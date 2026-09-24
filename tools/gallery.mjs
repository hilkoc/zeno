/**
 * Renders every preset plus a few colour modes and a deep zoom, then reports
 * mean luminance so a silently-black render cannot pass unnoticed.
 *   node tools/gallery.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/forge';
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: 'mandelbrot', script: `zeno.loadPreset('mandelbrot')` },
  { name: 'julia', script: `zeno.loadPreset('julia'); zeno.apply({paletteId:'ultraviolet'})` },
  { name: 'burningship', script: `zeno.loadPreset('burningship'); zeno.apply({paletteId:'ember'})` },
  { name: 'tricorn', script: `zeno.loadPreset('tricorn')` },
  { name: 'multibrot', script: `zeno.loadPreset('multibrot'); zeno.apply({paletteId:'neon'})` },
  { name: 'celtic', script: `zeno.loadPreset('celtic')` },
  { name: 'cosine', script: `zeno.loadPreset('phoenixjulia'); zeno.apply({paletteId:'frost'})` },
  { name: 'newton', script: `zeno.loadPreset('newton'); zeno.apply({paletteId:'spectrum'})` },
  { name: 'collatz', script: `zeno.loadPreset('collatz'); zeno.apply({paletteId:'goldleaf'})` },
  {
    name: 'stripes',
    script: `zeno.loadPreset('mandelbrot'); zeno.apply({colorMode:1, stripeFreq:7, density:1.2, paletteId:'magma'}); zeno.camera.set({x:-0.7436438870371587,y:0.13182590420531197,scale:3e-5})`,
  },
  {
    name: 'orbittrap',
    script: `zeno.loadPreset('julia'); zeno.apply({colorMode:2, trapKind:2, trapRadius:0.7, density:1.6, paletteId:'abyss'})`,
  },
  {
    name: 'distance',
    script: `zeno.loadPreset('mandelbrot'); zeno.apply({colorMode:3, density:1.4, paletteId:'goldleaf'}); zeno.camera.set({x:0.2925755,y:-0.0149977,scale:4e-4})`,
  },
  {
    name: 'deepzoom',
    script: `zeno.loadPreset('mandelbrot'); zeno.apply({paletteId:'aurora', density:2.2}); zeno.camera.set({x:-0.77568377,y:0.13646737,scale:2e-11})`,
  },
  {
    name: 'custom',
    script: `zeno.loadPreset('custom'); zeno.apply({formula:'z**2 + c/z', paletteId:'neon', density:1.8})`,
  },
  {
    // A rational map: almost nothing escapes, so only an orbit trap reads.
    name: 'custom-rational',
    script: `zeno.loadPreset('custom'); zeno.apply({formula:'(z**2 + c)/(z**2 - c)', paletteId:'ultraviolet', colorMode:2, trapKind:1, density:1.2})`,
  },
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.zeno), null, { timeout: 15000 });
await page.waitForTimeout(500);
await page.evaluate(() => document.body.classList.add('ui-hidden'));

const rows = [];
for (const shot of SHOTS) {
  await page.evaluate(`window.${shot.script}`);
  await page.waitForTimeout(2200);
  const stats = await page.evaluate(() => {
    const f = window.zeno;
    const gl = f.engine.gl;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    let dark = 0;
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const l = (px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722) / 255;
      sum += l;
      if (l < 0.02) dark++;
    }
    return {
      luminance: +(sum / n).toFixed(4),
      darkFraction: +(dark / n).toFixed(3),
      precision: f.compiled.precision,
      derivative: f.compiled.hasDerivative,
      iter: f.engine.uniforms.uMaxIter.value,
      status: document.getElementById('formula-status').textContent,
    };
  });
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  rows.push({ shot: shot.name, ...stats });
}

console.table(rows.map(({ status, ...r }) => r));
const suspicious = rows.filter((r) => r.luminance < 0.012);
if (suspicious.length) console.log('SUSPICIOUSLY DARK:', suspicious.map((r) => r.shot).join(', '));
if (problems.length) console.log('--- console ---\n' + [...new Set(problems)].join('\n'));
await browser.close();
