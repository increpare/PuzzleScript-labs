import { renderProgram } from './program.mjs';

/** Lexicographic priorities: fewer inputs, rules, cells, declarations and occupants. */
export function complexity(program) {
  const cells = program.board.flat();
  return [program.inputs.length, program.rules.length, cells.length, program.objects.length,
    program.properties.length, cells.reduce((sum, cell) => sum + cell.length, 0), renderProgram(program).length];
}

function smaller(candidate, original) {
  const left = complexity(candidate), right = complexity(original);
  const first = left.findIndex((value, index) => value !== right[index]);
  return first !== -1 && left[first] < right[first];
}

function* omissions(values) {
  // Large contiguous deletions first, followed by every single-element deletion.
  for (let size = values.length; size >= 1; size = size === 1 ? 0 : Math.ceil(size / 2)) {
    for (let start = 0; start + size <= values.length; start++) {
      yield [...values.slice(0, start), ...values.slice(start + size)];
    }
  }
}

const mentions = (rule, names) => (rule.match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? [])
  .some(word => names.has(word.toLowerCase()));

/** Produce new named-object models; independent compiler agreement filters legality. */
export function* simplifyPrograms(program) {
  const seen = new Set();
  function accept(candidate) {
    if (!smaller(candidate, program)) return false;
    const key = JSON.stringify(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }
  for (const inputs of omissions(program.inputs)) {
    const candidate = { ...structuredClone(program), inputs };
    if (accept(candidate)) yield candidate;
  }
  for (const rules of omissions(program.rules)) {
    const candidate = { ...structuredClone(program), rules };
    if (accept(candidate)) yield candidate;
  }
  if (program.board.length > 1) for (let y = 0; y < program.board.length; y++) {
    if (program.board[y].some(cell => cell.includes('Player'))) continue;
    const candidate = structuredClone(program); candidate.board.splice(y, 1);
    if (accept(candidate)) yield candidate;
  }
  if (program.board[0].length > 1) for (let x = 0; x < program.board[0].length; x++) {
    if (program.board.some(row => row[x].includes('Player'))) continue;
    const candidate = structuredClone(program); candidate.board.forEach(row => row.splice(x, 1));
    if (accept(candidate)) yield candidate;
  }
  for (let y = 0; y < program.board.length; y++) for (let x = 0; x < program.board[y].length; x++) {
    for (const name of program.board[y][x]) {
      if (name === 'Background' || name === 'Player') continue;
      const candidate = structuredClone(program);
      candidate.board[y][x] = candidate.board[y][x].filter(object => object !== name);
      if (accept(candidate)) yield candidate;
    }
  }
  for (const object of program.objects) {
    if (object.name === 'Background' || object.name === 'Player') continue;
    const candidate = structuredClone(program), removed = new Set([object.name.toLowerCase()]);
    candidate.objects = candidate.objects.filter(item => item.name !== object.name);
    candidate.layers = candidate.layers.map(layer => layer.filter(name => name !== object.name));
    candidate.board = candidate.board.map(row => row.map(cell => cell.filter(name => name !== object.name)));
    candidate.properties = candidate.properties.flatMap(property => {
      const objects = property.objects.filter(name => name !== object.name);
      if (objects.length === 0) { removed.add(property.name.toLowerCase()); return []; }
      return [{ ...property, objects }];
    });
    candidate.rules = candidate.rules.filter(rule => !mentions(rule, removed));
    if (accept(candidate)) yield candidate;
  }
  for (const property of program.properties) {
    const candidate = structuredClone(program);
    candidate.properties = candidate.properties.filter(item => item.name !== property.name);
    candidate.rules = candidate.rules.filter(rule => !mentions(rule, new Set([property.name.toLowerCase()])));
    if (accept(candidate)) yield candidate;
  }
  for (const sound of program.sounds ?? []) {
    const candidate = structuredClone(program);
    candidate.sounds = candidate.sounds.filter(item => item.event !== sound.event);
    candidate.rules = candidate.rules.filter(rule => !mentions(rule, new Set([sound.event.toLowerCase()])));
    if (accept(candidate)) yield candidate;
  }
}

/** Greedy local reduction under a caller-supplied same-failure predicate. */
export async function minimizeProgram(original, interesting, { maxChecks = 200, maxTimeMs = 60000 } = {}) {
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1 || !Number.isFinite(maxTimeMs) || maxTimeMs <= 0) throw new Error('Use positive reduction budgets');
  const deadline = Date.now() + maxTimeMs;
  let program = structuredClone(original), checks = 1;
  if (!await interesting(program)) throw new Error('Original program does not reproduce the requested failure');
  while (checks < maxChecks && Date.now() < deadline) {
    let changed = false;
    for (const candidate of simplifyPrograms(program)) {
      if (checks >= maxChecks || Date.now() >= deadline) return { program, checks, fixedPoint: false };
      checks++;
      if (await interesting(candidate)) { program = candidate; changed = true; break; }
    }
    if (!changed) return { program, checks, fixedPoint: true };
  }
  return { program, checks, fixedPoint: false };
}
