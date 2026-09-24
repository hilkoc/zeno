/**
 * AST -> GLSL. Emits straight-line SSA statements instead of one giant nested
 * expression, so deeply nested formulas stay readable and compile fast.
 *
 * Two emission targets share one set of operator names:
 *   - `single`: complex numbers are vec2, ops are k_* (full function library)
 *   - `ds`:     complex numbers are vec4 double-single pairs, ops are cx_*
 *               (arithmetic only -- no transcendentals in extended precision)
 */

import { FormulaError } from './parse.js';

/** Functions that exist in the double-single library. */
const DS_SAFE_FUNCTIONS = new Set(['abs', 'conj', 're', 'im']);

const FUNCTION_SUFFIX = {
  abs: 'absc',
  conj: 'conj',
  re: 'rp',
  im: 'ip',
  len: 'len',
  norm: 'nrm',
  sqrt: 'sqrt',
  exp: 'exp',
  log: 'log',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
};

/** Split a float64 into two float32 halves so the GPU can reconstruct it. */
export function splitDouble(value) {
  const hi = Math.fround(value);
  const lo = Math.fround(value - hi);
  return [hi, lo];
}

function glslFloat(v) {
  if (!Number.isFinite(v)) throw new FormulaError('Non-finite constant in formula', 0);
  const s = Math.fround(v).toPrecision(9);
  return s.includes('.') || s.includes('e') || s.includes('E') ? s : `${s}.0`;
}

class Emitter {
  constructor({ ds, prefix, type, names, tempPrefix }) {
    this.ds = ds;
    this.prefix = prefix;
    this.type = type;
    this.names = names;
    this.tempPrefix = tempPrefix || prefix;
    this.lines = [];
    this.counter = 0;
    this.cache = new Map();
  }

  op(name) {
    return this.prefix + name;
  }

  temp(expr) {
    if (this.cache.has(expr)) return this.cache.get(expr);
    const name = `${this.tempPrefix}t${this.counter++}`;
    this.lines.push(`${this.type} ${name} = ${expr};`);
    this.cache.set(expr, name);
    return name;
  }

  literal(re, im) {
    if (this.ds) {
      const [rh, rl] = splitDouble(re);
      const [ih, il] = splitDouble(im);
      return `vec4(${glslFloat(rh)}, ${glslFloat(rl)}, ${glslFloat(ih)}, ${glslFloat(il)})`;
    }
    return `vec2(${glslFloat(re)}, ${glslFloat(im)})`;
  }

  /** Integer powers become a binary-exponentiation chain of multiplies. */
  intPower(base, exponent) {
    let e = Math.abs(exponent);
    let result = null;
    let acc = base;
    while (e > 0) {
      if (e & 1) result = result === null ? acc : this.temp(`${this.op('mul')}(${result}, ${acc})`);
      e >>= 1;
      if (e > 0) acc = this.temp(`${this.op('mul')}(${acc}, ${acc})`);
    }
    if (result === null) result = this.temp(this.literal(1, 0));
    if (exponent < 0) result = this.temp(`${this.op('div')}(${this.literal(1, 0)}, ${result})`);
    return result;
  }

  emit(node) {
    switch (node.t) {
      case 'num':
        return this.temp(this.literal(node.v, 0));
      case 'const':
        return this.temp(this.literal(node.re, node.im));
      case 'var': {
        const mapped = this.names[node.name];
        if (!mapped) throw new FormulaError(`Variable "${node.name}" is not available here`, 0);
        return mapped;
      }
      case 'neg':
        return this.temp(`${this.op('neg')}(${this.emit(node.a)})`);
      case 'bin': {
        if (node.op === '**') {
          // Integer exponents are exact and much faster than exp(b*log(a)).
          if (node.b.t === 'num' && Number.isInteger(node.b.v) && Math.abs(node.b.v) <= 64) {
            return this.intPower(this.emit(node.a), node.b.v);
          }
          if (this.ds) throw new FormulaError('Extended precision supports integer powers only', 0);
          return this.temp(`${this.op('pow')}(${this.emit(node.a)}, ${this.emit(node.b)})`);
        }
        const table = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' };
        return this.temp(`${this.op(table[node.op])}(${this.emit(node.a)}, ${this.emit(node.b)})`);
      }
      case 'call': {
        if (node.name === 'pow') {
          return this.emit({ t: 'bin', op: '**', a: node.args[0], b: node.args[1] });
        }
        if (this.ds && !DS_SAFE_FUNCTIONS.has(node.name)) {
          throw new FormulaError(`${node.name}() has no extended-precision version`, 0);
        }
        const args = node.args.map((a) => this.emit(a)).join(', ');
        return this.temp(`${this.op(FUNCTION_SUFFIX[node.name])}(${args})`);
      }
      default:
        throw new FormulaError(`Cannot compile node "${node.t}"`, 0);
    }
  }
}

/**
 * @returns {{ code: string, result: string }} statements plus the variable
 *          holding the value of the expression.
 */
export function emitExpression(node, options) {
  const emitter = new Emitter(options);
  const result = emitter.emit(node);
  return { code: emitter.lines.map((l) => '    ' + l).join('\n'), result };
}

export function canEmitDouble(node) {
  try {
    emitExpression(node, {
      ds: true,
      prefix: 'cx_',
      type: 'vec4',
      names: { z: 'z', c: 'c', n: 'nIter' },
    });
    return true;
  } catch {
    return false;
  }
}
