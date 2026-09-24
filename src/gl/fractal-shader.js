/**
 * Assembles the per-formula fragment shader.
 *
 * The iteration body, the orbit derivative and the precision mode are all
 * generated from the parsed formula, so "custom" fractals run exactly the same
 * code path as the built-in presets -- no interpreter, no uber-shader branching.
 */

import { emitExpression } from '../formula/codegen.js';
import { orbitDerivatives } from '../formula/derivative.js';
import { COMPLEX_SINGLE, DOUBLE_SINGLE, SINGLE_ALIASES, COLOR_LIB } from './glsl-lib.js';

const UNIFORM_BLOCK = /* glsl */ `
uniform vec2  uResolution;
uniform vec4  uCenter;       // double-single complex centre of the view
uniform vec2  uScale;        // double-single half-height in complex units
uniform vec4  uParamC;
uniform vec4  uParamZ0;
uniform int   uSeedMode;     // 0 = parameter plane (c = pixel), 1 = dynamic plane (z = pixel)
uniform int   uMaxIter;
uniform float uBailout2;
uniform float uDegree;
uniform int   uConverge;
uniform vec2  uJitter;
uniform float uSample;
uniform sampler2D uPrev;

uniform int   uColorMode;    // 0 smooth, 1 stripes, 2 orbit trap, 3 distance
uniform float uDensity;
uniform float uShift;
uniform vec3  uPalA;
uniform vec3  uPalB;
uniform vec3  uPalC;
uniform vec3  uPalD;
uniform float uStripeFreq;
uniform int   uTrapKind;
uniform vec2  uTrapPoint;
uniform float uTrapRadius;
uniform float uShading;
uniform vec2  uLightDir;
uniform float uLightHeight;
uniform float uInterior;
uniform vec3  uInteriorTint;
uniform float uEdgeShade;
uniform float uGlow;
uniform float uDetail;
`;

function seedBlock(ds) {
  if (ds) {
    return `
    vec2 offRe = ds_mul(uScale, ds_set(ndc.x));
    vec2 offIm = ds_mul(uScale, ds_set(ndc.y));
    vec4 pixel = cx_add(uCenter, vec4(offRe, offIm));
    vec4 z = (uSeedMode == 0) ? uParamZ0 : pixel;
    vec4 c = (uSeedMode == 0) ? pixel : uParamC;`;
  }
  return `
    vec2 pixel = vec2(uCenter.x, uCenter.z) + ndc * uScale.x;
    vec2 z = (uSeedMode == 0) ? uParamZ0.xz : pixel;
    vec2 c = (uSeedMode == 0) ? pixel : uParamC.xz;`;
}

/**
 * @param {object} ast  parsed formula
 * @param {{ precision: 'single'|'double' }} options
 * @returns {{ source: string, hasDerivative: boolean }}
 */
export function buildFractalShader(ast, options = {}) {
  const ds = options.precision === 'double';
  const CPLX = ds ? 'vec4' : 'vec2';
  const LOW = ds ? '(%).xz' : '(%)';
  const low = (v) => LOW.replace('%', v);

  const formula = emitExpression(ast, {
    ds,
    prefix: 'cx_',
    type: CPLX,
    names: { z: 'z', c: 'c', n: 'nIter' },
  });

  const derivatives = orbitDerivatives(ast);
  let derivativeBlock = '    vec2 dfdz = vec2(1.0, 0.0);\n    vec2 dfdc = vec2(0.0);';
  if (derivatives) {
    const names = { z: 'zs', c: 'cs', n: 'nIterS' };
    const base = { ds: false, prefix: 'k_', type: 'vec2', names };
    const dz = emitExpression(derivatives.dz, { ...base, tempPrefix: 'dz_' });
    const dc = emitExpression(derivatives.dc, { ...base, tempPrefix: 'dc_' });
    derivativeBlock = `${dz.code}\n${dc.code}\n    vec2 dfdz = ${dz.result};\n    vec2 dfdc = ${dc.result};`;
  }
  const hasDerivative = Boolean(derivatives);

  const source = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;
${UNIFORM_BLOCK}
${COMPLEX_SINGLE}
${ds ? DOUBLE_SINGLE : SINGLE_ALIASES}
${COLOR_LIB}

void main() {
    vec2 frag = gl_FragCoord.xy + uJitter;
    vec2 ndc = (frag - 0.5 * uResolution) / (0.5 * uResolution.y);
${seedBlock(ds)}

    vec2 dOrbit = (uSeedMode == 0) ? vec2(0.0) : vec2(1.0, 0.0);
    vec2 dPixel = (uSeedMode == 0) ? vec2(1.0, 0.0) : vec2(0.0);
    vec2 cs = ${low('c')};

    int iter = 0;
    bool escaped = false;
    bool converged = false;
    float trap = 1e20;
    float stripeSum = 0.0;
    float stripePrev = 0.0;
    float mag2 = dot(${low('z')}, ${low('z')});
    vec2 zs = ${low('z')};

    for (int k = 0; k < 65536; k++) {
        if (k >= uMaxIter) break;
        zs = ${low('z')};
        vec2 nIterS = vec2(float(k), 0.0);
        ${CPLX} nIter = ${ds ? 'vec4(float(k), 0.0, 0.0, 0.0)' : 'vec2(float(k), 0.0)'};

${derivativeBlock}
        dOrbit = k_add(k_mul(dfdz, dOrbit), k_mul(dfdc, dPixel));
        if (!(dot(dOrbit, dOrbit) < 1e30)) dOrbit = normalize(dOrbit) * 1e15;

${formula.code}
        ${CPLX} zNext = ${formula.result};

        vec2 delta = ${low('zNext')} - zs;
        z = zNext;
        iter = k + 1;
        vec2 zl = ${low('z')};
        mag2 = dot(zl, zl);

        stripePrev = stripeSum;
        stripeSum += 0.5 + 0.5 * sin(uStripeFreq * atan(zl.y, zl.x));
        trap = min(trap, trapDistance(zl));

        if (!(mag2 < uBailout2)) { escaped = true; break; }
        if (uConverge == 1 && dot(delta, delta) < 1e-11) { converged = true; break; }
    }

    vec2 zl = ${low('z')};
    float fracPart = 0.0;
    float smoothN = float(iter);
    if (escaped) {
        float logZ = 0.5 * log(max(mag2, 1.00001));
        float logR = 0.5 * log(max(uBailout2, 1.00001));
        float nu = log(max(logZ / logR, 1.00001)) / log(max(uDegree, 1.00001));
        fracPart = clamp(1.0 - nu, 0.0, 1.0);
        smoothN = float(iter) - 1.0 + fracPart;
    }

    float sac = 0.0;
    if (iter > 1) {
        float cur = stripeSum / float(iter);
        float prev = stripePrev / float(iter - 1);
        sac = mix(prev, cur, fracPart);
    }

    float deShade = 1.0;
    float lambert = 1.0;
${hasDerivative ? `
    float dLen = length(dOrbit);
    float zLen = sqrt(max(mag2, 1e-30));
    if (escaped && dLen > 0.0) {
        float de = zLen * log(max(zLen, 1.00001)) / dLen;
        float pixelSpan = 2.0 * uScale.x / uResolution.y;
        deShade = clamp(pow(clamp(de / max(pixelSpan, 1e-32), 0.0, 1e6) * uDetail, 0.42), 0.0, 1.0);
        vec2 nrm = normalize(k_div(zl, dOrbit) + vec2(1e-20));
        lambert = clamp((dot(nrm, uLightDir) + uLightHeight) / (1.0 + uLightHeight), 0.0, 1.0);
    }` : ''}

    vec3 col;
    if (!escaped) {
        if (uConverge == 1 && converged) {
            float root = atan(zl.y, zl.x) * 0.15915494 + 0.5;
            float t = root * 2.0 + 0.05 * float(iter) * uDensity + uShift;
            col = paletteAt(t) * clamp(1.15 - float(iter) / float(max(uMaxIter, 1)), 0.12, 1.0);
        // Stripe average and orbit traps are statistics of the whole orbit, so
        // they still say something when nothing escapes. Rational maps, where
        // almost every pixel is bounded, are only readable in these two modes.
        } else if (uColorMode == 1) {
            col = paletteAt(sac * uDensity + uShift) * uInterior * 0.8;
        } else if (uColorMode == 2) {
            float t = uDensity * 2.5 * trap + uShift;
            col = paletteAt(t) * uInterior * (0.35 + 0.65 * exp(-2.0 * trap));
        } else {
            float core = exp(-3.0 * trap);
            col = uInteriorTint * uInterior * (0.06 + 0.94 * core);
        }
    } else {
        float t;
        if (uColorMode == 1) {
            t = sac * uDensity + 0.004 * smoothN;
        } else if (uColorMode == 2) {
            t = uDensity * (0.3 * log(trap + 1e-5) + 0.75);
        } else {
            t = 0.022 * smoothN * uDensity;
        }
        col = paletteAt(t + uShift);
        col *= (uColorMode == 3) ? deShade : mix(1.0, deShade, uEdgeShade);
        col = mix(col, col * lambert, uShading);
        col += uGlow * paletteAt(t + uShift + 0.5) * pow(1.0 - deShade, 3.0);
    }

    vec3 linear = toLinear(col);
    vec3 previous = texture(uPrev, vUv).rgb;
    float weight = 1.0 / (uSample + 1.0);
    fragColor = vec4(mix(previous, linear, weight), 1.0);
}
`;

  return { source, hasDerivative };
}
