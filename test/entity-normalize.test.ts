import { describe, expect, it } from "vitest";

import { normalizeLiveConfig } from "../src/config/normalize-entity";
import type { EntityLegendTableCardConfig } from "../src/config/types";

const config = (
  overrides: Partial<EntityLegendTableCardConfig> = {}
): EntityLegendTableCardConfig =>
  ({
    type: "custom:entity-legend-table",
    entities: [{ entity: "sensor.power" }],
    ...overrides,
  }) as EntityLegendTableCardConfig;

describe("normalizeLiveConfig", () => {
  it("accepts a minimal configuration", () => {
    const resolved = normalizeLiveConfig(config());
    expect(resolved.entities).toHaveLength(1);
    expect(resolved.entities[0]).toMatchObject({
      key: "sensor.power",
      source: { entityId: "sensor.power" },
      entityIds: ["sensor.power"],
      moreInfoEntity: "sensor.power",
      showValues: "always",
    });
  });

  it("requires at least one entity", () => {
    expect(() => normalizeLiveConfig(config({ entities: [] }))).toThrow(/entities/);
  });

  it("requires an entity or a calculation per row", () => {
    expect(() => normalizeLiveConfig(config({ entities: [{ name: "x" }] }))).toThrow(
      /needs an `entity` or a `calculation`/
    );
  });

  it("refuses entity and calculation together", () => {
    expect(() =>
      normalizeLiveConfig(
        config({
          entities: [{ entity: "sensor.a", calculation: { terms: [{ entity: "sensor.b" }] } }],
        })
      )
    ).toThrow(/both/);
  });

  it("reads an attribute instead of the state", () => {
    const resolved = normalizeLiveConfig(
      config({ entities: [{ entity: "climate.living", attribute: " current_temperature " }] })
    );
    expect(resolved.entities[0].source).toEqual({
      entityId: "climate.living",
      attribute: "current_temperature",
    });
  });

  it("resolves a calculation over entities", () => {
    const resolved = normalizeLiveConfig(
      config({
        entities: [
          {
            name: "House",
            calculation: {
              terms: [
                { entity: "sensor.grid" },
                { entity: "sensor.pv" },
                { entity: "sensor.export", operation: "subtract" },
                { constant: 5 },
              ],
            },
          },
        ],
      })
    );
    const entity = resolved.entities[0];
    expect(entity.key).toBe("sensor.grid");
    expect(entity.entityIds).toEqual(["sensor.grid", "sensor.pv", "sensor.export"]);
    expect(entity.calculation?.terms[2].operation).toBe("subtract");
    expect(entity.calculation?.terms[3]).toMatchObject({ source: undefined, constant: 5 });
  });

  it("refuses show_values: selection, which needs a graph selection", () => {
    expect(() =>
      normalizeLiveConfig(
        config({ entities: [{ entity: "sensor.power", show_values: "selection" }] })
      )
    ).toThrow(/show_values/);
  });

  it("ignores options of the statistics card", () => {
    expect(() =>
      normalizeLiveConfig(
        config({
          timespan: { mode: "nonsense" },
          aggregation: { period: "nonsense" },
          legend: { columns: ["max"] },
        } as Partial<EntityLegendTableCardConfig>)
      )
    ).not.toThrow();
  });

  it("opens the first explicit link target in more-info mode", () => {
    const resolved = normalizeLiveConfig(
      config({
        link: { mode: "more-info" },
        entities: [{ entity: "sensor.power", link: "sensor.other" }],
      })
    );
    expect(resolved.entities[0].moreInfoEntity).toBe("sensor.other");
  });
});
