/**
 * Cosine gradient palettes: colour(t) = a + b * cos(2*PI * (c*t + d)).
 * Cheap, perfectly cyclic, and smooth at any zoom - ideal for animating a
 * palette offset without banding.
 */

export const PALETTES = [
  {
    id: 'aurora',
    name: 'Aurora',
    a: [0.48, 0.5, 0.52],
    b: [0.45, 0.48, 0.5],
    c: [1.0, 1.0, 1.0],
    d: [0.3, 0.18, 0.08],
    interior: [0.05, 0.11, 0.16],
  },
  {
    id: 'ember',
    name: 'Ember',
    a: [0.52, 0.34, 0.24],
    b: [0.48, 0.38, 0.28],
    c: [1.0, 1.0, 0.85],
    d: [0.0, 0.1, 0.22],
    interior: [0.14, 0.05, 0.03],
  },
  {
    id: 'ultraviolet',
    name: 'Ultraviolet',
    a: [0.5, 0.45, 0.55],
    b: [0.5, 0.42, 0.5],
    c: [2.0, 1.0, 1.0],
    d: [0.5, 0.2, 0.25],
    interior: [0.09, 0.04, 0.16],
  },
  {
    id: 'spectrum',
    name: 'Spectrum',
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.3333, 0.6667],
    interior: [0.04, 0.04, 0.07],
  },
  {
    id: 'abyss',
    name: 'Abyss',
    a: [0.16, 0.28, 0.42],
    b: [0.22, 0.34, 0.44],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.12, 0.28],
    interior: [0.02, 0.05, 0.1],
  },
  {
    id: 'goldleaf',
    name: 'Gold Leaf',
    a: [0.56, 0.46, 0.3],
    b: [0.42, 0.38, 0.26],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.06, 0.12],
    interior: [0.1, 0.08, 0.04],
  },
  {
    id: 'magma',
    name: 'Magma',
    a: [0.5, 0.32, 0.28],
    b: [0.5, 0.46, 0.38],
    c: [1.0, 0.9, 0.8],
    d: [0.0, 0.14, 0.24],
    interior: [0.12, 0.03, 0.02],
  },
  {
    id: 'frost',
    name: 'Frost',
    a: [0.62, 0.7, 0.78],
    b: [0.34, 0.3, 0.28],
    c: [1.0, 1.0, 1.0],
    d: [0.6, 0.68, 0.76],
    interior: [0.06, 0.09, 0.13],
  },
  {
    id: 'neon',
    name: 'Neon',
    a: [0.32, 0.28, 0.42],
    b: [0.58, 0.5, 0.6],
    c: [1.1, 1.0, 0.9],
    d: [0.12, 0.35, 0.6],
    interior: [0.05, 0.03, 0.09],
  },
  {
    id: 'ash',
    name: 'Ash',
    a: [0.48, 0.48, 0.5],
    b: [0.42, 0.42, 0.44],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.02, 0.05],
    interior: [0.05, 0.05, 0.06],
  },
];

export const paletteById = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];

/** CSS gradient preview of a palette, used for the swatch strip in the panel. */
export function paletteCss(palette, stops = 24) {
  const parts = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    const rgb = [0, 1, 2].map((k) => {
      const v = palette.a[k] + palette.b[k] * Math.cos(2 * Math.PI * (palette.c[k] * t + palette.d[k]));
      return Math.round(Math.min(1, Math.max(0, v)) * 255);
    });
    parts.push(`rgb(${rgb.join(',')}) ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
