# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

An entry is put together by the release workflow: the text written by hand in
`.release/next.md`, followed by the list of commits. Installation instructions
are added to the release page and do not belong in an entry. The entries up to
0.5.3 were written by hand as a whole.

## [0.6.0](https://github.com/stefgo/ha-statistics-legend-table/compare/v0.5.5...v0.6.0) (2026-11-07)

### Open the entity dialog on click

The new link mode `more-info` makes a click on a row open Home Assistant's own entity
dialog with its history graph, instead of hiding the row:

```yaml
link:
  mode: more-info
```

The dialog shows the row's statistic, or the first entry of `entities[].link` if set. Rows
are never greyed out in this mode, so `hidden_by_default` has no effect, and `more-info`
cannot be combined with another link mode. Existing configurations are unchanged.

### Features

* add link mode more-info to open the entity dialog ([6f9123f](https://github.com/stefgo/ha-statistics-legend-table/commit/6f9123f29fb944502d17ab4828498620f7e367ee))

## [0.5.5](https://github.com/stefgo/ha-statistics-legend-table/compare/v0.5.4...v0.5.5) (2026-11-07)

### Fixes

- A legend without an embedded `card:` now has the same spacing above its first row as other cards (16 px instead of 8 px).

### Bug Fixes

* use 16px top margin for legend without embedded card ([ac31e20](https://github.com/stefgo/ha-statistics-legend-table/commit/ac31e20bad1f0b4ba366e5f5e6239f4880192a8d))

## [0.5.4](https://github.com/stefgo/ha-statistics-legend-table/compare/v0.5.3...v0.5.4) (2026-10-10)

### Fixed

- The first click on a legend row after loading the page greyed out the row but left its
  series in the chart; only a second click hid it. This happened with a `chart` link
  whenever the embedded card had rebuilt its chart after the legend first found it — while
  loading its data, for example. The legend now notices the replaced chart, and a click
  always acts on the one that is on screen.

### Releases

Releases are now produced by the release workflow all stefgo projects share. A version can
be tried as a beta before it is released, and every release is described here by hand, above
the list of commits.

### Bug Fixes

* **link:** Toggle the chart that is on screen ([e27de3d](https://github.com/stefgo/ha-statistics-legend-table/commit/e27de3da30d41c85b15bc79463ed3deae317928d))

## [0.5.3] — 2026-08-29

A maintenance release. The card renders exactly as in 0.5.2 — nothing under
`src/` changed. What changed is the ground it stands on: the dependencies moved
to their current majors, and the repository gained the checks and the release
machinery the other ha-custom projects already have.

### Added

- **Tests.** A vitest scaffold (`npm test`) with the first suite over
  `config/normalize.ts` — the entry point of every dashboard, which Lovelace
  calls from `setConfig()` on every keystroke in the editor. It is pure and needs
  no DOM, which is what makes it the place the suite starts.
- **ESLint** over the TypeScript sources (`npm run lint`, `npm run lint:fix`).
  Syntactic only — types stay `npm run typecheck`'s job and no formatting rules
  are enforced, so it adds a check without rewriting working code.
- **`validate.yml` runs on every push and pull request**, not only on a tag: the
  HACS check, lint, typecheck, tests and the build. The bundle is not committed,
  so a broken rollup config used to surface no earlier than the release itself.
  A weekly run catches HACS changing its rules with nothing committed here.
- **dependabot** for GitHub actions and npm, with the rollup packages grouped
  into one pull request.
- **A weekly TypeScript 7 probe.** `@rollup/plugin-typescript` cannot build with
  the native port (it reads `ts.ModuleKind` at module scope), so dependabot holds
  typescript at 7.x. The probe stays silent while that is still true and opens an
  issue on the day the build goes green.

### Changed

- **typescript 5 → 6, custom-card-helpers 1 → 2 and eslint 9 → 10**, plus rollup
  to its current version. No source change was needed for any of them; the card's
  own API and its YAML are untouched. ESLint 10 stops pulling its own config
  package in transitively, so `@eslint/js` is now declared as a devDependency of
  its own. The bundle is rebuilt from these, so this release is worth installing
  even though nothing visible moved.
- **The release notes come from `.github/scripts/release_notes.py`**, the same
  script in all four ha-custom repositories. Same rule as before: a tag whose
  CHANGELOG section is missing stops the release instead of publishing one that
  says nothing. The release now also checks the tag against `package.json` and
  runs the tests before it builds.
- **`builddeploy.sh` and `.env.example` use the shared `HA_*` variable names**
  (`HA_HOST` / `HA_SSH_PORT` / `HA_CONFIG` / `HA_TARGET`) instead of the
  card-specific ones. **An existing local `.env` needs its variable names updated
  once**; the build flag `STATSTABLE_MINIFY` keeps its name.
- **`hacs.json` names the minimum Home Assistant version** (2025.2.0), so HACS
  can refuse the install instead of the card failing on the dashboard.
- `CLAUDE.md` follows the structure every ha-custom project uses, and documents
  the test setup and the release procedure.
- The CI images moved to Node 22 and the pinned actions to their current majors.

## [0.5.2] — 2026-08-27

### Fixed

- **The `sum` column is correct for level statistics again** (`stat_type: mean`, `min`, `max`,
  `state`). It always added the bucket values up, which only makes sense for the additive types
  (`change`, `sum`); for a level the result grew with the number of buckets. `show_values:
  selection` showed a multiple of the real value that way, because a selected period is fetched
  with a finer bucket size than the configured timespan. The column now shows the average,
  smallest, largest and last bucket respectively.

### Changed

- **`entities[].no_values` becomes `entities[].show_values`** — a breaking config change. The flag
  is now a mode: `always` (default, the normal row), `never` (what `no_values: true` did) and the
  new `selection`. A `selection` row keeps its value area empty over the configured timespan and
  fills it while a period is selected in the embedded graph (`timespan.follow_selection`) — for
  rows whose total over the whole range says nothing but whose value for a single bucket does: a
  price, a state of charge, a reference line. Replace `no_values: true` with `show_values: never`.
  Everything but `always` stays out of `total: {mode: sum}`, in a selection as well, so the total
  sums the same rows either way.
- **The README is restructured.** Sections are ordered by relevance (`entities`, `timespan`,
  `legend`, `aggregation`, then the optional `card`/`link` blocks), the option tables within them
  put the everyday options first, longer prose moved into named subsections, and every
  cross-reference is now an anchor link naming the chapter it points to. A table of contents and a
  table choosing between the three `link` modes were added.

## [0.5.1] — 2026-08-24

### Fixed

- **The card fills the height it is given again.** `ha-card` had `height: 100%`, but the host
  element itself had no height, so the percentage resolved against an auto height and the card
  stayed exactly as tall as its content. In a layout that stretches its cells — a
  `bootstrap-grid-card` column, Home Assistant's own grid — a legend next to a taller card was
  drawn short instead of matching it. The host now carries the height, `ha-card` lays its parts
  out as a flex column and the legend takes the leftover room, so the rows stay at the top.
  Where no ancestor has a definite height (masonry, a section with `rows: auto`), the percentage
  still resolves to auto and nothing changes.

## [0.5.0] — 2026-08-23

The card is renamed in this release, and both the card type and the event protocol change with
it. See **Breaking changes** below before updating.

### Breaking changes

- **Renamed to `statistics-legend-table`.** Dashboards need `type: custom:statistics-legend-table`
  instead of `custom:energy-custom-legend-card`, and the resource URL becomes
  `/hacsfiles/ha-statistics-legend-table/statistics-legend-table.js`. The old name described a
  wrapper around the energy cards, which this card has not been since 0.1.0. The repository moved
  to `stefgo/ha-statistics-legend-table` along with it.
- **The event protocol is renamed** to `statistics-legend-table:toggle` and
  `statistics-legend-table:state`. Third-party listeners and user JavaScript built on
  `energy-custom-legend:*` must be updated.
- **`link.target` is removed.** It took a CSS selector resolved against the whole document, which
  made the search for the linked chart both broader and far more frequent than it needed to be.
  The chart link now addresses the `card:` block. A `target:` left in an existing configuration is
  ignored rather than rejected, so nothing stops rendering.
- The deploy script's environment prefix changed from `ENERGYLEGEND_` to `STATSTABLE_`; a local
  `.env` needs renaming (see `.env.example`).

### Added

- **Follow a period selected in an embedded graph** (`timespan.follow_selection`, on by default).
  Clicking a bucket in a `custom-graph-card` placed in the `card:` block makes the legend show all
  of its values for that period — every column, calculated rows and both total modes. The values
  are refetched rather than derived, so a selection finer than `aggregation.period` is answered
  correctly. The listener is filtered to the wrapped card, so a second graph on the same view
  never moves this legend.
- **`legend.min_name_width`** (default 120) decides how short a name may get before a row stacks
  its values below it instead of truncating. `0` stacks only once the values themselves no longer
  fit.
- **Card version in the console**, reported as `<semver>` for a release and `<semver>+build.<n>`
  for a bundle built by `builddeploy.sh` — a reloaded dashboard still printing the old number is
  serving a cached bundle.
- **`builddeploy.sh`** builds the bundle and copies it to a Home Assistant instance configured
  through `.env` (template in `.env.example`).
- `aria-pressed` on legend rows, so a screen reader can tell a hidden row from a visible one.
  Previously the state was encoded in opacity alone.

### Changed

- `getGridOptions()` reports `rows: "auto"` for a legend without a `card:` block, letting the
  browser measure what a height estimate could only model. With a `card:` block the rows stay a
  number, because the embedded card needs a definite height to size to.
- Rows decide whether to stack their values from the room the row actually needs — the swatch, the
  gaps, the value columns and `min_name_width` — computed per group, since `legend.groups[]` may
  override `columns`.
- README and card metadata are in English throughout.

### Fixed

- **Statistic names follow Home Assistant.** The entity's name now takes precedence over the
  recorder metadata, matching HA's own `getStatisticLabel()`. An entity renamed in HA kept its old
  name in the recorder metadata and therefore in the legend.
- **Units appeared again.** The metadata reader looked for `display_unit_of_measurement` and
  `unit_of_measurement`, neither of which `recorder/get_statistics_metadata` returns — Home
  Assistant sends `statistics_unit_of_measurement`. A unit only ever showed where one had been
  written into the YAML by hand.
- **Linked chart rows could never grey out.** With a compare series present, the two toggle calls
  undid each other; series ids are now mapped onto their controlling legend id and deduplicated.
  The mirrored hidden set is also re-read wholesale rather than patched incrementally, since the
  chart changes it without firing an event.
- **`total: {mode: ratio}` inside `legend.groups[]`** never had its operands fetched and rendered
  a constant 0 %, despite being documented.
- **The legend was clipped** in the sections layout: the height estimate assumed a two-column
  layout, ignored the `title:` heading and the error banner, counted one gap too many per group,
  missed that a stacking row is `1 + columns` lines tall, and rounded every line constant down.
- **The narrow layout fired on the wrong cards.** It sat behind `@media (max-width: 400px)`, which
  measures the viewport — on a phone it stacked every card however wide, while a narrow card in a
  wide sections layout never triggered it.
- **`:host { display: block }`.** A custom element is `display: inline` by default and Lovelace
  does not set it from outside; a non-replaced inline element reports a content box of 0×0, so the
  `ResizeObserver` measurement never landed and the card stayed pinned to its stacked fallback.
- **`mode: energy` without an energy collection** showed today once and then froze — no refresh,
  no retry, and the wrong day past midnight. It now runs the same 60 s cycle as `mode: relative`
  and hands back over to the date picker if a collection appears.
- Recorder errors read `[object Object]` in the error banner, because `hass.callWS()` rejects with
  a plain `{code, message}` rather than an `Error`.
- Two quick `setConfig()` calls — one per keystroke in the Lovelace editor — could resolve out of
  order and leave the older config's `card:` element standing.
- A rejection from `loadCardHelpers()` escaped as an unhandled rejection and the `card:` block
  vanished with no error anywhere but the console.
- `getStubConfig()` returned `entities: []`, which the config validation rejects by design, so
  adding the card from the picker showed an error where a preview belongs. It now picks an entity
  with a `state_class`, since only those have long-term statistics.
- `entities[].color` went unchecked into a `style` attribute; it is written through `styleMap` now
  and falls back to the palette for anything the browser would not recognise as a color.

### Performance

- **Renders are skipped when a `hass` update cannot change anything.** Home Assistant replaces
  `hass` on every state change in the house, and the legend's values come from the recorder on a
  timer. The card now re-renders only when the theme mode, the locale, or the state of an entity
  a link targets actually differ.
- **The shadow DOM is no longer walked on every update.** The chart adapter listens for the
  chart's own bubbling, composed events and takes its element reference from `composedPath()[0]`;
  the recursive search runs only after a render, when the DOM can actually have changed.
- **Statistics metadata is cached.** It answers what a statistic is called and which unit it is
  stored in, neither of which changes while a dashboard is open, yet it was refetched with every
  refresh — once a minute for `mode: relative`, for the lifetime of the page. The cache is keyed
  to the id set and shares an in-flight call.

## [0.1.0] — 2026-08-01

First release: a standalone legend card that depends on no other card.

### Added

- **Own data.** The card queries the recorder itself (`src/data/`), subscribes to the energy date
  picker, and resolves its own timespan and aggregation — replacing the previous version's reads
  of another card's TypeScript-`private` fields.
- **Link adapters** (`src/link/`) behind one interface, the only card-aware code in the project:
  `chart` (targets `ha-chart-base`, so it covers the built-in energy cards too), `entity` (a
  service call, the universal escape hatch) and `event` (a documented `CustomEvent` protocol on
  `window`).
- **Optional `card:` block**, created through `loadCardHelpers().createCardElement()`, so any
  Lovelace card can share the legend's `ha-card`. Its config is passed through untouched.
- Legend rendering with grouping, ordering, and a total row in `sum` or `ratio` mode.
- Calculated rows: `entities[].calculation` with ordered terms, evaluated per bucket.
- Theme-aware colors — a swatch color may be given per light/dark mode.
- Several link targets per legend row.
- A release workflow that builds on a `v*` tag and attaches the bundle to the GitHub release, so
  HACS can install the card without `dist/` being committed.

[0.5.3]: https://github.com/stefgo/ha-statistics-legend-table/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/stefgo/ha-statistics-legend-table/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/stefgo/ha-statistics-legend-table/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/stefgo/ha-statistics-legend-table/compare/v0.1.0...v0.5.0
[0.1.0]: https://github.com/stefgo/ha-statistics-legend-table/releases/tag/v0.1.0
