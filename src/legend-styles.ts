/**
 * Legend styling in the look of the built-in energy cards' legend,
 * extended for multiple value columns.
 */

import { css } from "lit";

export const legendStyles = css`
  /* A custom element is display: inline by default, and Lovelace does not set
     this from the outside — hui-card leaves its child alone. It goes unnoticed
     visually, because the ha-card inside is block-level and fills the width
     anyway. It is not unnoticed by a ResizeObserver: a non-replaced inline
     element reports a content box of 0x0, so the card could never measure
     itself and fell back to its stacked layout at every width. */
  :host {
    display: block;
    /* The card has to be able to fill the room it is given, not only the room
       its content needs: layout cards that put cards of different heights side
       by side (bootstrap-grid-card, HA's own grid) stretch their cells and
       expect the card to follow. Without a height on the host the percentage
       below resolves against an auto height, so the ha-card stayed at content
       height and the shorter card rendered short inside a stretched cell.
       Where no ancestor has a definite height — masonry, a section with
       rows: auto — the percentage resolves to auto, i.e. unchanged. */
    height: 100%;
  }
  ha-card {
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0;
  }
  .notice {
    padding: 16px;
    color: var(--secondary-text-color);
  }
  .legend {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0 16px 16px;
    margin-top: 8px;
    /* Takes up whatever a stretched card has left over, so the empty surface
       below the last row belongs to the legend and the rows stay at the top. */
    flex: 1 1 auto;
  }
  /* Without a card: block the legend is the card's only content, so it gets
     the full card spacing above it instead of the smaller gap to a chart. */
  .legend.standalone {
    margin-top: 16px;
  }
  .legend-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .legend-group-title {
    font-size: 12px;
    color: var(--secondary-text-color);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .legend-item {
    display: grid;
    grid-template-columns: var(--ecl-columns, 52px 1fr auto);
    align-items: center;
    gap: 12px;
    font-size: 14px;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.2s;
  }
  .legend-headers {
    display: grid;
    grid-template-columns: var(--ecl-columns, 52px 1fr auto);
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: var(--secondary-text-color);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .legend-item.static {
    cursor: default;
  }
  .legend-item.hidden {
    opacity: 0.5;
  }
  .legend-item.hidden .legend-name,
  .legend-item.hidden .legend-value {
    color: var(--secondary-text-color);
  }
  .legend-icon {
    width: 32px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid;
    display: block;
    transition: background-color 0.2s;
  }
  .legend-name {
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .legend-value {
    color: var(--primary-text-color);
    font-weight: var(--ha-font-weight-normal);
    white-space: nowrap;
    text-align: right;
  }
  .legend-total {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    padding-top: 12px;
    padding-left: 64px;
    border-top: 1px solid var(--divider-color);
  }
  .legend-total .legend-name {
    font-weight: var(--ha-font-weight-medium);
  }
  .legend-total .legend-value {
    font-weight: var(--ha-font-weight-medium);
  }

  /* Not enough room for one line: the values stack below the series name.

     The verdict is made in the card, not here, and arrives as this class. It
     used to be @media (max-width: 400px), which measured the viewport — so it
     fired on every phone however wide the card was, wrapping values that had
     room to spare, and never fired for a narrow card in a wide sections layout,
     which is the one case it was written for. A container query fixed the
     measurement but not the threshold: what a row needs depends on how many
     value columns it has, roughly 285px for a single one against well over 500
     for four, and no single breakpoint serves both.

     A query condition cannot read a custom property, so a computed threshold
     cannot live in CSS. Deciding in the card also keeps the height estimate and
     the stylesheet on one verdict instead of two that can drift apart. */
  .legend-group.narrow .legend-headers {
    display: none;
  }
  .legend-group.narrow .legend-item {
    grid-template-columns: 52px 1fr;
    row-gap: 2px;
  }
  .legend-group.narrow .legend-item .legend-value {
    grid-column: 2;
    text-align: left;
    color: var(--secondary-text-color);
  }
`;
