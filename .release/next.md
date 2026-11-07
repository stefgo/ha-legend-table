<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

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

`statistics-legend-table` is unchanged.
