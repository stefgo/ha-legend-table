<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### New name: `ha-legend-table`

The project is now called **Legend Table Cards** (`stefgo/ha-legend-table`), because it is no
longer about statistics alone. The card type `custom:statistics-legend-table` and all of its
options are unchanged — **dashboards keep working without any edit**. What an upgrade needs:

1. In HACS, remove the custom repository `stefgo/ha-statistics-legend-table`, add
   `stefgo/ha-legend-table` (category *Dashboard*) and install “Legend Table Cards”.
2. Under *Settings → Dashboards → Resources*, delete
   `/hacsfiles/ha-statistics-legend-table/statistics-legend-table.js` and make sure
   `/hacsfiles/ha-legend-table/legend-table.js` is registered. With both in place the card would
   be loaded twice.
3. Only if you use `link: {mode: event}` from your own JavaScript: the events are now called
   `legend-table:toggle` and `legend-table:state`. The old names are no longer sent or received.

### New card: live values with `entity-legend-table`

`custom:entity-legend-table` is the same legend over current values instead of statistics: one row
per entity with its state right now, updated the moment the state changes, without the recorder
and without a timespan.

```yaml
type: custom:entity-legend-table
entities:
  - entity: sensor.solar_power
  - entity: climate.living_room
    attribute: current_temperature
    unit: °C
legend:
  total:
    mode: sum
```

- A row shows an entity's state or, with `attribute`, one of its attributes.
- Calculated rows take the same `calculation` block as the statistics card, with `entity` in place
  of `statistic_id`; a row with an unavailable entity shows `—` instead of a wrong value.
- Text states such as `on` or `heat` are shown as Home Assistant shows them, translated, and stay
  out of the sum. `unavailable` and `unknown` are shown as `—`.
- Without `legend.precision` each value uses the display precision set for the entity in Home
  Assistant.
- `legend` (groups, `total: sum` and `total: ratio` over entity IDs), the embedded `card` and every
  `link` mode work as in the statistics card.

Apart from the new name, `statistics-legend-table` behaves exactly as before.
