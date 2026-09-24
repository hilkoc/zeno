/**
 * Guards the GitHub Pages deploy: serves the built dist/ under a /zeno/
 * subpath, the way Pages does, then boots it and checks the canvas is not
 * blank. Catches absolute-path regressions in the bundle, which look fine on
 * a dev server at / and 404 everywhere else.
 *
 *   npm run check:pages
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const ROOT = new URL('../dist/', import.meta.url).pathname;

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (!path.startsWith('/zeno/')) { res.writeHead(404).end('outside subpath'); return; }
  path = path.slice('/zeno/'.length) || 'index.html';
  try {
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(4180, r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('requestfailed', (r) => problems.push(`404/failed: ${r.url()}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));

await page.goto('http://localhost:4180/zeno/', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.zeno), null, { timeout: 20000 });
await page.evaluate(() => window.zeno.apply({ quality: '0.5', samples: 1 }));
await page.waitForTimeout(3000);

const lit = await page.evaluate(() => {
  const gl = window.zeno.engine.gl;
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 765;
  return +(sum / (w * h)).toFixed(4);
});
await page.screenshot({ path: '/tmp/forge/pages.png', timeout: 60000 });
console.log(`booted from /zeno/ subpath, mean luminance ${lit}`);
console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'no failed requests, no console errors');
await browser.close();
server.close();
process.exit(problems.length || lit < 0.01 ? 1 : 0);
