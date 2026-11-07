<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

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
