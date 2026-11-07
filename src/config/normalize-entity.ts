/**
 * Validation and defaulting of an `entity-legend-table` config.
 *
 * Adds the live part on top of `normalize-common.ts`: a row's `entity` (with an
 * optional `attribute`) or its `calculation`. Options of the statistics card
 * that have no meaning for current values — `timespan`, `aggregation`,
 * `stat_type`, `legend.columns` — are ignored rather than refused, so a config
 * copied over from the statistics card still renders.
 */

import {
  ALL_CALCULATION_OPERATIONS,
  CalculationOperation,
  EntityLegendTableCardConfig,
  LiveCalculationTerm,
  LiveEntityConfig,
  ShowValuesMode,
} from "./types";
import {
  ResolvedConfigBase,
  ResolvedEntityBase,
  checkCardConfig,
  checkUniqueKeys,
  fail,
  numberOr,
  oneOf,
  optionalNumber,
  resolveEntityBase,
  resolveLinks,
  trimmedString,
} from "./normalize-common";

/** `selection` needs a graph selection, which this card has none of */
const LIVE_SHOW_VALUES_MODES: ShowValuesMode[] = ["always", "never"];

/** Where a live value is read: an entity's state, or one of its attributes */
export interface LiveSource {
  entityId: string;
  attribute?: string;
}

/** One calculation term with every default filled in */
export interface ResolvedLiveTerm {
  /** Undefined for a constant term */
  source?: LiveSource;
  /** Only meaningful without `source` */
  constant: number;
  operation: CalculationOperation;
  multiply: number;
  add: number;
  clipMin?: number;
  clipMax?: number;
}

export interface ResolvedLiveCalculation {
  terms: ResolvedLiveTerm[];
  initialValue: number;
  unit?: string;
}

/** One live row with everything resolved that does not need `hass` */
export interface ResolvedLiveEntity extends ResolvedEntityBase {
  /** Set for a plain row */
  source?: LiveSource;
  /** Set when the row is computed from several entities */
  calculation?: ResolvedLiveCalculation;
  /** Every entity the row reads, in first-use order */
  entityIds: string[];
}

export type ResolvedLiveConfig = ResolvedConfigBase<
  EntityLegendTableCardConfig,
  ResolvedLiveEntity
>;

function resolveTerm(term: LiveCalculationTerm, field: string): ResolvedLiveTerm {
  if (!term || typeof term !== "object") {
    fail(`\`${field}\` must be an object`);
  }

  const entityId = trimmedString(term.entity);

  return {
    source: entityId ? { entityId, attribute: trimmedString(term.attribute) } : undefined,
    constant: numberOr(term.constant, 0, `${field}.constant`),
    operation:
      oneOf(term.operation, ALL_CALCULATION_OPERATIONS, `${field}.operation`) ?? "add",
    multiply: numberOr(term.multiply, 1, `${field}.multiply`),
    add: numberOr(term.add, 0, `${field}.add`),
    clipMin: optionalNumber(term.clip_min, `${field}.clip_min`),
    clipMax: optionalNumber(term.clip_max, `${field}.clip_max`),
  };
}

function resolveEntity(entity: LiveEntityConfig, index: number): ResolvedLiveEntity {
  if (!entity || typeof entity !== "object") {
    fail(`\`entities[${index}]\` must be an object`);
  }

  const entityId = trimmedString(entity.entity);
  const calculationConfig = entity.calculation;

  if (entityId && calculationConfig) {
    fail(`\`entities[${index}]\` must not set both \`entity\` and \`calculation\``);
  }

  let source: LiveSource | undefined;
  let calculation: ResolvedLiveCalculation | undefined;
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
      if (term.source && !ids.includes(term.source.entityId)) {
        ids.push(term.source.entityId);
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
  } else if (entityId) {
    source = { entityId, attribute: trimmedString(entity.attribute) };
    ids.push(entityId);
  } else {
    fail(`\`entities[${index}]\` needs an \`entity\` or a \`calculation\``);
  }

  return {
    ...resolveEntityBase(entity, index, ids, LIVE_SHOW_VALUES_MODES),
    source,
    calculation,
    entityIds: ids,
  };
}

export function normalizeLiveConfig(config: EntityLegendTableCardConfig): ResolvedLiveConfig {
  checkCardConfig(config, "entity");

  const entities = config.entities!.map(resolveEntity);
  checkUniqueKeys(entities);

  return { raw: config, entities, links: resolveLinks(config) };
}
