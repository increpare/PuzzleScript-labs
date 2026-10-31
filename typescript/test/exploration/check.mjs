import { inspect, isDeepStrictEqual } from 'node:util';
import { runInThisContext } from 'node:vm';
import { createSourceCompilerOracle } from '../legacy-source-compiler.cjs';
import { createSessionOracle } from '../legacy-session-oracle.cjs';
import { renderProgram } from './program.mjs';

let loaded;
async function loadOracles() {
  if (!loaded) loaded = (async () => {
    const modules = await Promise.all([
      'model', 'rule-model', 'commands', 'turn-rules', 'win-conditions', 'session-model',
      'session', 'source-compiler', 'source-model', 'source-assets', 'declaration-model', 'execution-model',
    ].map(name => import(`../../build/${name}.js`)));
    const types = Object.assign({}, ...modules);
    // Both factories load the hash-verified pinned vanilla host. Share one pair
    // per process: reloading its globals would detach an earlier session's hooks.
    const compiler = createSourceCompilerOracle(types);
    const session = createSessionOracle(types, { nativeAlreadyLoaded: true });
    return { types, compiler, session };
  })();
  return loaded;
}

const bounded = (value, limit = 12000) => value.length <= limit ? value : value.slice(0, limit) + '… [truncated]';
const evidence = value => bounded(inspect(value, {
  depth: 8, maxArrayLength: 40, maxStringLength: 1200, breakLength: 100,
  sorted: true, customInspect: false, getters: false,
}));

function serializeError(error) {
  return {
    name: error?.name ?? 'Error', code: error?.code ?? null,
    message: bounded(String(error?.message ?? error)), operator: error?.operator ?? null,
    actual: evidence(error?.actual), expected: evidence(error?.expected),
    stack: bounded(String(error?.stack ?? '')),
  };
}

function fieldPath(path, key) {
  return typeof key === 'string' && /^[A-Za-z_$][\w$]*$/.test(key)
    ? path + '.' + key : path + '[' + String(key) + ']';
}

function firstDifference(actual, expected, path = '$', seen = new WeakMap()) {
  if (isDeepStrictEqual(actual, expected)) return null;
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return path;
  let paired = seen.get(actual);
  if (paired?.has(expected)) return path;
  if (!paired) { paired = new WeakSet(); seen.set(actual, paired); }
  paired.add(expected);
  if (Array.isArray(actual) && Array.isArray(expected)) {
    for (let index = 0; index < Math.min(actual.length, expected.length); index++) {
      const difference = firstDifference(actual[index], expected[index], path + '[' + index + ']', seen);
      if (difference) return difference;
    }
    return path + '.length';
  }
  if (actual instanceof Map && expected instanceof Map) {
    return firstDifference([...actual], [...expected], path, seen) ?? path;
  }
  if (actual instanceof Set && expected instanceof Set) {
    return firstDifference([...actual], [...expected], path, seen) ?? path;
  }
  const keys = [...new Set([...Reflect.ownKeys(actual), ...Reflect.ownKeys(expected)])]
    .sort((left, right) => String(left).localeCompare(String(right), 'en'));
  for (const key of keys) {
    const next = fieldPath(path, key);
    if (!Object.hasOwn(actual, key) || !Object.hasOwn(expected, key)) return next;
    const difference = firstDifference(actual[key], expected[key], next, seen);
    if (difference) return difference;
  }
  return path;
}

function failure(error, phase, fixtureName) {
  const failureType = error?.code === 'ERR_ASSERTION' || error?.name === 'AssertionError'
    ? 'comparison' : 'exception';
  const serialized = serializeError(error);
  let caption = serialized.message.split('\n')[0];
  if (fixtureName && caption.startsWith(fixtureName + ': ')) caption = caption.slice(fixtureName.length + 2);
  caption = caption.replace(/session snapshot \d+(?: \([^)]*\))?/, 'session snapshot');
  const path = (firstDifference(error?.actual, error?.expected) ?? '$').replace(/\[\d+\]/g, '[]');
  return { status: 'failed', phase, failureType,
    signature: [phase, failureType, serialized.name, caption, path].join(':'), error: serialized };
}

/** Build once, then synchronously compare each structured program without recording expected output. */
export async function createProgramChecker(overrides = {}) {
  const { types, compiler, session } = await loadOracles();
  return program => {
    let phase = 'model';
    let nativeErrorFree = false;
    try {
      const fixture = { name: program.name, source: renderProgram(program), inputs: program.inputs, seed: program.seed };
      phase = 'compiler';
      // The complete independent compiler comparison precedes exclusion. A
      // candidate-only error or declined installation must remain a failure.
      const { result } = compiler.compareFixture(fixture, { ...overrides, afterNative: formed => {
        // Observe the completed native compiler before candidate code or test
        // hooks can change its lexical diagnostic counter.
        nativeErrorFree = formed != null && runInThisContext('errorCount') === 0;
        overrides.afterNative?.(formed);
      } });
      if (result.outcome.kind !== types.SourceCompilationKind.Accepted || result.errorCount > 0) {
        return { status: 'excluded', nativeErrorFree, reason: 'shared compiler outcome ' +
          types.SourceCompilationKind[result.outcome.kind] + ', compiler errors: ' + result.errorCount };
      }
      phase = 'session';
      return { status: 'passed', nativeErrorFree, report: session.compareFixture(fixture, overrides) };
    } catch (error) {
      return { ...failure(error, phase, program?.name), nativeErrorFree };
    }
  };
}
