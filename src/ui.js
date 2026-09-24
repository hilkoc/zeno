/**
 * DOM wiring. Knows nothing about WebGL: it reads and writes `state`, then
 * reports what changed so the app can decide between a uniform update and a
 * shader recompile.
 */

import { PALETTES, paletteCss } from './palettes.js';
import { PRESETS, BOOKMARKS } from './presets.js';

const $ = (id) => document.getElementById(id);

const EXAMPLE_FORMULAS = [
  'z**2 + c',
  'z**3 + c',
  'abs(z)**2 + c',
  'z**2 + c/z',
  '(z**2 + c)/(z**2 - c)',
  'exp(z) + c',
  'c*sin(z)',
  'z**2 + c*cos(z)',
  'conj(z)**3 + c',
  'z - (z**4 - 1)/(4*z**3)',
];

/** control id -> [state key, parser, formatter for the inline value readout] */
const RANGES = {
  iterations: ['maxIter', Number, (v) => String(Math.round(v))],
  bailout: ['bailout', Number, (v) => String(Math.round(v))],
  density: ['density', Number, (v) => v.toFixed(2)],
  shift: ['shift', Number, (v) => v.toFixed(2)],
  cycle: ['cycle', Number, (v) => v.toFixed(2)],
  stripe: ['stripeFreq', Number, (v) => String(Math.round(v))],
  trapradius: ['trapRadius', Number, (v) => v.toFixed(2)],
  shading: ['shading', Number, (v) => v.toFixed(2)],
  light: ['lightAngle', Number, (v) => `${Math.round(v)}°`],
  edge: ['edge', Number, (v) => v.toFixed(2)],
  interior: ['interior', Number, (v) => v.toFixed(2)],
  glow: ['glow', Number, (v) => v.toFixed(2)],
  bloom: ['bloom', Number, (v) => v.toFixed(2)],
  exposure: ['exposure', Number, (v) => v.toFixed(2)],
  vignette: ['vignette', Number, (v) => v.toFixed(2)],
};

const SELECTS = {
  preset: ['presetId', String],
  seedmode: ['seedMode', String],
  colormode: ['colorMode', Number],
  trapkind: ['trapKind', Number],
  quality: ['quality', String],
  samples: ['samples', Number],
  precision: ['precisionMode', String],
};

export function createUI(state, onChange, onAction) {
  const el = {};
  for (const id of [
    'panel', 'collapse', 'reveal', 'preset', 'custom-block', 'formula', 'formula-status',
    'formula-examples', 'seedmode', 'seed-block', 'seed-pad', 'seed-canvas', 'seed-dot',
    'seed-re', 'seed-im', 'seed-random', 'auto-iter', 'swatches', 'stripe-field', 'trap-field',
    'bookmarks', 'center-re', 'center-im', 'reset', 'copy-link', 'zoomspeed', 'playpause',
    'rate', 'shot', 'full', 'help-btn', 'help', 'help-close', 'toast', 'hud-zoom', 'hud-center',
    'hud-iter', 'hud-samples', 'hud-fps', 'hud-precision', 'hud-de', 'subtitle',
  ]) {
    el[id] = $(id);
  }

  // ── static content ────────────────────────────────────────────
  el.preset.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  el.bookmarks.innerHTML =
    '<option value="">Select a location…</option>' +
    BOOKMARKS.map((b, i) => `<option value="${i}">${b.name}</option>`).join('');
  el['formula-examples'].innerHTML = EXAMPLE_FORMULAS.map(
    (f) => `<button class="chip" data-formula="${f.replace(/"/g, '&quot;')}">${f}</button>`
  ).join('');
  el.swatches.innerHTML = PALETTES.map(
    (p) => `<div class="swatch" data-id="${p.id}" style="background:${paletteCss(p)}"><span>${p.name}</span></div>`
  ).join('');

  // ── generic binding ───────────────────────────────────────────
  for (const [id, [key, parse, format]] of Object.entries(RANGES)) {
    const input = $(id);
    const readout = $(`${id}-value`);
    if (!input) continue;
    input.addEventListener('input', () => {
      state[key] = parse(input.value);
      if (readout) readout.textContent = format(state[key]);
      onChange(key);
    });
  }

  for (const [id, [key, parse]] of Object.entries(SELECTS)) {
    const input = $(id);
    input.addEventListener('change', () => {
      state[key] = parse(input.value);
      onChange(key);
    });
  }

  el.formula.addEventListener('input', () => {
    state.formula = el.formula.value;
    onChange('formula');
  });
  el['formula-examples'].addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.formula = chip.dataset.formula;
    el.formula.value = state.formula;
    onChange('formula');
  });
  el['auto-iter'].addEventListener('change', () => {
    state.autoIter = el['auto-iter'].checked;
    onChange('autoIter');
  });
  el.swatches.addEventListener('click', (e) => {
    const swatch = e.target.closest('.swatch');
    if (!swatch) return;
    state.paletteId = swatch.dataset.id;
    markPalette();
    onChange('paletteId');
  });

  const seedFromInputs = () => {
    const re = parseFloat(el['seed-re'].value);
    const im = parseFloat(el['seed-im'].value);
    if (Number.isFinite(re) && Number.isFinite(im)) {
      state.c = [re, im];
      onChange('c');
    }
  };
  el['seed-re'].addEventListener('change', seedFromInputs);
  el['seed-im'].addEventListener('change', seedFromInputs);
  el['seed-random'].addEventListener('click', () => onAction('randomSeed'));

  // Dragging on the seed pad sweeps c across the Mandelbrot set.
  let padDragging = false;
  const padPick = (e) => {
    const rect = el['seed-pad'].getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    onAction('seedPick', { fx: Math.min(1, Math.max(0, fx)), fy: Math.min(1, Math.max(0, fy)) });
  };
  el['seed-pad'].addEventListener('pointerdown', (e) => {
    padDragging = true;
    el['seed-pad'].setPointerCapture(e.pointerId);
    padPick(e);
  });
  el['seed-pad'].addEventListener('pointermove', (e) => padDragging && padPick(e));
  el['seed-pad'].addEventListener('pointerup', () => (padDragging = false));
  el['seed-pad'].addEventListener('pointercancel', () => (padDragging = false));

  el.bookmarks.addEventListener('change', () => {
    if (el.bookmarks.value === '') return;
    onAction('bookmark', BOOKMARKS[Number(el.bookmarks.value)]);
    el.bookmarks.value = '';
  });

  const centreFromInputs = () => {
    const re = parseFloat(el['center-re'].value);
    const im = parseFloat(el['center-im'].value);
    if (Number.isFinite(re) && Number.isFinite(im)) onAction('setCentre', { x: re, y: im });
  };
  el['center-re'].addEventListener('change', centreFromInputs);
  el['center-im'].addEventListener('change', centreFromInputs);

  el.reset.addEventListener('click', () => onAction('reset'));
  el['copy-link'].addEventListener('click', () => onAction('copyLink'));
  el.shot.addEventListener('click', () => onAction('screenshot'));
  el.full.addEventListener('click', () => onAction('fullscreen'));

  // ── zoom transport ────────────────────────────────────────────
  const snap = (v) => (Math.abs(v) < 0.045 ? 0 : v);
  el.zoomspeed.addEventListener('input', () => {
    state.zoomSpeed = snap(Number(el.zoomspeed.value));
    if (state.zoomSpeed === 0) el.zoomspeed.value = '0';
    onChange('zoomSpeed');
  });
  el.zoomspeed.addEventListener('dblclick', () => {
    state.zoomSpeed = 0;
    el.zoomspeed.value = '0';
    onChange('zoomSpeed');
  });
  el.playpause.addEventListener('click', () => onAction('togglePlay'));

  // ── panel chrome ──────────────────────────────────────────────
  document.querySelectorAll('.group-head').forEach((head) => {
    head.addEventListener('click', () => {
      const group = head.parentElement;
      group.dataset.open = group.dataset.open === 'true' ? 'false' : 'true';
    });
  });
  const setCollapsed = (collapsed) => {
    el.panel.classList.toggle('collapsed', collapsed);
    el.reveal.hidden = !collapsed;
    el.collapse.setAttribute('aria-expanded', String(!collapsed));
  };
  el.collapse.addEventListener('click', () => setCollapsed(true));
  el.reveal.addEventListener('click', () => setCollapsed(false));

  const showHelp = (on) => { el.help.hidden = !on; };
  el['help-btn'].addEventListener('click', () => showHelp(true));
  el['help-close'].addEventListener('click', () => showHelp(false));
  el.help.addEventListener('click', (e) => { if (e.target === el.help) showHelp(false); });

  // ── helpers exposed to the app ────────────────────────────────
  function markPalette() {
    el.swatches.querySelectorAll('.swatch').forEach((s) => {
      s.classList.toggle('active', s.dataset.id === state.paletteId);
    });
  }

  let toastTimer = 0;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), 1800);
  }

  function setFormulaStatus(text, kind) {
    el['formula-status'].textContent = text;
    el['formula-status'].className = `status ${kind || ''}`;
  }

  /** Push the whole state object back into the controls. */
  function syncControls() {
    el.preset.value = state.presetId;
    el.formula.value = state.formula;
    el.seedmode.value = state.seedMode;
    el['auto-iter'].checked = state.autoIter;
    el.zoomspeed.value = String(state.zoomSpeed);
    for (const [id, [key, , format]] of Object.entries(RANGES)) {
      const input = $(id);
      const readout = $(`${id}-value`);
      if (!input) continue;
      input.value = String(state[key]);
      if (readout) readout.textContent = format(state[key]);
    }
    for (const [id, [key]] of Object.entries(SELECTS)) {
      $(id).value = String(state[key]);
    }
    el['custom-block'].hidden = state.presetId !== 'custom';
    el['seed-block'].hidden = state.seedMode !== 'dynamic';
    el['stripe-field'].hidden = state.colorMode !== 1;
    el['trap-field'].hidden = state.colorMode !== 2;
    el['seed-re'].value = state.c[0].toFixed(6);
    el['seed-im'].value = state.c[1].toFixed(6);
    markPalette();
  }

  function setSeedDot(fx, fy) {
    el['seed-dot'].style.left = `${fx * 100}%`;
    el['seed-dot'].style.top = `${fy * 100}%`;
  }

  function setPlaying(playing) {
    el.playpause.textContent = playing ? '▮▮' : '▶';
    el.playpause.classList.toggle('active', playing);
  }

  function setHud(h) {
    el['hud-zoom'].textContent = h.zoom;
    el['hud-center'].textContent = h.centre;
    el['hud-iter'].textContent = h.iter;
    el['hud-samples'].textContent = h.samples;
    el['hud-fps'].textContent = h.fps;
    el['hud-precision'].textContent = h.precision;
    el['hud-precision'].className =
      `badge${h.precision === 'extended' ? ' deep' : ''}${h.precisionWarn ? ' warn' : ''}`;
    el['hud-precision'].title = h.precisionWarn
      ? 'Past the precision floor — pixels are quantising'
      : '';
    el['hud-de'].className = `badge${h.derivative ? '' : ' dim'}`;
    el.rate.textContent = h.rate;
    el['center-re'].value = h.centreRe;
    el['center-im'].value = h.centreIm;
  }

  function setSubtitle(text) {
    el.subtitle.textContent = text;
  }

  return {
    el, syncControls, setFormulaStatus, setSeedDot, setHud, setPlaying, toast, setSubtitle,
    markPalette, showHelp, setCollapsed,
  };
}
