# Zeno

A single-page, real-time fractal explorer. Named for the paradox: the zoom never
bottoms out, it only asks for more precision. Every fractal — including ones you type in
yourself — is compiled to a GPU shader and rendered with progressive supersampling,
distance-estimated shading and emulated double precision for deep zooms.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

## What it does

- **Continuous zoom slider.** Centre is a hard stop; left zooms out, right zooms in, and
  the rate rises quadratically to 2.6 e-folds per second at either end.
- **Nine built-in fractals** plus a **custom formula** field. Mandelbrot, Julia,
  Burning Ship, Tricorn, Multibrot, Celtic, Cosine Julia, Newton (z³ − 1), and the
  Collatz / 3n+1 map.
- **Custom formulas** are the right-hand side of z<sub>n+1</sub> = f(z, c), with `z`
  meaning z<sub>n</sub>. `z**2 + c` is the Mandelbrot iteration.
- **Deep zoom to ~10¹²** using double-single arithmetic, engaged automatically as soon as
  a pixel approaches the float32 step size.
- Four colouring modes, ten palettes, relief shading, bloom, screenshots, and shareable
  URLs that carry the full view state.

## Formula language

| | |
|---|---|
| Operators | `+ - * / ** ^`, unary `-`, implicit products (`2z`, `3(z + c)`) |
| Names | `z` `c` `n` (iteration index) `i` `pi` `tau` `e` `phi` |
| Functions | `abs conj re im len norm sqrt exp log sin cos tan sinh cosh tanh pow` |

`abs(z)` folds each component independently — that is the Burning Ship convention — while
`len(z)` is the modulus. Numbers are real; multiply by `i` for imaginary parts.

Two properties of a formula change what the renderer can do with it, and both are
reported under the input:

- **Holomorphic** formulas (no `abs`, `conj`, `re`, `im`) are symbolically differentiated,
  which yields the orbit derivative used for distance estimation and relief shading.
- **Arithmetic-only** formulas (`+ - * /` and integer powers) have an extended-precision
  version, so they can be zoomed far past the float32 floor. Transcendental functions are
  single precision only, which caps the zoom at about 10⁵.

## How it works

```
formula text
   │  parse.js        precedence-climbing parser -> AST (no eval)
   ├─ derivative.js   symbolic ∂f/∂z and ∂f/∂c
   ├─ codegen.js      AST -> straight-line GLSL, single or double-single
   └─ fractal-shader.js  assembles the fragment shader around the iteration body
```

Each frame runs one jittered sample of the fractal shader, folds it into a ping-ponged
half-float accumulation buffer, and tonemaps the result. While the view moves the buffer
resets every frame; the moment it settles, samples pile up on a low-discrepancy sequence
until the image is clean.

**Precision.** The view centre lives in float64 on the CPU and is uploaded as pairs of
float32s. The switch to extended precision is driven by pixel span rather than a fixed
zoom level: once one pixel covers fewer than about eight float32 steps, the shader is
recompiled to carry z, c and the whole iteration as double-single pairs (Dekker/Knuth
arithmetic). Both limits were measured by rendering a fixed deep view at shrinking
scales until it speckled — single precision holds to a pixel span of ~1e-7, the pair to
~4e-15. The orbit derivative stays in single precision throughout; distance estimation
does not need the extra digits.

**Colouring.** Smooth iteration uses the standard continuous escape count with the
formula's polynomial degree. Stripe average colouring accumulates
`½ + ½·sin(f · arg z)` over the orbit and interpolates by the same fractional part.
Orbit traps track the closest approach to a point, cross, ring or box — and are the one
mode that also colours bounded orbits, which is what makes rational maps readable.
Distance field uses |z|·log|z| / |dz| against the pixel spacing.

## Layout

```
index.html              markup for the panel, HUD and transport
src/main.js             state, compile pipeline, input, render loop
src/ui.js               DOM binding (knows nothing about WebGL)
src/camera.js           view state and zoom integration
src/presets.js          the built-in fractals and bookmarks
src/palettes.js         cosine gradient palettes
src/formula/            parser, symbolic derivative, GLSL codegen
src/gl/engine.js        OGL setup, accumulation, bloom, present
src/gl/fractal-shader.js  fragment shader assembly
src/gl/glsl-lib.js      complex + double-single GLSL libraries
tools/                  headless test and screenshot harnesses
```

## Tests

```bash
npm test          # parser, codegen and camera maths — no browser needed
npm run dev &     # the browser tests drive the dev server
npm run test:ui   # interaction pass in headless Chromium
npm run gallery   # renders every preset to /tmp/forge and flags black frames

npm run check:pages   # builds, serves dist/ from a subpath, boots it
```

The browser harnesses run Chromium with SwiftShader, so they check correctness rather
than speed; expect well under a frame per second there.

## Controls

| | |
|---|---|
| Drag | Pan |
| Wheel | Zoom at cursor |
| Double click | Centre here |
| Space | Pause / resume the zoom |
| Arrows | Nudge the view |
| `R` `S` `F` | Reset, save PNG, fullscreen |
| `C` `M` | Cycle palette, cycle colour mode |
| `Tab` | Hide the interface |
| `?` | Help |

## Why OGL

The interesting part of a fractal renderer is one fullscreen fragment shader, so the job
of a graphics library here is to stay out of the way: compile a program, bind uniforms,
manage render targets. Three.js brings a scene graph, materials and shader preprocessing
that this never uses; regl's declarative command layer buys nothing for a single draw
call; p5 and PixiJS are the wrong abstraction level entirely.
[OGL](https://github.com/oframe/ogl) is a zero-dependency ES-module wrapper that does the
minimum over raw WebGL2 and leaves the GLSL untouched — including `#version 300 es`,
which a preprocessing library would fight.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`: it runs the browser-free tests,
builds, and publishes `dist/` to GitHub Pages. Live at
<https://hilkoc.github.io/zeno/>.

Pages itself has to be enabled once, by hand — the workflow token's `pages: write`
lets it deploy but not provision the site:

```bash
gh api -X POST /repos/OWNER/REPO/pages -f build_type=workflow
```

Pages serves from a subdirectory (`/zeno/`), so `vite.config.js` sets `base: './'` and
every asset reference stays relative. `npm run check:pages` verifies that locally by
serving the build from a subpath and booting it — an absolute base works on a dev server
at `/` and 404s on Pages, which is an easy way to ship a blank page.

## Browser support

Requires WebGL 2. `EXT_color_buffer_float` is used for half-float accumulation buffers
and degrades to 8-bit buffers without it.
