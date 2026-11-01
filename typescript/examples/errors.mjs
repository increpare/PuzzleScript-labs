import { readFileSync } from 'node:fs';
import { compileSource, SourceCompilationKind, SourceCompilationFailureKind } from '../build/source-compiler.js';
import { RuleProblemKind } from '../build/rule-problems.js';
import { RuleCompilationCheckpoint } from '../build/rule-recovery.js';

const source = readFileSync(new URL('./source-game.ps', import.meta.url), 'utf8')
  .replace('[ > Player | Crate ] -> [ > Player | > Crate ]', 'right [ Player | Crate ] -> [ Player ]');
const compilation = compileSource(source);
for (const diagnostic of compilation.diagnostics) {
  console.log(diagnostic.message);
  const problem = diagnostic.problem;
  if (problem?.kind === RuleProblemKind.CellCountMismatch) {
    console.log(`Row ${problem.rowIndex + 1}: ${problem.leftCellCount} cells on the left, ${problem.rightCellCount} on the right.`);
    for (const span of [problem.leftSpan, problem.rightSpan]) {
      console.log(`${span.start.line}:${span.start.column}: ${source.slice(span.start.offset, span.end.offset)}`);
    }
  }
}
if (compilation.outcome.kind !== SourceCompilationKind.Invalid
  || compilation.outcome.failure.kind !== SourceCompilationFailureKind.RuleCompilation) {
  throw new Error('The example should stop at the rule compilation checkpoint.');
}
console.log(`Stopped at ${RuleCompilationCheckpoint[compilation.outcome.failure.checkpoint]}.`);
