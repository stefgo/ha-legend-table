/**
 * `custom:entity-legend-table`
 *
 * The legend of `statistics-legend-table` over live values: one row per
 * entity with its current state (or an attribute, or a value calculated from
 * several entities), clickable, plus an optional total row.
 *
 * There is nothing to fetch. The rows are rebuilt from `hass.states` whenever
 * one of the entities they read changes — and only then: the entities are
 * handed to `LegendTableBase` as watched, so `shouldUpdate()` lets every other
 * state change in the house pass by without a render.
 */

import { PropertyValues } from "lit";
import { customElement } from "lit/decorators.js";
import type { HomeAssistant } from "custom-card-helpers";

import { DEFAULT_PRECISION } from "./config/normalize-common";
import {
  ResolvedLiveConfig,
  ResolvedLiveEntity,
  normalizeLiveConfig,
} from "./config/normalize-entity";
import type { EntityLegendTableCardConfig, LegendRow } from "./config/types";
import { buildLiveRows, collectLiveEntities, liveRatioSum } from "./data/live";
import { RatioSum } from "./legend-stats";
import { LegendTableBase } from "./legend-table-base";
import { ENTITY_CARD_NAME } from "./version";

/** The single value column of a live row */
const LIVE_COLUMN = "state";

@customElement(ENTITY_CARD_NAME)
export class EntityLegendTableCard extends LegendTableBase<
  EntityLegendTableCardConfig,
  ResolvedLiveEntity
> {
  /**
   * Configuration the card picker previews the card with: the first offered
   * entity with a numeric state and a unit, which is what this card is for.
   * Nothing suitable leaves a placeholder that renders as unavailable rather
   * than an error.
   */
  public static getStubConfig(
    hass?: HomeAssistant,
    entities?: string[],
    entitiesFallback?: string[]
  ): EntityLegendTableCardConfig {
    const candidates = [...(entities ?? []), ...(entitiesFallback ?? [])];
    const entity =
      candidates.find((entityId) => {
        const stateObj = hass?.states?.[entityId];
        return (
          stateObj !== undefined &&
          stateObj.state.trim() !== "" &&
          Number.isFinite(Number(stateObj.state)) &&
          typeof stateObj.attributes?.unit_of_measurement === "string"
        );
      }) ?? "sensor.example_power";

    return {
      type: `custom:${ENTITY_CARD_NAME}`,
      entities: [{ entity }],
    } as EntityLegendTableCardConfig;
  }

  /* ---------------------------------------------------------------------- */
  /* Hooks of LegendTableBase                                                */
  /* ---------------------------------------------------------------------- */

  protected _normalize(config: EntityLegendTableCardConfig): ResolvedLiveConfig {
    return normalizeLiveConfig(config);
  }

  protected _watchEntities(config: ResolvedLiveConfig): string[] {
    return [
      ...super._watchEntities(config),
      ...collectLiveEntities(config.entities, config.raw.legend),
    ];
  }

  protected _buildRows(): LegendRow[] {
    return this._config ? buildLiveRows(this._config.entities, this.hass) : [];
  }

  protected _columns(): string[] {
    return [LIVE_COLUMN];
  }

  protected _columnLabel(): string {
    return this._localize("ui.panel.lovelace.editor.card.generic.state", "Zustand");
  }

  protected _cellValue(row: LegendRow): number {
    return row.sum;
  }

  protected _ratioSum(): RatioSum {
    return liveRatioSum(this.hass);
  }

  /**
   * Without any configured precision the sum takes the finest precision of its
   * rows, so a total of `1.25 kW` and `0.4 kW` does not round away what the
   * rows show.
   */
  protected _totalFallbackPrecision(rows: LegendRow[]): number {
    const precisions = rows
      .map((row) => row.precision)
      .filter((precision): precision is number => precision !== undefined);
    return precisions.length ? Math.max(...precisions) : DEFAULT_PRECISION;
  }

  /**
   * Rebuilds the rows on every update `shouldUpdate()` let through with a new
   * `hass` — which already means one of the watched entities changed — and on
   * every new config.
   */
  protected willUpdate(changedProps: PropertyValues): void {
    super.willUpdate(changedProps);
    if (this._config && (changedProps.has("hass") || changedProps.has("_config"))) {
      this._rows = this._buildRows();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "entity-legend-table": EntityLegendTableCard;
  }
}
