/**
 * Link adapter built on a documented CustomEvent protocol.
 *
 * Two events on `window`, both carrying the legend's `link_id` so several
 * legends can coexist on one dashboard:
 *
 *   legend-table:toggle   ← dispatched by this card on every click
 *     detail: { link_id, target, hidden }
 *
 *   legend-table:state    → listened for, to adopt outside state
 *     detail: { link_id, target, hidden }   // one target
 *     detail: { link_id, hidden: string[] } // the full hidden set
 *
 * `window` is used on purpose rather than a bubbling DOM event: the receiving
 * card is a sibling somewhere else in the dashboard, not an ancestor, so there
 * is no shared path to bubble along. This is the integration point for cards
 * that want to support the legend natively, and for user JavaScript.
 */

import type { LinkAdapter, LinkContext } from "./types";

export const TOGGLE_EVENT = "legend-table:toggle";
export const STATE_EVENT = "legend-table:state";

interface StateDetail {
  link_id?: string;
  target?: string;
  hidden?: boolean | string[];
}

export class EventLinkAdapter implements LinkAdapter {
  private _linkId?: string;
  private _context?: LinkContext;
  private _hidden = new Set<string>();
  private _listening = false;

  constructor(linkId?: string) {
    this._linkId = linkId;
  }

  public attach(context: LinkContext): void {
    this._context = context;
    if (!this._listening) {
      window.addEventListener(STATE_EVENT, this._onState);
      this._listening = true;
    }
  }

  public detach(): void {
    if (this._listening) {
      window.removeEventListener(STATE_EVENT, this._onState);
      this._listening = false;
    }
  }

  public toggle(target: string, hidden: boolean): void {
    if (hidden) {
      this._hidden.add(target);
    } else {
      this._hidden.delete(target);
    }
    window.dispatchEvent(
      new CustomEvent(TOGGLE_EVENT, {
        detail: { link_id: this._linkId, target, hidden },
      })
    );
  }

  public isHidden(target: string): boolean | undefined {
    return this._hidden.has(target) ? true : undefined;
  }

  private _onState = (event: Event): void => {
    const detail = (event as CustomEvent<StateDetail>).detail;
    if (!detail || (detail.link_id ?? undefined) !== this._linkId) {
      return;
    }

    if (Array.isArray(detail.hidden)) {
      this._hidden = new Set(detail.hidden);
    } else if (detail.target) {
      if (detail.hidden) {
        this._hidden.add(detail.target);
      } else {
        this._hidden.delete(detail.target);
      }
    } else {
      return;
    }

    this._context?.notify();
  };
}
