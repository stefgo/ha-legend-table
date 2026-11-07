/**
 * Validation and defaulting shared by both cards.
 *
 * `setConfig()` runs in the Lovelace editor on every keystroke, so this throws
 * only for mistakes a card genuinely cannot render (no `entities`, a row
 * without a value source, an unknown enum value). Everything else is silently
 * defaulted — a card on a dashboard should degrade, not blow up.
 *
 * Everything here is independent of where a row's value comes from; the two
 * card-specific modules (`normalize-statistics.ts`, `normalize-entity.ts`) only
 * add the value source on top.
 */

import {
  ALL_SHOW_VALUES_MODES,
  ColorConfig,
  LegendEntityConfig,
  LegendTableCardConfig,
  LinkConfig,
  LinkMode,
  ShowValuesMode,
} from "./types";

const LINK_MODES: LinkMode[] = ["chart", "entity", "event", "more-info", "none"];

/** `domain.object_id`, which external statistics (`domain:name`) are not */
export const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export const DEFAULT_PRECISION = 2;

/** The part of a row both cards resolve the same way */
export interface ResolvedEntityBase {
  key: string;
  name?: string;
  color?: ColorConfig;
  unit?: string;
  multiply: number;
  add: number;
  hiddenByDefault: boolean;
  /** At least one target; several mean one row drives several targets */
  links: string[];
  /**
   * Entity whose dialog `link: {mode: more-info}` opens: the first explicit
   * `link` target, else the row's first statistic or entity. Unset when that is
   * no entity id, e.g. an external statistic.
   */
  moreInfoEntity?: string;
  showValues: ShowValuesMode;
}

export interface ResolvedConfigBase<
  C extends LegendTableCardConfig = LegendTableCardConfig,
  E extends ResolvedEntityBase = ResolvedEntityBase,
> {
  raw: C;
  entities: E[];
  links: LinkConfig[];
}

export function fail(message: string): never {
  throw new Error(message);
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: T[],
  field: string
): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`\`${field}\` must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function numberOr(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`\`${field}\` must be a number`);
  }
  return value;
}

export function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return numberOr(value, 0, field);
}

/** A trimmed, non-empty string, or `undefined` for anything else */
export function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

/** The entity `more-info` opens for a row, see `ResolvedEntityBase.moreInfoEntity` */
function resolveMoreInfoEntity(
  link: string | string[] | undefined,
  sourceIds: string[]
): string | undefined {
  const target = explicitLinkTargets(link)[0] ?? sourceIds[0];
  return target && ENTITY_ID_PATTERN.test(target) ? target : undefined;
}

/**
 * Resolves the fields every row has.
 *
 * `sourceIds` are the statistics or entities the row reads, in first-use
 * order: the first one is the default `key` and the default `more-info` target.
 * `showValuesModes` lets a card narrow `show_values` to the modes it supports.
 */
export function resolveEntityBase(
  entity: LegendEntityConfig,
  index: number,
  sourceIds: string[],
  showValuesModes: ShowValuesMode[] = ALL_SHOW_VALUES_MODES
): ResolvedEntityBase {
  const key = trimmedString(entity.key) ?? sourceIds[0] ?? `entity_${index}`;

  return {
    key,
    name: typeof entity.name === "string" ? entity.name : undefined,
    color: resolveColorConfig(entity.color),
    unit: typeof entity.unit === "string" ? entity.unit : undefined,
    multiply: numberOr(entity.multiply, 1, `entities[${index}].multiply`),
    add: numberOr(entity.add, 0, `entities[${index}].add`),
    hiddenByDefault: entity.hidden_by_default === true,
    links: resolveLinkTargets(entity.link, key),
    moreInfoEntity: resolveMoreInfoEntity(entity.link, sourceIds),
    showValues:
      oneOf(entity.show_values, showValuesModes, `entities[${index}].show_values`) ?? "always",
  };
}

/** `link` accepts a single block or a list; both become a list here */
export function resolveLinks(config: LegendTableCardConfig): LinkConfig[] {
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

/**
 * The checks both cards run before resolving their rows: a config object, a
 * non-empty `entities` list and a well-formed `card` block.
 */
export function checkCardConfig(config: LegendTableCardConfig, rowNoun: string): void {
  if (!config || typeof config !== "object") {
    fail("Invalid configuration");
  }
  if (!Array.isArray(config.entities) || !config.entities.length) {
    fail(`\`entities\` is required and must list at least one ${rowNoun}`);
  }
  if (config.card !== undefined && (typeof config.card !== "object" || !config.card?.type)) {
    fail("`card` must be a card configuration with a `type`");
  }
}

/** Rejects two rows sharing a key — selectors and links address rows by it */
export function checkUniqueKeys(entities: ResolvedEntityBase[]): void {
  const duplicate = entities.find(
    (entity, index) => entities.findIndex((other) => other.key === entity.key) !== index
  );
  if (duplicate) {
    fail(`Duplicate entity key \`${duplicate.key}\` — set an explicit \`key\` to disambiguate`);
  }
}
