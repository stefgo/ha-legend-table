/**
 * First tests of the card — the scaffold the suite grows from.
 *
 * `normalizeConfig` is the entry point of every dashboard: Lovelace calls it
 * from `setConfig()` on every keystroke in the editor. It is pure and needs no
 * DOM, which is what makes it the natural place to start testing.
 */
import { describe, expect, it } from "vitest";

import { columnsFor, normalizeConfig } from "../src/config/normalize";
import type { StatisticsLegendTableCardConfig } from "../src/config/types";

const config = (
  overrides: Partial<StatisticsLegendTableCardConfig> = {}
): StatisticsLegendTableCardConfig =>
  ({
    type: "custom:statistics-legend-table",
    entities: [{ statistic_id: "sensor.energy" }],
    ...overrides,
  }) as StatisticsLegendTableCardConfig;

describe("normalizeConfig", () => {
  it("accepts a minimal configuration", () => {
    const resolved = normalizeConfig(config());
    expect(resolved.entities).toHaveLength(1);
  });

  it("requires at least one entity", () => {
    expect(() => normalizeConfig(config({ entities: [] }))).toThrow(/entities/);
  });

  it("rejects duplicate entity keys", () => {
    expect(() =>
      normalizeConfig(
        config({
          entities: [
            { statistic_id: "sensor.energy" },
            { statistic_id: "sensor.energy" },
          ],
        })
      )
    ).toThrow(/Duplicate entity key/);
  });

  it("rejects an unknown enum value", () => {
    expect(() =>
      normalizeConfig(config({ timespan: { mode: "nonsense" as never } }))
    ).toThrow(/timespan.mode/);
  });
});

describe("columnsFor", () => {
  it("falls back to sum", () => {
    expect(columnsFor(undefined)).toEqual(["sum"]);
    expect(columnsFor([])).toEqual(["sum"]);
    expect(columnsFor(["nonsense" as never])).toEqual(["sum"]);
  });

  it("keeps the configured columns", () => {
    expect(columnsFor(["avg", "max"])).toEqual(["avg", "max"]);
  });
});

describe("link mode more-info", () => {
  const moreInfo = { mode: "more-info" as const };

  it("opens the row's statistic, not its key", () => {
    const resolved = normalizeConfig(
      config({ link: moreInfo, entities: [{ key: "range", statistic_id: "sensor.range" }] })
    );
    expect(resolved.entities[0].moreInfoEntity).toBe("sensor.range");
    expect(resolved.entities[0].links).toEqual(["range"]);
  });

  it("prefers the first explicit link target", () => {
    const resolved = normalizeConfig(
      config({
        link: moreInfo,
        entities: [{ statistic_id: "sensor.copy", link: ["sensor.original", "sensor.other"] }],
      })
    );
    expect(resolved.entities[0].moreInfoEntity).toBe("sensor.original");
  });

  it("uses the first statistic of a calculation", () => {
    const resolved = normalizeConfig(
      config({
        link: moreInfo,
        entities: [
          {
            key: "net",
            calculation: {
              terms: [{ statistic_id: "sensor.import" }, { statistic_id: "sensor.export" }],
            },
          },
        ],
      })
    );
    expect(resolved.entities[0].moreInfoEntity).toBe("sensor.import");
  });

  it("has no entity for an external statistic", () => {
    const resolved = normalizeConfig(
      config({ link: moreInfo, entities: [{ statistic_id: "sensor:external_energy" }] })
    );
    expect(resolved.entities[0].moreInfoEntity).toBeUndefined();
  });

  it("cannot be combined with another mode", () => {
    expect(() => normalizeConfig(config({ link: [moreInfo, { mode: "chart" }] }))).toThrow(
      /more-info/
    );
  });

  it("may stand next to mode none", () => {
    const resolved = normalizeConfig(config({ link: [moreInfo, { mode: "none" }] }));
    expect(resolved.links).toEqual([moreInfo]);
  });
});
