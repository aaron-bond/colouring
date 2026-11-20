// Colour maths for the mixer (TECHNICAL-DESIGN.md 7, "colour"): hex and
// HSV conversions, a friendly name for any mixed colour ("pale blue"),
// and the recent-colours list.

export interface Hsv {
  // 0-360
  h: number;
  // 0-1
  s: number;
  // 0-1
  v: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (c: number) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

const HUES: [number, string][] = [
  [15, 'red'],
  [40, 'orange'],
  [65, 'yellow'],
  [90, 'lime'],
  [160, 'green'],
  [195, 'teal'],
  [250, 'blue'],
  [285, 'violet'],
  [320, 'purple'],
  [345, 'pink'],
  [360, 'red'],
];

// A short everyday name for a mixed colour, shown under the current
// swatch: "pale blue", "deep green", "brown", "grey".
export function colourName(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  const { h } = hexToHsv(hex);
  if (s < 0.12 || max - min < 0.06) {
    if (l > 0.93) return 'white';
    if (l < 0.1) return 'black';
    return l > 0.7 ? 'pale grey' : l < 0.3 ? 'dark grey' : 'grey';
  }
  let hue = HUES.find(([limit]) => h < limit)![1];
  if ((hue === 'orange' || hue === 'red' || hue === 'yellow') && l < 0.42 && h >= 10 && h < 50) hue = 'brown';
  if (l > 0.78) return `pale ${hue}`;
  if (l < 0.28) return `deep ${hue}`;
  if (s < 0.35) return `dusty ${hue}`;
  return hue;
}

// The recent-colours list after using `hex`: newest first, no repeats.
export function withRecent(recents: string[], hex: string, max = 8): string[] {
  const up = hex.toUpperCase();
  return [up, ...recents.filter((c) => c.toUpperCase() !== up)].slice(0, max);
}
