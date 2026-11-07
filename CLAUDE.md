# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

`ha-legend-table` is one bundle (`dist/legend-table.js`) with two standalone Home Assistant
Lovelace cards rendering a legend in the style of the built-in energy cards: one row per value
with a color swatch, name and value, clickable, plus an optional total/ratio row.

- `custom:statistics-legend-table` — recorder statistics over a timespan (sum/min/max/avg).
- `custom:entity-legend-table` — live entity state (or an attribute, or a calculation).

Both share one element, `LegendTableBase`; they differ only in their data source. The project
was called `ha-statistics-legend-table` up to 0.6; the statistics card kept its type name so
existing dashboards keep working.

**The defining constraint of this project: the cards must not depend on any other card.** They
never wrap a foreign card to reach its data, never forward their config to one, and never read
another element's TypeScript-`private` fields. Keep it that way:

- The cards read their own values — the recorder or `hass.states` (`src/data/`).
- Their config describes the legend and nothing else — no options are forwarded to another card.
- Everything card-specific lives behind an adapter in `src/link/`.

## Commands

```bash
npm run build      # Rollup → dist/legend-table.js
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
npm run lint       # eslint (npm run lint:fix to autofix)
npm test           # vitest run
```

## Architecture

```
src/index.ts                    card registration (window.customCards)
src/legend-table-base.ts        shared LitElement: rendering, card:, links, sizing, click handling
src/statistics-legend-table.ts  statistics card: timespan, fetch, graph selection
src/entity-legend-table.ts      entity card: rows rebuilt from hass.states on every watched change
src/config/types.ts             config and row types
src/config/normalize-common.ts  setConfig validation and defaults shared by both cards
src/config/normalize-statistics.ts  validation of the statistics card
src/config/normalize-entity.ts  validation of the entity card
src/data/timespan.ts            timespan modes -> {start, end} + bucket period
src/data/energy-collection.ts   subscription to the energy date picker
src/data/statistics.ts          recorder websocket calls
src/data/aggregate.ts           buckets -> LegendRow (sum/min/max/avg)
src/data/live.ts                current state -> LegendRow (entity card)
src/colors.ts                   palette + swatch fill derivation
src/legend-stats.ts             grouping, ordering, total row, number formatting
src/legend-styles.ts            legend CSS
src/wrapped-card.ts             creates the optional `card:` element
src/link/                       the three link adapters + controller + graph selection
```

### Three independent axes

The design keeps three concerns strictly apart. When adding a feature, work out which
axis it belongs on:

1. **Data** (`src/data/`) — what the legend shows, and the only axis on which the two cards
   differ. The statistics card is driven only by `entities`, `timespan` and `aggregation` and
   never reads anything outside the recorder API; the entity card reads `hass.states` (and
   `hass.entities` for the display precision) and nothing else. Everything a subclass of
   `LegendTableBase` contributes is a hook of the base: rows, columns, cell value, ratio source.
2. **Layout** (`wrapped-card.ts`) — the optional `card:` block, created through
   `loadCardHelpers().createCardElement()` so *any* Lovelace card works. Its config is passed
   through untouched; this card neither reads nor rewrites it.
3. **Interaction** (`src/link/`) — what a click does outside this card.

### Link adapters (the only card-aware code)

`LinkAdapter` (`src/link/types.ts`) is the entire contract. `LinkController` owns the visibility
state, asks adapters for their opinion (first one that has one wins) and falls back to local
state — which is why a legend with no `link` block still greys out rows and still updates a
`total: {mode: sum}`.

- `chart-adapter.ts` targets **`ha-chart-base`**, a Home Assistant *frontend* element, not any
  particular card. That is deliberate: one adapter covers `energy-custom-graph`, the built-in
  energy cards and everything else built on it. It calls `_handleDatasetToggle(id)` and listens
  for `dataset-hidden`/`dataset-unhidden`. These are frontend internals — every access is
  guarded, so a rename degrades to "the legend only tracks its own state" instead of throwing.
  The events bubble and are composed (`fireEvent` defaults), so the adapter listens on the legend
  element itself and filters by `composedPath()` — the same idiom as `graph-selection.ts`. A chart
  reference is still needed for `_handleDatasetToggle()` and for re-reading `_hiddenDatasets`;
  `findDeep()` pierces shadow roots to get one, but only from `attach()`, which the card calls
  after a render. On an update it decides not to render, the card calls `sync()` instead: the
  adapters re-read what they mirror and nothing walks the DOM, because nothing can have moved.
  The first event also hands over the chart for free through `composedPath()[0]`.
- `entity-adapter.ts` toggles an entity via a service call. This is the universal escape hatch:
  it assumes nothing about the other card, so cards without any toggle API
  (`power-flow-card-plus`) are covered through a `conditional` card. It is also the only adapter
  whose state survives a reload.
- `graph-selection.ts` is not an adapter: it listens on the legend element for the
  `custom-graph-selection` event of `ha-custom-graph` and hands the card the selected period,
  which then replaces the configured timespan for as long as the selection lasts
  (`timespan.follow_selection`). The listener is deliberately scoped: bound to the card itself
  and filtered to the `card:` element's `composedPath()`, so only the embedded graph counts and
  a second graph on the view is ignored. The
  values are refetched for that period, so every column, calculated rows and both total modes
  follow it through the normal data flow.
- `event-adapter.ts` implements the documented `legend-table:toggle` /
  `legend-table:state` protocol on `window` (not a bubbling DOM event — the target card
  is a sibling, not an ancestor). Changing this protocol is a breaking change; it is documented
  in the README for third parties.
- `link: {mode: more-info}` has no adapter: nothing outside the card is toggled. The controller
  only reports it (`opensMoreInfo()`), and the card then fires Home Assistant's `hass-more-info`
  event for the row's `moreInfoEntity` instead of calling `toggle()` — so no row is ever hidden.
  It cannot be combined with another mode (`resolveLinks()` refuses the config).

### Data flow

`setConfig()` (in `LegendTableBase`) → `normalizeConfig()` → `_onConfig()` → `_restartTimespan()` picks the range source
(energy collection subscription / 60 s re-resolve / one-off) → `_setRange()` → `_fetch()` →
`fetchStatistics()` → `buildRows()` → `buildLegendGroups()` → render.

`_fetchToken` guards against an out-of-order response overwriting a newer one. `mode: energy`
needs `hass` to subscribe, which may arrive after `setConfig()`, so `willUpdate()` restarts the
timespan when the first `hass` lands.

Raw statistics are kept in `_statistics` alongside the rows because `legend.total.mode: ratio`
deliberately bypasses rows entirely: it sums the named `statistic_id`s directly, so it also
covers statistics that never became a row, and row visibility has no effect on it. `mode: sum`
in contrast sums the *visible* rows.

The entity card has no fetch: `_watchEntities()` hands every entity its rows and ratio totals
read to the base, whose `shouldUpdate()` lets a `hass` update through only when one of them
changed, and `willUpdate()` then rebuilds the rows from `hass.states` (`buildLiveRows()`). A live
row carries its one value in `sum`/`min`/`max`/`avg`; a text state or a missing value is put in
`LegendRow.text`, which the base renders verbatim and which keeps the row out of a sum total.
Calculated rows reuse `evaluateCalculation()` with one pseudo bucket per term.

`aggregation.period` is not just a performance knob — `min`/`max`/`avg` are computed per bucket,
so the period decides what those columns mean. `auto` mirrors Home Assistant's own rule.

### Config validation

`normalizeConfig()` throws only for configs that genuinely cannot render (no `entities`, an
entity without a statistic, an unknown enum value) — `setConfig()` runs on every keystroke in
the Lovelace editor. Everything else is silently defaulted.

## Testing

Tests are in `test/*.test.ts` (vitest, `npm test`) and cover the pure modules —
the elements themselves have no DOM-based tests, so `npm run typecheck` is what
guards them. `.github/workflows/validate.yml` runs the HACS check, typecheck,
tests and the build on every push and pull request.

Dependency updates come from Renovate, run centrally from
[stefgo/renovate-config](https://github.com/stefgo/renovate-config) (shared
preset and the runner, daily at noon). Renovate opens its pull requests on
Mondays — all minor and patch updates in one, each major update in its own,
because it merges only one pull request per run — and merges them itself,
squashed, on the first run after every check — Validate — is green; a red one
stays open for a human, and so does an update of the Node version the
workflows run on. What is particular to this repository (the rollup
group, the TypeScript 7 hold) lives in `.github/renovate.json5`. The commits
are typed `ci(deps)` and `chore(deps)` and release nothing by themselves.

## Releasing

A release is started by hand, never by pushing a tag: **Actions → Create Release → Run
workflow**, on `main` for a release or on `dev` for a beta (`x.y.z-beta.n`, a prerelease
HACS offers only with beta versions switched on). **Never bump a version or create a
`v*` tag by hand.**

- `dry_run` (on by default) shows the next version and the complete notes in the run
  summary and changes nothing.
- `bump` (`auto` | `patch` | `minor` | `major`): `auto` reads the commit types — `feat`
  raises the minor position, `fix`, `perf` and `revert` the patch position, every other
  type releases nothing — so commit messages follow Conventional Commits, checked against
  `commitlint.config.mjs` by `.githooks/commit-msg`, which `npm install` activates. Any other value
  is the step that is taken, whatever the commits say. `major` is the only way a major
  version is created; a `BREAKING CHANGE:` footer raises the minor position.
- **Every release is described by hand in `.release/next.md`** — what is new and what an
  upgrade needs, written for someone who uses the card. The text goes above the
  generated list of commits, in the GitHub release and in `CHANGELOG.md`; a release
  without it is refused. Write it as part of the change, not at release time. A beta
  keeps the text, the release from `main` empties the file. `.release/footer.md` is the
  installation part appended to every release page.
- **`dev` is merged into `main` with its history — never squashed or rebased** — and
  `main` back into `dev` before the next beta. The workflow checks both.

`.github/workflows/release.yml` calls
[stefgo/release-workflows](https://github.com/stefgo/release-workflows), which carries
semantic-release and its configuration for every stefgo project. It runs `validate.yml`, writes the
version to `package.json`, builds minified *before* the release commit and the tag, and
attaches the bundle to the release — that asset is what HACS installs.

### The release notes are part of the commit

Before every commit, read `.release/next.md` and bring it up to date with what the commit
changes — in the same commit, not at release time.

- A commit that changes what a user sees or has to do — a feature, a fix, a changed
  default, a renamed setting, anything an upgrade needs — is reflected in the text. A
  `feat`, `fix` or `perf` commit that leaves the file untouched needs a reason.
- A commit that changes nothing for a user (`ci`, `test`, `refactor`, `docs`, `chore`,
  most of `build`) leaves the file alone. No line is added for the sake of it.
- Revise the text as a whole instead of appending a line per commit: it describes the
  release, not its history. Merge what belongs together, and remove a sentence a later
  commit made untrue — a feature taken back before the release is not in its notes.
- Write for someone who uses the project, in their terms: what is new, why it matters,
  what an upgrade needs. No file names and no internals; the list of commits below the
  text already names every change.
- The text goes below the HTML comment at the top of the file, with `###` headings. If
  the file holds only the comment, the text starts with this commit.

## Conventions

- Keep new config options optional with sensible defaults; never break existing YAML.
- Prefer graceful fallbacks over hard failures — the card sits on a user dashboard.
- Do not fork or copy another card's source into this repo.
- Anything that knows about a specific foreign card belongs in `src/link/`, nowhere else.

## Not implemented yet

- GUI editor (`getConfigElement`) — YAML only.
- An expression tree for calculated rows. `entities[].calculation` (ordered terms, evaluated
  bucket-wise without operator precedence, same YAML as `energy-custom-graph`) covers the
  common cases instead.
- Compare period (`allow_compare`): values cover the main period only.
