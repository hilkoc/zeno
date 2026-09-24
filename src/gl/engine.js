/**
 * Rendering pipeline.
 *
 *   fractal pass  -> ping-pong accumulation buffer (progressive supersampling)
 *   bright pass   -> half-res buffer
 *   blur H / V    -> separable gaussian
 *   present pass  -> tonemap + bloom + vignette + dither to the canvas
 *
 * Progressive accumulation is what makes still frames look clean: while the
 * view moves we draw one jittered sample per frame, and the moment it settles
 * the shader keeps folding new jittered samples into the same buffer.
 */

import { Renderer, Program, Mesh, Triangle, RenderTarget } from 'ogl';
import { FULLSCREEN_VERTEX } from './glsl-lib.js';
import { buildFractalShader } from './fractal-shader.js';

const BRIGHT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform float uThreshold;
void main() {
    vec3 c = texture(uTexture, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = max(l - uThreshold, 0.0) / max(l, 1e-5);
    fragColor = vec4(c * k, 1.0);
}
`;

const BLUR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec2 uDirection;
void main() {
    // 9-tap gaussian folded into 5 bilinear samples
    vec3 sum = texture(uTexture, vUv).rgb * 0.2270270270;
    vec2 o1 = uDirection * 1.3846153846;
    vec2 o2 = uDirection * 3.2307692308;
    sum += (texture(uTexture, vUv + o1).rgb + texture(uTexture, vUv - o1).rgb) * 0.3162162162;
    sum += (texture(uTexture, vUv + o2).rgb + texture(uTexture, vUv - o2).rgb) * 0.0702702703;
    fragColor = vec4(sum, 1.0);
}
`;

const PRESENT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform vec2 uResolution;

// Narkowicz ACES approximation
vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec3 col = texture(uTexture, vUv).rgb;
    col += texture(uBloom, vUv).rgb * uBloomStrength;
    col = aces(col * uExposure);
    col = pow(max(col, 0.0), vec3(1.0 / 2.2));

    vec2 q = vUv - 0.5;
    float vig = 1.0 - uVignette * dot(q, q) * 1.6;
    col *= clamp(vig, 0.0, 1.0);

    col += (hash(gl_FragCoord.xy) - 0.5) * uGrain;
    fragColor = vec4(col, 1.0);
}
`;

export class FractalEngine {
  constructor(canvas, { dpr = 1, alpha = false } = {}) {
    this.renderer = new Renderer({
      canvas,
      dpr,
      alpha,
      depth: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    const gl = (this.gl = this.renderer.gl);
    gl.clearColor(0, 0, 0, 1);

    this.floatTargets = Boolean(this.renderer.isWebgl2 && this.renderer.extensions['EXT_color_buffer_float']);
    this.geometry = new Triangle(gl);
    this.sample = 0;
    this.targets = {};
    this.compileError = null;

    /** Shared with the UI: mutated in place, read by the shader every frame. */
    this.uniforms = {
      uResolution: { value: [1, 1] },
      uCenter: { value: [0, 0, 0, 0] },
      uScale: { value: [1, 0] },
      uParamC: { value: [0, 0, 0, 0] },
      uParamZ0: { value: [0, 0, 0, 0] },
      uSeedMode: { value: 0 },
      uMaxIter: { value: 300 },
      uBailout2: { value: 1e6 },
      uDegree: { value: 2 },
      uConverge: { value: 0 },
      uJitter: { value: [0, 0] },
      uSample: { value: 0 },
      uPrev: { value: null },
      uColorMode: { value: 0 },
      uDensity: { value: 1 },
      uShift: { value: 0 },
      uPalA: { value: [0.5, 0.5, 0.5] },
      uPalB: { value: [0.5, 0.5, 0.5] },
      uPalC: { value: [1, 1, 1] },
      uPalD: { value: [0, 0.1, 0.2] },
      uStripeFreq: { value: 6 },
      uTrapKind: { value: 0 },
      uTrapPoint: { value: [0, 0] },
      uTrapRadius: { value: 1 },
      uShading: { value: 0.5 },
      uLightDir: { value: [-0.7071, 0.7071] },
      uLightHeight: { value: 1.2 },
      uInterior: { value: 1 },
      uInteriorTint: { value: [0.05, 0.08, 0.14] },
      uEdgeShade: { value: 0.35 },
      uGlow: { value: 0.25 },
      uDetail: { value: 1.0 },
    };

    this.postUniforms = {
      bright: { uTexture: { value: null }, uThreshold: { value: 0.75 } },
      blur: { uTexture: { value: null }, uDirection: { value: [0, 0] } },
      present: {
        uTexture: { value: null },
        uBloom: { value: null },
        uBloomStrength: { value: 0.45 },
        uExposure: { value: 1.0 },
        uVignette: { value: 0.35 },
        uGrain: { value: 0.006 },
        uResolution: { value: [1, 1] },
      },
    };

    this.brightMesh = this.makeMesh(BRIGHT_FRAGMENT, this.postUniforms.bright);
    this.blurMesh = this.makeMesh(BLUR_FRAGMENT, this.postUniforms.blur);
    this.presentMesh = this.makeMesh(PRESENT_FRAGMENT, this.postUniforms.present);
  }

  makeMesh(fragment, uniforms) {
    const program = new Program(this.gl, {
      vertex: FULLSCREEN_VERTEX,
      fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
      cullFace: false,
    });
    return new Mesh(this.gl, { geometry: this.geometry, program });
  }

  /**
   * Compile a formula into a fractal program.
   * @returns {{ ok: boolean, error?: string, hasDerivative?: boolean }}
   */
  setFormula(ast, precision) {
    let built;
    try {
      built = buildFractalShader(ast, { precision });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    const gl = this.gl;
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(shader, built.source);
    gl.compileShader(shader);
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    const log = gl.getShaderInfoLog(shader) || '';
    gl.deleteShader(shader);
    if (!compiled) {
      const first = log.split('\n').find((l) => l.trim()) || 'shader compilation failed';
      return { ok: false, error: first.trim() };
    }

    if (this.fractalMesh) this.fractalMesh.program.remove();
    this.fractalMesh = this.makeMesh(built.source, this.uniforms);
    this.hasDerivative = built.hasDerivative;
    this.resetAccumulation();
    return { ok: true, hasDerivative: built.hasDerivative };
  }

  resize(cssWidth, cssHeight, dpr) {
    this.renderer.dpr = dpr;
    this.renderer.setSize(cssWidth, cssHeight);
    const w = Math.max(1, Math.floor(cssWidth * dpr));
    const h = Math.max(1, Math.floor(cssHeight * dpr));
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;

    const gl = this.gl;
    const type = this.floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const internalFormat = this.floatTargets ? gl.RGBA16F : gl.RGBA;
    const make = (width, height, filter) =>
      new RenderTarget(gl, {
        width,
        height,
        depth: false,
        type,
        format: gl.RGBA,
        internalFormat,
        minFilter: filter,
        magFilter: filter,
      });

    Object.values(this.targets).forEach((t) => {
      if (!t) return;
      t.textures.forEach((tex) => gl.deleteTexture(tex.texture));
      gl.deleteFramebuffer(t.buffer);
    });
    const bw = Math.max(1, w >> 1);
    const bh = Math.max(1, h >> 1);
    this.targets = {
      accumA: make(w, h, gl.NEAREST),
      accumB: make(w, h, gl.NEAREST),
      bloomA: make(bw, bh, gl.LINEAR),
      bloomB: make(bw, bh, gl.LINEAR),
    };
    this.uniforms.uResolution.value = [w, h];
    this.postUniforms.present.uResolution.value = [w, h];
    this.resetAccumulation();
  }

  resetAccumulation() {
    this.sample = 0;
  }

  /** Golden-ratio (R2) low-discrepancy jitter keeps the sample set even. */
  jitterFor(index) {
    const g = 1.32471795724474602596;
    const a1 = 1.0 / g;
    const a2 = 1.0 / (g * g);
    return [((0.5 + a1 * index) % 1) - 0.5, ((0.5 + a2 * index) % 1) - 0.5];
  }

  renderSample() {
    if (!this.fractalMesh || !this.targets.accumA) return;
    const { accumA, accumB } = this.targets;
    const read = this.sample % 2 === 0 ? accumA : accumB;
    const write = this.sample % 2 === 0 ? accumB : accumA;

    this.uniforms.uSample.value = this.sample;
    this.uniforms.uJitter.value = this.sample === 0 ? [0, 0] : this.jitterFor(this.sample);
    this.uniforms.uPrev.value = read.texture;

    this.renderer.render({ scene: this.fractalMesh, target: write, clear: false });
    this.sample++;
    this.current = write;
  }

  present({ bloom = true } = {}) {
    if (!this.current) return;
    const { bloomA, bloomB } = this.targets;
    const p = this.postUniforms;

    if (bloom && p.present.uBloomStrength.value > 0.001) {
      p.bright.uTexture.value = this.current.texture;
      this.renderer.render({ scene: this.brightMesh, target: bloomA, clear: false });

      p.blur.uTexture.value = bloomA.texture;
      p.blur.uDirection.value = [1 / bloomA.width, 0];
      this.renderer.render({ scene: this.blurMesh, target: bloomB, clear: false });

      p.blur.uTexture.value = bloomB.texture;
      p.blur.uDirection.value = [0, 1 / bloomA.height];
      this.renderer.render({ scene: this.blurMesh, target: bloomA, clear: false });
      p.present.uBloom.value = bloomA.texture;
    } else {
      p.present.uBloom.value = bloomB.texture;
    }

    p.present.uTexture.value = this.current.texture;
    this.renderer.render({ scene: this.presentMesh, clear: false });
  }
}
