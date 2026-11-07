// Replaced at build time by rollup (@rollup/plugin-replace) with the version
// from package.json, plus the local build counter (`scripts/build-number.mjs`)
// when a local deploy build asked for one.
// The fallbacks keep `tsc --noEmit` and unbundled use happy.
declare const __CARD_VERSION__: string;
declare const __CARD_SEMVER__: string;
declare const __CARD_BUILD__: number;
declare const __CARD_BUILD_TIME__: string;

/** Element name of the statistics card; its `type` is `custom:` plus this */
export const STATISTICS_CARD_NAME = "statistics-legend-table";

/** The released version — what `package.json` says, without the build counter */
export const CARD_SEMVER =
  typeof __CARD_SEMVER__ === "string" ? __CARD_SEMVER__ : "dev";

/** Rises with every local deploy build, so a cached bundle is recognisable by
 * its number; 0 in a release build, which reports the semver alone */
export const CARD_BUILD = typeof __CARD_BUILD__ === "number" ? __CARD_BUILD__ : 0;

export const CARD_BUILD_TIME =
  typeof __CARD_BUILD_TIME__ === "string" ? __CARD_BUILD_TIME__ : "";

/** What the card reports in the console: `<semver>`, or `<semver>+build.<n>`
 * for a bundle built by `builddeploy.sh` */
export const CARD_VERSION =
  typeof __CARD_VERSION__ === "string" ? __CARD_VERSION__ : "dev";
