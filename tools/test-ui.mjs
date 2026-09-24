/**
 * Interaction checks against the running dev server.
 *   node tools/test-ui.mjs
 */

import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.zeno), null, { timeout: 15000 });
// SwiftShader renders at well under a frame per second at full quality, so run
// the interaction pass cheap. Rate accuracy is covered by tools/test-camera.mjs.
await page.evaluate(() => window.zeno.apply({ quality: '0.5', samples: 1 }));
await page.waitForTimeout(600);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const scale = () => page.evaluate(() => window.zeno.camera.scale);
const setSlider = async (id, value) =>
  page.evaluate(
    ([i, v]) => {
      const el = document.getElementById(i);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [id, value]
  );
const setSelect = async (id, value) =>
  page.evaluate(
    ([i, v]) => {
      const el = document.getElementById(i);
      el.value = String(v);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [id, value]
  );

// ── zoom slider: right of centre zooms in ─────────────────────────
const before = await scale();
await setSlider('zoomspeed', 0.8);
await page.waitForTimeout(2500);
const zoomedIn = await scale();
check('slider right zooms in', zoomedIn < before, `${before.toExponential(3)} -> ${zoomedIn.toExponential(3)}`);

// ── centre pauses ─────────────────────────────────────────────────
await setSlider('zoomspeed', 0);
const paused = await scale();
await page.waitForTimeout(900);
check('slider centre pauses', (await scale()) === paused);

// ── small offsets snap to the dead zone ───────────────────────────
await setSlider('zoomspeed', 0.03);
check('dead zone snaps to zero', (await page.evaluate(() => window.zeno.state.zoomSpeed)) === 0);

// ── left of centre zooms out ──────────────────────────────────────
await setSlider('zoomspeed', -0.8);
await page.waitForTimeout(2500);
const zoomedOut = await scale();
check('slider left zooms out', zoomedOut > paused, `${paused.toExponential(3)} -> ${zoomedOut.toExponential(3)}`);
await setSlider('zoomspeed', 0);

// ── space toggles ─────────────────────────────────────────────────
await page.evaluate(() => document.getElementById('view').focus());
await setSlider('zoomspeed', 0.5);
await page.keyboard.press('Space');
check('space pauses', (await page.evaluate(() => window.zeno.state.zoomSpeed)) === 0);
await page.keyboard.press('Space');
check('space resumes', (await page.evaluate(() => window.zeno.state.zoomSpeed)) === 0.5);
await setSlider('zoomspeed', 0);

// ── collapsing the panel must be reversible ───────────────────────
check('reveal tab hidden while the panel is open', await page.isHidden('#reveal'));
await page.click('#collapse');
// The slide-out is a 0.32s transition, and a busy software renderer can stall
// the compositor, so poll instead of sleeping a fixed amount.
let panelRight = 999;
for (let i = 0; i < 30 && panelRight >= 1; i++) {
  await page.waitForTimeout(150);
  panelRight = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().right);
}
check('collapse moves the panel off screen', panelRight < 1, `right = ${panelRight.toFixed(1)}px`);
check('reveal tab appears when collapsed', await page.isVisible('#reveal'));
await page.click('#reveal');
let panelLeft = -999;
for (let i = 0; i < 30 && panelLeft < 0; i++) {
  await page.waitForTimeout(150);
  panelLeft = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().left);
}
check('reveal tab brings the panel back', panelLeft >= 0, `left = ${panelLeft.toFixed(1)}px`);
check('reveal tab hides again', await page.isHidden('#reveal'));

// ── preset switching reveals the custom formula input ─────────────
check('custom block hidden initially', await page.isHidden('#custom-block'));
await setSelect('preset', 'custom');
check('custom block visible for custom preset', await page.isVisible('#custom-block'));
check('seed pad hidden in parameter plane', await page.isHidden('#seed-block'));

// ── formula entry ─────────────────────────────────────────────────
const typeFormula = async (text) => {
  await page.fill('#formula', '');
  await page.fill('#formula', text);
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    status: document.getElementById('formula-status').textContent,
    cls: document.getElementById('formula-status').className,
    formula: window.zeno.state.formula,
    derivative: window.zeno.compiled.hasDerivative,
    deep: window.zeno.compiled.dsCapable,
  }));
};

let r = await typeFormula('z**3 + c');
check('valid cubic accepted', r.cls.includes('ok') && r.derivative && r.deep, r.status);

r = await typeFormula('z**2 + ');
check('truncated formula reports an error', r.cls.includes('error'), r.status);

r = await typeFormula('z**2 + q');
check('unknown name reports an error', r.cls.includes('error'), r.status);

r = await typeFormula('abs(z)**2 + c');
check('non-holomorphic formula compiles without a derivative', r.cls.includes('ok') && !r.derivative, r.status);

r = await typeFormula('c*sin(z)');
check('transcendental formula is single precision only', r.cls.includes('ok') && !r.deep, r.status);

r = await typeFormula('z**2 + c');
check('recovers after errors', r.cls.includes('ok'));

// ── dynamic plane shows the seed pad ──────────────────────────────
await setSelect('seedmode', 'dynamic');
check('seed pad visible in dynamic plane', await page.isVisible('#seed-block'));
const padBefore = await page.evaluate(() => window.zeno.state.c.join(','));
await page.locator('#seed-pad').click({ position: { x: 60, y: 40 } });
const padAfter = await page.evaluate(() => window.zeno.state.c.join(','));
check('clicking the seed pad moves c', padBefore !== padAfter, `${padBefore} -> ${padAfter}`);

// ── colour mode reveals its own controls ──────────────────────────
await setSelect('colormode', '2');
check('orbit trap controls appear', await page.isVisible('#trap-field'));
await setSelect('colormode', '1');
check('stripe control appears', await page.isVisible('#stripe-field'));
await setSelect('colormode', '0');

// ── mouse navigation ──────────────────────────────────────────────
await setSelect('preset', 'mandelbrot');
await page.waitForTimeout(300);
const centreBefore = await page.evaluate(() => [window.zeno.camera.x, window.zeno.camera.y]);
await page.mouse.move(900, 400);
await page.mouse.down();
await page.mouse.move(1000, 460, { steps: 6 });
await page.mouse.up();
const centreAfter = await page.evaluate(() => [window.zeno.camera.x, window.zeno.camera.y]);
check('drag pans the view', centreBefore[0] !== centreAfter[0] && centreBefore[1] !== centreAfter[1]);

const wheelBefore = await scale();
await page.mouse.move(900, 400);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(200);
check('wheel zooms in', (await scale()) < wheelBefore);

// ── precision auto-switch ─────────────────────────────────────────
// A pixel must never shrink below a few float32 steps: that is what turns a
// deep zoom into square blocks.
const spans = await page.evaluate(() => {
  const f = window.zeno;
  const h = f.engine.height;
  const out = [];
  for (const scale of [1e-2, 1e-3, 1e-4, 1e-5, 1e-7, 1e-10]) {
    f.camera.set({ x: -0.7436438870371587, y: 0.13182590420531197, scale });
    out.push({ scale, span: (2 * scale) / h });
  }
  return { out, h };
});
check('render height is known', spans.h > 0, String(spans.h));

for (const { scale } of spans.out) {
  await page.evaluate((s) => window.zeno.camera.set({ x: -0.7436438870371587, y: 0.13182590420531197, scale: s }), scale);
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const f = window.zeno;
    return {
      precision: f.compiled.precision,
      span: (2 * f.camera.scale) / f.engine.height,
      scale: f.camera.scale,
    };
  });
  const blocky = st.precision === 'single' && st.span < 6e-8 * 4;
  check(
    `scale ${scale.toExponential(0)} stays above the float32 floor`,
    !blocky,
    `${st.precision}, span ${st.span.toExponential(2)}`
  );
}

await page.evaluate(() => window.zeno.camera.set({ x: -0.7436438870371587, y: 0.13182590420531197, scale: 1e-9 }));
await page.waitForTimeout(3000);
check('deep zoom switches to extended precision', (await page.evaluate(() => window.zeno.compiled.precision)) === 'double');
await page.evaluate(() => window.zeno.camera.set({ x: -0.6, y: 0, scale: 1.35 }));
await page.waitForTimeout(1500);
check('shallow zoom returns to single precision', (await page.evaluate(() => window.zeno.compiled.precision)) === 'single');

// ── share link round trip ─────────────────────────────────────────
await page.evaluate(() => {
  window.zeno.apply({ paletteId: 'magma', density: 2.5 });
  window.zeno.camera.set({ x: 0.25, y: -0.5, scale: 0.01 });
});
const url = await page.evaluate(() => {
  window.zeno.onAction('copyLink');
  return location.hash;
});
await page.goto(`http://localhost:5173/${url}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.zeno), null, { timeout: 15000 });
const restored = await page.evaluate(() => ({
  palette: window.zeno.state.paletteId,
  density: window.zeno.state.density,
  x: window.zeno.camera.x,
  scale: window.zeno.camera.scale,
}));
check(
  'share link restores the view',
  restored.palette === 'magma' && Math.abs(restored.density - 2.5) < 1e-9 && Math.abs(restored.x - 0.25) < 1e-12 && Math.abs(restored.scale - 0.01) < 1e-12,
  JSON.stringify(restored)
);

// ── mobile layout ─────────────────────────────────────────────────
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const layout = await page.evaluate(() => {
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  return { panel: r('panel'), transport: r('transport'), w: innerWidth, h: innerHeight };
});
check('panel fits the mobile viewport', layout.panel.right <= layout.w + 1 && layout.panel.bottom <= layout.h);
check('transport fits the mobile viewport', layout.transport.right <= layout.w + 1 && layout.transport.bottom <= layout.h + 1);
// Drop to one sample first: SwiftShader cannot both accumulate and screenshot.
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/forge/mobile.png', timeout: 60000 });

check('no console errors', errors.length === 0, errors.join(' | '));
console.log(failures ? `\n${failures} failure(s)` : '\nall good');
await browser.close();
process.exit(failures ? 1 : 0);
