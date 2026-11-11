<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### Names line up across groups

The names of all rows now start at the same position, whatever indicator each row shows. A
group in which no row shows an indicator (for example `indicator: none`) used to move its names
to the left edge, out of line with the other groups; it now keeps the empty space. Only a legend
in which no row at all shows an indicator puts its names at the left edge.
