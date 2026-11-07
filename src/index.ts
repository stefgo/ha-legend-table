declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

import "./statistics-legend-table";
import { CARD_VERSION, STATISTICS_CARD_NAME } from "./version";

console.info(
  "%c STATISTICS-LEGEND-TABLE %c " + CARD_VERSION + " ",
  "background-color: #000000; color: #4CAF50; font-weight: bold;",
  "background-color: #666666; color: #FFFFFF; font-weight: bold;",
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: STATISTICS_CARD_NAME,
  name: "Statistics Table and Legend",
  description:
    "Standalone legend with color, name and statistic values per row — optionally wrapped around any other card and linked to it.",
  documentationURL: "https://github.com/stefgo/ha-statistics-legend-table",
});
