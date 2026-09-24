/**
 * Camera maths, run without a browser.
 *   node tools/test-camera.mjs
 */

import { Camera } from '../src/camera.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// Integrating the zoom rate over many small steps must match exp(-rate * t).
function simulate(speed, seconds, step = 1 / 60) {
  const cam = new Camera({ x: 0, y: 0, scale: 1 });
  cam.minScale = 1e-30;
  cam.zoomSpeed = speed;
  for (let t = 0; t < seconds - 1e-12; t += step) cam.update(step);
  return cam;
}

const rateAt = (v) => new Camera({ x: 0, y: 0, scale: 1, ...{} }) && (() => {
  const c = new Camera({ x: 0, y: 0, scale: 1 });
  c.zoomSpeed = v;
  return c.rate;
})();

check('centre of the slider is a dead stop', rateAt(0) === 0);
check('dead zone covers tiny offsets', rateAt(0.015) === 0 && rateAt(-0.015) === 0);
check('rate is signed like the slider', rateAt(0.5) > 0 && rateAt(-0.5) < 0);
check('rate is symmetric', near(rateAt(0.7), -rateAt(-0.7)));
check('rate grows with the slider', rateAt(0.9) > rateAt(0.5) && rateAt(0.5) > rateAt(0.1));
check('full right is 2.6 e-folds per second', near(rateAt(1), 2.6, 1e-6), rateAt(1).toFixed(4));

const inward = simulate(0.8, 2);
check('zoom in shrinks the scale exponentially', near(inward.scale, Math.exp(-rateAt(0.8) * 2), 1e-3), inward.scale.toExponential(4));

const outward = simulate(-0.8, 1);
check('zoom out grows the scale exponentially', near(outward.scale, Math.exp(rateAt(0.8)), 1e-3), outward.scale.toExponential(4));

const still = simulate(0, 2);
check('zero speed holds the scale exactly', still.scale === 1);
check('zero speed reports no view change', still.update(1) === false);

// Step size must not change where you end up.
const coarse = simulate(0.6, 3, 1 / 15);
const fine = simulate(0.6, 3, 1 / 240);
check('result is independent of frame rate', near(coarse.scale, fine.scale, 1e-6), `${coarse.scale.toExponential(6)} vs ${fine.scale.toExponential(6)}`);

// Zooming at a point keeps that point under the cursor.
const cam = new Camera({ x: -0.5, y: 0.25, scale: 2 });
const ndc = [0.6, -0.35];
const target = { x: cam.x + ndc[0] * cam.scale, y: cam.y + ndc[1] * cam.scale };
cam.zoomAt(ndc[0], ndc[1], 0.37);
const after = { x: cam.x + ndc[0] * cam.scale, y: cam.y + ndc[1] * cam.scale };
check('zoomAt pins the point under the cursor', near(after.x, target.x, 1e-12) && near(after.y, target.y, 1e-12));

// Clamps.
const deep = new Camera({ x: 0, y: 0, scale: 1 });
deep.minScale = 1e-13;
deep.zoomSpeed = 1;
for (let i = 0; i < 100000; i++) deep.update(1 / 60);
check('zoom in stops at the precision floor', deep.scale === 1e-13);
const wide = new Camera({ x: 0, y: 0, scale: 1 });
wide.zoomSpeed = -1;
for (let i = 0; i < 100000; i++) wide.update(1 / 60);
check('zoom out stops at the widest framing', wide.scale === 64);

// Panning moves the plane the same amount the pointer moved.
const pan = new Camera({ x: 0, y: 0, scale: 1 });
pan.panPixels(100, 0, 1000);
check('pan maps pixels to complex units', near(pan.x, -0.2, 1e-12), String(pan.x));
pan.panPixels(0, 100, 1000);
check('pan flips the vertical axis', near(pan.y, 0.2, 1e-12), String(pan.y));

// toComplex agrees with the shader's pixel mapping.
const map = new Camera({ x: 1, y: -1, scale: 3 });
const centre = map.toComplex(640, 360, 1280, 720);
check('centre pixel maps to the centre', near(centre.x, 1, 1e-12) && near(centre.y, -1, 1e-12));
const corner = map.toComplex(1280, 0, 1280, 720);
check('corner pixel maps with the right aspect', near(corner.x, 1 + 3 * (1280 / 720), 1e-12) && near(corner.y, -1 + 3, 1e-12));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
