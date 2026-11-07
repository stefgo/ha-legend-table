/**
 * Validation and defaulting of the raw YAML config.
 *
 * `setConfig()` runs in the Lovelace editor on every keystroke, so this throws
 * only for mistakes the card genuinely cannot render (no `entities`, an entity
 * without a statistic, an unknown enum value). Everything else is silently
 * defaulted — a card on a dashboard should degrade, not blow up.
 */

import {
  ALL_AGGREGATION_PERIODS,
  ALL_CALCULATION_OPERATIONS,
  ALL_LEGEND_COLUMNS,
  ALL_RELATIVE_PERIODS,
  ALL_STAT_TYPES,
  ALL_SHOW_VALUES_MODES,
  AggregationSetting,
  CalculationOperation,
  CalculationTerm,
  ColorConfig,
  StatisticsLegendTableCardConfig,
  EntityConfig,
  LegendColumn,
  LinkConfig,
  LinkMode,
  RelativePeriod,
  ShowValuesMode,
  StatType,
  TimespanMode,
} from "./types";

const TIMESPAN_MODES: TimespanMode[] = ["energy", "relative", "fixed"];
const LINK_MODES: LinkMode[] = ["chart", "entity", "event", "more-info", "none"];

/** `domain.object_id`, which external statistics (`domain:name`) are not */
const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export const DEFAULT_PRECISION = 2;

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

/** One entity row with everything resolved that does not need `hass` */
export interface ResolvedEntity {
  key: string;
  /**
   * Every statistic this row needs fetched — the single `statistic_id`, or every
   * statistic referenced by the `calculation` terms, in first-use order. Empty
   * only for a calculation made of constants alone.
   */
  statisticIds: string[];
  /** Set when the row is computed instead of read from a single statistic */
  calculation?: ResolvedCalculation;
  name?: string;
  color?: ColorConfig;
  statType: StatType;
  unit?: string;
  multiply: number;
  add: number;
  hiddenByDefault: boolean;
  /** At least one target; several mean one row drives several targets */
  links: string[];
  /**
   * Entity whose dialog `link: {mode: more-info}` opens: the first explicit
   * `link` target, else the row's first statistic. Unset when that is no
   * entity id, e.g. an external statistic.
   */
  moreInfoEntity?: string;
  showValues: ShowValuesMode;
}

export interface ResolvedConfig {
  raw: StatisticsLegendTableCardConfig;
  entities: ResolvedEntity[];
  links: LinkConfig[];
}

function fail(message: string): never {
  throw new Error(message);
}

function oneOf<T extends string>(value: unknown, allowed: T[], field: string): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`\`${field}\` must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function numberOr(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`\`${field}\` must be a number`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return numberOr(value, 0, field);
}

/**
 * Normalizes `entities[].color`. Accepts a plain string or a `{light, dark}`
 * object; anything else (including an object with neither field set) falls
 * back to `undefined`, which leaves the row on the built-in palette rather
 * than failing the whole config over a malformed color.
 */
function resolveColorConfig(value: unknown): ColorConfig | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const light = (value as Record<string, unknown>).light;
    const dark = (value as Record<string, unknown>).dark;
    if (typeof light === "string" || typeof dark === "string") {
      return {
        light: typeof light === "string" ? light : undefined,
        dark: typeof dark === "string" ? dark : undefined,
      };
    }
  }
  return undefined;
}

/**
 * Normalizes `entities[].link`. A single string and a list are folded into the
 * same list form; an empty or malformed value falls back to the row's key, so a
 * typo costs the link, not the whole card.
 */
function resolveLinkTargets(link: string | string[] | undefined, key: string): string[] {
  const targets = explicitLinkTargets(link);
  return targets.length ? targets : [key];
}

/** The usable targets of `entities[].link`, without the fallback to the key */
function explicitLinkTargets(link: string | string[] | undefined): string[] {
  const list = Array.isArray(link) ? link : [link];
  const targets = list
    .filter((target): target is string => typeof target === "string" && Boolean(target.trim()))
    .map((target) => target.trim());
  return [...new Set(targets)];
}

/** The entity `more-info` opens for a row, see `ResolvedEntity.moreInfoEntity` */
function resolveMoreInfoEntity(
  link: string | string[] | undefined,
  statisticIds: string[]
): string | undefined {
  const target = explicitLinkTargets(link)[0] ?? statisticIds[0];
  return target && ENTITY_ID_PATTERN.test(target) ? target : undefined;
}

/**
 * Normalizes one calculation term. A term without a `statistic_id` is a
 * constant; `constant` itself defaults to 0, so a term that carries neither is
 * a no-op rather than a config error.
 */
function resolveTerm(term: CalculationTerm, field: string): ResolvedTerm {
  if (!term || typeof term !== "object") {
    fail(`\`${field}\` must be an object`);
  }

  const statisticId =
    typeof term.statistic_id === "string" && term.statistic_id.trim()
      ? term.statistic_id.trim()
      : undefined;

  return {
    statisticId,
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
function resolveEntity(entity: EntityConfig, index: number): ResolvedEntity {
  if (!entity || typeof entity !== "object") {
    fail(`\`entities[${index}]\` must be an object`);
  }

  const statisticId =
    typeof entity.statistic_id === "string" && entity.statistic_id.trim()
      ? entity.statistic_id.trim()
      : undefined;
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

  const key =
    typeof entity.key === "string" && entity.key.trim()
      ? entity.key.trim()
      : ids[0] ?? `entity_${index}`;

  return {
    key,
    statisticIds: ids,
    calculation,
    name: typeof entity.name === "string" ? entity.name : undefined,
    color: resolveColorConfig(entity.color),
    statType: oneOf(entity.stat_type, ALL_STAT_TYPES, `entities[${index}].stat_type`) ?? "change",
    unit: typeof entity.unit === "string" ? entity.unit : undefined,
    multiply: numberOr(entity.multiply, 1, `entities[${index}].multiply`),
    add: numberOr(entity.add, 0, `entities[${index}].add`),
    hiddenByDefault: entity.hidden_by_default === true,
    links: resolveLinkTargets(entity.link, key),
    moreInfoEntity: resolveMoreInfoEntity(entity.link, ids),
    showValues:
      oneOf(entity.show_values, ALL_SHOW_VALUES_MODES, `entities[${index}].show_values`) ??
      "always",
  };
}

/** `link` accepts a single block or a list; both become a list here */
function resolveLinks(config: StatisticsLegendTableCardConfig): LinkConfig[] {
  const raw = config.link;
  if (!raw) {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const links = list
    .map((link, index) => {
      if (!link || typeof link !== "object") {
        fail(`\`link[${index}]\` must be an object`);
      }
      const mode = oneOf(link.mode, LINK_MODES, `link[${index}].mode`) ?? "none";
      return { ...link, mode };
    })
    .filter((link) => link.mode !== "none");

  // `more-info` replaces hiding the row, every other mode hides something, so
  // the two cannot both describe what one click does.
  if (links.length > 1 && links.some((link) => link.mode === "more-info")) {
    fail("`link: {mode: more-info}` cannot be combined with another link mode");
  }
  return links;
}

export function normalizeConfig(config: StatisticsLegendTableCardConfig): ResolvedConfig {
  if (!config || typeof config !== "object") {
    fail("Invalid configuration");
  }
  if (!Array.isArray(config.entities) || !config.entities.length) {
    fail("`entities` is required and must list at least one statistic");
  }
  if (config.card !== undefined && (typeof config.card !== "object" || !config.card?.type)) {
    fail("`card` must be a card configuration with a `type`");
  }

  const entities = config.entities.map(resolveEntity);

  const duplicate = entities.find(
    (entity, index) => entities.findIndex((other) => other.key === entity.key) !== index
  );
  if (duplicate) {
    fail(`Duplicate entity key \`${duplicate.key}\` — set an explicit \`key\` to disambiguate`);
  }

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
