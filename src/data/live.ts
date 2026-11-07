/**
 * Turns current entity state into legend rows, for `entity-legend-table`.
 *
 * A live row has exactly one value, so `sum`, `min`, `max` and `avg` all carry
 * it — whatever reads a row (the sum total, `hide_zero`, the cell) finds it
 * where it looks for a statistics row's value.
 *
 * Three outcomes per row:
 *
 * - a number: the value, after `multiply`/`add`, with `count = 1`
 * - text (`on`, `heat`, …): shown through Home Assistant's own formatting in
 *   `text`, `count = 1`; it takes no part in a sum
 * - missing (`unavailable`, `unknown`, no such entity, a calculation that
 *   cannot be evaluated): shown as `MISSING_TEXT`, `count = 0`
 */

import type { HomeAssistant } from "custom-card-helpers";

import { isDarkMode, resolveColor, withAlpha, SWATCH_FILL_ALPHA } from "../colors";
import type { ResolvedCalculation } from "../config/normalize-statistics";
import type {
  LiveSource,
  ResolvedLiveCalculation,
  ResolvedLiveEntity,
} from "../config/normalize-entity";
import type { LegendConfig, LegendRow } from "../config/types";
import type { RatioSum } from "../legend-stats";
import { collectRatioTotals, evaluateCalculation } from "./aggregate";
import { Statistics, statisticLabel } from "./statistics";

/** What a cell shows for a value that cannot be read */
export const MISSING_TEXT = "—";

/** States Home Assistant uses for "no value", which are not text to show */
const MISSING_STATES = new Set(["unavailable", "unknown"]);

interface LiveEntityState {
  state: string;
  attributes?: Record<string, unknown>;
}

/**
 * The parts of `hass` read here that `custom-card-helpers` does not type. All
 * of them exist in every supported Home Assistant version; each is still read
 * defensively, so a missing one falls back instead of throwing.
 */
interface LiveHass {
  states?: Record<string, LiveEntityState | undefined>;
  entities?: Record<string, { display_precision?: unknown } | undefined>;
  formatEntityState?: (stateObj: LiveEntityState, state?: string) => string;
  formatEntityAttributeValue?: (stateObj: LiveEntityState, attribute: string) => string;
}

export type LiveValue =
  | { kind: "number"; value: number }
  | { kind: "text"; text: string }
  | { kind: "missing" };

function asLive(hass: HomeAssistant | undefined): LiveHass | undefined {
  return hass as unknown as LiveHass | undefined;
}

/** A finite number from a state or attribute, or `undefined` for anything else */
function toNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === "string" && raw.trim()) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

function rawText(raw: unknown): string {
  if (raw && typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch (_err) {
      return String(raw);
    }
  }
  return String(raw);
}

/** Reads one entity's state or attribute */
export function readLiveValue(hass: HomeAssistant | undefined, source: LiveSource): LiveValue {
  const live = asLive(hass);
  const stateObj = live?.states?.[source.entityId];
  if (!stateObj) {
    return { kind: "missing" };
  }

  const raw = source.attribute ? stateObj.attributes?.[source.attribute] : stateObj.state;
  if (raw === undefined || raw === null || raw === "") {
    return { kind: "missing" };
  }
  if (!source.attribute && MISSING_STATES.has(String(raw))) {
    return { kind: "missing" };
  }

  const value = toNumber(raw);
  if (value !== undefined) {
    return { kind: "number", value };
  }

  let formatted: string | undefined;
  try {
    formatted = source.attribute
      ? live?.formatEntityAttributeValue?.(stateObj, source.attribute)
      : live?.formatEntityState?.(stateObj);
  } catch (_err) {
    formatted = undefined;
  }
  return { kind: "text", text: formatted || rawText(raw) };
}

/** The key a term's value is filed under for `evaluateCalculation()` */
function sourceKey(source: LiveSource): string {
  return source.attribute ? `${source.entityId}#${source.attribute}` : source.entityId;
}

/**
 * Evaluates a calculated row over current values.
 *
 * Reuses the statistics card's `evaluateCalculation()`: every term becomes a
 * statistic with a single bucket, so the order of operations, clamping and the
 * division-by-zero rule are the same in both cards. Unlike a missing bucket
 * there — which counts as 0 so a sum over a range does not lose whole buckets —
 * a term whose entity has no number makes the whole row missing: a current
 * value computed from a 0 that stands in for "unavailable" would be wrong
 * rather than incomplete.
 */
export function evaluateLiveCalculation(
  hass: HomeAssistant | undefined,
  calculation: ResolvedLiveCalculation
): number | undefined {
  const statistics: Statistics = {};
  for (const term of calculation.terms) {
    if (!term.source) {
      continue;
    }
    const value = readLiveValue(hass, term.source);
    if (value.kind !== "number") {
      return undefined;
    }
    statistics[sourceKey(term.source)] = [{ start: 0, state: value.value }];
  }

  const asStatistics: ResolvedCalculation = {
    initialValue: calculation.initialValue,
    unit: calculation.unit,
    terms: calculation.terms.map((term) => ({
      statisticId: term.source ? sourceKey(term.source) : undefined,
      constant: term.constant,
      statType: "state",
      operation: term.operation,
      multiply: term.multiply,
      add: term.add,
      clipMin: term.clipMin,
      clipMax: term.clipMax,
    })),
  };

  return evaluateCalculation(statistics, asStatistics, "state")[0];
}

/** `display_precision` of an entity as set in Home Assistant, if any */
export function displayPrecision(
  hass: HomeAssistant | undefined,
  entityId: string
): number | undefined {
  const precision = asLive(hass)?.entities?.[entityId]?.display_precision;
  return typeof precision === "number" && Number.isInteger(precision) && precision >= 0
    ? precision
    : undefined;
}

/** `unit_of_measurement` of an entity's state */
function stateUnit(hass: HomeAssistant | undefined, entityId: string): string | undefined {
  const unit = asLive(hass)?.states?.[entityId]?.attributes?.unit_of_measurement;
  return typeof unit === "string" ? unit : undefined;
}

/**
 * The unit a row shows when none is configured: an entity's state carries one,
 * an attribute does not, and a calculation takes the unit of its first term
 * that reads a state.
 */
function defaultUnit(hass: HomeAssistant | undefined, entity: ResolvedLiveEntity): string {
  if (entity.calculation) {
    const first = entity.calculation.terms.find((term) => term.source && !term.source.attribute);
    return (first?.source && stateUnit(hass, first.source.entityId)) || "";
  }
  if (entity.source && !entity.source.attribute) {
    return stateUnit(hass, entity.source.entityId) ?? "";
  }
  return "";
}

/** The value a row shows, before `multiply`/`add` */
function rowValue(hass: HomeAssistant | undefined, entity: ResolvedLiveEntity): LiveValue {
  if (entity.calculation) {
    const value = evaluateLiveCalculation(hass, entity.calculation);
    return value === undefined ? { kind: "missing" } : { kind: "number", value };
  }
  return entity.source ? readLiveValue(hass, entity.source) : { kind: "missing" };
}

/**
 * The `icon` attribute of a row's entity, used when the row sets no `icon`.
 * A calculated row has no single entity, so it gets none.
 */
function entityIcon(
  hass: HomeAssistant | undefined,
  entity: ResolvedLiveEntity
): string | undefined {
  if (!entity.source) {
    return undefined;
  }
  const icon = asLive(hass)?.states?.[entity.source.entityId]?.attributes?.icon;
  return typeof icon === "string" && icon.trim() ? icon.trim() : undefined;
}

/** Builds one legend row per configured entity, in configuration order */
export function buildLiveRows(
  entities: ResolvedLiveEntity[],
  hass: HomeAssistant | undefined
): LegendRow[] {
  const darkMode = isDarkMode(hass);

  return entities.map((entity, index) => {
    const color = resolveColor(entity.color, darkMode, index);
    const firstId: string | undefined = entity.entityIds[0];
    const live = rowValue(hass, entity);

    const value =
      live.kind === "number" ? live.value * entity.multiply + entity.add : 0;
    const precision =
      entity.source && !entity.source.attribute
        ? displayPrecision(hass, entity.source.entityId)
        : undefined;

    return {
      id: entity.key,
      name: entity.name ?? (firstId ? statisticLabel(hass, firstId) : entity.key),
      color,
      fillColor: withAlpha(color, SWATCH_FILL_ALPHA),
      icon: entity.icon ?? entityIcon(hass, entity),
      indicator: entity.indicator,
      unit: entity.calculation?.unit ?? entity.unit ?? defaultUnit(hass, entity),
      sum: value,
      min: value,
      max: value,
      avg: value,
      count: live.kind === "missing" ? 0 : 1,
      links: entity.links,
      showValues: entity.showValues,
      text: live.kind === "text" ? live.text : live.kind === "missing" ? MISSING_TEXT : undefined,
      precision,
    };
  });
}

/**
 * The `RatioSum` of the entity card: the operands of a `total: {mode: ratio}`
 * are entity ids, summed over their current numeric state. An operand without
 * a number contributes nothing.
 */
export function liveRatioSum(hass: HomeAssistant | undefined): RatioSum {
  return (ids) =>
    ids.reduce((total, id) => {
      const entityId = typeof id === "string" ? id.trim() : "";
      const value = entityId ? readLiveValue(hass, { entityId }) : { kind: "missing" as const };
      return value.kind === "number" ? total + value.value : total;
    }, 0);
}

/**
 * Every entity whose state can change what the legend shows: the ones the rows
 * read and the operands of every ratio total.
 */
export function collectLiveEntities(
  entities: ResolvedLiveEntity[],
  legend: LegendConfig | undefined
): string[] {
  const ids = new Set<string>();
  entities.forEach((entity) => entity.entityIds.forEach((id) => ids.add(id)));
  collectRatioTotals(legend).forEach((total) => {
    [...(total.numerator ?? []), ...(total.denominator ?? [])].forEach((id) => {
      if (typeof id === "string" && id.trim()) {
        ids.add(id.trim());
      }
    });
  });
  return [...ids];
}
