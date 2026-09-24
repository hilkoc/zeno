/**
 * Symbolic differentiation of the iteration formula.
 *
 * The renderer carries the derivative of the orbit alongside z:
 *
 *   d_{n+1} = (df/dz)(z_n, c) * d_n + (df/dc)(z_n, c) * dc/du
 *
 * where u is the pixel coordinate. That derivative drives distance estimation
 * (crisp, antialiased boundaries) and the Lambert "embossed" shading.
 *
 * Only holomorphic formulas have one. abs(), conj(), re(), im() are not
 * complex-differentiable, so those fractals fall back to iteration coloring.
 */

import { add, sub, mul, div, neg, num, pow, call } from './parse.js';

export class NotHolomorphic extends Error {}

export function differentiate(node, wrt) {
  switch (node.t) {
    case 'num':
    case 'const':
      return num(0);

    case 'var':
      return node.name === wrt ? num(1) : num(0);

    case 'neg':
      return neg(differentiate(node.a, wrt));

    case 'bin': {
      const { op, a, b } = node;
      const da = differentiate(a, wrt);
      const db = differentiate(b, wrt);
      if (op === '+') return add(da, db);
      if (op === '-') return sub(da, db);
      if (op === '*') return add(mul(da, b), mul(a, db));
      if (op === '/') return div(sub(mul(da, b), mul(a, db)), mul(b, b));
      if (op === '**') {
        if (b.t === 'num') {
          // d/dx a^k = k * a^(k-1) * a'
          return mul(mul(num(b.v), pow(a, num(b.v - 1))), da);
        }
        // d/dx a^b = a^b * (b' * log(a) + b * a'/a)
        const logA = call('log', [a]);
        return mul(node, add(mul(db, logA), div(mul(b, da), a)));
      }
      throw new NotHolomorphic(op);
    }

    case 'call': {
      const [a, b] = node.args;
      const da = a ? differentiate(a, wrt) : num(0);
      switch (node.name) {
        case 'pow':
          return differentiate({ t: 'bin', op: '**', a, b }, wrt);
        case 'exp':
          return mul(node, da);
        case 'log':
          return div(da, a);
        case 'sqrt':
          return div(da, mul(num(2), call('sqrt', [a])));
        case 'sin':
          return mul(call('cos', [a]), da);
        case 'cos':
          return neg(mul(call('sin', [a]), da));
        case 'tan':
          return div(da, pow(call('cos', [a]), num(2)));
        case 'sinh':
          return mul(call('cosh', [a]), da);
        case 'cosh':
          return mul(call('sinh', [a]), da);
        case 'tanh':
          return div(da, pow(call('cosh', [a]), num(2)));
        default:
          throw new NotHolomorphic(node.name);
      }
    }

    default:
      throw new NotHolomorphic(node.t);
  }
}

/** @returns {{dz, dc} | null} null when the formula is not holomorphic. */
export function orbitDerivatives(ast) {
  try {
    return { dz: differentiate(ast, 'z'), dc: differentiate(ast, 'c') };
  } catch (err) {
    if (err instanceof NotHolomorphic) return null;
    throw err;
  }
}
