declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

import "./statistics-legend-table";
import "./entity-legend-table";
import { CARD_VERSION, ENTITY_CARD_NAME, STATISTICS_CARD_NAME } from "./version";

const DOCUMENTATION_URL = "https://github.com/stefgo/ha-legend-table";

console.info(
  "%c LEGEND-TABLE %c " + CARD_VERSION + " ",
  "background-color: #000000; color: #4CAF50; font-weight: bold;",
  "background-color: #666666; color: #FFFFFF; font-weight: bold;",
);

window.customCards = window.customCards || [];
window.customCards.push(
  {
    type: STATISTICS_CARD_NAME,
    name: "Statistics Legend Table",
    description:
      "Standalone legend with color, name and statistic values per row — optionally wrapped around any other card and linked to it.",
    documentationURL: DOCUMENTATION_URL,
  },
  {
    type: ENTITY_CARD_NAME,
    name: "Entity Legend Table",
    description:
      "The same legend with the current value of each entity per row — live, without the recorder.",
    documentationURL: DOCUMENTATION_URL,
  },
);
