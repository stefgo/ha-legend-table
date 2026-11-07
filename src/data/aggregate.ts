/**
 * Turns recorder buckets into legend rows.
 *
 * `sum` is the aggregate over the whole timespan — added up for the additive
 * `change`/`sum` statistics, condensed instead for a level (`mean`/`min`/`max`/
 * `state`), see `aggregateOverBuckets()`. `min`/`max`/`avg` are computed across
 * the *buckets*, so they mean "the smallest/largest/average hour" (or day,
 * month, …) depending on `aggregation.period`.
 */

import type { HomeAssistant } from "custom-card-helpers";

import { isDarkMode, resolveColor, withAlpha, SWATCH_FILL_ALPHA } from "../colors";
import type { ResolvedCalculation, ResolvedEntity } from "../config/normalize-statistics";
import type {
  LegendConfig,
  LegendRow,
  LegendTotalConfig,
  StatType,
} from "../config/types";
import {
  Statistics,
  StatisticsMetadata,
  StatisticValue,
  statisticLabel,
  statisticUnit,
} from "./statistics";

/** Reads one bucket's value for the requested statistic type */
function bucketValue(bucket: StatisticValue, statType: StatType): number | undefined {
  const value = bucket?.[statType];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The buckets of a single statistic as a plain value series */
function plainValues(
  statistics: Statistics,
  statisticId: string,
  statType: StatType
): number[] {
  const values: number[] = [];
  (statistics[statisticId] ?? []).forEach((bucket) => {
    const value = bucketValue(bucket, statType);
    if (value !== undefined) {
      values.push(value);
    }
  });
  return values;
}

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (min !== undefined && result < min) {
    result = min;
  }
  if (max !== undefined && result > max) {
    result = max;
  }
  return result;
}

/**
 * Evaluates a calculated row into a value series.
 *
 * The calculation runs *per bucket*, over the union of all bucket starts of the
 * statistics involved, so `min`/`max`/`avg` keep meaning "the smallest/largest/
 * average bucket" just like for a plain statistic row. Terms are applied in
 * configuration order, without operator precedence.
 *
 * A statistic that has no value for a bucket contributes 0 rather than dropping
 * the bucket — with `subtract` terms the alternative would silently lose whole
 * buckets from the sum. A division by zero does drop its bucket, since there is
 * no meaningful value to show for it.
 *
 * A calculation made of constants alone has no buckets to iterate; it yields a
 * single value, so the row still has a defined sum/min/max/avg.
 */
export function evaluateCalculation(
  statistics: Statistics,
  calculation: ResolvedCalculation,
  fallbackStatType: StatType
): number[] {
  const termValues = calculation.terms.map((term) => {
    if (!term.statisticId) {
      return clamp(term.constant * term.multiply + term.add, term.clipMin, term.clipMax);
    }

    const statType = term.statType ?? fallbackStatType;
    const byStart = new Map<number, number>();
    (statistics[term.statisticId] ?? []).forEach((bucket) => {
      const value = bucketValue(bucket, statType);
      if (value !== undefined) {
        byStart.set(bucket.start, clamp(value * term.multiply + term.add, term.clipMin, term.clipMax));
      }
    });
    return byStart;
  });

  const starts = new Set<number>();
  termValues.forEach((values) => {
    if (values instanceof Map) {
      values.forEach((_value, start) => starts.add(start));
    }
  });

  const evaluate = (start?: number): number | undefined => {
    let result = calculation.initialValue;
    for (let index = 0; index < calculation.terms.length; index += 1) {
      const values = termValues[index];
      const value =
        values instanceof Map ? (start !== undefined ? values.get(start) ?? 0 : 0) : values;

      switch (calculation.terms[index].operation) {
        case "subtract":
          result -= value;
          break;
        case "multiply":
          result *= value;
          break;
        case "divide":
          if (value === 0) {
            return undefined;
          }
          result /= value;
          break;
        default:
          result += value;
          break;
      }
    }
    return Number.isFinite(result) ? result : undefined;
  };

  if (!starts.size) {
    // Constants only: a legitimate row with exactly one value. A calculation
    // that does reference statistics but got no data is an empty row instead,
    // like any other row whose statistic returned nothing.
    if (calculation.terms.some((term) => term.statisticId)) {
      return [];
    }
    const value = evaluate();
    return value === undefined ? [] : [value];
  }

  const values: number[] = [];
  [...starts]
    .sort((a, b) => a - b)
    .forEach((start) => {
      const value = evaluate(start);
      if (value !== undefined) {
        values.push(value);
      }
    });
  return values;
}

/**
 * The `sum` column of a row: the whole timespan condensed into one value.
 *
 * Only `change`/`sum` are additive — adding them up over the buckets is exactly
 * what they mean. A `mean`/`min`/`max`/`state` statistic is a *level*, not an
 * amount: summing the per-bucket values there produces a number that grows with
 * the bucket count (a price averaging 30 ct over an hour read as 360 ct at
 * `5minute` buckets), so those types condense the way the recorder itself does —
 * the average, the smallest, the largest bucket, and the last known level.
 *
 * This is what makes `show_values: selection` correct for the rows it exists
 * for: a selected period is fetched with a finer period than the configured
 * range, so a summed level jumped by a factor as the selection came and went.
 */
function aggregateOverBuckets(
  values: number[],
  statType: StatType,
  total: number,
  avg: number,
  min: number,
  max: number
): number {
  switch (statType) {
    case "mean":
      return avg;
    case "min":
      return min;
    case "max":
      return max;
    case "state":
      return values[values.length - 1] ?? 0;
    default:
      return total;
  }
}

/** Builds one legend row per configured entity, in configuration order */
export function buildRows(
  entities: ResolvedEntity[],
  statistics: Statistics,
  metadata: StatisticsMetadata,
  hass: HomeAssistant | undefined
): LegendRow[] {
  const darkMode = isDarkMode(hass);

  return entities.map((entity, index) => {
    const firstId: string | undefined = entity.statisticIds[0];
    const firstMeta = firstId ? metadata[firstId] : undefined;

    const raw = entity.calculation
      ? evaluateCalculation(statistics, entity.calculation, entity.statType)
      : firstId
        ? plainValues(statistics, firstId, entity.statType)
        : [];
    const values =
      entity.multiply === 1 && entity.add === 0
        ? raw
        : raw.map((value) => value * entity.multiply + entity.add);

    let total = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    values.forEach((value) => {
      total += value;
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    });

    const count = values.length;
    const avg = count ? total / count : 0;
    const color = resolveColor(entity.color, darkMode, index);

    return {
      id: entity.key,
      name: entity.name ?? (firstId ? statisticLabel(hass, firstId, firstMeta) : entity.key),
      color,
      fillColor: withAlpha(color, SWATCH_FILL_ALPHA),
      unit: entity.calculation?.unit ?? entity.unit ?? statisticUnit(hass, firstId, firstMeta),
      sum: count ? aggregateOverBuckets(values, entity.statType, total, avg, min, max) : 0,
      min: count ? min : 0,
      max: count ? max : 0,
      avg,
      count,
      links: entity.links,
      showValues: entity.showValues,
    };
  });
}

/**
 * The ratio totals of a legend: the top-level one plus every group override.
 *
 * A group may override `total` with a ratio of its own, so collecting only the
 * top-level one left those groups without any of their operands fetched — they
 * summed nothing and rendered a constant `0.0 %`.
 */
export function collectRatioTotals(legend: LegendConfig | undefined): LegendTotalConfig[] {
  return [legend?.total, ...(legend?.groups ?? []).map((group) => group.total)].filter(
    (total): total is LegendTotalConfig => total?.mode === "ratio"
  );
}

/** Every statistic type any row (or any ratio total) asks for */
export function collectStatTypes(
  entities: ResolvedEntity[],
  ratioTotals: LegendTotalConfig[] = []
): Set<StatType> {
  const types = new Set<StatType>();
  entities.forEach((entity) => {
    types.add(entity.statType);
    entity.calculation?.terms.forEach((term) => {
      if (term.statisticId && term.statType) {
        types.add(term.statType);
      }
    });
  });
  // `computeTotal()` defaults a ratio without `stat_type` to `change`, so the
  // same default has to be requested here or the operands come back empty.
  ratioTotals.forEach((total) => types.add(total.stat_type ?? "change"));
  if (!types.size) {
    types.add("change");
  }
  return types;
}

/** Every statistic id that needs fetching, including every ratio total's operands */
export function collectStatisticIds(
  entities: ResolvedEntity[],
  ratioTotals: LegendTotalConfig[] = []
): string[] {
  const ids = new Set<string>();
  entities.forEach((entity) => entity.statisticIds.forEach((id) => ids.add(id)));
  ratioTotals.forEach((total) => {
    [...(total.numerator ?? []), ...(total.denominator ?? [])].forEach((id) => {
      if (typeof id === "string" && id.trim()) {
        ids.add(id.trim());
      }
    });
  });
  return [...ids];
}
