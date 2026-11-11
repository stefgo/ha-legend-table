/**
 * The element both legend table cards are built on.
 *
 * Everything here is independent of where the values come from: the optional
 * neighbouring card (created generically through Lovelace's card helpers,
 * `wrapped-card.ts`), the click interaction through pluggable adapters
 * (`src/link/`), rendering the legend, and estimating the space it needs. A
 * subclass contributes its rows and the few things that depend on them — the
 * value columns, how a cell reads, and where a `total: {mode: ratio}` gets its
 * operands.
 *
 * Nothing here knows about any particular other card. Removing the `card:` and
 * `link:` blocks leaves a fully working legend.
 */

import { LitElement, PropertyValues, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { styleMap } from "lit/directives/style-map.js";
import type { HomeAssistant } from "custom-card-helpers";

import { ICON_FILL_ALPHA, isDarkMode, tintColor } from "./colors";
import {
  DEFAULT_PRECISION,
  ResolvedConfigBase,
  ResolvedEntityBase,
} from "./config/normalize-common";
import type {
  IndicatorMode,
  LegendConfig,
  LegendGroupResult,
  LegendRow,
  LegendTableCardConfig,
  LegendTotal,
} from "./config/types";
import { hassAffectsRender, onlyHassChanged } from "./hass-changes";
import {
  RatioSum,
  buildLegendGroups,
  computeTotal,
  formatValue,
  hidesValues,
  needsIndicatorColumn,
  resolveIndicator,
} from "./legend-stats";
import { legendStyles } from "./legend-styles";
import { LinkController } from "./link/controller";
import { LovelaceCardElement, createWrappedCard } from "./wrapped-card";

/* Legend metrics, mirroring `legend-styles.ts`. They estimate the space the
   legend needs: the heights below feed `_legendHeight()`, the widths further
   down feed `_isNarrow()`. Both have to be kept in step with the stylesheet. */

/**
 * One legend line. `.legend-item` sets 14px, and Home Assistant inherits
 * `--ha-line-height-normal` (1.6) into every shadow root from `:host` in its
 * `styles.ts`, so a line is 22.4px. Rounded up, not down: every estimate here
 * errs towards reserving too much, because reserving too little clips.
 */
const LEGEND_LINE_HEIGHT = 23;
/** `gap` of `.legend` and `.legend-group` */
const LEGEND_GAP = 16;
/** `.legend` margin-top plus its bottom padding */
const LEGEND_PADDING = 24;
/** Extra margin-top of `.legend.standalone`, the legend without a `card:` block */
const LEGEND_STANDALONE_MARGIN = 8;
/** `row-gap` between the values of a row that had to stack them */
const LEGEND_STACKED_GAP = 2;
/** Height of the indicator per mode, where it is taller than a line (`.legend-icon.*`) */
const INDICATOR_HEIGHT: Partial<Record<IndicatorMode, number>> = {
  icon: 32,
  plain_icon: 24,
};

/**
 * The `title:` heading. Styled by `ha-card` itself, not here: `.card-header`
 * is slotted into it, and its `::slotted(.card-header)` rule sets
 * `--ha-font-size-2xl` (24px) at `--ha-line-height-expanded` (2) with a
 * `--ha-space-3` (12px) top padding. `legend-styles.ts` overrides the bottom
 * padding to 0, and the `h1` keeps its 0.67em user-agent margins.
 * 16.08 + 12 + 48 + 0 + 16.08, rounded up. The bottom margin collapses with
 * the legend's own `margin-top`, which makes this a few pixels generous — the
 * safe direction.
 */
const TITLE_HEIGHT = 93;

/** The error banner: one 22.4px line inside the 16px padding of `.notice` */
const NOTICE_HEIGHT = 55;

/* Widths deciding whether a row still fits on one line. No single breakpoint
   can: a lone `sum` column needs about 284px of row while all four need 584, so
   one threshold stacks the former far too eagerly and the latter not at all.
   The threshold is computed from the parts below instead — and computed here
   rather than in a container query, because a query condition cannot read a
   custom property, and because `_legendHeight()` has to reach the same verdict
   as the stylesheet. One source of truth, not two that can drift apart. */

/**
 * First grid column of `.legend-item`, holding the color box or icon. A legend
 * in which no row shows either drops it (`.legend-group.no-indicator`).
 */
const LEGEND_ICON_COLUMN = 52;
/** Column `gap` of `.legend-item` */
const LEGEND_ITEM_GAP = 12;
/** Left plus right padding of `.legend`, unavailable to a row */
const LEGEND_SIDE_PADDING = 32;
/**
 * Assumed width of one value column — about `1.234,56 kWh` at 14px. Estimated
 * and not measured on purpose: measuring the *name* would be circular, since
 * stacking changes the very width that decided to stack.
 */
const LEGEND_VALUE_WIDTH = 88;
/** Default for `legend.min_name_width`, roughly 16 characters at 14px */
const DEFAULT_MIN_NAME_WIDTH = 120;

/** `--ha-section-grid-row-gap` */
const GRID_ROW_GAP = 8;
/** One row of a Home Assistant section grid, including its gap
    (`--ha-section-grid-row-height` 56px + `GRID_ROW_GAP`). A card spanning n
    rows is given `n * GRID_ROW_HEIGHT - GRID_ROW_GAP` pixels — the trailing gap
    falls outside the card. */
const GRID_ROW_HEIGHT = 64;
/** Roughly one `getCardSize()` unit in a masonry view */
const MASONRY_UNIT = 50;

/**
 * A readable message for anything that can come out of a failed fetch.
 *
 * `hass.callWS()` does not reject with an `Error` but with a plain
 * `{code, message}` object, so the naive `String(err)` produced the useless
 * `[object Object]` in exactly the situation where the user needs to be told
 * what went wrong.
 */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === "object") {
    const { message, code } = err as { message?: unknown; code?: unknown };
    if (typeof message === "string" && message) {
      return typeof code === "string" && code ? `${message} (${code})` : message;
    }
    if (typeof code === "string" && code) {
      return code;
    }
  }
  return typeof err === "string" && err ? err : fallback;
}

export abstract class LegendTableBase<
  C extends LegendTableCardConfig,
  E extends ResolvedEntityBase,
> extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  /** Set by Home Assistant in section layouts, forwarded to the wrapped card */
  @property({ attribute: false }) public layout?: string;

  @state() protected _config?: ResolvedConfigBase<C, E>;
  @state() protected _rows: LegendRow[] = [];
  @state() protected _error?: string;

  /** Tracked so a system-triggered theme flip can rebuild rows without a fetch */
  private _darkMode = false;
  protected _wrappedCard?: LovelaceCardElement;
  protected _links = new LinkController(() => {
    this._linkNotified = true;
    this.requestUpdate();
  });
  /**
   * Set while an adapter reports changed visibility. Only read on the path
   * where `shouldUpdate()` is about to skip the render — see there.
   */
  private _linkNotified = false;

  /** The same guard `_fetch()` has, for the wrapped card `setConfig()` rebuilds */
  private _wrappedCardToken = 0;

  /**
   * Rendered width of the card, undefined until the first measurement. Decides
   * whether the legend wraps its values — see `_isNarrow()`.
   */
  private _cardWidth?: number;
  private _resizeObserver?: ResizeObserver;

  /**
   * Entities whose state can change what is rendered — see `_watchEntities()`.
   * Empty in the common case of the statistics card, see `shouldUpdate()`.
   */
  private _watchedEntities: string[] = [];

  /* ---------------------------------------------------------------------- */
  /* What a subclass provides                                                */
  /* ---------------------------------------------------------------------- */

  /** Validates and defaults the raw config; throws for an unrenderable one */
  protected abstract _normalize(config: C): ResolvedConfigBase<C, E>;

  /** Rows from whatever the subclass currently holds, without fetching anything */
  protected abstract _buildRows(): LegendRow[];

  /** Value columns a group renders */
  protected abstract _columns(config: LegendConfig): string[];

  /** Header label of a value column, for `legend.show_headers` */
  protected abstract _columnLabel(column: string): string;

  /** Where the operands of a `total: {mode: ratio}` come from */
  protected abstract _ratioSum(): RatioSum;

  /** Numeric value of one cell; a row's `text`, when set, takes precedence */
  protected abstract _cellValue(row: LegendRow, column: string): number;

  /** Called at the end of `setConfig()`, after the shared state is reset */
  protected _onConfig(_config: C): void {}

  /** Called once the first `hass` arrives */
  protected _onFirstHass(): void {}

  /** Called on (re)connect when a config is set, and on disconnect */
  protected _onConnected(): void {}

  protected _onDisconnected(): void {}

  /** Whether a row renders its value cells empty */
  protected _valuesHidden(row: LegendRow): boolean {
    return hidesValues(row, false);
  }

  /** Precision of a `total: {mode: sum}` that neither the total nor the legend sets */
  protected _totalFallbackPrecision(_rows: LegendRow[]): number {
    return DEFAULT_PRECISION;
  }

  /**
   * Entities whose state can change what a row looks like. Here: the link
   * targets of every configured entity while an `entity` link is in play, the
   * only adapter deriving a row's appearance from entity state. A subclass whose
   * values come from entity state adds those.
   */
  protected _watchEntities(config: ResolvedConfigBase<C, E>): string[] {
    return this._links.tracksEntities() ? config.entities.flatMap((entity) => entity.links) : [];
  }

  /* ---------------------------------------------------------------------- */
  /* Config                                                                  */
  /* ---------------------------------------------------------------------- */

  public setConfig(config: C): void {
    // Throws on genuinely unrenderable configs; the message surfaces in the
    // Lovelace editor.
    const resolved = this._normalize(config);
    this._config = resolved;
    this._error = undefined;
    this._rows = [];

    this._links.configure(
      resolved.links,
      resolved.entities.filter((entity) => entity.hiddenByDefault).flatMap((entity) => entity.links)
    );

    // Resolved once per config rather than per update: the set only changes
    // with the config, and `shouldUpdate()` runs on every state change.
    this._watchedEntities = [...new Set(this._watchEntities(resolved))];

    void this._setupWrappedCard(config);
    this._onConfig(config);
  }

  /* ---------------------------------------------------------------------- */
  /* Wrapped card                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Builds the element for the `card:` block.
   *
   * Guarded by a token: `setConfig()` runs on every keystroke in the Lovelace
   * editor, and this is asynchronous, so two calls can resolve in the opposite
   * order and leave the card of the *older* config standing. The token makes a
   * superseded call drop its result.
   *
   * `requestUpdate()` runs in a `finally` so the legend renders even when
   * building the inner card failed outright — without it a rejection left the
   * card silent as well as empty.
   */
  private async _setupWrappedCard(config: C): Promise<void> {
    const token = ++this._wrappedCardToken;

    try {
      if (!config.card) {
        this._wrappedCard = undefined;
        return;
      }

      const element = await createWrappedCard(config.card);
      if (token !== this._wrappedCardToken) {
        return; // a newer config won while this one was building
      }

      this._wrappedCard = element;
      if (this._wrappedCard) {
        if (this.hass) {
          this._wrappedCard.hass = this.hass;
        }
        if (this.layout !== undefined) {
          this._wrappedCard.layout = this.layout;
        }
      }
    } finally {
      if (token === this._wrappedCardToken) {
        this.requestUpdate();
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Skips the render for a `hass` update that cannot change what is rendered.
   *
   * `hass` is a reactive property and Home Assistant replaces it on every state
   * change in the whole house, so without this the card re-rendered — and
   * re-walked the shadow DOM in `updated()` — several times a second on a busy
   * installation, for values that either are refetched on a timer anyway or
   * belong to entities this card does not show.
   *
   * Two traps make this less trivial than it reads, both verified rather than
   * assumed. Lit calls `shouldUpdate()` *before* `willUpdate()`
   * (`reactive-element.js:893`), so returning `false` skips `willUpdate()` too
   * — forwarding `hass` to the wrapped card therefore has to happen here, for
   * every update, or the embedded card would stop receiving state. And a bare
   * `requestUpdate()` leaves `changedProps` empty, which
   * `onlyHassChanged()` deliberately reports as "not just hass".
   */
  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (changedProps.has("hass") && this._wrappedCard && this.hass) {
      this._wrappedCard.hass = this.hass;
    }

    if (!onlyHassChanged(changedProps)) {
      return true;
    }

    const previous = changedProps.get("hass") as HomeAssistant | undefined;
    if (!previous || !this.hass) {
      return true; // first hass, or it went away — willUpdate() has work to do
    }

    if (hassAffectsRender(previous, this.hass, this._watchedEntities)) {
      return true;
    }

    // The render is skipped, so `updated()` will not run — and with it neither
    // would the re-read of the chart's hidden set, which can change without any
    // event (`_updateHiddenStatsFromOptions()` fills it from `legend.selected`
    // on every options update). Dropping it would let the mirrored state drift
    // again, exactly the way the chart fix removed. `sync()` does that re-read
    // and, beyond it, only replaces a chart the wrapped card has thrown away
    // in a render of its own — the DOM is not searched on every update.
    //
    // An adapter noticing a change calls `notify()`, i.e. `requestUpdate()` —
    // which Lit swallows here, because the pending update it would schedule is
    // the very one being answered (`__markUpdated()` clears it on this path).
    // Hence the flag rather than a second `requestUpdate()`.
    this._linkNotified = false;
    this._links.sync(this, this._wrappedCard, this.hass);
    return this._linkNotified;
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has("hass")) {
      const previous = changedProps.get("hass") as HomeAssistant | undefined;
      if (!previous && this.hass) {
        this._onFirstHass();
      }

      // Swatch colors may differ per theme mode (`color: {light, dark}`); a
      // system-triggered flip changes `hass.themes.darkMode` without any other
      // config change, so rows are rebuilt in place instead of refetched.
      const darkMode = isDarkMode(this.hass);
      if (darkMode !== this._darkMode) {
        this._darkMode = darkMode;
        if (this._config && this._rows.length) {
          this._rows = this._buildRows();
        }
      }
    }
    if (changedProps.has("layout") && this._wrappedCard) {
      this._wrappedCard.layout = this.layout;
    }
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    // Re-resolved on every update: the wrapped card may only have rendered its
    // chart by now, and Home Assistant can recreate it across view switches.
    this._links.attach(this, this._wrappedCard, this.hass);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (this._config) {
      this._onConnected();
    }
    this._links.attach(this, this._wrappedCard, this.hass);
    this._startResizeObserver();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._onDisconnected();
    this._links.detach();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  /**
   * Tracks the card's width, which is what decides whether a group stacks its
   * values. Only a group actually changing its verdict matters, so a render is
   * requested for that and not for every pixel of a resize.
   */
  private _startResizeObserver(): void {
    if (this._resizeObserver || typeof ResizeObserver === "undefined") {
      return;
    }
    this._resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      // `contentRect` is 0x0 for a host that is not a block box; `offsetWidth`
      // still answers there, so a stray inline host cannot silently pin the
      // card to its stacked layout again.
      const width = entry?.contentRect?.width || (entry?.target as HTMLElement)?.offsetWidth;
      if (typeof width !== "number" || !width || width === this._cardWidth) {
        return;
      }
      const before = this._narrowPerGroup();
      this._cardWidth = width;
      const after = this._narrowPerGroup();
      if (before.length !== after.length || before.some((was, i) => was !== after[i])) {
        this.requestUpdate();
      }
    });
    this._resizeObserver.observe(this);
  }

  /** The stacking verdict of every group, used to spot a change on resize */
  private _narrowPerGroup(): boolean[] {
    const groups = this._groups();
    const indicatorColumn = needsIndicatorColumn(groups);
    return groups.map((group) => this._isNarrow(group, indicatorColumn));
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering                                                               */
  /* ---------------------------------------------------------------------- */

  private get _legendConfig(): LegendConfig {
    return this._config?.raw.legend ?? {};
  }

  private _groups(): LegendGroupResult[] {
    return buildLegendGroups(this._rows, this._legendConfig);
  }

  protected _localize = (key: string, fallback: string): string =>
    (this.hass as unknown as { localize?: (key: string) => string })?.localize?.(key) || fallback;

  private _format(value: number, precision: number): string {
    return formatValue(value, precision, this.hass?.locale?.language);
  }

  private _handleLegendClick(row: LegendRow): void {
    if (!this._links.opensMoreInfo()) {
      this._links.toggle(row.links);
      return;
    }
    const entityId = this._moreInfoEntity(row);
    if (entityId) {
      // Home Assistant's own event for its entity dialog, handled by the frontend
      this.dispatchEvent(
        new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
      );
    }
  }

  private _moreInfoEntity(row: LegendRow): string | undefined {
    return this._config?.entities.find((entity) => entity.key === row.id)?.moreInfoEntity;
  }

  private _total(group: LegendGroupResult, visibleRows: LegendRow[]): LegendTotal | undefined {
    return computeTotal(
      visibleRows,
      group.config,
      this._ratioSum(),
      this._localize,
      this._totalFallbackPrecision(visibleRows)
    );
  }

  protected render() {
    if (!this._config) {
      return nothing;
    }

    const groups = this._groups();
    const indicatorColumn = needsIndicatorColumn(groups);

    return html`
      <ha-card>
        ${this._config.raw.title
          ? html`<h1 class="card-header">${this._config.raw.title}</h1>`
          : nothing}
        ${this._wrappedCard
          ? html`<div class="card-slot">${this._wrappedCard}</div>`
          : nothing}
        ${this._error ? html`<div class="notice">${this._error}</div>` : nothing}
        ${groups.some((group) => group.rows.length)
          ? html`<div class="legend${this._config.raw.card ? "" : " standalone"}">
              ${groups.map((group) => this._renderGroup(group, indicatorColumn))}
            </div>`
          : nothing}
      </ha-card>
    `;
  }

  private _renderGroup(group: LegendGroupResult, indicatorColumn: boolean) {
    if (!group.rows.length) {
      return nothing;
    }

    const columns = this._columns(group.config);
    // 52px indicator cell (unless no row of the legend needs one) + flexible name + one column per value
    const gridColumns = [
      ...(indicatorColumn ? [`${LEGEND_ICON_COLUMN}px`] : []),
      "1fr",
      ...columns.map(() => "auto"),
    ].join(" ");
    const visibleRows = group.rows.filter((row) => !this._links.isHidden(row.links));
    const total = this._total(group, visibleRows);

    return html`
      <div
        class="legend-group${this._isNarrow(group, indicatorColumn) ? " narrow" : ""}${indicatorColumn
          ? ""
          : " no-indicator"}"
      >
        ${group.name ? html`<div class="legend-group-title">${group.name}</div>` : nothing}
        ${group.config.show_headers
          ? html`
              <div class="legend-headers" style="--ecl-columns: ${gridColumns}">
                ${indicatorColumn ? html`<span></span>` : nothing}
                <span></span>
                ${columns.map(
                  (column) => html`<span class="legend-value">${this._columnLabel(column)}</span>`
                )}
              </div>
            `
          : nothing}
        ${group.rows.map((row) =>
          this._renderRow(row, group.config, columns, gridColumns, indicatorColumn)
        )}
        ${total
          ? html`
              <div class="legend-total">
                <span class="legend-name">${total.name}</span>
                <span class="legend-value">
                  ${this._format(total.value, total.precision)}${total.unit ? ` ${total.unit}` : ""}
                </span>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  /**
   * The cell in front of the name: the color box, the icon on a circle of the
   * row's color, the icon alone, or an empty cell. A hidden row keeps only the
   * outline of the box or circle, the way it always kept only the box's border.
   */
  private _renderIndicator(row: LegendRow, config: LegendConfig, hidden: boolean) {
    switch (resolveIndicator(row, config)) {
      case "icon":
        return html`<span
          class="legend-icon badge"
          style=${styleMap({
            backgroundColor: hidden ? "transparent" : tintColor(row.color, ICON_FILL_ALPHA),
            borderColor: hidden ? row.color : "transparent",
            color: row.color,
          })}
          ><ha-icon .icon=${row.icon}></ha-icon
        ></span>`;
      case "plain_icon":
        return html`<span class="legend-icon plain"><ha-icon .icon=${row.icon}></ha-icon></span>`;
      case "none":
        return html`<span></span>`;
      default:
        return html`<span
          class="legend-icon"
          style=${styleMap({
            backgroundColor: hidden ? "transparent" : row.fillColor,
            borderColor: row.color,
          })}
        ></span>`;
    }
  }

  /** The text of one value cell: a row's `text` verbatim, else the formatted number */
  private _cellText(row: LegendRow, column: string, precision: number, unit: string): string {
    if (row.text !== undefined) {
      return row.text;
    }
    return `${this._format(this._cellValue(row, column), precision)}${unit}`;
  }

  private _renderRow(
    row: LegendRow,
    config: LegendConfig,
    columns: string[],
    gridColumns: string,
    indicatorColumn: boolean
  ) {
    const hidden = this._links.isHidden(row.links);
    const precision = config.precision ?? row.precision ?? DEFAULT_PRECISION;
    const showUnit = config.show_unit !== false;
    const unit = showUnit && row.unit ? ` ${row.unit}` : "";
    const valuesHidden = this._valuesHidden(row);
    // `more-info` has no on/off state, and a row without an entity does nothing
    const moreInfo = this._links.opensMoreInfo();
    const clickable = !moreInfo || this._moreInfoEntity(row) !== undefined;

    return html`
      <div
        class="legend-item ${hidden ? "hidden" : ""} ${clickable ? "" : "static"}"
        style="--ecl-columns: ${gridColumns}"
        role=${ifDefined(clickable ? "button" : undefined)}
        tabindex=${ifDefined(clickable ? "0" : undefined)}
        aria-pressed=${ifDefined(moreInfo ? undefined : String(!hidden))}
        @click=${() => this._handleLegendClick(row)}
        @keydown=${(ev: KeyboardEvent) => {
          if (clickable && (ev.key === "Enter" || ev.key === " ")) {
            ev.preventDefault();
            this._handleLegendClick(row);
          }
        }}
      >
        ${indicatorColumn ? this._renderIndicator(row, config, hidden) : nothing}
        <span class="legend-name">${row.name}</span>
        ${valuesHidden
          ? columns.map(() => html`<span class="legend-value"></span>`)
          : columns.map(
              (column) => html`<span class="legend-value"
                >${this._cellText(row, column, precision, unit)}</span
              >`
            )}
      </div>
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* Sizing                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Approximate height in pixels the legend adds on top of the wrapped card.
   *
   * Estimated rather than measured because both callers run before layout. The
   * previous estimate counted half a row per legend row, which assumed a
   * two-column layout — but `.legend-group` is `flex-direction: column`, so
   * every row is a line of its own. In a section that under-estimate clipped the
   * legend outright: a numeric `rows` puts Home Assistant's grid into
   * `fit-rows`, which pins the card to `rows * 64 - 8` pixels.
   *
   * Headings and column headers use a smaller font than the rows but are
   * counted as full lines. Over-estimating costs some whitespace;
   * under-estimating costs content.
   */
  private _legendHeight(): number {
    const groups = this._groups().filter((group) => group.rows.length);
    const indicatorColumn = needsIndicatorColumn(groups);
    if (!groups.length) {
      return 0;
    }

    let height = LEGEND_PADDING + (this._config?.raw.card ? 0 : LEGEND_STANDALONE_MARGIN);
    let blocks = 0;

    groups.forEach((group) => {
      const narrow = this._isNarrow(group, indicatorColumn);
      // A stacking group puts every value on a line of its own beneath the name
      // and hides the header row entirely, so a row is `1 + columns` lines tall
      // rather than one — with the default single `sum` column already twice
      // the height, and with all four columns five times.
      const columns = this._columns(group.config).length;
      const stacked = narrow ? columns * (LEGEND_LINE_HEIGHT + LEGEND_STACKED_GAP) : 0;
      // An icon taller than a line makes the row's first line that tall.
      const rowsHeight = group.rows.reduce((sum, row) => {
        const indicator = INDICATOR_HEIGHT[resolveIndicator(row, group.config)] ?? 0;
        return sum + Math.max(LEGEND_LINE_HEIGHT, indicator) + stacked;
      }, 0);

      const heading = group.name ? 1 : 0;
      const headers = group.config.show_headers && !narrow ? 1 : 0;
      const total = group.config.total && group.config.total.mode !== "none" ? 1 : 0;

      height += rowsHeight + (heading + headers + total) * LEGEND_LINE_HEIGHT;
      blocks += group.rows.length + heading + headers + total;
    });

    // Every gap-separated block but the first carries one gap: within a group
    // from `.legend-group`, between groups from `.legend` — both are the same
    // size, so the whole legend simply has `blocks - 1` of them.
    return height + Math.max(0, blocks - 1) * LEGEND_GAP;
  }

  /**
   * Whether a group's rows have to stack their values below the name.
   *
   * Decided per group, not per card: `legend.groups[]` may override `columns`,
   * and a group with one value column needs a completely different amount of
   * room than one with four. A single verdict for the whole card would be wrong
   * for one of them.
   *
   * The width itself is measured, since nothing here can know it ahead of
   * layout. Until the first measurement lands the stacked layout is assumed —
   * it is the taller of the two, and reserving too much costs whitespace while
   * reserving too little clips the legend. Home Assistant re-reads
   * `getGridOptions()` on every render of the section and the section renders on
   * every `hass` update, so an over-reservation corrects itself within a second.
   */
  private _isNarrow(group: LegendGroupResult, indicatorColumn: boolean): boolean {
    const cardWidth = this._measuredWidth();
    if (cardWidth === undefined) {
      return true;
    }

    const { config } = group;
    const indicator = indicatorColumn ? LEGEND_ICON_COLUMN + LEGEND_ITEM_GAP : 0;
    const columns = this._columns(config).length;
    const minNameWidth =
      typeof config.min_name_width === "number" && config.min_name_width >= 0
        ? config.min_name_width
        : DEFAULT_MIN_NAME_WIDTH;

    const required =
      indicator +
      minNameWidth +
      columns * (LEGEND_VALUE_WIDTH + LEGEND_ITEM_GAP);

    // The legend's own horizontal padding is not available to a row.
    return cardWidth - LEGEND_SIDE_PADDING < required;
  }

  /**
   * The card's width, from the observer if it has reported and read directly
   * otherwise.
   *
   * The direct read forces a layout, so its result is kept: `_isNarrow()` runs
   * once per group per render, and where no observer ever reports — it is
   * optional, and a host that is not a block box measures 0 — an unremembered
   * read would force one on every one of them, for as long as the card is on
   * screen. Reading at all is worth it because the alternative is worse: a
   * single missed measurement would leave the card on its conservative
   * assumption, stacked, however much room it actually has.
   */
  private _measuredWidth(): number | undefined {
    if (this._cardWidth === undefined && this.offsetWidth > 0) {
      this._cardWidth = this.offsetWidth;
    }
    return this._cardWidth;
  }

  /**
   * Everything this card renders around the wrapped one: the `title:` heading,
   * the error banner, and the legend itself. All three are outside the wrapped
   * card's own size, so all three have to be added to it.
   */
  private _extraHeight(): number {
    return (
      (this._config?.raw.title ? TITLE_HEIGHT : 0) +
      (this._error ? NOTICE_HEIGHT : 0) +
      this._legendHeight()
    );
  }

  /** Grid rows this card needs on top of whatever the wrapped card needs */
  private _extraRows(): number {
    const height = this._extraHeight();
    // n rows are worth `n * GRID_ROW_HEIGHT - GRID_ROW_GAP` pixels, so the gap
    // has to be added back before dividing — without it the content lands one
    // or two pixels short of a row boundary and is clipped again.
    return height ? Math.ceil((height + GRID_ROW_GAP) / GRID_ROW_HEIGHT) : 0;
  }

  public async getCardSize(): Promise<number> {
    const innerSize = this._wrappedCard ? ((await this._wrappedCard.getCardSize?.()) ?? 6) : 0;
    const height = this._extraHeight();
    return innerSize + (height ? Math.ceil(height / MASONRY_UNIT) : 0);
  }

  /**
   * Grid size of the card.
   *
   * Without a `card:` block the legend *is* the card, and its height is left to
   * the browser: `rows: "auto"` is what Home Assistant defaults to for a card
   * that reports no rows at all (`DEFAULT_GRID_SIZE`), and what its own layout
   * editor offers as "Auto height". A number instead puts the section grid into
   * `fit-rows`, which pins the card to `rows * 64 - 8` pixels — every pixel the
   * estimate falls short then clips the legend rather than merely crowding it.
   * There is nothing to estimate here that the browser does not measure better.
   *
   * With a `card:` block the rows stay a number: the embedded card reports its
   * own (`energy-custom-graph` asks for 4 to 6) because its chart needs a
   * definite height to size to, and `auto` would take that away.
   *
   * `min_rows` stays a number either way. The grid ignores it while rows are
   * `auto`, but the layout editor falls back to it as the starting height when
   * someone switches "Auto height" off — better a measured number than its `1`.
   */
  public getGridOptions(): Record<string, unknown> {
    const innerOptions = this._wrappedCard?.getGridOptions?.() ?? {};
    const extra = this._extraRows();
    const base = this._wrappedCard ? 6 : 0;
    const rows = typeof innerOptions.rows === "number" ? innerOptions.rows : base;
    const minRows = typeof innerOptions.min_rows === "number" ? innerOptions.min_rows : base;
    // The wrapped card may cap itself at fewer rows than the legend now needs;
    // a `max_rows` below `rows` would clip the legend again.
    const maxRows =
      typeof innerOptions.max_rows === "number"
        ? Math.max(innerOptions.max_rows + extra, rows + extra)
        : undefined;

    return {
      ...innerOptions,
      rows: this._wrappedCard ? rows + extra : "auto",
      min_rows: minRows + extra,
      ...(maxRows === undefined ? {} : { max_rows: maxRows }),
    };
  }

  static styles = [
    legendStyles,
    css`
      /* The wrapped card brings its own <ha-card>; neutralize it so it and the
         legend share this card's surface. */
      .wrapped-card {
        display: block;
        --ha-card-background: transparent;
        --ha-card-box-shadow: none;
        --ha-card-border-width: 0;
        --ha-card-border-radius: 0;
        --card-background-color: transparent;
      }
    `,
  ];
}
