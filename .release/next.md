<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### Icons in the legend

A row can now show an icon instead of the color box. The new `indicator` option decides what
appears in front of the name:

- `box`: the color box, as before (default)
- `icon`: the icon in the row's color, on a faint circle of the same color
- `plain_icon`: the icon alone, in the normal text color, without any color
- `none`: nothing

Set it once for the whole legend (`legend.indicator`), per group, or per row, and give each row
its `icon`, for example `mdi:solar-power`. The entity card uses the entity's own icon when a row
sets none. A row set to `icon` without an icon keeps its color box.

Existing dashboards look exactly as before; nothing needs to change on upgrade.

### Changed

- `indicator: plain_icon` shows the icon in Home Assistant's icon color
  (`--state-icon-color`, blue by default) instead of the text color, like the
  icons of the built-in entity rows. A theme that sets `--state-icon-color`
  changes it too.
