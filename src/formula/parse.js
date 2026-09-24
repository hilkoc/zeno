/**
 * Tiny expression parser for complex-valued fractal formulas.
 *
 * Grammar (precedence climbing):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | implicit) unary)*
 *   unary   := ('-' | '+') unary | power
 *   power   := atom ('**' | '^') unary        // right associative
 *   atom    := number | ident | ident '(' args ')' | '(' expr ')'
 *
 * Implicit multiplication is supported: `2z`, `3(z + c)`, `2 pi z`.
 * Everything is complex-valued; real literals become (x, 0).
 */

export const CONSTANTS = {
  i: { re: 0, im: 1 },
  pi: { re: Math.PI, im: 0 },
  tau: { re: Math.PI * 2, im: 0 },
  e: { re: Math.E, im: 0 },
  phi: { re: (1 + Math.sqrt(5)) / 2, im: 0 },
};

export const VARIABLES = new Set(['z', 'c', 'n']);

/** name -> arity. All of these are complex -> complex. */
export const FUNCTIONS = {
  abs: 1, // component-wise |Re| + i|Im|  (Burning Ship convention)
  conj: 1,
  re: 1,
  im: 1,
  len: 1, // modulus, as a real complex number
  norm: 1, // squared modulus
  sqrt: 1,
  exp: 1,
  log: 1,
  sin: 1,
  cos: 1,
  tan: 1,
  sinh: 1,
  cosh: 1,
  tanh: 1,
  pow: 2,
};

export class FormulaError extends Error {
  constructor(message, position) {
    super(message);
    this.name = 'FormulaError';
    this.position = position;
  }
}

const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z_0-9]*/;

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    let m;
    if ((m = NUM_RE.exec(rest))) {
      tokens.push({ type: 'num', value: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if ((m = IDENT_RE.exec(rest))) {
      tokens.push({ type: 'ident', value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (rest.startsWith('**')) {
      tokens.push({ type: 'op', value: '**', pos: i });
      i += 2;
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch === '^' ? '**' : ch, pos: i });
      i++;
      continue;
    }
    if ('(),'.includes(ch)) {
      tokens.push({ type: 'punc', value: ch, pos: i });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected character "${ch}"`, i);
  }
  return tokens;
}

const BINARY_PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '**': 4 };
const UNARY_PRECEDENCE = 3; // looser than **, so -z**2 parses as -(z**2)

/** Builder helpers that constant-fold as they go. */
export const num = (v) => ({ t: 'num', v });
export const cplx = (re, im) => (im === 0 ? num(re) : { t: 'const', re, im });
export const variable = (name) => ({ t: 'var', name });

function isZero(node) {
  return node.t === 'num' && node.v === 0;
}
function isOne(node) {
  return node.t === 'num' && node.v === 1;
}

export function add(a, b) {
  if (isZero(a)) return b;
  if (isZero(b)) return a;
  if (a.t === 'num' && b.t === 'num') return num(a.v + b.v);
  return { t: 'bin', op: '+', a, b };
}
export function sub(a, b) {
  if (isZero(b)) return a;
  if (a.t === 'num' && b.t === 'num') return num(a.v - b.v);
  return { t: 'bin', op: '-', a, b };
}
export function mul(a, b) {
  if (isZero(a) || isZero(b)) return num(0);
  if (isOne(a)) return b;
  if (isOne(b)) return a;
  if (a.t === 'num' && b.t === 'num') return num(a.v * b.v);
  return { t: 'bin', op: '*', a, b };
}
export function div(a, b) {
  if (isZero(a)) return num(0);
  if (isOne(b)) return a;
  if (a.t === 'num' && b.t === 'num' && b.v !== 0) return num(a.v / b.v);
  return { t: 'bin', op: '/', a, b };
}
export function pow(a, b) {
  if (isZero(b)) return num(1);
  if (isOne(b)) return a;
  return { t: 'bin', op: '**', a, b };
}
export function neg(a) {
  if (isZero(a)) return num(0);
  if (a.t === 'num') return num(-a.v);
  if (a.t === 'neg') return a.a;
  return { t: 'neg', a };
}
export const call = (name, args) => ({ t: 'call', name, args });

export function parseFormula(source) {
  const tokens = tokenize(source);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];

  function expect(value) {
    const t = peek();
    if (!t || t.value !== value) {
      throw new FormulaError(`Expected "${value}"`, t ? t.pos : source.length);
    }
    return next();
  }

  function parseAtom() {
    const t = peek();
    if (!t) throw new FormulaError('Unexpected end of formula', source.length);

    if (t.type === 'num') {
      next();
      return num(t.value);
    }

    if (t.type === 'punc' && t.value === '(') {
      next();
      const e = parseExpression(0);
      expect(')');
      return e;
    }

    if (t.type === 'ident') {
      next();
      const name = t.value.toLowerCase();
      const after = peek();
      const isCall = after && after.type === 'punc' && after.value === '(';

      if (name in FUNCTIONS) {
        if (!isCall) throw new FormulaError(`"${name}" is a function, use ${name}(...)`, t.pos);
        next(); // consume '('
        const args = [];
        if (!(peek() && peek().type === 'punc' && peek().value === ')')) {
          args.push(parseExpression(0));
          while (peek() && peek().type === 'punc' && peek().value === ',') {
            next();
            args.push(parseExpression(0));
          }
        }
        expect(')');
        if (args.length !== FUNCTIONS[name]) {
          throw new FormulaError(`${name}() takes ${FUNCTIONS[name]} argument(s), got ${args.length}`, t.pos);
        }
        return call(name, args);
      }
      if (VARIABLES.has(name)) return variable(name);
      if (name in CONSTANTS) {
        const k = CONSTANTS[name];
        return cplx(k.re, k.im);
      }
      throw new FormulaError(`Unknown name "${t.value}"`, t.pos);
    }

    throw new FormulaError(`Unexpected token "${t.value}"`, t.pos);
  }

  function parseUnary() {
    const t = peek();
    if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
      next();
      const operand = parseExpression(UNARY_PRECEDENCE);
      return t.value === '-' ? neg(operand) : operand;
    }
    return parseAtom();
  }

  /** Returns the operator that continues the current expression, or null. */
  function nextOperator() {
    const t = peek();
    if (!t) return null;
    if (t.type === 'op' && t.value in BINARY_PRECEDENCE) {
      return { op: t.value, prec: BINARY_PRECEDENCE[t.value], implicit: false };
    }
    // implicit multiplication: `2z`, `3(z+c)`, `2 pi z`
    const startsValue =
      t.type === 'num' || t.type === 'ident' || (t.type === 'punc' && t.value === '(');
    if (startsValue) return { op: '*', prec: BINARY_PRECEDENCE['*'], implicit: true };
    return null;
  }

  function parseExpression(minPrec) {
    let left = parseUnary();
    for (;;) {
      const info = nextOperator();
      if (!info) break;
      if (info.prec < minPrec) break;
      const rightAssoc = info.op === '**';
      if (!info.implicit) next();
      const right = parseExpression(rightAssoc ? info.prec : info.prec + 1);
      switch (info.op) {
        case '+': left = add(left, right); break;
        case '-': left = sub(left, right); break;
        case '*': left = mul(left, right); break;
        case '/': left = div(left, right); break;
        case '**': left = pow(left, right); break;
      }
    }
    return left;
  }

  if (!tokens.length) throw new FormulaError('Formula is empty', 0);
  const ast = parseExpression(0);
  if (p < tokens.length) {
    throw new FormulaError(`Unexpected token "${tokens[p].value}"`, tokens[p].pos);
  }
  return ast;
}

/** Best-effort polynomial degree in z, used to pick the smooth-escape exponent. */
export function degreeInZ(node) {
  switch (node.t) {
    case 'num':
    case 'const':
      return 0;
    case 'var':
      return node.name === 'z' ? 1 : 0;
    case 'neg':
      return degreeInZ(node.a);
    case 'bin': {
      const a = degreeInZ(node.a);
      if (a === null) return null;
      if (node.op === '**') {
        if (node.b.t !== 'num') return null;
        return a * node.b.v;
      }
      const b = degreeInZ(node.b);
      if (b === null) return null;
      if (node.op === '+' || node.op === '-') return Math.max(a, b);
      if (node.op === '*') return a + b;
      if (node.op === '/') return a - b;
      return null;
    }
    case 'call': {
      const a = degreeInZ(node.args[0]);
      if (a === null) return null;
      // These preserve magnitude growth; the rest are transcendental.
      if (['abs', 'conj', 're', 'im', 'len'].includes(node.name)) return a;
      if (node.name === 'norm') return a * 2;
      if (node.name === 'sqrt') return a / 2;
      if (node.name === 'pow' && node.args[1].t === 'num') return a * node.args[1].v;
      return null;
    }
    default:
      return null;
  }
}

export function collectNames(node, out = new Set()) {
  switch (node.t) {
    case 'var':
      out.add(node.name);
      break;
    case 'neg':
      collectNames(node.a, out);
      break;
    case 'bin':
      collectNames(node.a, out);
      collectNames(node.b, out);
      break;
    case 'call':
      out.add(`fn:${node.name}`);
      node.args.forEach((a) => collectNames(a, out));
      break;
  }
  return out;
}
