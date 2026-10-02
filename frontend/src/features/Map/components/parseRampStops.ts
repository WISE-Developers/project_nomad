/**
 * parseRampStops — parse an uploaded colour-ramp file into ordered hex stops.
 *
 * Split out of RasterLegend.tsx so that file exports only the component
 * (react-refresh/only-export-components); this helper has no JSX and no
 * component identity to preserve across fast-refresh reloads.
 *
 * @module features/Map/components/parseRampStops
 */

/**
 * Parse an uploaded colour-ramp file into ordered hex stops (#271 Unit 9).
 * Accepts a JSON array of hex strings, or whitespace/comma/newline-separated
 * `#rrggbb` tokens. Fail-fast: throws on anything malformed or with < 2 stops
 * — there is no silent fallback to a default ramp.
 */
export function parseRampStops(text: string): string[] {
  const trimmed = text.trim();
  let tokens: string[];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('Ramp JSON must be an array of hex colours');
    tokens = parsed.map(String);
  } else {
    tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  }
  const stops = tokens.map((t) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(t.trim());
    if (!m) throw new Error(`Invalid colour "${t}" (expected #rrggbb)`);
    return `#${m[1].toLowerCase()}`;
  });
  if (stops.length < 2) throw new Error('A ramp needs at least two colour stops');
  return stops;
}
