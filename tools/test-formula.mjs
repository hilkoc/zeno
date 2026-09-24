/**
 * Formula parser / codegen checks.
 *   node tools/test-formula.mjs
 *
 * Parses each expression, prints it back fully parenthesised, and compares
 * against the expected grouping. Also differentiates and emits GLSL so a
 * codegen crash shows up here rather than as a black screen.
 */

import { parseFormula, degreeInZ } from '../src/formula/parse.js';
import { emitExpression, canEmitDouble } from '../src/formula/codegen.js';
import { orbitDerivatives } from '../src/formula/derivative.js';

function show(node) {
  switch (node.t) {
    case 'num': return String(node.v);
    case 'const': return `(${node.re}${node.im < 0 ? '' : '+'}${node.im}i)`;
    case 'var': return node.name;
    case 'neg': return `(-${show(node.a)})`;
    case 'bin': return `(${show(node.a)} ${node.op} ${show(node.b)})`;
    case 'call': return `${node.name}(${node.args.map(show).join(', ')})`;
    default: return '?';
  }
}

const CASES = [
  ['z**2 + c', '(z ** 2) + c'],
  ['z - (z**3 - 1)/(3*z**2)', 'z - (((z ** 3) - 1) / (3 * (z ** 2)))'],
  ['a', null], // unknown name -> error
  ['z - c - 1', '(z - c) - 1'],
  ['z - c * 3', 'z - (c * 3)'],
  ['z ** c ** 2', 'z ** (c ** 2)'],
  ['-z**2', '-(z ** 2)'],
  ['-z*2', '(-z) * 2'],
  ['2z', '2 * z'],
  ['2 pi z', '6.283185307179586 * z'],  // 2*pi folds at parse time
  ['3(z + c)', '3 * (z + c)'],
  [
    '(2 + 7*z - (2 + 5*z)*cos(pi*z))/4',
    '((2 + (7 * z)) - ((2 + (5 * z)) * cos((3.141592653589793 * z)))) / 4',
  ],
  ['z**2 + c/z', '(z ** 2) + (c / z)'],
  ['abs(z)**2 + c', '(abs(z) ** 2) + c'],
  ['(z**2 + c)/(z**2 - c)', '((z ** 2) + c) / ((z ** 2) - c)'],
];

// The expected column above is written without the outermost parens for
// readability, so normalise both sides the same way.
const strip = (s) => s.replace(/\s+/g, ' ').trim();
const unwrap = (s) => (s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1) : s);

let failures = 0;
for (const [source, expected] of CASES) {
  let actual;
  try {
    actual = unwrap(show(parseFormula(source)));
  } catch (err) {
    actual = `ERROR: ${err.message}`;
  }
  const want = expected === null ? 'ERROR' : strip(expected);
  const ok = expected === null ? actual.startsWith('ERROR') : strip(actual) === want;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${source}\n        -> ${actual}${ok ? '' : `\n        want ${want}`}`);
}

console.log('\n-- codegen --');
const FORMULAS = [
  'z**2 + c', 'z**5 + c', 'abs(z)**2 + c', 'conj(z)**2 + c',
  'abs(re(z**2)) + i*im(z**2) + c', 'z - (z**3 - 1)/(3*z**2)',
  '(2 + 7*z - (2 + 5*z)*cos(pi*z))/4', 'c*cos(z)', '(z**2 + c)/(z**2 - c)',
  'exp(z) + c', 'z**2 + c*sin(z)', 'z*z*z/(1 + z*z) + c', 'z - (z**4 - 1)/(4*z**3)',
];
for (const f of FORMULAS) {
  try {
    const ast = parseFormula(f);
    const single = emitExpression(ast, { ds: false, prefix: 'cx_', type: 'vec2', names: { z: 'z', c: 'c', n: 'n' } });
    const d = orbitDerivatives(ast);
    let derivOps = 0;
    if (d) {
      derivOps =
        emitExpression(d.dz, { ds: false, prefix: 'k_', type: 'vec2', names: { z: 'z', c: 'c', n: 'n' } }).code.split('\n').length +
        emitExpression(d.dc, { ds: false, prefix: 'k_', type: 'vec2', names: { z: 'z', c: 'c', n: 'n' } }).code.split('\n').length;
    }
    console.log(
      `ok    ${f.padEnd(40)} ops=${String(single.code.split('\n').length).padStart(3)}` +
        ` deriv=${d ? String(derivOps).padStart(3) : ' no'} deep=${canEmitDouble(ast) ? 'yes' : ' no'}` +
        ` degree=${degreeInZ(ast)}`
    );
  } catch (err) {
    failures++;
    console.log(`FAIL  ${f} -> ${err.message}`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
