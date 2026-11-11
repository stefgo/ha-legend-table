/**
 * Grouping and the closing total row.
 *
 * Hidden rows are excluded from the `sum` total, mirroring the behaviour of the
 * legend in Home Assistant's own energy cards. The `ratio` total is computed
 * from raw statistics instead (see `computeTotal()`) and is therefore unaffected
 * by which rows are currently hidden.
 */

import { DEFAULT_PRECISION } from "./config/normalize-common";
import type {
  IndicatorMode,
  LegendConfig,
  LegendGroupOverrides,
  LegendGroupResult,
  LegendRow,
  LegendTotal,
  LegendTotalConfig,
  StatType,
} from "./config/types";
import type { Statistics } from "./data/statistics";

export { DEFAULT_PRECISION };

/**
 * `hide_zero`: drops rows without a value or with a zero one. A row showing
 * text (a live state such as `on`) has a value even though its `sum` is 0.
 */
function filterHideZero(rows: LegendRow[], config: LegendConfig): LegendRow[] {
  return config.hide_zero
    ? rows.filter((row) => !(row.count === 0 || (row.text === undefined && row.sum === 0)))
    : rows;
}

function resolveGroupConfig(base: LegendConfig, override: LegendGroupOverrides): LegendConfig {
  return {
    columns: override.columns ?? base.columns,
    precision: override.precision ?? base.precision,
    show_unit: override.show_unit ?? base.show_unit,
    hide_zero: override.hide_zero ?? base.hide_zero,
    show_headers: override.show_headers ?? base.show_headers,
    min_name_width: override.min_name_width ?? base.min_name_width,
    indicator: override.indicator ?? base.indicator,
    total: override.total ?? base.total,
  };
}

/**
 * What a row shows in front of its name: its own `indicator`, else the one of
 * its group (which already falls back to the legend's), else `box`.
 *
 * An icon mode without an icon degrades instead of leaving a gap: `icon` to
 * the color box, so the row keeps its color, and `plain_icon` to nothing, since
 * it was never meant to show a color.
 */
export function resolveIndicator(row: LegendRow, config: LegendConfig): IndicatorMode {
  const mode = row.indicator ?? config.indicator ?? "box";
  if (!row.icon) {
    if (mode === "icon") {
      return "box";
    }
    if (mode === "plain_icon") {
      return "none";
    }
  }
  return mode;
}

/**
 * Whether the legend needs the indicator column at all: some row of some group
 * shows something. Decided for the whole legend, not per group, so the names of
 * every group start at the same position — a group whose rows show nothing
 * keeps the empty column instead of moving its names to the left edge.
 */
export function needsIndicatorColumn(groups: LegendGroupResult[]): boolean {
  return groups.some((group) =>
    group.rows.some((row) => resolveIndicator(row, group.config) !== "none")
  );
}

/**
 * Splits rows into groups per `legend.groups`. Without groups this returns a
 * single unnamed group holding every row. Rows claimed by an earlier group are
 * unavailable to later ones (first match wins); rows matched by no group land in
 * a trailing, unnamed group using the top-level config — nothing is ever lost,
 * even when `groups` does not cover every entity.
 */
export function buildLegendGroups(allRows: LegendRow[], config: LegendConfig): LegendGroupResult[] {
  const groupConfigs = config.groups ?? [];

  if (!groupConfigs.length) {
    return [{ config, rows: filterHideZero(allRows, config) }];
  }

  const claimed = new Set<string>();
  const results: LegendGroupResult[] = groupConfigs.map((group) => {
    const selectors = group.entities ?? [];
    const matched = allRows.filter((row) => {
      if (claimed.has(row.id)) {
        return false;
      }
      const isMatch = selectors.some((selector) => matchesSelector(row, selector));
      if (isMatch) {
        claimed.add(row.id);
      }
      return isMatch;
    });
    const resolvedConfig = resolveGroupConfig(config, group);
    return { name: group.name, config: resolvedConfig, rows: filterHideZero(matched, resolvedConfig) };
  });

  const remainder = allRows.filter((row) => !claimed.has(row.id));
  results.push({ config, rows: filterHideZero(remainder, config) });

  return results;
}

/**
 * Matches a user supplied selector against a row.
 *
 * A selector matches the row's `key` or its displayed `name`, so a config can
 * refer to rows by whichever is more readable.
 */
export function matchesSelector(row: LegendRow, selector: string): boolean {
  const needle = selector.trim();
  if (!needle) {
    return false;
  }
  return row.id === needle || row.name === needle;
}

/**
 * True when a row is excluded from `total: {mode: sum}`.
 *
 * Every row but an `always` one, including a `selection` row while its values
 * are on screen: a row that carries no meaningful total over the range does not
 * gain one by having a bucket selected, and the total would otherwise jump as
 * the selection comes and goes.
 */
export function isExcludedFromValues(row: LegendRow): boolean {
  return row.showValues !== "always";
}

/**
 * True when a row renders its value columns empty.
 *
 * `never` hides them for good; `selection` hides them only outside a selection —
 * the one period for which a row that carries no meaningful total (a price, a
 * state of charge, a reference line) does have a value worth reading.
 */
export function hidesValues(row: LegendRow, selectionActive: boolean): boolean {
  return row.showValues === "never" || (row.showValues === "selection" && !selectionActive);
}

/** Sums one statistic's raw buckets for the given type, ignoring gaps */
function sumRawStatistic(statistics: Statistics, statisticId: string, statType: StatType): number {
  const buckets = statistics[statisticId.trim()];
  if (!Array.isArray(buckets)) {
    return 0;
  }
  return buckets.reduce((total, bucket) => {
    const value = bucket?.[statType];
    return typeof value === "number" && Number.isFinite(value) ? total + value : total;
  }, 0);
}

/**
 * Sums the operands of a `total: {mode: ratio}`. Each card answers this from
 * its own source: the statistics card from raw recorder buckets, the entity
 * card from current states.
 */
export type RatioSum = (ids: string[], statType: StatType) => number;

/** The `RatioSum` of the statistics card, over the raw buckets it fetched */
export function statisticsRatioSum(statistics: Statistics): RatioSum {
  return (statisticIds, statType) =>
    statisticIds.reduce((total, id) => total + sumRawStatistic(statistics, id, statType), 0);
}

/**
 * Computes the closing total row.
 *
 * `mode: "sum"` sums the *visible* rows passed in. `mode: "ratio"` sums the
 * ids of `total.numerator`/`total.denominator` directly through `ratioSum` —
 * these name statistics or entities, not legend rows, so a ratio also works for
 * ids that never became a row of their own, and row visibility has no effect
 * on it.
 *
 * `fallbackPrecision` is used for a sum when neither the total nor the legend
 * sets a precision.
 *
 * Returns `undefined` when no total row should be rendered.
 */
export function computeTotal(
  visibleRows: LegendRow[],
  config: LegendConfig,
  ratioSum: RatioSum,
  localize: (key: string, fallback: string) => string,
  fallbackPrecision: number = DEFAULT_PRECISION
): LegendTotal | undefined {
  const total: LegendTotalConfig | undefined = config.total;
  if (!total || total.mode === "none") {
    return undefined;
  }

  if (total.mode === "ratio") {
    const statType = total.stat_type ?? "change";
    const numerator = ratioSum(total.numerator ?? [], statType);
    const denominator = ratioSum(total.denominator ?? [], statType);

    return {
      name:
        total.name ??
        localize("ui.panel.lovelace.cards.energy.energy_usage_graph.autarky", "Autarkie"),
      value: denominator === 0 ? 0 : (numerator / denominator) * 100,
      unit: total.unit ?? "%",
      precision: total.precision ?? 1,
    };
  }

  // mode "sum" (default). A row showing text instead of a number — a live
  // state such as `on`, or one that is unavailable — has nothing to add.
  const rows = visibleRows.filter((row) => !isExcludedFromValues(row) && row.text === undefined);
  const precision = config.precision ?? fallbackPrecision;
  const value = rows.reduce((sum, row) => sum + row.sum, 0);
  const units = new Set(rows.map((row) => row.unit).filter((unit) => unit));

  return {
    name: total.name ?? localize("ui.panel.lovelace.cards.energy.energy_usage_graph.total", "Gesamt"),
    // A mixed-unit sum is meaningless; the unit is dropped in that case.
    unit: total.unit ?? (units.size === 1 ? [...units][0] : ""),
    value,
    precision: total.precision ?? precision,
  };
}

/** Formats a number using the Home Assistant locale */
export function formatValue(
  value: number,
  precision: number,
  language: string | undefined
): string {
  try {
    return new Intl.NumberFormat(language || undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(value);
  } catch (_err) {
    return value.toFixed(precision);
  }
}
