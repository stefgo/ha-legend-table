<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### Changed

- `indicator: plain_icon` shows the icon in Home Assistant's icon color
  (`--state-icon-color`, blue by default) instead of the text color, like the
  icons of the built-in entity rows. A theme that sets `--state-icon-color`
  changes it too.
