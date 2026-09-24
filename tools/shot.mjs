/**
 * Headless smoke test + screenshot harness.
 *   node tools/shot.mjs [outfile] [hash]
 * Loads the dev server in Chromium with SwiftShader, waits for a few rendered
 * frames, and reports any console errors or WebGL warnings.
 */

import { chromium } from 'playwright';

const out = process.argv[2] || '/tmp/fractal.png';
const hash = process.argv[3] || '';
const actions = process.argv[4] || '';

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const messages = [];
page.on('console', (m) => messages.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:5173/${hash}`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.zeno), null, { timeout: 15000 });
await page.waitForTimeout(600);

if (actions) await page.evaluate(actions);
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const f = window.zeno;
  if (!f) return { error: 'app did not boot' };
  return {
    preset: f.state.presetId,
    formula: f.state.formula,
    precision: f.compiled.precision,
    derivative: f.compiled.hasDerivative,
    degree: f.compiled.degree,
    samples: f.engine.sample,
    scale: f.camera.scale,
    status: document.getElementById('formula-status').textContent,
  };
});

await page.screenshot({ path: out });
console.log(JSON.stringify(info, null, 2));
const noise = messages.filter((m) => !/\[log\]/.test(m));
if (noise.length) console.log('--- console ---\n' + noise.join('\n'));
await browser.close();
