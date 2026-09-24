/**
 * GLSL building blocks shared by every generated fractal shader.
 *
 *  k_*  : single-precision complex arithmetic on vec2. Always available;
 *         also used for the orbit derivative even in extended-precision mode.
 *  ds_* : double-single (unevaluated float pair) real arithmetic on vec2.
 *         ~1e-15 relative precision out of two float32s, which pushes the
 *         usable zoom depth from ~1e-5 to ~1e-13.
 *  cx_* : complex arithmetic in the active precision. In single mode these
 *         are #defines onto k_*; in extended mode they operate on vec4
 *         (xy = real hi/lo, zw = imaginary hi/lo).
 */

export const COMPLEX_SINGLE = /* glsl */ `
#define K_PI 3.1415926535897932
#define K_HUGE 1e18

vec2 k_add(vec2 a, vec2 b) { return a + b; }
vec2 k_sub(vec2 a, vec2 b) { return a - b; }
vec2 k_neg(vec2 a) { return -a; }
vec2 k_mul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 k_div(vec2 a, vec2 b) {
    float d = dot(b, b);
    d = (d == 0.0) ? 1e-30 : d;
    return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d;
}
vec2 k_absc(vec2 a) { return abs(a); }
vec2 k_conj(vec2 a) { return vec2(a.x, -a.y); }
vec2 k_rp(vec2 a) { return vec2(a.x, 0.0); }
vec2 k_ip(vec2 a) { return vec2(a.y, 0.0); }
vec2 k_len(vec2 a) { return vec2(length(a), 0.0); }
vec2 k_nrm(vec2 a) { return vec2(dot(a, a), 0.0); }

vec2 k_exp(vec2 a) {
    float e = exp(clamp(a.x, -80.0, 80.0));
    return vec2(e * cos(a.y), e * sin(a.y));
}
vec2 k_log(vec2 a) {
    float m = dot(a, a);
    return vec2(0.5 * log(max(m, 1e-37)), atan(a.y, a.x));
}
vec2 k_sqrt(vec2 a) {
    float r = length(a);
    float s = (a.y < 0.0) ? -1.0 : 1.0;
    return vec2(sqrt(max(0.5 * (r + a.x), 0.0)), s * sqrt(max(0.5 * (r - a.x), 0.0)));
}
vec2 k_sin(vec2 a) {
    float y = clamp(a.y, -70.0, 70.0);
    return vec2(sin(a.x) * cosh(y), cos(a.x) * sinh(y));
}
vec2 k_cos(vec2 a) {
    float y = clamp(a.y, -70.0, 70.0);
    return vec2(cos(a.x) * cosh(y), -sin(a.x) * sinh(y));
}
vec2 k_tan(vec2 a) { return k_div(k_sin(a), k_cos(a)); }
vec2 k_sinh(vec2 a) {
    float x = clamp(a.x, -70.0, 70.0);
    return vec2(sinh(x) * cos(a.y), cosh(x) * sin(a.y));
}
vec2 k_cosh(vec2 a) {
    float x = clamp(a.x, -70.0, 70.0);
    return vec2(cosh(x) * cos(a.y), sinh(x) * sin(a.y));
}
vec2 k_tanh(vec2 a) { return k_div(k_sinh(a), k_cosh(a)); }
vec2 k_pow(vec2 a, vec2 b) {
    if (dot(a, a) < 1e-37) return vec2(0.0);
    return k_exp(k_mul(b, k_log(a)));
}
`;

export const DOUBLE_SINGLE = /* glsl */ `
// Dekker/Knuth double-single arithmetic. SPLIT = 2^12 + 1 for a 24-bit mantissa.
const float DS_SPLIT = 4097.0;

vec2 ds_set(float a) { return vec2(a, 0.0); }

vec2 ds_quick(float hi, float lo) {
    float s = hi + lo;
    return vec2(s, lo - (s - hi));
}

vec2 ds_add(vec2 a, vec2 b) {
    float t1 = a.x + b.x;
    float e = t1 - a.x;
    float t2 = ((b.x - e) + (a.x - (t1 - e))) + a.y + b.y;
    return ds_quick(t1, t2);
}

vec2 ds_sub(vec2 a, vec2 b) { return ds_add(a, -b); }

vec2 ds_mul(vec2 a, vec2 b) {
    float cona = a.x * DS_SPLIT;
    float conb = b.x * DS_SPLIT;
    float a1 = cona - (cona - a.x);
    float b1 = conb - (conb - b.x);
    float a2 = a.x - a1;
    float b2 = b.x - b1;
    float c11 = a.x * b.x;
    float c21 = a2 * b2 + (a2 * b1 + (a1 * b2 + (a1 * b1 - c11)));
    float c2 = a.x * b.y + a.y * b.x;
    float t1 = c11 + c2;
    float e = t1 - c11;
    float t2 = a.y * b.y + ((c2 - e) + (c11 - (t1 - e))) + c21;
    return ds_quick(t1, t2);
}

vec2 ds_div(vec2 a, vec2 b) {
    float xn = 1.0 / ((b.x == 0.0) ? 1e-30 : b.x);
    float yn = a.x * xn;
    vec2 diff = ds_sub(a, ds_mul(b, ds_set(yn)));
    vec2 prod = ds_mul(ds_set(xn), ds_set(diff.x));
    return ds_add(ds_set(yn), prod);
}

vec2 ds_abs(vec2 a) { return (a.x < 0.0) ? -a : a; }

// Complex double-single: xy = real (hi, lo), zw = imaginary (hi, lo).
vec4 cx_add(vec4 a, vec4 b) { return vec4(ds_add(a.xy, b.xy), ds_add(a.zw, b.zw)); }
vec4 cx_sub(vec4 a, vec4 b) { return vec4(ds_sub(a.xy, b.xy), ds_sub(a.zw, b.zw)); }
vec4 cx_neg(vec4 a) { return -a; }
vec4 cx_mul(vec4 a, vec4 b) {
    return vec4(ds_sub(ds_mul(a.xy, b.xy), ds_mul(a.zw, b.zw)),
                ds_add(ds_mul(a.xy, b.zw), ds_mul(a.zw, b.xy)));
}
vec4 cx_div(vec4 a, vec4 b) {
    vec2 den = ds_add(ds_mul(b.xy, b.xy), ds_mul(b.zw, b.zw));
    return vec4(ds_div(ds_add(ds_mul(a.xy, b.xy), ds_mul(a.zw, b.zw)), den),
                ds_div(ds_sub(ds_mul(a.zw, b.xy), ds_mul(a.xy, b.zw)), den));
}
vec4 cx_absc(vec4 a) { return vec4(ds_abs(a.xy), ds_abs(a.zw)); }
vec4 cx_conj(vec4 a) { return vec4(a.xy, -a.zw); }
vec4 cx_rp(vec4 a) { return vec4(a.xy, 0.0, 0.0); }
vec4 cx_ip(vec4 a) { return vec4(a.zw, 0.0, 0.0); }
`;

export const SINGLE_ALIASES = /* glsl */ `
#define cx_add k_add
#define cx_sub k_sub
#define cx_neg k_neg
#define cx_mul k_mul
#define cx_div k_div
#define cx_absc k_absc
#define cx_conj k_conj
#define cx_rp k_rp
#define cx_ip k_ip
#define cx_len k_len
#define cx_nrm k_nrm
#define cx_exp k_exp
#define cx_log k_log
#define cx_sqrt k_sqrt
#define cx_sin k_sin
#define cx_cos k_cos
#define cx_tan k_tan
#define cx_sinh k_sinh
#define cx_cosh k_cosh
#define cx_tanh k_tanh
#define cx_pow k_pow
`;

/** Colour helpers: cosine palettes, orbit traps and tone shaping. */
export const COLOR_LIB = /* glsl */ `
vec3 paletteAt(float t) {
    return uPalA + uPalB * cos(6.28318530718 * (uPalC * t + uPalD));
}

float trapDistance(vec2 z) {
    if (uTrapKind == 0) return length(z - uTrapPoint);                       // point
    if (uTrapKind == 1) return min(abs(z.x - uTrapPoint.x), abs(z.y - uTrapPoint.y)); // cross
    if (uTrapKind == 2) return abs(length(z - uTrapPoint) - uTrapRadius);    // ring
    vec2 d = abs(z - uTrapPoint) - vec2(uTrapRadius);                        // box
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
`;

export const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;
