import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "custom-card-helpers";

import { normalizeLiveConfig } from "../src/config/normalize-entity";
import type { LiveEntityConfig } from "../src/config/types";
import {
  MISSING_TEXT,
  buildLiveRows,
  collectLiveEntities,
  liveRatioSum,
} from "../src/data/live";
import { computeTotal } from "../src/legend-stats";

interface FakeState {
  state: string;
  attributes?: Record<string, unknown>;
}

const fakeHass = (
  states: Record<string, FakeState>,
  extra: Record<string, unknown> = {}
): HomeAssistant =>
  ({
    states: Object.fromEntries(
      Object.entries(states).map(([id, s]) => [
        id,
        { entity_id: id, attributes: {}, ...s },
      ])
    ),
    themes: { darkMode: false },
    ...extra,
  }) as unknown as HomeAssistant;

const rowsFor = (entities: LiveEntityConfig[], hass: HomeAssistant) =>
  buildLiveRows(
    normalizeLiveConfig({ type: "custom:entity-legend-table", entities }).entities,
    hass
  );

describe("buildLiveRows", () => {
  it("reads a numeric state with its unit and friendly name", () => {
    const [row] = rowsFor(
      [{ entity: "sensor.pv" }],
      fakeHass({
        "sensor.pv": { state: "1234.5", attributes: { unit_of_measurement: "W", friendly_name: "PV" } },
      })
    );
    expect(row).toMatchObject({ name: "PV", unit: "W", sum: 1234.5, count: 1, text: undefined });
  });

  it("applies multiply and add", () => {
    const [row] = rowsFor(
      [{ entity: "sensor.pv", multiply: 0.001, add: 1, unit: "kW" }],
      fakeHass({ "sensor.pv": { state: "2000" } })
    );
    expect(row.sum).toBeCloseTo(3);
    expect(row.unit).toBe("kW");
  });

  it("shows unavailable, unknown and missing entities as missing", () => {
    const rows = rowsFor(
      [{ entity: "sensor.a" }, { entity: "sensor.b" }, { entity: "sensor.gone" }],
      fakeHass({ "sensor.a": { state: "unavailable" }, "sensor.b": { state: "unknown" } })
    );
    rows.forEach((row) => {
      expect(row.text).toBe(MISSING_TEXT);
      expect(row.count).toBe(0);
    });
  });

  it("formats a text state through Home Assistant, falling back to the raw state", () => {
    const formatted = rowsFor(
      [{ entity: "climate.living" }],
      fakeHass(
        { "climate.living": { state: "heat" } },
        { formatEntityState: () => "Heizen" }
      )
    );
    expect(formatted[0]).toMatchObject({ text: "Heizen", count: 1 });

    const raw = rowsFor([{ entity: "climate.living" }], fakeHass({ "climate.living": { state: "heat" } }));
    expect(raw[0].text).toBe("heat");
  });

  it("reads an attribute, without the state's unit", () => {
    const [row] = rowsFor(
      [{ entity: "climate.living", attribute: "current_temperature" }],
      fakeHass({
        "climate.living": {
          state: "heat",
          attributes: { current_temperature: 21.5, unit_of_measurement: "x" },
        },
      })
    );
    expect(row).toMatchObject({ sum: 21.5, unit: "", text: undefined });
  });

  it("evaluates a calculation over current values", () => {
    const [row] = rowsFor(
      [
        {
          name: "House",
          calculation: {
            terms: [
              { entity: "sensor.grid" },
              { entity: "sensor.pv" },
              { entity: "sensor.export", operation: "subtract" },
            ],
          },
        },
      ],
      fakeHass({
        "sensor.grid": { state: "100", attributes: { unit_of_measurement: "W" } },
        "sensor.pv": { state: "900" },
        "sensor.export": { state: "300" },
      })
    );
    expect(row).toMatchObject({ name: "House", sum: 700, unit: "W", count: 1 });
  });

  it("makes a calculation missing when a term has no number or divides by zero", () => {
    const rows = rowsFor(
      [
        { key: "a", calculation: { terms: [{ entity: "sensor.grid" }, { entity: "sensor.pv" }] } },
        {
          key: "b",
          calculation: { terms: [{ entity: "sensor.grid" }, { constant: 0, operation: "divide" }] },
        },
      ],
      fakeHass({ "sensor.grid": { state: "100" }, "sensor.pv": { state: "unavailable" } })
    );
    rows.forEach((row) => expect(row.text).toBe(MISSING_TEXT));
  });

  it("takes the icon from the entity unless the row sets one", () => {
    const hass = fakeHass({
      "sensor.pv": { state: "1", attributes: { icon: "mdi:solar-power" } },
      "sensor.grid": { state: "2" },
    });
    const [fromEntity, explicit, none] = rowsFor(
      [
        { entity: "sensor.pv" },
        { entity: "sensor.pv", key: "pv2", icon: "mdi:flash" },
        { entity: "sensor.grid" },
      ],
      hass
    );
    expect(fromEntity.icon).toBe("mdi:solar-power");
    expect(explicit.icon).toBe("mdi:flash");
    expect(none.icon).toBeUndefined();
  });

  it("gives a calculated row no icon of its entities", () => {
    const [row] = rowsFor(
      [{ key: "calc", calculation: { terms: [{ entity: "sensor.pv" }] } }],
      fakeHass({ "sensor.pv": { state: "1", attributes: { icon: "mdi:solar-power" } } })
    );
    expect(row.icon).toBeUndefined();
  });

  it("takes the entity's display precision", () => {
    const [row] = rowsFor(
      [{ entity: "sensor.pv" }],
      fakeHass(
        { "sensor.pv": { state: "1.23456" } },
        { entities: { "sensor.pv": { display_precision: 1 } } }
      )
    );
    expect(row.precision).toBe(1);
  });
});

describe("live totals", () => {
  const hass = fakeHass({
    "sensor.pv": { state: "600" },
    "sensor.house": { state: "800" },
    "sensor.off": { state: "unavailable" },
  });

  it("sums current states for a ratio total", () => {
    const total = computeTotal(
      [],
      { total: { mode: "ratio", numerator: ["sensor.pv"], denominator: ["sensor.house", "sensor.off"] } },
      liveRatioSum(hass),
      (_key, fallback) => fallback
    );
    expect(total?.value).toBeCloseTo(75);
  });

  it("leaves text and missing rows out of a sum total", () => {
    const rows = rowsFor(
      [{ entity: "sensor.pv" }, { entity: "sensor.off" }, { entity: "switch.x" }],
      fakeHass({
        "sensor.pv": { state: "600" },
        "sensor.off": { state: "unavailable" },
        "switch.x": { state: "on" },
      })
    );
    const total = computeTotal(rows, { total: { mode: "sum" } }, liveRatioSum(hass), (_k, f) => f);
    expect(total?.value).toBe(600);
  });

  it("watches row entities and ratio operands", () => {
    const resolved = normalizeLiveConfig({
      type: "custom:entity-legend-table",
      entities: [{ entity: "sensor.pv" }, { calculation: { terms: [{ entity: "sensor.grid" }] } }],
    });
    expect(
      collectLiveEntities(resolved.entities, {
        total: { mode: "ratio", numerator: ["sensor.pv"], denominator: ["sensor.house"] },
      }).sort()
    ).toEqual(["sensor.grid", "sensor.house", "sensor.pv"]);
  });
});
