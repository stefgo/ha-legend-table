/**
 * Configuration and row types of the two legend table cards.
 *
 * `statistics-legend-table` and `entity-legend-table` share everything but the
 * source of their values: `legend`, `card` and `link` mean the same in both, and
 * so do the common fields of an `entities` row. What differs is how a row names
 * its value — a recorder statistic with a `timespan`/`aggregation`, or the live
 * state of an entity.
 *
 * Nothing here mirrors or forwards the configuration of another card.
 */

import type { LovelaceCardConfig } from "custom-card-helpers";

/** Value columns that can be shown per legend row */
export type LegendColumn = "sum" | "min" | "max" | "avg";

export const ALL_LEGEND_COLUMNS: LegendColumn[] = ["sum", "min", "max", "avg"];

/**
 * When a row shows its value columns.
 *
 * - `always`: normal row, counted in `total: {mode: sum}`
 * - `never`: value area stays empty
 * - `selection`: empty over the configured timespan, filled while a period is
 *   selected in the embedded graph (`timespan.follow_selection`)
 *
 * Only an `always` row feeds `total: {mode: sum}` — a row that shows values
 * merely for a selected bucket must not move the total in and out of one.
 */
export type ShowValuesMode = "always" | "never" | "selection";

export const ALL_SHOW_VALUES_MODES: ShowValuesMode[] = ["always", "never", "selection"];

/** Statistic value read per bucket, mirrors the recorder's own types */
export type StatType = "change" | "sum" | "mean" | "min" | "max" | "state";

export const ALL_STAT_TYPES: StatType[] = ["change", "sum", "mean", "min", "max", "state"];

/** Bucket size requested from the recorder; `auto` derives it from the timespan */
export type AggregationPeriod = "5minute" | "hour" | "day" | "week" | "month";

export type AggregationSetting = AggregationPeriod | "auto";

export const ALL_AGGREGATION_PERIODS: AggregationPeriod[] = [
  "5minute",
  "hour",
  "day",
  "week",
  "month",
];

/* -------------------------------------------------------------------------- */
/* Timespan                                                                    */
/* -------------------------------------------------------------------------- */

export type TimespanMode = "energy" | "relative" | "fixed";

/** Named ranges for `timespan.mode: relative` */
export type RelativePeriod =
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year"
  | "last_60_minutes"
  | "last_24_hours"
  | "last_7_days"
  | "last_30_days"
  | "last_12_months";

export const ALL_RELATIVE_PERIODS: RelativePeriod[] = [
  "hour",
  "day",
  "week",
  "month",
  "year",
  "last_60_minutes",
  "last_24_hours",
  "last_7_days",
  "last_30_days",
  "last_12_months",
];

export interface TimespanConfig {
  /**
   * - `energy`: follows the dashboard's energy date picker, so the legend shows
   *   the same range as any neighbouring energy card without knowing about it
   * - `relative`: a rolling range relative to now (`period` + `offset`)
   * - `fixed`: an explicit `start`/`end`
   */
  mode?: TimespanMode;
  /**
   * `mode: energy` only. Matches the `collection_key` of the card whose date
   * picker should drive this legend; unset uses the dashboard's default one.
   */
  collection_key?: string;
  /** `mode: relative` only, defaults to `day` */
  period?: RelativePeriod;
  /** `mode: relative` only: shifts the range by whole periods, defaults to 0 */
  offset?: number;
  /** `mode: fixed` only: ISO 8601 timestamp, defaults to the start of today */
  start?: string;
  /** `mode: fixed` only: ISO 8601 timestamp, defaults to the end of `start`'s day */
  end?: string;
  /**
   * Whether a period selected in a neighbouring `custom-graph-card` overrides
   * the range above for as long as the selection lasts. Defaults to `true`;
   * set to `false` for a legend that must always show the configured range.
   */
  follow_selection?: boolean;
}

export interface AggregationConfig {
  /**
   * Bucket size requested from the recorder. `auto` follows Home Assistant's own
   * rule (> 35 days → month, > 2 days → day, else hour).
   *
   * This is not just a performance knob: `min`/`max`/`avg` are computed *per
   * bucket*, so the period decides what those columns actually mean (e.g. the
   * daily maximum vs. the hourly maximum). `sum` is unaffected.
   */
  period?: AggregationSetting;
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A row's swatch color: either a single color used regardless of theme, or an
 * object giving a separate color per Home Assistant theme mode. Either side of
 * the object may be omitted; the other side is then used for both modes.
 */
export type ColorConfig = string | { light?: string; dark?: string };

/** Operation a calculation term applies to the running result */
export type CalculationOperation = "add" | "subtract" | "multiply" | "divide";

export const ALL_CALCULATION_OPERATIONS: CalculationOperation[] = [
  "add",
  "subtract",
  "multiply",
  "divide",
];

/**
 * One step of a calculated row. Either a statistic or a `constant`; the value is
 * transformed by `multiply`/`add`/`clip_*` before `operation` applies it to the
 * running result.
 */
export interface CalculationTerm {
  /** Statistic read for this term; omit to use `constant` instead */
  statistic_id?: string;
  /** Constant operand, used when no `statistic_id` is given. Defaults to 0 */
  constant?: number;
  /** Statistic value read per bucket, defaults to the row's `stat_type` */
  stat_type?: StatType;
  /** Operation applied to the running result, defaults to `add` */
  operation?: CalculationOperation;
  /** Term value is multiplied by this, applied before `add`. Defaults to 1 */
  multiply?: number;
  /** Added to the term value after `multiply`. Defaults to 0 */
  add?: number;
  /** Lower clamp of the term value, applied after `multiply`/`add` */
  clip_min?: number;
  /** Upper clamp of the term value, applied after `multiply`/`add` */
  clip_max?: number;
}

/**
 * A row computed from several statistics. Terms are evaluated in order (no
 * operator precedence) per recorder bucket, starting from `initial_value`.
 */
export interface CalculationConfig {
  /** Ordered calculation steps; at least one is required */
  terms: CalculationTerm[];
  /** Start value before the first term, defaults to 0 */
  initial_value?: number;
  /** Unit of the result, defaults to the unit of the first statistic used */
  unit?: string;
}

/** Fields every `entities` row has, whichever card it belongs to */
export interface LegendEntityConfig {
  /**
   * Stable identifier of this row, used by `legend` selectors and by the link
   * adapters. Defaults to the row's statistic or entity (or the first one of a
   * `calculation`).
   */
  key?: string;
  /** Row label, defaults to the entity's friendly name or the statistic's name */
  name?: string;
  /**
   * Swatch color, defaults to the next color of the built-in palette. Pass
   * `{light: "...", dark: "..."}` to use a different color per theme mode.
   */
  color?: ColorConfig;
  /** Unit appended to the values, defaults to the statistic's or entity's unit */
  unit?: string;
  /** Every value is multiplied by this, applied before `add`. Defaults to 1 */
  multiply?: number;
  /** Added to every value after `multiply`. Defaults to 0 */
  add?: number;
  /** Row starts out hidden (and, with a link, hides its target too) */
  hidden_by_default?: boolean;
  /**
   * Target(s) this row addresses in the linked card. Interpretation depends on
   * the link mode: a series id for `chart`, an entity id for `entity`, an opaque
   * key for `event`. Defaults to the row's `key`.
   *
   * `more-info` reads only the first target, as the entity whose dialog opens,
   * and defaults to the row's statistic instead of its `key`.
   *
   * A list links one row to several targets at once: a click drives all of them
   * to the same state, and the row is drawn greyed out once they are all hidden.
   */
  link?: string | string[];
  /**
   * When the row shows its value columns, defaults to `always`. Anything other
   * than `always` also takes the row out of `total: {mode: sum}`.
   * `entity-legend-table` has no selection and accepts `always`/`never` only.
   */
  show_values?: ShowValuesMode;
}

/** One row of `statistics-legend-table` */
export interface StatisticsEntityConfig extends LegendEntityConfig {
  /** Statistic entity shown in this row. Mutually exclusive with `calculation` */
  statistic_id?: string;
  /**
   * Row computed from several statistics and constants instead of a single
   * `statistic_id`. Evaluated bucket by bucket, so `min`/`max`/`avg` keep
   * meaning what they mean for a plain statistic row.
   */
  calculation?: CalculationConfig;
  /** Statistic value read per bucket, defaults to `change` */
  stat_type?: StatType;
}

/** One step of a calculated row of `entity-legend-table` */
export interface LiveCalculationTerm {
  /** Entity read for this term; omit to use `constant` instead */
  entity?: string;
  /** Reads this attribute instead of the entity's state */
  attribute?: string;
  /** Constant operand, used when no `entity` is given. Defaults to 0 */
  constant?: number;
  /** Operation applied to the running result, defaults to `add` */
  operation?: CalculationOperation;
  /** Term value is multiplied by this, applied before `add`. Defaults to 1 */
  multiply?: number;
  /** Added to the term value after `multiply`. Defaults to 0 */
  add?: number;
  /** Lower clamp of the term value, applied after `multiply`/`add` */
  clip_min?: number;
  /** Upper clamp of the term value, applied after `multiply`/`add` */
  clip_max?: number;
}

/** A row of `entity-legend-table` computed from the current values of entities */
export interface LiveCalculationConfig {
  /** Ordered calculation steps; at least one is required */
  terms: LiveCalculationTerm[];
  /** Start value before the first term, defaults to 0 */
  initial_value?: number;
  /** Unit of the result, defaults to the unit of the first entity used */
  unit?: string;
}

/** One row of `entity-legend-table` */
export interface LiveEntityConfig extends LegendEntityConfig {
  /** Entity whose current value this row shows. Mutually exclusive with `calculation` */
  entity?: string;
  /** Shows this attribute instead of the entity's state */
  attribute?: string;
  /** Row computed from the current values of several entities and constants */
  calculation?: LiveCalculationConfig;
}

/* -------------------------------------------------------------------------- */
/* Legend                                                                      */
/* -------------------------------------------------------------------------- */

/** Configuration of the closing total row below the divider */
export interface LegendTotalConfig {
  /** Label of the total row, defaults to "Gesamt" / "Total" */
  name?: string;
  /**
   * - `sum`: sum of all visible legend rows
   * - `ratio`: numerator / denominator as percentage (e.g. autarky), computed
   *   directly from the named statistic entities — independent of `entities`,
   *   so it also works for statistics that never become a legend row
   * - `none`: no total row
   */
  mode?: "sum" | "ratio" | "none";
  /**
   * Ids summed for the numerator, `ratio` mode only: `statistic_id`s in the
   * statistics card, entity ids (current state) in the entity card
   */
  numerator?: string[];
  /** Ids summed for the denominator, `ratio` mode only, see `numerator` */
  denominator?: string[];
  /**
   * Statistic type read per entity, `ratio` mode of the statistics card only.
   * Defaults to `change`
   */
  stat_type?: StatType;
  /** Decimal places, defaults to the legend precision (ratio mode: 1) */
  precision?: number;
  /** Unit appended to the value, defaults to "%" in ratio mode */
  unit?: string;
}

export interface LegendConfig {
  /** Value columns per row, defaults to ["sum"] */
  columns?: LegendColumn[];
  /** Decimal places for the value columns, defaults to 2 */
  precision?: number;
  /** Append the unit to values, defaults to true */
  show_unit?: boolean;
  /** Hide rows whose values are all zero/empty, defaults to false */
  hide_zero?: boolean;
  /** Show column headers above the rows, defaults to false */
  show_headers?: boolean;
  /**
   * Width in pixels the series name should keep before the values move onto a
   * line of their own, defaults to 120.
   *
   * The card wraps when the name would be squeezed below this; how much room
   * that needs depends on how many value columns there are, so the threshold is
   * computed rather than fixed. Only this one number cannot be derived — how
   * short a name may get before wrapping beats truncating is a matter of taste,
   * and names range from `PV` to `Wärmepumpe Erdgeschoss Vorlauf`.
   *
   * Two useful extremes: `0` wraps only once the values themselves no longer
   * fit, a large value always wraps.
   */
  min_name_width?: number;
  /** Closing total row */
  total?: LegendTotalConfig;
  /** Splits the legend into named sections; unmatched rows form a trailing, unnamed group */
  groups?: LegendGroupConfig[];
}

/** Fields of LegendConfig a group may override */
export type LegendGroupOverrides = Pick<
  LegendConfig,
  | "columns"
  | "precision"
  | "show_unit"
  | "hide_zero"
  | "show_headers"
  | "min_name_width"
  | "total"
>;

export interface LegendGroupConfig extends LegendGroupOverrides {
  /** Heading rendered above the group's rows; omitted groups render without one */
  name?: string;
  /** Rows matched into this group (selector semantics, see `matchesSelector`) */
  entities?: string[];
}

/* -------------------------------------------------------------------------- */
/* Link                                                                        */
/* -------------------------------------------------------------------------- */

export type LinkMode = "chart" | "entity" | "event" | "more-info" | "none";

export interface LinkConfig {
  /**
   * - `chart`: toggles a dataset of an `ha-chart-base` inside the `card:` block
   * - `entity`: toggles a Home Assistant entity (typically an `input_boolean`)
   * - `event`: dispatches a CustomEvent on `window`
   * - `more-info`: opens Home Assistant's entity dialog instead of hiding the
   *   row; cannot be combined with another mode
   * - `none`: the legend only greys out its own row
   */
  mode?: LinkMode;
  /** `event` mode: identifies this legend in the dispatched events */
  link_id?: string;
  /** `entity` mode: service called on click, defaults to `homeassistant.toggle` */
  service?: string;
  /**
   * `entity` mode: which entity state counts as "hidden", defaults to `off`.
   * A row is drawn greyed out while its entity is in this state.
   */
  hidden_state?: string;
}

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

/** What both cards' configurations have in common */
export interface LegendTableCardConfig extends LovelaceCardConfig {
  type: string;
  /** Card header rendered above everything else */
  title?: string;
  /** Any Lovelace card, rendered above the legend inside the same `ha-card` */
  card?: LovelaceCardConfig;
  entities?: LegendEntityConfig[];
  legend?: LegendConfig;
  /** One link block, or several that all fire on a click */
  link?: LinkConfig | LinkConfig[];
}

export interface StatisticsLegendTableCardConfig extends LegendTableCardConfig {
  timespan?: TimespanConfig;
  aggregation?: AggregationConfig;
  entities?: StatisticsEntityConfig[];
}

/**
 * `entity-legend-table`: the same legend over live entity state. `legend.columns`
 * does not apply — a row has exactly one current value — and in
 * `legend.total: {mode: ratio}` the operands name entities, not statistics.
 */
export interface EntityLegendTableCardConfig extends LegendTableCardConfig {
  entities?: LiveEntityConfig[];
}

/* -------------------------------------------------------------------------- */
/* Runtime shapes                                                              */
/* -------------------------------------------------------------------------- */

/** One rendered legend row */
export interface LegendRow {
  /** Stable id, from `entities[].key` */
  id: string;
  name: string;
  /** Solid color, used for the swatch border */
  color: string;
  /** Translucent version of `color`, used for the swatch fill */
  fillColor: string;
  unit: string;
  sum: number;
  min: number;
  max: number;
  avg: number;
  /** Number of buckets that carried a value */
  count: number;
  /** Targets passed to the link adapters, from `entities[].link`; never empty */
  links: string[];
  /** From `entities[].show_values` */
  showValues: ShowValuesMode;
  /** Shown verbatim in every value cell instead of a formatted number */
  text?: string;
  /** Decimal places of this row when the legend sets none */
  precision?: number;
}

/** Rendered total row */
export interface LegendTotal {
  name: string;
  value: number;
  unit: string;
  precision: number;
}

/** One resolved legend section, ready to render */
export interface LegendGroupResult {
  /** Undefined for the implicit/no-groups bucket — no heading is rendered */
  name?: string;
  /** Group override merged over the top-level legend config */
  config: LegendConfig;
  rows: LegendRow[];
}
