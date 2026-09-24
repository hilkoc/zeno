/**
 * Zeno — application shell.
 *
 * Pipeline per formula change:
 *   text -> AST -> (symbolic derivative) -> GLSL -> program
 * Pipeline per frame:
 *   camera -> double-single uniforms -> one jittered sample -> post -> screen
 */

import { FractalEngine } from './gl/engine.js';
import { Camera } from './camera.js';
import { createUI } from './ui.js';
import { PRESETS, presetById, COLOR_DEFAULTS } from './presets.js';
import { paletteById, PALETTES } from './palettes.js';
import { parseFormula, degreeInZ, FormulaError } from './formula/parse.js';
import { canEmitDouble, splitDouble } from './formula/codegen.js';

const canvas = document.getElementById('view');
const seedCanvas = document.getElementById('seed-canvas');

// ── state ─────────────────────────────────────────────────────────
const state = {
  presetId: 'mandelbrot',
  formula: 'z**2 + c',
  seedMode: 'parameter',
  z0: [0, 0],
  c: [-0.7269, 0.1889],
  bailout: 512,
  maxIter: 400,
  autoIter: true,
  paletteId: 'aurora',
  colorMode: 0,
  density: 1,
  shift: 0,
  cycle: 0,
  stripeFreq: 6,
  trapKind: 0,
  trapRadius: 1,
  shading: 0.55,
  lightAngle: 135,
  edge: 0.35,
  interior: 1,
  glow: 0.25,
  bloom: 0.45,
  exposure: 1,
  vignette: 0.35,
  quality: '1',
  samples: 64,
  precisionMode: 'auto',
  zoomSpeed: 0,
};

const camera = new Camera(presetById('mandelbrot').view);

let engine;
try {
  engine = new FractalEngine(canvas, { dpr: 1 });
} catch {
  document.body.innerHTML = '<p class="noscript">WebGL 2 is unavailable in this browser.</p>';
  throw new Error('no webgl2');
}

const compiled = {
  ast: null,
  degree: 2,
  dsCapable: false,
  hasDerivative: false,
  precision: 'single',
  converge: false,
};

let needsReset = true;
let lastCameraVersion = -1;
let lastSpeed = 0.35;

const markDirty = () => { needsReset = true; };

// ── formula compilation ───────────────────────────────────────────
function compile({ silent = false } = {}) {
  let ast;
  try {
    ast = parseFormula(state.formula);
  } catch (err) {
    if (err instanceof FormulaError) {
      ui.setFormulaStatus(`${err.message}${err.position >= 0 ? ` (at ${err.position + 1})` : ''}`, 'error');
      return false;
    }
    throw err;
  }

  const dsCapable = canEmitDouble(ast);
  const wanted = choosePrecision(dsCapable);
  const result = engine.setFormula(ast, wanted);
  if (!result.ok) {
    ui.setFormulaStatus(result.error, 'error');
    return false;
  }

  compiled.ast = ast;
  compiled.dsCapable = dsCapable;
  compiled.precision = wanted;
  compiled.hasDerivative = result.hasDerivative;

  const preset = presetById(state.presetId);
  const degree = preset.degree ?? degreeInZ(ast);
  compiled.degree = Number.isFinite(degree) && degree > 1 ? degree : 2;
  compiled.converge = Boolean(preset.converge);

  updateScaleFloor();

  if (!silent) {
    const bits = [];
    bits.push(compiled.hasDerivative ? 'holomorphic · distance estimation on' : 'non-holomorphic · iteration colouring');
    bits.push(dsCapable ? 'deep zoom ready' : 'single precision only');
    ui.setFormulaStatus(bits.join(' · '), 'ok');
  }
  markDirty();
  return true;
}

/**
 * Absolute spacing between representable numbers near |z| ~ 1, measured by
 * rendering the same deep view at shrinking scales until it speckles:
 * single precision holds to a pixel span of ~1e-7, the double-single pair to
 * ~4e-15 (clean at scale 1e-12 / 480px, visibly noisy one decade further).
 */
const RESOLUTION = { single: 6e-8, double: 1e-15 };

/** Width of one rendered pixel in the complex plane. */
function pixelSpan(scale = camera.scale) {
  return (2 * scale) / Math.max(1, engine.height || window.innerHeight);
}

/**
 * Scale below which a precision mode produces visible square blocks: pixels
 * start landing on the same representable number as their neighbours.
 */
function blockyBelow(mode, headroom) {
  return (RESOLUTION[mode] * headroom * Math.max(1, engine.height || window.innerHeight)) / 2;
}

function choosePrecision(dsCapable) {
  if (!dsCapable) return 'single';
  if (state.precisionMode === 'single') return 'single';
  if (state.precisionMode === 'double') return 'double';
  // Switch while single precision still has a comfortable margin -- by the
  // time a pixel is only a few float32 steps wide the image is already
  // visibly quantised. Hysteresis keeps a slow zoom from thrashing the
  // shader compiler at the boundary.
  const span = pixelSpan();
  return compiled.precision === 'double'
    ? span > RESOLUTION.single * 24 ? 'single' : 'double'
    : span < RESOLUTION.single * 8 ? 'double' : 'single';
}

/**
 * Hard stop on zooming in. Set a quarter of a float32 step per pixel: past
 * that there is nothing left to resolve, only blocks.
 */
function updateScaleFloor() {
  const deepOk = compiled.dsCapable && state.precisionMode !== 'single';
  camera.minScale = deepOk ? blockyBelow('double', 2) : blockyBelow('single', 0.5);
  if (camera.scale < camera.minScale) {
    camera.set({ x: camera.x, y: camera.y, scale: camera.minScale });
  }
}

/** True once pixels are within a few representable steps of each other. */
function nearPrecisionFloor() {
  return pixelSpan() < RESOLUTION[compiled.precision] * 4;
}

function maybeSwitchPrecision() {
  if (!compiled.ast) return;
  const wanted = choosePrecision(compiled.dsCapable);
  if (wanted === compiled.precision) return;
  const result = engine.setFormula(compiled.ast, wanted);
  if (result.ok) {
    compiled.precision = wanted;
    compiled.hasDerivative = result.hasDerivative;
    markDirty();
  }
}

// ── uniform sync ──────────────────────────────────────────────────
const packComplex = (re, im) => {
  const [a, b] = splitDouble(re);
  const [c, d] = splitDouble(im);
  return [a, b, c, d];
};

function effectiveIterations() {
  if (!state.autoIter) return Math.round(state.maxIter);
  const mag = Math.max(1, 1.35 / camera.scale);
  const depth = Math.log10(mag);
  return Math.min(8000, Math.round(state.maxIter * (1 + 0.28 * depth) + 90 * depth));
}

function syncUniforms() {
  const u = engine.uniforms;
  const palette = paletteById(state.paletteId);
  const angle = (state.lightAngle * Math.PI) / 180;

  u.uCenter.value = packComplex(camera.x, camera.y);
  u.uScale.value = splitDouble(camera.scale);
  u.uParamC.value = packComplex(state.c[0], state.c[1]);
  u.uParamZ0.value = packComplex(state.z0[0], state.z0[1]);
  u.uSeedMode.value = state.seedMode === 'parameter' ? 0 : 1;
  u.uMaxIter.value = effectiveIterations();
  u.uBailout2.value = state.bailout * state.bailout;
  u.uDegree.value = compiled.degree;
  u.uConverge.value = compiled.converge ? 1 : 0;

  u.uColorMode.value = state.colorMode;
  u.uDensity.value = state.density;
  u.uShift.value = state.shift;
  u.uPalA.value = palette.a;
  u.uPalB.value = palette.b;
  u.uPalC.value = palette.c;
  u.uPalD.value = palette.d;
  u.uStripeFreq.value = state.stripeFreq;
  u.uTrapKind.value = state.trapKind;
  u.uTrapRadius.value = state.trapRadius;
  u.uShading.value = state.shading;
  u.uLightDir.value = [Math.cos(angle), Math.sin(angle)];
  u.uInterior.value = state.interior;
  u.uInteriorTint.value = palette.interior;
  u.uEdgeShade.value = state.edge;
  u.uGlow.value = state.glow;

  const p = engine.postUniforms.present;
  p.uBloomStrength.value = state.bloom;
  p.uExposure.value = state.exposure;
  p.uVignette.value = state.vignette;
}

// ── seed pad (mini Mandelbrot for picking Julia constants) ────────
const PAD_VIEW = { x: -0.6, y: 0, scale: 1.28 };
let padEngine = null;

function initSeedPad() {
  try {
    padEngine = new FractalEngine(seedCanvas, { dpr: 1 });
  } catch {
    return;
  }
  const ast = parseFormula('z**2 + c');
  padEngine.setFormula(ast, 'single');
  padEngine.resize(176, 132, 2);
  renderSeedPad();
}

function renderSeedPad() {
  if (!padEngine) return;
  const palette = paletteById(state.paletteId);
  const u = padEngine.uniforms;
  u.uCenter.value = packComplex(PAD_VIEW.x, PAD_VIEW.y);
  u.uScale.value = splitDouble(PAD_VIEW.scale);
  u.uSeedMode.value = 0;
  u.uMaxIter.value = 220;
  u.uBailout2.value = 1e6;
  u.uDegree.value = 2;
  u.uDensity.value = 1.2;
  u.uPalA.value = palette.a;
  u.uPalB.value = palette.b;
  u.uPalC.value = palette.c;
  u.uPalD.value = palette.d;
  u.uInteriorTint.value = palette.interior;
  u.uShading.value = 0.4;
  u.uEdgeShade.value = 0.4;
  u.uGlow.value = 0.1;
  padEngine.postUniforms.present.uBloomStrength.value = 0.2;
  padEngine.postUniforms.present.uVignette.value = 0.2;
  padEngine.resetAccumulation();
  for (let i = 0; i < 8; i++) padEngine.renderSample();
  padEngine.present();
}

function seedDotPosition() {
  const w = 176;
  const h = 132;
  const ndcX = (state.c[0] - PAD_VIEW.x) / PAD_VIEW.scale;
  const ndcY = (state.c[1] - PAD_VIEW.y) / PAD_VIEW.scale;
  return { fx: 0.5 + ndcX * 0.5 * (h / w), fy: 0.5 - 0.5 * ndcY };
}

function updateSeedDot() {
  const { fx, fy } = seedDotPosition();
  ui.setSeedDot(fx, fy);
}

function seedFromPad(fx, fy) {
  const w = 176;
  const h = 132;
  const ndcX = (fx - 0.5) * 2 * (w / h);
  const ndcY = (0.5 - fy) * 2;
  return [PAD_VIEW.x + ndcX * PAD_VIEW.scale, PAD_VIEW.y + ndcY * PAD_VIEW.scale];
}

// ── presets ───────────────────────────────────────────────────────
function loadPreset(id, { keepView = false } = {}) {
  const preset = presetById(id);
  state.presetId = preset.id;
  if (preset.id !== 'custom') state.formula = preset.formula;
  state.seedMode = preset.seedMode;
  state.z0 = [...preset.z0];
  state.c = [...preset.c];
  state.bailout = preset.bailout;
  state.maxIter = preset.maxIter;
  Object.assign(state, COLOR_DEFAULTS, preset.color || {});
  if (!keepView) camera.set(preset.view);
  ui.setSubtitle(preset.note || 'GPU escape-time renderer');
  ui.syncControls();
  compile();
  updateSeedDot();
  markDirty();
}

// ── URL state ─────────────────────────────────────────────────────
const SHARE_KEYS = [
  'presetId', 'formula', 'seedMode', 'c', 'bailout', 'maxIter', 'autoIter', 'paletteId',
  'colorMode', 'density', 'shift', 'stripeFreq', 'trapKind', 'trapRadius', 'shading',
  'lightAngle', 'edge', 'interior', 'glow', 'bloom', 'exposure', 'vignette',
];

function encodeState() {
  const payload = { v: 1, x: camera.x, y: camera.y, s: camera.scale };
  for (const k of SHARE_KEYS) payload[k] = state[k];
  return btoa(encodeURIComponent(JSON.stringify(payload))).replace(/=+$/, '');
}

function applyHash() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return false;
  try {
    const payload = JSON.parse(decodeURIComponent(atob(hash)));
    for (const k of SHARE_KEYS) if (k in payload) state[k] = payload[k];
    camera.set({ x: payload.x, y: payload.y, scale: payload.s });
    return true;
  } catch {
    return false;
  }
}

// ── UI wiring ─────────────────────────────────────────────────────
const ui = createUI(state, onChange, onAction);

function onChange(key) {
  switch (key) {
    case 'presetId':
      loadPreset(state.presetId);
      return;
    case 'formula':
    case 'seedMode':
      if (state.presetId !== 'custom' && key === 'formula') state.presetId = 'custom';
      compile();
      ui.syncControls();
      return;
    case 'paletteId':
      renderSeedPad();
      break;
    case 'quality':
    case 'samples':
      resize();
      break;
    case 'precisionMode':
      compile();
      return;
    case 'colorMode':
      ui.syncControls();
      break;
    case 'zoomSpeed':
      camera.zoomSpeed = state.zoomSpeed;
      if (state.zoomSpeed !== 0) lastSpeed = state.zoomSpeed;
      ui.setPlaying(state.zoomSpeed !== 0);
      return;
    case 'c':
      updateSeedDot();
      break;
  }
  markDirty();
}

function onAction(action, payload) {
  switch (action) {
    case 'reset':
      camera.set(presetById(state.presetId).view);
      break;
    case 'bookmark': {
      if (payload.preset && payload.preset !== state.presetId) loadPreset(payload.preset, { keepView: true });
      camera.flyTo({ x: payload.x, y: payload.y, scale: payload.scale }, 1.6);
      break;
    }
    case 'setCentre':
      camera.set({ x: payload.x, y: payload.y, scale: camera.scale });
      break;
    case 'seedPick':
      state.c = seedFromPad(payload.fx, payload.fy);
      ui.el['seed-re'].value = state.c[0].toFixed(6);
      ui.el['seed-im'].value = state.c[1].toFixed(6);
      ui.setSeedDot(payload.fx, payload.fy);
      markDirty();
      break;
    case 'randomSeed': {
      // Sample the main cardioid boundary c = e^{iθ}/2 - e^{2iθ}/4, where the
      // most intricate Julia sets live, then wobble slightly off it.
      const angle = Math.random() * Math.PI * 2;
      state.c = [
        Math.cos(angle) / 2 - Math.cos(2 * angle) / 4 + (Math.random() - 0.5) * 0.02,
        Math.sin(angle) / 2 - Math.sin(2 * angle) / 4 + (Math.random() - 0.5) * 0.02,
      ];
      ui.syncControls();
      updateSeedDot();
      markDirty();
      break;
    }
    case 'togglePlay':
      state.zoomSpeed = state.zoomSpeed === 0 ? lastSpeed : 0;
      camera.zoomSpeed = state.zoomSpeed;
      ui.el.zoomspeed.value = String(state.zoomSpeed);
      ui.setPlaying(state.zoomSpeed !== 0);
      break;
    case 'screenshot':
      saveScreenshot();
      break;
    case 'fullscreen':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
      break;
    case 'copyLink': {
      const url = `${location.origin}${location.pathname}#${encodeState()}`;
      history.replaceState(null, '', `#${encodeState()}`);
      navigator.clipboard?.writeText(url).then(
        () => ui.toast('Link copied to clipboard'),
        () => ui.toast('Link is in the address bar')
      );
      break;
    }
  }
}

function saveScreenshot() {
  engine.present({ bloom: state.bloom > 0.001 });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zeno-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ui.toast('PNG saved');
  }, 'image/png');
}

// ── canvas input ──────────────────────────────────────────────────
const pointers = new Map();
let dragging = false;
let pinchDistance = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragging = true;
    canvas.classList.add('dragging');
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance > 0 && d > 0) {
      const rect = canvas.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      const ndcX = (mx - rect.width / 2) / (rect.height / 2);
      const ndcY = -(my - rect.height / 2) / (rect.height / 2);
      camera.zoomAt(ndcX, ndcY, pinchDistance / d);
    }
    pinchDistance = d;
    return;
  }
  if (!dragging) return;
  camera.panPixels(dx, dy, canvas.clientHeight);
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    dragging = false;
    canvas.classList.remove('dragging');
  }
  pinchDistance = 0;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const ndcX = (e.clientX - rect.left - rect.width / 2) / (rect.height / 2);
    const ndcY = -(e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    const step = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
    camera.zoomAt(ndcX, ndcY, Math.exp(Math.max(-3, Math.min(3, step * 0.0016))));
  },
  { passive: false }
);

canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  const p = camera.toComplex(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
  camera.flyTo({ x: p.x, y: p.y, scale: camera.scale * 0.45 }, 0.7);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      onAction('togglePlay');
      break;
    case 'r': case 'R': onAction('reset'); break;
    case 's': case 'S': onAction('screenshot'); break;
    case 'f': case 'F': onAction('fullscreen'); break;
    case '?': ui.showHelp(true); break;
    case 'Escape': ui.showHelp(false); break;
    case 'Tab':
      e.preventDefault();
      document.body.classList.toggle('ui-hidden');
      break;
    case 'ArrowLeft': camera.panPixels(40, 0, canvas.clientHeight); break;
    case 'ArrowRight': camera.panPixels(-40, 0, canvas.clientHeight); break;
    case 'ArrowUp': camera.panPixels(0, 40, canvas.clientHeight); break;
    case 'ArrowDown': camera.panPixels(0, -40, canvas.clientHeight); break;
    case 'c': case 'C': {
      const index = PALETTES.findIndex((p) => p.id === state.paletteId);
      state.paletteId = PALETTES[(index + 1) % PALETTES.length].id;
      ui.markPalette();
      renderSeedPad();
      markDirty();
      break;
    }
    case 'm': case 'M':
      state.colorMode = (state.colorMode + 1) % 4;
      ui.syncControls();
      markDirty();
      break;
    default:
      return;
  }
});

// ── sizing ────────────────────────────────────────────────────────
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr =
    state.quality === 'dpr' ? Math.min(window.devicePixelRatio || 1, 2) : Number(state.quality);
  engine.resize(w, h, dpr);
  // The precision floor is measured per pixel, so it moves with the canvas.
  updateScaleFloor();
  markDirty();
}
window.addEventListener('resize', resize);

// ── main loop ─────────────────────────────────────────────────────
let lastTime = performance.now();
let fps = 60;
let hudTimer = 0;

function formatMagnification(m) {
  if (m < 1000) return `${m.toFixed(1)}×`;
  const exponent = Math.floor(Math.log10(m));
  return `${(m / 10 ** exponent).toFixed(2)}e${exponent}×`;
}

function formatCoordinate(v, scale) {
  const digits = Math.min(17, Math.max(4, Math.ceil(-Math.log10(scale)) + 4));
  return v.toFixed(digits);
}

function frame(now) {
  // Clamped generously: the zoom rate should track wall-clock time even on a
  // slow renderer, but a backgrounded tab must not resume with a huge jump.
  const dt = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  fps += (1 / Math.max(dt, 0.001) - fps) * 0.08;

  camera.update(dt);
  maybeSwitchPrecision();

  if (state.cycle !== 0) {
    state.shift = (state.shift + state.cycle * dt) % 1;
    if (state.shift < 0) state.shift += 1;
    markDirty();
  }

  if (camera.version !== lastCameraVersion) {
    lastCameraVersion = camera.version;
    needsReset = true;
  }
  if (needsReset) {
    engine.resetAccumulation();
    needsReset = false;
  }

  syncUniforms();
  if (engine.sample < state.samples) engine.renderSample();
  engine.present({ bloom: state.bloom > 0.001 });

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.12;
    ui.setHud({
      zoom: formatMagnification(camera.magnification),
      centre: `${camera.x.toFixed(4)}, ${camera.y.toFixed(4)}`,
      centreRe: formatCoordinate(camera.x, camera.scale),
      centreIm: formatCoordinate(camera.y, camera.scale),
      iter: String(effectiveIterations()),
      samples: `${Math.min(engine.sample, state.samples)}/${state.samples}`,
      fps: fps.toFixed(0),
      precision: compiled.precision === 'double' ? 'extended' : 'single',
      precisionWarn: nearPrecisionFloor(),
      derivative: compiled.hasDerivative,
      rate: `${camera.rate >= 0 ? '+' : ''}${camera.rate.toFixed(2)} e/s`,
    });
  }

  requestAnimationFrame(frame);
}

// ── boot ──────────────────────────────────────────────────────────
const fromHash = applyHash();
if (!fromHash) {
  loadPreset('mandelbrot');
} else {
  ui.setSubtitle(presetById(state.presetId).note || 'GPU escape-time renderer');
  ui.syncControls();
  compile();
}
resize();
initSeedPad();
updateSeedDot();
ui.setPlaying(false);
requestAnimationFrame(frame);

// Expose a tiny handle for debugging and scripted captures from the console.
window.zeno = {
  state,
  camera,
  engine,
  compiled,
  compile,
  ui,
  loadPreset,
  onChange,
  onAction,
  markDirty,
  PRESETS,
  /** Apply a patch to the state the same way the panel would. */
  apply(patch) {
    for (const [key, value] of Object.entries(patch)) {
      state[key] = value;
      onChange(key);
    }
    ui.syncControls();
    markDirty();
  },
};
