/**
 * Swatch colors.
 *
 * The legend no longer inherits colors from a chart, so it assigns them itself:
 * an explicit `entities[].color` if given, otherwise the next entry of the
 * palette below. Each swatch is drawn as a solid border plus a translucent fill
 * derived from the same color.
 */

/**
 * Default palette, matching the colors Home Assistant's own energy cards use
 * (`--energy-*-color` in the frontend theme) followed by the generic chart
 * colors, so a legend placed next to an energy card looks at home without
 * anyone configuring colors.
 */
import type { HomeAssistant } from "custom-card-helpers";

import type { ColorConfig } from "./config/types";

const PALETTE = [
  "#488fc2", // grid consumption
  "#ff9800", // solar
  "#4db6ac", // battery
  "#8353d1", // gas
  "#0f9d58", // water
  "#db4437", // grid return
  "#f4b400", // generic 1
  "#3f51b5", // generic 2
  "#e91e63", // generic 3
  "#009688", // generic 4
];

/** Fixed fill opacity applied to every swatch */
export const SWATCH_FILL_ALPHA = 0.5;

/** Fill opacity of the circle behind an icon (`indicator: icon`) */
export const ICON_FILL_ALPHA = 0.2;

/**
 * Whether Home Assistant currently renders in dark mode. `darkMode` is not part
 * of the `custom-card-helpers` types, but is present on the real frontend
 * object at runtime; this reads it defensively so a rename degrades to "always
 * light" instead of throwing.
 */
export function isDarkMode(hass: HomeAssistant | undefined): boolean {
  return Boolean((hass?.themes as { darkMode?: boolean } | undefined)?.darkMode);
}

/** Palette color for the n-th row, wrapping around for long legends */
export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/**
 * Resolves a row's configured color for the current theme mode. A plain string
 * is used as-is; `{light, dark}` picks the side matching `darkMode`, falling
 * back to the other side if that one is unset. No configured color at all
 * falls back to the palette.
 */
export function resolveColor(
  color: ColorConfig | undefined,
  darkMode: boolean,
  index: number
): string {
  const fallback = paletteColor(index);

  if (typeof color === "string") {
    return isColor(color) ? color.trim() : fallback;
  }
  if (color) {
    const picked = darkMode ? (color.dark ?? color.light) : (color.light ?? color.dark);
    if (picked) {
      return isColor(picked) ? picked.trim() : fallback;
    }
  }
  return fallback;
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNC = /^(?:rgba?|hsla?)\([0-9a-z.,%\s/+-]*\)$/i;
const NAMED = /^[a-z]+$/i;
const VARIABLE = /^var\(\s*--[a-z0-9_-]+\s*(?:,\s*[^;(){}]*)?\)$/i;

/**
 * Whether a configured color is plausibly a CSS color.
 *
 * `entities[].color` is written by whoever writes the dashboard, so this is not
 * a security boundary — but the value ends up in a `style` attribute, and an
 * unchecked string there can close the declaration and add its own. The render
 * passes it through `styleMap`, which already refuses anything the CSSOM will
 * not parse; this is the second half of that, and it also turns a typo into the
 * palette color instead of an invisible swatch.
 *
 * Deliberately permissive about *which* colors: named ones, `var(...)` and the
 * modern color functions all pass, because rejecting a valid color the browser
 * understands would be worse than accepting a broken one the browser ignores.
 */
export function isColor(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }
  return (
    HEX.test(trimmed) ||
    COLOR_FUNC.test(trimmed) ||
    NAMED.test(trimmed) ||
    VARIABLE.test(trimmed)
  );
}

const RGB_HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNC = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i;

/**
 * Applies an alpha to a concrete hex/rgb color, used to derive a swatch's fill
 * from its border color. Colors this cannot parse (named colors, `var(...)`,
 * modern color functions) are returned unchanged — the swatch then loses the
 * fill/border distinction but stays a valid, visible color instead of breaking.
 */
export function withAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();

  const hexMatch = RGB_HEX.exec(trimmed);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((char) => char + char)
        .join("");
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const rgbMatch = RGB_FUNC.exec(trimmed);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }

  return trimmed;
}

/**
 * Like `withAlpha()`, but never returns the color unchanged: a color it cannot
 * parse is tinted through `color-mix()` instead. Used for the circle behind an
 * icon, which is drawn in the icon's own color — returned unchanged, the circle
 * would hide the icon completely.
 */
export function tintColor(color: string, alpha: number): string {
  const trimmed = color.trim();
  const tinted = withAlpha(trimmed, alpha);
  return tinted !== trimmed
    ? tinted
    : `color-mix(in srgb, ${trimmed} ${Math.round(alpha * 100)}%, transparent)`;
}
