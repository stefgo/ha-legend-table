/**
 * Owns the legend's visibility state and fans clicks out to the adapters.
 *
 * The card never talks to an adapter directly — it asks the controller whether a
 * row is hidden and tells it when one was clicked. Without any `link` block the
 * controller is simply local state, which is why a standalone legend still
 * greys out rows and still updates a `total: {mode: sum}` on click.
 */

import type { HomeAssistant } from "custom-card-helpers";

import type { LinkConfig } from "../config/types";
import { ChartLinkAdapter } from "./chart-adapter";
import { EntityLinkAdapter } from "./entity-adapter";
import { EventLinkAdapter } from "./event-adapter";
import type { LinkAdapter, LinkContext } from "./types";

function createAdapter(config: LinkConfig): LinkAdapter | undefined {
  switch (config.mode) {
    case "chart":
      return new ChartLinkAdapter();
    case "entity":
      return new EntityLinkAdapter(config.service, config.hidden_state);
    case "event":
      return new EventLinkAdapter(config.link_id);
    default:
      return undefined;
  }
}

export class LinkController {
  private _adapters: LinkAdapter[] = [];
  private _context?: LinkContext;
  /** Fallback state for rows no adapter has an opinion about */
  private _hidden = new Set<string>();
  private _notify: () => void;
  private _moreInfo = false;

  constructor(notify: () => void) {
    this._notify = notify;
  }

  /** Rebuilds the adapters after a config change */
  public configure(links: LinkConfig[], hiddenByDefault: string[]): void {
    this.detach();
    this._adapters = links
      .map(createAdapter)
      .filter((adapter): adapter is LinkAdapter => Boolean(adapter));
    this._moreInfo = links.some((link) => link.mode === "more-info");
    // A click never hides a row in `more-info` mode, so a row hidden from the
    // start could never come back.
    this._hidden = this._moreInfo ? new Set() : new Set(hiddenByDefault);
  }

  /**
   * Whether a click opens the entity dialog instead of hiding the row. The card
   * handles that click itself — there is nothing to toggle, so `toggle()` is
   * not called and no row is ever hidden.
   */
  public opensMoreInfo(): boolean {
    return this._moreInfo;
  }

  /**
   * (Re-)resolves every adapter's target. Called on connect and after each
   * update, since the wrapped card may only have rendered its chart by then.
   */
  public attach(host: HTMLElement, wrappedCard: HTMLElement | undefined, hass: HomeAssistant | undefined): void {
    this._context = { host, wrappedCard, hass, notify: this._notify };
    this._adapters.forEach((adapter) => adapter.attach(this._context!));
  }

  /**
   * Refreshes the adapters without re-resolving their targets.
   *
   * The card calls this for an update it skips: nothing has rendered, so the DOM
   * cannot have changed, but `hass` has been replaced and a mirrored state may
   * have moved on underneath.
   */
  public sync(host: HTMLElement, wrappedCard: HTMLElement | undefined, hass: HomeAssistant | undefined): void {
    this._context = { host, wrappedCard, hass, notify: this._notify };
    this._adapters.forEach((adapter) => adapter.sync?.(this._context!));
  }

  public detach(): void {
    this._adapters.forEach((adapter) => adapter.detach());
    this._context = undefined;
  }

  /**
   * Whether any adapter derives its answer from entity state.
   *
   * Only `EntityLinkAdapter` does. The card asks this to decide whether a
   * `hass` update can change what the legend renders: without an entity link,
   * no state in the house affects a single row, and the update can be skipped
   * outright.
   */
  public tracksEntities(): boolean {
    return this._adapters.some((adapter) => adapter instanceof EntityLinkAdapter);
  }

  /**
   * Whether a single target is hidden. The first adapter with an opinion wins,
   * so a chart toggled directly (or an entity switched elsewhere) is reflected
   * in the legend; local state only fills in when nobody knows better.
   */
  private _isTargetHidden(target: string): boolean {
    for (const adapter of this._adapters) {
      const hidden = adapter.isHidden(target);
      if (hidden !== undefined) {
        return hidden;
      }
    }
    return this._hidden.has(target);
  }

  /**
   * Whether a row is hidden. With several targets the row counts as hidden only
   * once *all* of them are — a partially hidden row still renders normally, and
   * the next click hides the rest, which is the only reading that keeps a
   * multi-target row usable after someone toggled one series in the chart.
   */
  public isHidden(targets: string[]): boolean {
    return targets.length > 0 && targets.every((target) => this._isTargetHidden(target));
  }

  /** Handles a click on a legend row */
  public toggle(targets: string[]): void {
    // One state for the whole row, so several targets cannot drift apart.
    const hidden = !this.isHidden(targets);

    targets.forEach((target) => {
      if (hidden) {
        this._hidden.add(target);
      } else {
        this._hidden.delete(target);
      }
      this._adapters.forEach((adapter) => adapter.toggle(target, hidden));
    });

    this._notify();
  }
}
