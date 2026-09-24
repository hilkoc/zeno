/**
 * Built-in fractals. Every one of them is just a formula plus a starting
 * condition -- the same pipeline the "Custom" entry uses.
 *
 * seedMode 'parameter': c = pixel, z starts at z0   (Mandelbrot-like)
 * seedMode 'dynamic'  : z = pixel, c is a constant  (Julia-like)
 */

export const PRESETS = [
  {
    id: 'mandelbrot',
    name: 'Mandelbrot',
    formula: 'z**2 + c',
    seedMode: 'parameter',
    z0: [0, 0],
    c: [0, 0],
    bailout: 512,
    maxIter: 400,
    view: { x: -0.6, y: 0, scale: 1.35 },
    note: 'The parameter plane of z² + c.',
  },
  {
    id: 'julia',
    name: 'Julia set (z² + c)',
    formula: 'z**2 + c',
    seedMode: 'dynamic',
    z0: [0, 0],
    c: [-0.7269, 0.1889],
    bailout: 512,
    maxIter: 400,
    view: { x: 0, y: 0, scale: 1.5 },
    note: 'Drag the seed pad to move c across the Mandelbrot set.',
  },
  {
    id: 'burningship',
    name: 'Burning Ship',
    formula: 'abs(z)**2 + c',
    seedMode: 'parameter',
    z0: [0, 0],
    c: [0, 0],
    bailout: 512,
    maxIter: 400,
    view: { x: -0.4, y: -0.5, scale: 1.3 },
    note: 'abs() folds each component, which breaks holomorphy — no distance shading.',
  },
  {
    id: 'tricorn',
    name: 'Tricorn',
    formula: 'conj(z)**2 + c',
    seedMode: 'parameter',
    z0: [0, 0],
    c: [0, 0],
    bailout: 512,
    maxIter: 300,
    view: { x: -0.25, y: 0, scale: 1.6 },
  },
  {
    id: 'multibrot',
    name: 'Multibrot (z⁵ + c)',
    formula: 'z**5 + c',
    seedMode: 'parameter',
    z0: [0, 0],
    c: [0, 0],
    bailout: 512,
    maxIter: 300,
    view: { x: 0, y: 0, scale: 1.4 },
  },
  {
    id: 'celtic',
    name: 'Celtic',
    formula: 'abs(re(z**2)) + i*im(z**2) + c',
    seedMode: 'parameter',
    z0: [0, 0],
    c: [0, 0],
    bailout: 512,
    maxIter: 400,
    view: { x: -0.4, y: 0, scale: 1.5 },
  },
  {
    id: 'phoenixjulia',
    name: 'Cosine Julia',
    formula: 'c*cos(z)',
    seedMode: 'dynamic',
    z0: [0, 0],
    c: [1.0, 0.4],
    bailout: 64,
    maxIter: 160,
    degree: 2,
    view: { x: 0, y: 0, scale: 4.0 },
    color: { colorMode: 0, density: 2.2 },
  },
  {
    id: 'newton',
    name: 'Newton (z³ − 1)',
    formula: 'z - (z**3 - 1)/(3*z**2)',
    seedMode: 'dynamic',
    z0: [0, 0],
    c: [0, 0],
    bailout: 2048,
    maxIter: 64,
    converge: true,
    view: { x: 0, y: 0, scale: 1.6 },
    color: { colorMode: 0, density: 1.2, interior: 1, glow: 0.15 },
    note: 'Colour marks which root the orbit converges to, and how fast.',
  },
  {
    id: 'collatz',
    name: 'Collatz (3n + 1)',
    formula: '(2 + 7*z - (2 + 5*z)*cos(pi*z))/4',
    seedMode: 'dynamic',
    z0: [0, 0],
    c: [0, 0],
    bailout: 16,
    maxIter: 48,
    degree: 2,
    view: { x: 1.0, y: 0, scale: 2.4 },
    color: { colorMode: 0, density: 5, glow: 0.2 },
    note: 'Holomorphic extension of the 3n+1 map. Integers on the real axis never escape.',
  },
  {
    id: 'custom',
    name: 'Custom formula…',
    formula: 'z**2 + c',
    seedMode: 'parameter',
    z0: [0, 0],
    c: [0, 0],
    bailout: 512,
    maxIter: 400,
    view: { x: -0.6, y: 0, scale: 1.35 },
  },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

/**
 * Colour settings that belong to the fractal rather than to personal taste.
 * Loading a preset resets these, then applies the preset's own overrides;
 * palette, bloom, exposure and vignette are left alone.
 */
export const COLOR_DEFAULTS = {
  colorMode: 0,
  density: 1,
  stripeFreq: 6,
  trapKind: 0,
  trapRadius: 1,
  shading: 0.55,
  edge: 0.35,
  interior: 1,
  glow: 0.25,
};

/** Hand-picked deep zooms. Depths beyond ~1e-5 need extended precision. */
export const BOOKMARKS = [
  { name: 'Home', preset: 'mandelbrot', x: -0.6, y: 0, scale: 1.35 },
  { name: 'Seahorse Valley', preset: 'mandelbrot', x: -0.7436438870371587, y: 0.13182590420531197, scale: 3e-6 },
  { name: 'Elephant Valley', preset: 'mandelbrot', x: 0.2925755, y: -0.0149977, scale: 4e-4 },
  { name: 'Triple Spiral', preset: 'mandelbrot', x: -0.088, y: 0.654, scale: 6e-3 },
  { name: 'Julia Island', preset: 'mandelbrot', x: -1.768778833, y: -0.001738996, scale: 5e-6 },
  { name: 'Deep Spiral', preset: 'mandelbrot', x: -0.77568377, y: 0.13646737, scale: 2e-9 },
  { name: 'Ship Masts', preset: 'burningship', x: -1.7548, y: -0.0286, scale: 0.02 },
];
