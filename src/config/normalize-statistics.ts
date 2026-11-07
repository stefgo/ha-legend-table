/**
 * Validation and defaulting of a `statistics-legend-table` config.
 *
 * Adds the statistics part on top of `normalize-common.ts`: a row's
 * `statistic_id` or `calculation`, its `stat_type`, and the `timespan` /
 * `aggregation` blocks.
 */

import {
  ALL_AGGREGATION_PERIODS,
  ALL_CALCULATION_OPERATIONS,
  ALL_LEGEND_COLUMNS,
  ALL_RELATIVE_PERIODS,
  ALL_STAT_TYPES,
  AggregationSetting,
  CalculationOperation,
  CalculationTerm,
  LegendColumn,
  RelativePeriod,
  StatisticsEntityConfig,
  StatisticsLegendTableCardConfig,
  StatType,
  TimespanMode,
} from "./types";
import {
  ResolvedConfigBase,
  ResolvedEntityBase,
  checkCardConfig,
  checkLegendIndicators,
  checkUniqueKeys,
  fail,
  numberOr,
  oneOf,
  optionalNumber,
  resolveEntityBase,
  resolveLinks,
  trimmedString,
} from "./normalize-common";

export { DEFAULT_PRECISION } from "./normalize-common";

const TIMESPAN_MODES: TimespanMode[] = ["energy", "relative", "fixed"];

/** One calculation term with every default filled in */
export interface ResolvedTerm {
  /** Undefined for a constant term */
  statisticId?: string;
  /** Only meaningful without `statisticId` */
  constant: number;
  /** Undefined means "use the row's stat type" */
  statType?: StatType;
  operation: CalculationOperation;
  multiply: number;
  add: number;
  clipMin?: number;
  clipMax?: number;
}

export interface ResolvedCalculation {
  terms: ResolvedTerm[];
  initialValue: number;
  unit?: string;
}

/** One statistics row with everything resolved that does not need `hass` */
export interface ResolvedEntity extends ResolvedEntityBase {
  /**
   * Every statistic this row needs fetched — the single `statistic_id`, or every
   * statistic referenced by the `calculation` terms, in first-use order. Empty
   * only for a calculation made of constants alone.
   */
  statisticIds: string[];
  /** Set when the row is computed instead of read from a single statistic */
  calculation?: ResolvedCalculation;
  statType: StatType;
}

export type ResolvedConfig = ResolvedConfigBase<StatisticsLegendTableCardConfig, ResolvedEntity>;

/**
 * Normalizes one calculation term. A term without a `statistic_id` is a
 * constant; `constant` itself defaults to 0, so a term that carries neither is
 * a no-op rather than a config error.
 */
function resolveTerm(term: CalculationTerm, field: string): ResolvedTerm {
  if (!term || typeof term !== "object") {
    fail(`\`${field}\` must be an object`);
  }

  return {
    statisticId: trimmedString(term.statistic_id),
    constant: numberOr(term.constant, 0, `${field}.constant`),
    statType: oneOf(term.stat_type, ALL_STAT_TYPES, `${field}.stat_type`),
    operation:
      oneOf(term.operation, ALL_CALCULATION_OPERATIONS, `${field}.operation`) ?? "add",
    multiply: numberOr(term.multiply, 1, `${field}.multiply`),
    add: numberOr(term.add, 0, `${field}.add`),
    clipMin: optionalNumber(term.clip_min, `${field}.clip_min`),
    clipMax: optionalNumber(term.clip_max, `${field}.clip_max`),
  };
}

/**
 * Normalizes one entity row: either a single `statistic_id` or a `calculation`.
 * Both end up with a `statisticIds` list of everything that needs fetching, so
 * only `buildRows()` cares about the difference.
 */
function resolveEntity(entity: StatisticsEntityConfig, index: number): ResolvedEntity {
  if (!entity || typeof entity !== "object") {
    fail(`\`entities[${index}]\` must be an object`);
  }

  const statisticId = trimmedString(entity.statistic_id);
  const calculationConfig = entity.calculation;

  if (statisticId && calculationConfig) {
    fail(`\`entities[${index}]\` must not set both \`statistic_id\` and \`calculation\``);
  }

  let calculation: ResolvedCalculation | undefined;
  const ids: string[] = [];

  if (calculationConfig) {
    if (typeof calculationConfig !== "object" || !Array.isArray(calculationConfig.terms)) {
      fail(`\`entities[${index}].calculation\` needs a \`terms\` list`);
    }
    if (!calculationConfig.terms.length) {
      fail(`\`entities[${index}].calculation.terms\` must not be empty`);
    }

    const terms = calculationConfig.terms.map((term, termIndex) =>
      resolveTerm(term, `entities[${index}].calculation.terms[${termIndex}]`)
    );
    terms.forEach((term) => {
      if (term.statisticId && !ids.includes(term.statisticId)) {
        ids.push(term.statisticId);
      }
    });

    calculation = {
      terms,
      initialValue: numberOr(
        calculationConfig.initial_value,
        0,
        `entities[${index}].calculation.initial_value`
      ),
      unit: typeof calculationConfig.unit === "string" ? calculationConfig.unit : undefined,
    };
  } else if (statisticId) {
    ids.push(statisticId);
  } else {
    fail(`\`entities[${index}]\` needs a \`statistic_id\` or a \`calculation\``);
  }

  return {
    ...resolveEntityBase(entity, index, ids),
    statisticIds: ids,
    calculation,
    statType: oneOf(entity.stat_type, ALL_STAT_TYPES, `entities[${index}].stat_type`) ?? "change",
  };
}

export function normalizeConfig(config: StatisticsLegendTableCardConfig): ResolvedConfig {
  checkCardConfig(config, "statistic");

  const entities = config.entities!.map(resolveEntity);
  checkUniqueKeys(entities);

  // Validated for their error messages; the values themselves are read lazily
  // from `config` by the modules that need them.
  oneOf(config.timespan?.mode, TIMESPAN_MODES, "timespan.mode");
  oneOf<RelativePeriod>(config.timespan?.period, ALL_RELATIVE_PERIODS, "timespan.period");
  oneOf<AggregationSetting>(
    config.aggregation?.period,
    [...ALL_AGGREGATION_PERIODS, "auto"],
    "aggregation.period"
  );
  oneOf(config.legend?.total?.stat_type, ALL_STAT_TYPES, "legend.total.stat_type");
  checkLegendIndicators(config);

  return { raw: config, entities, links: resolveLinks(config) };
}

/** Value columns of a legend/group config, falling back to `["sum"]` */
export function columnsFor(columns: LegendColumn[] | undefined): LegendColumn[] {
  if (!columns?.length) {
    return ["sum"];
  }
  const valid = columns.filter((column) => ALL_LEGEND_COLUMNS.includes(column));
  return valid.length ? valid : ["sum"];
}
