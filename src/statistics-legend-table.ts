/**
 * Statistics Table and Legend Card
 *
 * A standalone legend: one row per configured statistic with a color swatch,
 * a name and aggregated values, clickable, plus an optional total row.
 *
 * Nothing here knows about any particular other card. The values come from this
 * card's own recorder queries (`src/data/`), the optional neighbouring card is
 * created generically through Lovelace's card helpers (`wrapped-card.ts`), and
 * the click interaction goes through pluggable adapters (`src/link/`). Removing
 * the `card:` and `link:` blocks leaves a fully working legend.
 */

import { LitElement, PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant } from "custom-card-helpers";

import { ResolvedConfig, columnsFor, normalizeConfig } from "./config/normalize";
import {
  StatisticsLegendTableCardConfig,
  LegendColumn,
  LegendConfig,
  LegendGroupResult,
  LegendRow,
} from "./config/types";
import { isDarkMode } from "./colors";
import { styleMap } from "lit/directives/style-map.js";

import { hassAffectsRender, onlyHassChanged } from "./hass-changes";
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
import {
  DEFAULT_PRECISION,
  buildLegendGroups,
  computeTotal,
  formatValue,
  hidesValues,
} from "./legend-stats";
import { legendStyles } from "./legend-styles";
import { LinkController } from "./link/controller";
import { GraphSelection, subscribeGraphSelection } from "./link/graph-selection";
import { LovelaceCardElement, createWrappedCard } from "./wrapped-card";

const COLUMN_LABELS: Record<LegendColumn, string> = {
  sum: "Σ",
  min: "Min",
  max: "Max",
  avg: "Ø",
};

/** How often a `relative` timespan is re-resolved and re-fetched */
const REFRESH_INTERVAL = 60_000;

/* Legend metrics, mirroring `legend-styles.ts`. They estimate the space the
   legend needs: the heights below feed `_legendHeight()`, the widths further
   down feed `_isNarrow()`. Both have to be kept in step with the stylesheet. */

/**
 * One legend line. `.legend-item` sets 14px, and Home Assistant inherits
 * `--ha-line-height-normal` (1.6) into every shadow root from `:host` in its
 * `styles.ts`, so a line is 22.4px. Rounded up, not down: every estimate here
 * errs towards reserving too much, because reserving too little clips.
 */
const LEGEND_LINE_HEIGHT = 23;
/** `gap` of `.legend` and `.legend-group` */
const LEGEND_GAP = 16;
/** `.legend` margin-top plus its bottom padding */
const LEGEND_PADDING = 24;
/** Extra margin-top of `.legend.standalone`, the legend without a `card:` block */
const LEGEND_STANDALONE_MARGIN = 8;
/** `row-gap` between the values of a row that had to stack them */
const LEGEND_STACKED_GAP = 2;

/**
 * The `title:` heading. Styled by `ha-card` itself, not here: `.card-header`
 * is slotted into it, and its `::slotted(.card-header)` rule sets
 * `--ha-font-size-2xl` (24px) at `--ha-line-height-expanded` (2) with a
 * `--ha-space-3` (12px) top padding. `legend-styles.ts` overrides the bottom
 * padding to 0, and the `h1` keeps its 0.67em user-agent margins.
 * 16.08 + 12 + 48 + 0 + 16.08, rounded up. The bottom margin collapses with
 * the legend's own `margin-top`, which makes this a few pixels generous — the
 * safe direction.
 */
const TITLE_HEIGHT = 93;

/** The error banner: one 22.4px line inside the 16px padding of `.notice` */
const NOTICE_HEIGHT = 55;

/* Widths deciding whether a row still fits on one line. No single breakpoint
   can: a lone `sum` column needs about 284px of row while all four need 584, so
   one threshold stacks the former far too eagerly and the latter not at all.
   The threshold is computed from the parts below instead — and computed here
   rather than in a container query, because a query condition cannot read a
   custom property, and because `_legendHeight()` has to reach the same verdict
   as the stylesheet. One source of truth, not two that can drift apart. */

/** First grid column of `.legend-item`, holding the color swatch */
const LEGEND_ICON_COLUMN = 52;
/** Column `gap` of `.legend-item` */
const LEGEND_ITEM_GAP = 12;
/** Left plus right padding of `.legend`, unavailable to a row */
const LEGEND_SIDE_PADDING = 32;
/**
 * Assumed width of one value column — about `1.234,56 kWh` at 14px. Estimated
 * and not measured on purpose: measuring the *name* would be circular, since
 * stacking changes the very width that decided to stack.
 */
const LEGEND_VALUE_WIDTH = 88;
/** Default for `legend.min_name_width`, roughly 16 characters at 14px */
const DEFAULT_MIN_NAME_WIDTH = 120;

/** `--ha-section-grid-row-gap` */
const GRID_ROW_GAP = 8;
/** One row of a Home Assistant section grid, including its gap
    (`--ha-section-grid-row-height` 56px + `GRID_ROW_GAP`). A card spanning n
    rows is given `n * GRID_ROW_HEIGHT - GRID_ROW_GAP` pixels — the trailing gap
    falls outside the card. */
const GRID_ROW_HEIGHT = 64;
/** Roughly one `getCardSize()` unit in a masonry view */
const MASONRY_UNIT = 50;

/**
 * A readable message for anything that can come out of a failed fetch.
 *
 * `hass.callWS()` does not reject with an `Error` but with a plain
 * `{code, message}` object, so the naive `String(err)` produced the useless
 * `[object Object]` in exactly the situation where the user needs to be told
 * what went wrong.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === "object") {
    const { message, code } = err as { message?: unknown; code?: unknown };
    if (typeof message === "string" && message) {
      return typeof code === "string" && code ? `${message} (${code})` : message;
    }
    if (typeof code === "string" && code) {
      return code;
    }
  }
  return typeof err === "string" && err ? err : "Could not load statistics";
}

@customElement("statistics-legend-table")
export class StatisticsLegendTableCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  /** Set by Home Assistant in section layouts, forwarded to the wrapped card */
  @property({ attribute: false }) public layout?: string;

  @state() private _config?: ResolvedConfig;
  @state() private _rows: LegendRow[] = [];
  @state() private _error?: string;

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
  /** Tracked so a system-triggered theme flip can rebuild rows without a fetch */
  private _darkMode = false;
  private _wrappedCard?: LovelaceCardElement;
  private _links = new LinkController(() => {
    this._linkNotified = true;
    this.requestUpdate();
  });
  /**
   * Set while an adapter reports changed visibility. Only read on the path
   * where `shouldUpdate()` is about to skip the render — see there.
   */
  private _linkNotified = false;

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
  /** The same guard for the wrapped card, which `setConfig()` rebuilds */
  private _wrappedCardToken = 0;

  /**
   * Rendered width of the card, undefined until the first measurement. Decides
   * whether the legend wraps its values — see `_isNarrow()`.
   */
  private _cardWidth?: number;
  private _resizeObserver?: ResizeObserver;

  /**
   * Entities whose state can change what a row looks like, i.e. the link
   * targets of every configured entity while an `entity` link is in play.
   * Empty otherwise, which is the common case — see `shouldUpdate()`.
   */
  private _watchedEntities: string[] = [];

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
      type: "custom:statistics-legend-table",
      entities: [{ statistic_id: statisticId }],
      legend: { columns: ["sum"] },
    } as StatisticsLegendTableCardConfig;
  }

  public setConfig(config: StatisticsLegendTableCardConfig): void {
    // Throws on genuinely unrenderable configs; the message surfaces in the
    // Lovelace editor.
    this._config = normalizeConfig(config);
    this._error = undefined;
    this._rows = [];
    this._statistics = {};
    this._metadata = {};
    this._metadataCache.clear();

    this._links.configure(
      this._config.links,
      this._config.entities
        .filter((entity) => entity.hiddenByDefault)
        .flatMap((entity) => entity.links)
    );

    // Resolved once per config rather than per update: the set only changes
    // with the config, and `shouldUpdate()` runs on every state change.
    this._watchedEntities = this._links.tracksEntities()
      ? [...new Set(this._config.entities.flatMap((entity) => entity.links))]
      : [];

    this._selection = undefined;

    void this._setupWrappedCard(config);
    this._updateSelectionSubscription();
    this._restartTimespan();
  }

  /* ---------------------------------------------------------------------- */
  /* Wrapped card                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Builds the element for the `card:` block.
   *
   * Guarded by a token for the same reason `_fetch()` is: `setConfig()` runs on
   * every keystroke in the Lovelace editor, and this is asynchronous, so two
   * calls can resolve in the opposite order and leave the card of the *older*
   * config standing. The token makes a superseded call drop its result.
   *
   * `requestUpdate()` runs in a `finally` so the legend renders even when
   * building the inner card failed outright — without it a rejection left the
   * card silent as well as empty.
   */
  private async _setupWrappedCard(config: StatisticsLegendTableCardConfig): Promise<void> {
    const token = ++this._wrappedCardToken;

    try {
      if (!config.card) {
        this._wrappedCard = undefined;
        return;
      }

      const element = await createWrappedCard(config.card);
      if (token !== this._wrappedCardToken) {
        return; // a newer config won while this one was building
      }

      this._wrappedCard = element;
      if (this._wrappedCard) {
        if (this.hass) {
          this._wrappedCard.hass = this.hass;
        }
        if (this.layout !== undefined) {
          this._wrappedCard.layout = this.layout;
        }
      }
    } finally {
      if (token === this._wrappedCardToken) {
        this.requestUpdate();
      }
    }
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
      this._error = describeError(err);
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

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Skips the render for a `hass` update that cannot change what is rendered.
   *
   * `hass` is a reactive property and Home Assistant replaces it on every state
   * change in the whole house, so without this the card re-rendered — and
   * re-walked the shadow DOM in `updated()` — several times a second on a busy
   * installation, for values that are refetched on a timer anyway.
   *
   * Two traps make this less trivial than it reads, both verified rather than
   * assumed. Lit calls `shouldUpdate()` *before* `willUpdate()`
   * (`reactive-element.js:893`), so returning `false` skips `willUpdate()` too
   * — forwarding `hass` to the wrapped card therefore has to happen here, for
   * every update, or the embedded card would stop receiving state. And a bare
   * `requestUpdate()` leaves `changedProps` empty, which
   * `onlyHassChanged()` deliberately reports as "not just hass".
   */
  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (changedProps.has("hass") && this._wrappedCard && this.hass) {
      this._wrappedCard.hass = this.hass;
    }

    if (!onlyHassChanged(changedProps)) {
      return true;
    }

    const previous = changedProps.get("hass") as HomeAssistant | undefined;
    if (!previous || !this.hass) {
      return true; // first hass, or it went away — willUpdate() has work to do
    }

    if (hassAffectsRender(previous, this.hass, this._watchedEntities)) {
      return true;
    }

    // The render is skipped, so `updated()` will not run — and with it neither
    // would the re-read of the chart's hidden set, which can change without any
    // event (`_updateHiddenStatsFromOptions()` fills it from `legend.selected`
    // on every options update). Dropping it would let the mirrored state drift
    // again, exactly the way the chart fix removed. `sync()` does that re-read
    // and, beyond it, only replaces a chart the wrapped card has thrown away
    // in a render of its own — the DOM is not searched on every update.
    //
    // An adapter noticing a change calls `notify()`, i.e. `requestUpdate()` —
    // which Lit swallows here, because the pending update it would schedule is
    // the very one being answered (`__markUpdated()` clears it on this path).
    // Hence the flag rather than a second `requestUpdate()`.
    this._linkNotified = false;
    this._links.sync(this, this._wrappedCard, this.hass);
    return this._linkNotified;
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has("hass")) {
      // `mode: energy` needs `hass` to subscribe, which may only arrive after
      // setConfig(); the first hass sets everything in motion.
      const previous = changedProps.get("hass") as HomeAssistant | undefined;
      if (!previous && this.hass) {
        this._restartTimespan();
      }

      // Swatch colors may differ per theme mode (`color: {light, dark}`); a
      // system-triggered flip changes `hass.themes.darkMode` without any other
      // config change, so rows are rebuilt in place instead of refetched.
      const darkMode = isDarkMode(this.hass);
      if (darkMode !== this._darkMode) {
        this._darkMode = darkMode;
        if (this._config && this._rows.length) {
          this._rows = buildRows(this._config.entities, this._statistics, this._metadata, this.hass);
        }
      }
    }
    if (changedProps.has("layout") && this._wrappedCard) {
      this._wrappedCard.layout = this.layout;
    }
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    // Re-resolved on every update: the wrapped card may only have rendered its
    // chart by now, and Home Assistant can recreate it across view switches.
    this._links.attach(this, this._wrappedCard, this.hass);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (this._config) {
      this._updateSelectionSubscription();
      this._restartTimespan();
    }
    this._links.attach(this, this._wrappedCard, this.hass);
    this._startResizeObserver();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTimespan();
    this._stopSelection();
    this._links.detach();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  /**
   * Tracks the card's width, which is what decides whether a group stacks its
   * values. Only a group actually changing its verdict matters, so a render is
   * requested for that and not for every pixel of a resize.
   */
  private _startResizeObserver(): void {
    if (this._resizeObserver || typeof ResizeObserver === "undefined") {
      return;
    }
    this._resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      // `contentRect` is 0x0 for a host that is not a block box; `offsetWidth`
      // still answers there, so a stray inline host cannot silently pin the
      // card to its stacked layout again.
      const width = entry?.contentRect?.width || (entry?.target as HTMLElement)?.offsetWidth;
      if (typeof width !== "number" || !width || width === this._cardWidth) {
        return;
      }
      const before = this._narrowPerGroup();
      this._cardWidth = width;
      const after = this._narrowPerGroup();
      if (before.length !== after.length || before.some((was, i) => was !== after[i])) {
        this.requestUpdate();
      }
    });
    this._resizeObserver.observe(this);
  }

  /** The stacking verdict of every group, used to spot a change on resize */
  private _narrowPerGroup(): boolean[] {
    return this._groups().map((group) => this._isNarrow(group.config));
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering                                                               */
  /* ---------------------------------------------------------------------- */

  private get _legendConfig(): LegendConfig {
    return this._config?.raw.legend ?? {};
  }

  private _groups(): LegendGroupResult[] {
    return buildLegendGroups(this._rows, this._legendConfig);
  }

  private _localize = (key: string, fallback: string): string =>
    (this.hass as unknown as { localize?: (key: string) => string })?.localize?.(key) || fallback;

  private _format(value: number, precision: number): string {
    return formatValue(value, precision, this.hass?.locale?.language);
  }

  private _handleLegendClick(row: LegendRow): void {
    this._links.toggle(row.links);
  }

  protected render() {
    if (!this._config) {
      return nothing;
    }

    const groups = this._groups();

    return html`
      <ha-card>
        ${this._config.raw.title
          ? html`<h1 class="card-header">${this._config.raw.title}</h1>`
          : nothing}
        ${this._wrappedCard
          ? html`<div class="card-slot">${this._wrappedCard}</div>`
          : nothing}
        ${this._error ? html`<div class="notice">${this._error}</div>` : nothing}
        ${groups.some((group) => group.rows.length)
          ? html`<div class="legend${this._config.raw.card ? "" : " standalone"}">
              ${groups.map((group) => this._renderGroup(group))}
            </div>`
          : nothing}
      </ha-card>
    `;
  }

  private _renderGroup(group: LegendGroupResult) {
    if (!group.rows.length) {
      return nothing;
    }

    const columns = columnsFor(group.config.columns);
    // 52px color cell + flexible name + one column per value
    const gridColumns = `52px 1fr ${columns.map(() => "auto").join(" ")}`;
    const visibleRows = group.rows.filter((row) => !this._links.isHidden(row.links));
    const total = computeTotal(visibleRows, group.config, this._statistics, this._localize);

    return html`
      <div class="legend-group${this._isNarrow(group.config) ? " narrow" : ""}">
        ${group.name ? html`<div class="legend-group-title">${group.name}</div>` : nothing}
        ${group.config.show_headers
          ? html`
              <div class="legend-headers" style="--ecl-columns: ${gridColumns}">
                <span></span>
                <span></span>
                ${columns.map(
                  (column) => html`<span class="legend-value">${COLUMN_LABELS[column]}</span>`
                )}
              </div>
            `
          : nothing}
        ${group.rows.map((row) => this._renderRow(row, group.config, columns, gridColumns))}
        ${total
          ? html`
              <div class="legend-total">
                <span class="legend-name">${total.name}</span>
                <span class="legend-value">
                  ${this._format(total.value, total.precision)}${total.unit ? ` ${total.unit}` : ""}
                </span>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderRow(
    row: LegendRow,
    config: LegendConfig,
    columns: LegendColumn[],
    gridColumns: string
  ) {
    const hidden = this._links.isHidden(row.links);
    const precision = config.precision ?? DEFAULT_PRECISION;
    const showUnit = config.show_unit !== false;
    const unit = showUnit && row.unit ? ` ${row.unit}` : "";
    const valuesHidden = hidesValues(row, this._selection !== undefined);

    return html`
      <div
        class="legend-item ${hidden ? "hidden" : ""}"
        style="--ecl-columns: ${gridColumns}"
        role="button"
        tabindex="0"
        aria-pressed=${!hidden}
        @click=${() => this._handleLegendClick(row)}
        @keydown=${(ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            this._handleLegendClick(row);
          }
        }}
      >
        <span
          class="legend-icon"
          style=${styleMap({
            backgroundColor: hidden ? "transparent" : row.fillColor,
            borderColor: row.color,
          })}
        ></span>
        <span class="legend-name">${row.name}</span>
        ${valuesHidden
          ? columns.map(() => html`<span class="legend-value"></span>`)
          : columns.map(
              (column) => html`<span class="legend-value"
                >${this._format(row[column], precision)}${unit}</span
              >`
            )}
      </div>
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* Sizing                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Approximate height in pixels the legend adds on top of the wrapped card.
   *
   * Estimated rather than measured because both callers run before layout. The
   * previous estimate counted half a row per legend row, which assumed a
   * two-column layout — but `.legend-group` is `flex-direction: column`, so
   * every row is a line of its own. In a section that under-estimate clipped the
   * legend outright: a numeric `rows` puts Home Assistant's grid into
   * `fit-rows`, which pins the card to `rows * 64 - 8` pixels.
   *
   * Headings and column headers use a smaller font than the rows but are
   * counted as full lines. Over-estimating costs some whitespace;
   * under-estimating costs content.
   */
  private _legendHeight(): number {
    const groups = this._groups().filter((group) => group.rows.length);
    if (!groups.length) {
      return 0;
    }

    let height = LEGEND_PADDING + (this._config?.raw.card ? 0 : LEGEND_STANDALONE_MARGIN);
    let blocks = 0;

    groups.forEach((group) => {
      const narrow = this._isNarrow(group.config);
      // A stacking group puts every value on a line of its own beneath the name
      // and hides the header row entirely, so a row is `1 + columns` lines tall
      // rather than one — with the default single `sum` column already twice
      // the height, and with all four columns five times.
      const columns = columnsFor(group.config.columns).length;
      const rowHeight = narrow
        ? LEGEND_LINE_HEIGHT + columns * (LEGEND_LINE_HEIGHT + LEGEND_STACKED_GAP)
        : LEGEND_LINE_HEIGHT;

      const heading = group.name ? 1 : 0;
      const headers = group.config.show_headers && !narrow ? 1 : 0;
      const total = group.config.total && group.config.total.mode !== "none" ? 1 : 0;

      height += group.rows.length * rowHeight + (heading + headers + total) * LEGEND_LINE_HEIGHT;
      blocks += group.rows.length + heading + headers + total;
    });

    // Every gap-separated block but the first carries one gap: within a group
    // from `.legend-group`, between groups from `.legend` — both are the same
    // size, so the whole legend simply has `blocks - 1` of them.
    return height + Math.max(0, blocks - 1) * LEGEND_GAP;
  }

  /**
   * Whether a group's rows have to stack their values below the name.
   *
   * Decided per group, not per card: `legend.groups[]` may override `columns`,
   * and a group with one value column needs a completely different amount of
   * room than one with four. A single verdict for the whole card would be wrong
   * for one of them.
   *
   * The width itself is measured, since nothing here can know it ahead of
   * layout. Until the first measurement lands the stacked layout is assumed —
   * it is the taller of the two, and reserving too much costs whitespace while
   * reserving too little clips the legend. Home Assistant re-reads
   * `getGridOptions()` on every render of the section and the section renders on
   * every `hass` update, so an over-reservation corrects itself within a second.
   */
  private _isNarrow(config: LegendConfig): boolean {
    const cardWidth = this._measuredWidth();
    if (cardWidth === undefined) {
      return true;
    }

    const columns = columnsFor(config.columns).length;
    const minNameWidth =
      typeof config.min_name_width === "number" && config.min_name_width >= 0
        ? config.min_name_width
        : DEFAULT_MIN_NAME_WIDTH;

    const required =
      LEGEND_ICON_COLUMN +
      LEGEND_ITEM_GAP +
      minNameWidth +
      columns * (LEGEND_VALUE_WIDTH + LEGEND_ITEM_GAP);

    // The legend's own horizontal padding is not available to a row.
    return cardWidth - LEGEND_SIDE_PADDING < required;
  }

  /**
   * The card's width, from the observer if it has reported and read directly
   * otherwise.
   *
   * The direct read forces a layout, so its result is kept: `_isNarrow()` runs
   * once per group per render, and where no observer ever reports — it is
   * optional, and a host that is not a block box measures 0 — an unremembered
   * read would force one on every one of them, for as long as the card is on
   * screen. Reading at all is worth it because the alternative is worse: a
   * single missed measurement would leave the card on its conservative
   * assumption, stacked, however much room it actually has.
   */
  private _measuredWidth(): number | undefined {
    if (this._cardWidth === undefined && this.offsetWidth > 0) {
      this._cardWidth = this.offsetWidth;
    }
    return this._cardWidth;
  }

  /**
   * Everything this card renders around the wrapped one: the `title:` heading,
   * the error banner, and the legend itself. All three are outside the wrapped
   * card's own size, so all three have to be added to it.
   */
  private _extraHeight(): number {
    return (
      (this._config?.raw.title ? TITLE_HEIGHT : 0) +
      (this._error ? NOTICE_HEIGHT : 0) +
      this._legendHeight()
    );
  }

  /** Grid rows this card needs on top of whatever the wrapped card needs */
  private _extraRows(): number {
    const height = this._extraHeight();
    // n rows are worth `n * GRID_ROW_HEIGHT - GRID_ROW_GAP` pixels, so the gap
    // has to be added back before dividing — without it the content lands one
    // or two pixels short of a row boundary and is clipped again.
    return height ? Math.ceil((height + GRID_ROW_GAP) / GRID_ROW_HEIGHT) : 0;
  }

  public async getCardSize(): Promise<number> {
    const innerSize = this._wrappedCard ? ((await this._wrappedCard.getCardSize?.()) ?? 6) : 0;
    const height = this._extraHeight();
    return innerSize + (height ? Math.ceil(height / MASONRY_UNIT) : 0);
  }

  /**
   * Grid size of the card.
   *
   * Without a `card:` block the legend *is* the card, and its height is left to
   * the browser: `rows: "auto"` is what Home Assistant defaults to for a card
   * that reports no rows at all (`DEFAULT_GRID_SIZE`), and what its own layout
   * editor offers as "Auto height". A number instead puts the section grid into
   * `fit-rows`, which pins the card to `rows * 64 - 8` pixels — every pixel the
   * estimate falls short then clips the legend rather than merely crowding it.
   * There is nothing to estimate here that the browser does not measure better.
   *
   * With a `card:` block the rows stay a number: the embedded card reports its
   * own (`energy-custom-graph` asks for 4 to 6) because its chart needs a
   * definite height to size to, and `auto` would take that away.
   *
   * `min_rows` stays a number either way. The grid ignores it while rows are
   * `auto`, but the layout editor falls back to it as the starting height when
   * someone switches "Auto height" off — better a measured number than its `1`.
   */
  public getGridOptions(): Record<string, unknown> {
    const innerOptions = this._wrappedCard?.getGridOptions?.() ?? {};
    const extra = this._extraRows();
    const base = this._wrappedCard ? 6 : 0;
    const rows = typeof innerOptions.rows === "number" ? innerOptions.rows : base;
    const minRows = typeof innerOptions.min_rows === "number" ? innerOptions.min_rows : base;
    // The wrapped card may cap itself at fewer rows than the legend now needs;
    // a `max_rows` below `rows` would clip the legend again.
    const maxRows =
      typeof innerOptions.max_rows === "number"
        ? Math.max(innerOptions.max_rows + extra, rows + extra)
        : undefined;

    return {
      ...innerOptions,
      rows: this._wrappedCard ? rows + extra : "auto",
      min_rows: minRows + extra,
      ...(maxRows === undefined ? {} : { max_rows: maxRows }),
    };
  }

  static styles = [
    legendStyles,
    css`
      /* The wrapped card brings its own <ha-card>; neutralize it so it and the
         legend share this card's surface. */
      .wrapped-card {
        display: block;
        --ha-card-background: transparent;
        --ha-card-box-shadow: none;
        --ha-card-border-width: 0;
        --ha-card-border-radius: 0;
        --card-background-color: transparent;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "statistics-legend-table": StatisticsLegendTableCard;
  }
}
