/**
 * `indicator` and `icon`: what a row shows in front of its name.
 */
import { describe, expect, it } from "vitest";

import { tintColor } from "../src/colors";
import { normalizeLiveConfig } from "../src/config/normalize-entity";
import { normalizeConfig } from "../src/config/normalize-statistics";
import type { LegendRow, StatisticsLegendTableCardConfig } from "../src/config/types";
import { buildLegendGroups, needsIndicatorColumn, resolveIndicator } from "../src/legend-stats";

const config = (
  overrides: Partial<StatisticsLegendTableCardConfig> = {}
): StatisticsLegendTableCardConfig =>
  ({
    type: "custom:statistics-legend-table",
    entities: [{ statistic_id: "sensor.energy" }],
    ...overrides,
  }) as StatisticsLegendTableCardConfig;

const row = (overrides: Partial<LegendRow> = {}): LegendRow => ({
  id: "sensor.energy",
  name: "Energy",
  color: "#488fc2",
  fillColor: "rgba(72, 143, 194, 0.5)",
  unit: "kWh",
  sum: 1,
  min: 1,
  max: 1,
  avg: 1,
  count: 1,
  links: ["sensor.energy"],
  showValues: "always",
  ...overrides,
});

describe("normalizing indicator and icon", () => {
  it("leaves both unset by default", () => {
    const [entity] = normalizeConfig(config()).entities;
    expect(entity.icon).toBeUndefined();
    expect(entity.indicator).toBeUndefined();
  });

  it("takes a row's indicator and trims its icon", () => {
    const [entity] = normalizeConfig(
      config({
        entities: [{ statistic_id: "sensor.energy", indicator: "icon", icon: " mdi:solar-power " }],
      })
    ).entities;
    expect(entity).toMatchObject({ indicator: "icon", icon: "mdi:solar-power" });
  });

  it("ignores an icon that is no text", () => {
    const [entity] = normalizeConfig(
      config({
        entities: [{ statistic_id: "sensor.energy", icon: 42 as unknown as string }],
      })
    ).entities;
    expect(entity.icon).toBeUndefined();
  });

  it("rejects an unknown indicator on a row, the legend and a group", () => {
    expect(() =>
      normalizeConfig(
        config({
          entities: [{ statistic_id: "sensor.energy", indicator: "circle" as never }],
        })
      )
    ).toThrow(/entities\[0\]\.indicator/);
    expect(() => normalizeConfig(config({ legend: { indicator: "circle" as never } }))).toThrow(
      /legend\.indicator/
    );
    expect(() =>
      normalizeConfig(config({ legend: { groups: [{ indicator: "circle" as never }] } }))
    ).toThrow(/legend\.groups\[0\]\.indicator/);
  });

  it("validates the legend indicator of the entity card too", () => {
    expect(() =>
      normalizeLiveConfig({
        type: "custom:entity-legend-table",
        entities: [{ entity: "sensor.power" }],
        legend: { indicator: "circle" as never },
      })
    ).toThrow(/legend\.indicator/);
  });
});

describe("resolveIndicator", () => {
  it("defaults to the color box", () => {
    expect(resolveIndicator(row(), {})).toBe("box");
  });

  it("prefers the row over the legend", () => {
    expect(resolveIndicator(row({ indicator: "none" }), { indicator: "icon" })).toBe("none");
    expect(resolveIndicator(row({ icon: "mdi:fire" }), { indicator: "icon" })).toBe("icon");
  });

  it("falls back when an icon mode has no icon", () => {
    expect(resolveIndicator(row({ indicator: "icon" }), {})).toBe("box");
    expect(resolveIndicator(row({ indicator: "plain_icon" }), {})).toBe("none");
    expect(resolveIndicator(row({ indicator: "plain_icon", icon: "mdi:fire" }), {})).toBe(
      "plain_icon"
    );
  });

  it("lets a group override the legend", () => {
    const rows = [row({ id: "a", icon: "mdi:fire" }), row({ id: "b", icon: "mdi:fire" })];
    const groups = buildLegendGroups(rows, {
      indicator: "icon",
      groups: [{ entities: ["a"], indicator: "plain_icon" }],
    });
    expect(resolveIndicator(groups[0].rows[0], groups[0].config)).toBe("plain_icon");
    expect(resolveIndicator(groups[1].rows[0], groups[1].config)).toBe("icon");
  });
});

describe("needsIndicatorColumn", () => {
  it("drops the column only when no row shows anything", () => {
    expect(needsIndicatorColumn([row({ indicator: "none" })], {})).toBe(false);
    expect(needsIndicatorColumn([row()], { indicator: "none" })).toBe(false);
    expect(needsIndicatorColumn([row({ indicator: "plain_icon" })], {})).toBe(false);
    expect(needsIndicatorColumn([row({ indicator: "none" }), row()], {})).toBe(true);
  });
});

describe("tintColor", () => {
  it("applies the alpha to a color it can parse", () => {
    expect(tintColor("#488fc2", 0.2)).toBe("rgba(72, 143, 194, 0.2)");
  });

  it("tints any other color through color-mix", () => {
    expect(tintColor("var(--energy-solar-color)", 0.2)).toBe(
      "color-mix(in srgb, var(--energy-solar-color) 20%, transparent)"
    );
    expect(tintColor("orange", 0.2)).toBe("color-mix(in srgb, orange 20%, transparent)");
  });
});
