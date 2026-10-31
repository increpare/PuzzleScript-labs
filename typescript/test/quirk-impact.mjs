// Which recorded corpus games play differently when a compatibility quirk is toggled?
// Replays every simulation fixture with current vanilla defaults, then each quirk toggled
// (and with all off), and reports the first observation that differs.
//
//   npm --prefix typescript run quirk-impact -- [--jobs N] [--json OUT] [name filter]
//
// The baseline is this port with vanillaQuirks, which matches vanilla per input.
// Later level seeds are deterministic here, so every configuration sees the same ones.
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import vm from 'node:vm';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const build = new URL('../build/', import.meta.url);
const testdataPath = new URL('./vanilla/tests/resources/testdata.js', import.meta.url);
const AGAIN_LIMIT = 10_000;

function loadFixtures() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(readFileSync(testdataPath, 'utf8') + ';this.testdata = testdata;', context);
  return context.testdata.map(([name, payload], index) => ({
    index, name, source: payload[0], inputs: payload[1], level: payload[3] ?? 0, seed: payload[4] ?? null,
  }));
}

async function runWorker({ fixtures, configurations }) {
  const { compileSource, SourceCompilationKind } = await import(new URL('source-compiler.js', build));
  const { Movement } = await import(new URL('model.js', build));
  const session = await import(new URL('session.js', build));
  const { RunMode, SessionEffectKind } = await import(new URL('session-model.js', build));
  const inputMovements = [Movement.Up, Movement.Left, Movement.Down, Movement.Right, Movement.Action];

  const objectLabel = object => object.orphanedFrom === undefined ? object.name : object.name + '~orphan';
  function observe(label, result) {
    const state = result.state;
    const board = state.execution.board.rows.map(row => row.map(cell =>
      [...cell.objects].map(objectLabel).sort().join('+')).join(',')).join('/');
    const effects = result.effects.filter(effect => effect.kind !== SessionEffectKind.Diagnostic).map(effect =>
      effect.kind === SessionEffectKind.Sound ? 'sound:' + effect.seed
        : effect.kind === SessionEffectKind.Win ? 'win:' + effect.levelIndex
          : 'save:' + effect.operation + ':' + effect.levelIndex);
    return { label, text: JSON.stringify([state.levelIndex, state.screen, board, effects, result.modified ?? null]) };
  }

  // Yields one observation per operation and AGAIN step; stops at the first error.
  function* replay(fixture, quirks) {
    const compiled = compileSource(fixture.source, { quirks });
    const diagnostics = compiled.diagnostics.map(issue => issue.message);
    yield { label: 'compile', text: JSON.stringify([compiled.outcome.kind, diagnostics]) };
    if (compiled.outcome.kind !== SourceCompilationKind.Accepted) return;
    const { game } = compiled.outcome;
    let loads = 0;
    const environment = { nextLevelSeed: () => `${fixture.seed ?? fixture.name}:level:${++loads}` };
    let result;
    function* drain(label) {
      yield observe(label, result);
      for (let step = 1; result.state.againing; step++) {
        if (step > AGAIN_LIMIT) { yield { label: label + ' again', text: 'AGAIN did not terminate' }; return false; }
        result = session.stepSession(game, result.state, null, environment);
        yield observe(label + ', again ' + step, result);
      }
      return true;
    }
    try {
      result = session.createSession(game, { level: fixture.level, seed: fixture.seed ?? fixture.name,
        runMode: RunMode.Replay }, environment);
      if (!(yield* drain('initial'))) return;
      for (let index = 0; index < fixture.inputs.length; index++) {
        const input = fixture.inputs[index];
        if (input === 'undo') result = session.undoSession(game, result.state, { force: false, ignoreDuplicates: true });
        else if (input === 'restart') result = session.restartSession(game, result.state, environment);
        else result = session.stepSession(game, result.state, input === 'tick' ? null : inputMovements[input], environment);
        if (!(yield* drain('input ' + index + ' (' + input + ')'))) return;
      }
    } catch (error) {
      yield { label: 'error', text: 'error: ' + (error instanceof Error ? error.message : String(error)) };
    }
  }

  for (const fixture of fixtures) {
    const started = performance.now();
    const baseline = [...replay(fixture, configurations[0].quirks)];
    const results = [];
    for (const configuration of configurations.slice(1)) {
      let step = 0, divergence = null;
      for (const observation of replay(fixture, configuration.quirks)) {
        const expected = baseline[step];
        if (expected === undefined || expected.text !== observation.text) {
          divergence = { step, label: observation.label, baseline: expected?.text ?? null, variant: observation.text };
          break;
        }
        step++;
      }
      if (divergence === null && step < baseline.length) {
        divergence = { step, label: baseline[step].label, baseline: baseline[step].text, variant: null };
      }
      results.push({ configuration: configuration.name, divergence });
    }
    parentPort.postMessage({ fixture: { index: fixture.index, name: fixture.name }, steps: baseline.length,
      milliseconds: Math.round(performance.now() - started), results });
  }
}

async function main() {
  const { vanillaQuirks, noQuirks, quirkNames } = await import(new URL('compatibility.js', build));
  const args = process.argv.slice(2);
  let jobs = Math.max(1, availableParallelism() - 1), jsonPath = null, filter = null;
  while (args.length > 0) {
    const argument = args.shift();
    if (argument === '--jobs') jobs = Number(args.shift());
    else if (argument === '--json') jsonPath = args.shift();
    else filter = argument.toLowerCase();
  }
  const fixtures = loadFixtures().filter(fixture => filter === null || fixture.name.toLowerCase().includes(filter));
  const configurations = [{ name: 'vanilla', quirks: { ...vanillaQuirks } },
    ...quirkNames.map(name => ({ name, quirks: { ...vanillaQuirks, [name]: !vanillaQuirks[name] } })),
    { name: 'all off', quirks: { ...noQuirks } }];

  // Interleave fixtures so slow games spread across workers.
  const slices = Array.from({ length: Math.min(jobs, fixtures.length) }, () => []);
  fixtures.forEach((fixture, index) => slices[index % slices.length].push(fixture));
  const reports = [];
  const started = performance.now();
  await Promise.all(slices.map(slice => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { fixtures: slice, configurations } });
    worker.on('message', report => {
      reports.push(report);
      if (reports.length % 25 === 0) console.error(`${reports.length}/${fixtures.length} games`);
    });
    worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve() : reject(new Error('worker exit ' + code)));
  })));
  reports.sort((a, b) => a.fixture.index - b.fixture.index);

  console.log(`${fixtures.length} games, ${reports.reduce((sum, report) => sum + report.steps, 0)} baseline observations, `
    + `${Math.round((performance.now() - started) / 1000)}s with ${slices.length} workers\n`);
  for (const configuration of configurations.slice(1)) {
    const changed = reports.filter(report =>
      report.results.find(result => result.configuration === configuration.name).divergence !== null);
    const setting = configuration.name === 'all off' ? 'all quirks off'
      : configuration.name + (configuration.quirks[configuration.name] ? ' on' : ' off');
    console.log(`${setting}: ${changed.length} game(s) change`);
    for (const report of changed) {
      const { divergence } = report.results.find(result => result.configuration === configuration.name);
      console.log(`  - ${report.fixture.name} — first difference at ${divergence.label}`
        + (divergence.variant?.startsWith('error') || divergence.variant === 'AGAIN did not terminate' ? `: ${divergence.variant}` : ''));
    }
  }
  if (jsonPath !== null) writeFileSync(jsonPath, JSON.stringify(reports, null, 1));
}

if (isMainThread) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  runWorker(workerData).catch(error => { console.error(error); process.exitCode = 1; });
}
