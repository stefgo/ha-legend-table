/**
 * `custom:statistics-legend-table`
 *
 * A standalone legend: one row per configured statistic with a color swatch,
 * a name and aggregated values, clickable, plus an optional total row.
 *
 * The values come from this card's own recorder queries (`src/data/`); what it
 * shares with `entity-legend-table` — rendering, the `card:` block, the links
 * and sizing — lives in `LegendTableBase`. Here are only the timespan, the
 * fetch and the graph selection.
 */

import { customElement } from "lit/decorators.js";
import type { HomeAssistant } from "custom-card-helpers";

import {
  ResolvedConfig,
  ResolvedEntity,
  columnsFor,
  normalizeConfig,
} from "./config/normalize-statistics";
import type {
  LegendColumn,
  LegendConfig,
  LegendRow,
  StatisticsLegendTableCardConfig,
} from "./config/types";
import {
  buildRows,
  collectRatioTotals,
  collectStatTypes,
  collectStatisticIds,
} from "./data/aggregate";
import { findEnergyCollection, subscribeEnergyRange } from "./data/energy-collection";
import {
  Statistics,
  StatisticsMetadata,
  StatisticsMetadataCache,
  fetchStatistics,
} from "./data/statistics";
import {
  ResolvedTimespan,
  periodFor,
  periodForSelection,
  resolveTimespan,
} from "./data/timespan";
import { RatioSum, hidesValues, statisticsRatioSum } from "./legend-stats";
import { LegendTableBase, describeError } from "./legend-table-base";
import { GraphSelection, subscribeGraphSelection } from "./link/graph-selection";
import { STATISTICS_CARD_NAME } from "./version";

const COLUMN_LABELS: Record<LegendColumn, string> = {
  sum: "Σ",
  min: "Min",
  max: "Max",
  avg: "Ø",
};

/** How often a `relative` timespan is re-resolved and re-fetched */
const REFRESH_INTERVAL = 60_000;

@customElement(STATISTICS_CARD_NAME)
export class StatisticsLegendTableCard extends LegendTableBase<
  StatisticsLegendTableCardConfig,
  ResolvedEntity
> {
  /** Raw buckets kept for `legend.total.mode: ratio`, which bypasses the rows */
  private _statistics: Statistics = {};
  /** Kept alongside `_statistics` so rows can be rebuilt without refetching */
  private _metadata: StatisticsMetadata = {};
  /**
   * Metadata survives a refresh — it answers what a statistic is called and
   * which unit it is stored in, neither of which changes while the dashboard is
   * open. Cleared on a config change, which is the only thing that can change
   * the set of ids it holds.
   */
  private _metadataCache = new StatisticsMetadataCache();

  private _unsubscribeEnergy?: () => void;
  private _unsubscribeSelection?: () => void;
  private _refreshTimer?: number;
  /** Range currently displayed; for `mode: energy` it comes from the date picker */
  private _range?: ResolvedTimespan;
  /**
   * Period selected in a neighbouring `custom-graph-card`. While set it takes
   * the place of `_range` for every value the legend shows; clearing the
   * selection in the graph brings the configured range back.
   */
  private _selection?: ResolvedTimespan;
  /** Guards against an out-of-order fetch overwriting a newer one */
  private _fetchToken = 0;

  /**
   * Configuration the card picker previews the card with.
   *
   * It used to return `entities: []`, which `normalizeConfig()` rejects by
   * design — so adding the card showed an error where a preview belongs, which
   * is the worst possible first impression. A statistic is picked from the
   * entities Home Assistant offers: one with a `state_class`, since only those
   * have long-term statistics at all. Nothing suitable leaves a placeholder,
   * which renders an empty legend instead of an error.
   */
  public static getStubConfig(
    hass?: HomeAssistant,
    entities?: string[],
    entitiesFallback?: string[]
  ): StatisticsLegendTableCardConfig {
    const candidates = [...(entities ?? []), ...(entitiesFallback ?? [])];
    const statisticId =
      candidates.find((entityId) => hass?.states?.[entityId]?.attributes?.state_class) ??
      "sensor.example_energy";

    return {
      type: `custom:${STATISTICS_CARD_NAME}`,
      entities: [{ statistic_id: statisticId }],
      legend: { columns: ["sum"] },
    } as StatisticsLegendTableCardConfig;
  }

  /* ---------------------------------------------------------------------- */
  /* Hooks of LegendTableBase                                                */
  /* ---------------------------------------------------------------------- */

  protected _normalize(config: StatisticsLegendTableCardConfig): ResolvedConfig {
    return normalizeConfig(config);
  }

  protected _onConfig(): void {
    this._statistics = {};
    this._metadata = {};
    this._metadataCache.clear();
    this._selection = undefined;

    this._updateSelectionSubscription();
    this._restartTimespan();
  }

  // `mode: energy` needs `hass` to subscribe, which may only arrive after
  // setConfig(); the first hass sets everything in motion.
  protected _onFirstHass(): void {
    this._restartTimespan();
  }

  protected _onConnected(): void {
    this._updateSelectionSubscription();
    this._restartTimespan();
  }

  protected _onDisconnected(): void {
    this._stopTimespan();
    this._stopSelection();
  }

  protected _buildRows(): LegendRow[] {
    return this._config
      ? buildRows(this._config.entities, this._statistics, this._metadata, this.hass)
      : [];
  }

  protected _columns(config: LegendConfig): string[] {
    return columnsFor(config.columns);
  }

  protected _columnLabel(column: string): string {
    return COLUMN_LABELS[column as LegendColumn] ?? column;
  }

  protected _cellValue(row: LegendRow, column: string): number {
    return row[column as LegendColumn];
  }

  protected _valuesHidden(row: LegendRow): boolean {
    return hidesValues(row, this._selection !== undefined);
  }

  protected _ratioSum(): RatioSum {
    return statisticsRatioSum(this._statistics);
  }

  /* ---------------------------------------------------------------------- */
  /* Timespan and data                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Restarts whatever drives the displayed range: a subscription to the energy
   * date picker for `mode: energy`, a periodic re-resolve for `mode: relative`,
   * or a one-off resolve for `mode: fixed`.
   */
  private _restartTimespan(): void {
    this._stopTimespan();

    const timespan = this._config?.raw.timespan;
    const mode = timespan?.mode ?? "energy";

    if (mode === "energy") {
      if (!this.hass) {
        return; // retried from willUpdate() once hass arrives
      }
      this._unsubscribeEnergy = subscribeEnergyRange(
        this.hass,
        timespan?.collection_key,
        (range) => this._setRange(range),
        // No energy dashboard on this view: fall back to today so the legend
        // shows data rather than staying empty forever.
        () => this._startEnergyFallback()
      );
      return;
    }

    const range = resolveTimespan(timespan);
    if (range) {
      this._setRange(range);
    }

    if (mode === "relative") {
      this._refreshTimer = window.setInterval(() => {
        const next = resolveTimespan(this._config?.raw.timespan);
        if (next) {
          this._setRange(next);
        }
      }, REFRESH_INTERVAL);
    }
  }

  /**
   * Fallback for `mode: energy` when no energy collection can be found.
   *
   * Showing today once and then stopping left the legend frozen: no refresh, so
   * the values aged for as long as the dashboard stayed open, and past midnight
   * it showed the wrong day outright. It now behaves like `mode: relative` with
   * `period: day` — and re-checks for the collection on every tick, so a
   * dashboard whose energy card only appeared later is picked up instead of
   * being missed for the rest of the session.
   */
  private _startEnergyFallback(): void {
    const today = () => resolveTimespan({ mode: "relative", period: "day" })!;
    this._setRange(today());

    if (this._refreshTimer !== undefined) {
      return;
    }
    this._refreshTimer = window.setInterval(() => {
      const collectionKey = this._config?.raw.timespan?.collection_key;
      if (this.hass && findEnergyCollection(this.hass, collectionKey)) {
        // The real thing turned up — hand back over to the date picker.
        this._restartTimespan();
        return;
      }
      this._setRange(today());
    }, REFRESH_INTERVAL);
  }

  private _stopTimespan(): void {
    this._unsubscribeEnergy?.();
    this._unsubscribeEnergy = undefined;
    if (this._refreshTimer !== undefined) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  private _setRange(range: ResolvedTimespan): void {
    this._range = range;
    // A selection outside the new range is stale — it points into the range
    // that was just left. The graph clears its own marker on a range switch
    // too, but the order of the two events is not guaranteed, so the legend
    // does not rely on it. A selection that still lies inside the new range is
    // kept, which is what makes a `relative` timespan usable: its window moves
    // on every refresh without dropping the selection each time.
    const selection = this._selection;
    if (
      selection &&
      (selection.start.getTime() < range.start.getTime() ||
        selection.start.getTime() >= range.end.getTime())
    ) {
      this._selection = undefined;
    }
    void this._fetch();
  }

  private async _fetch(): Promise<void> {
    const config = this._config;
    const range = this._selection ?? this._range;
    if (!config || !range || !this.hass) {
      return;
    }

    // Both the top-level total and any group override may be a ratio, and each
    // names its own operands — a group ratio whose statistics went unfetched
    // rendered a constant 0 %.
    const ratioTotals = collectRatioTotals(config.raw.legend);
    const statisticIds = collectStatisticIds(config.entities, ratioTotals);
    const statTypes = collectStatTypes(config.entities, ratioTotals);
    const period = this._selection
      ? periodForSelection(config.raw.aggregation?.period, range)
      : periodFor(config.raw.aggregation?.period, range);

    const token = ++this._fetchToken;
    try {
      const result = await fetchStatistics(
        this.hass,
        statisticIds,
        range.start,
        range.end,
        period,
        statTypes,
        this._metadataCache
      );
      if (token !== this._fetchToken) {
        return; // a newer fetch already landed
      }
      this._statistics = result.statistics;
      this._metadata = result.metadata;
      this._rows = buildRows(config.entities, result.statistics, result.metadata, this.hass);
      this._error = undefined;
    } catch (err) {
      if (token !== this._fetchToken) {
        return;
      }
      this._error = describeError(err, "Could not load statistics");
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Graph selection                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * (Un)subscribes to the `custom-graph-selection` event of the card in the
   * `card:` block, according to `timespan.follow_selection` (defaults to on).
   */
  private _updateSelectionSubscription(): void {
    const follow = this._config?.raw.timespan?.follow_selection !== false;
    if (!follow) {
      this._stopSelection();
      return;
    }
    if (this._unsubscribeSelection) {
      return;
    }
    // Bound to this element and to the wrapped card, so only the graph this
    // legend actually embeds can move its range.
    this._unsubscribeSelection = subscribeGraphSelection(
      this,
      () => this._wrappedCard,
      (selection) => this._applySelection(selection)
    );
  }

  private _stopSelection(): void {
    this._unsubscribeSelection?.();
    this._unsubscribeSelection = undefined;
  }

  /**
   * Takes over the period a graph reports, or falls back to the configured
   * range when the selection is cleared. The values are refetched for that
   * period rather than derived from the ones already held: the graph buckets
   * on its own axis, so the period may be finer than anything this card has
   * queried, and a fetch is the only answer that stays correct for `sum`,
   * `min`/`max`/`avg`, calculated rows and `total.mode: ratio` alike.
   */
  private _applySelection(selection: GraphSelection | undefined): void {
    const next = selection ? this._selectionRange(selection) : undefined;

    const same =
      next?.start.getTime() === this._selection?.start.getTime() &&
      next?.end.getTime() === this._selection?.end.getTime();
    if (same) {
      return;
    }

    this._selection = next;
    void this._fetch();
  }

  /**
   * The selected period as a closed range. An open-ended last bucket — the
   * graph reports no `end` for it — runs to the end of the configured range,
   * so the still-running bucket shows the values it has so far.
   */
  private _selectionRange(selection: GraphSelection): ResolvedTimespan | undefined {
    const fallbackEnd = this._range?.end ?? new Date();
    const end = selection.end ?? fallbackEnd;
    return end.getTime() > selection.start.getTime()
      ? { start: selection.start, end }
      : undefined;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "statistics-legend-table": StatisticsLegendTableCard;
  }
}
