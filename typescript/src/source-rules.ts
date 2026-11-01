import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceRuleCellKind, SourceRuleCommandKind, SourceRuleKind, SourceRuleSyntaxIssueKind,
  type SourceEntry, type SourceLexicalToken, type SourceLine, type SourcePatternRule, type SourcePosition,
  type SourceRule, type SourceRuleCell, type SourceRuleCommand,
  type SourceRuleRow, type SourceRuleSyntaxIssue, type SourceRuleTerm, type SourceSpan, type SourceWord } from './source-model.js';
import { compilerMessagePayload, scanRuleTokens } from './rule-lexing.js';
import { lineSpan, trimmedRange } from './source-text.js';
import { RuleQualifier, type SourceQualifier } from './source-rule-model.js';
import { Direction } from './model.js';

const qualifiers = new Map<string, SourceQualifier>([
  ['up', RuleQualifier.Up], ['down', RuleQualifier.Down], ['left', RuleQualifier.Left], ['right', RuleQualifier.Right],
  ['action', RuleQualifier.Action], ['stationary', RuleQualifier.Stationary], ['no', RuleQualifier.No],
  ['random', RuleQualifier.RandomObject], ['randomdir', RuleQualifier.RandomDirection],
  ['horizontal', RuleQualifier.Horizontal], ['vertical', RuleQualifier.Vertical], ['orthogonal', RuleQualifier.Orthogonal],
  ['moving', RuleQualifier.Moving], ['>', RuleQualifier.Forward], ['<', RuleQualifier.Backward],
  ['^', RuleQualifier.Counterclockwise], ['v', RuleQualifier.Clockwise],
  ['parallel', RuleQualifier.Parallel], ['perpendicular', RuleQualifier.Perpendicular],
]);
const relative = new Set([RuleQualifier.Forward, RuleQualifier.Backward, RuleQualifier.Counterclockwise,
  RuleQualifier.Clockwise, RuleQualifier.Parallel, RuleQualifier.Perpendicular]);
const orthogonal = [Direction.Up, Direction.Down, Direction.Left, Direction.Right];
const absoluteDirections = new Map<string, Direction>([
  ['up', Direction.Up], ['down', Direction.Down], ['left', Direction.Left], ['right', Direction.Right],
]);
const directionFamilies = new Map<string, readonly Direction[]>([
  ['horizontal', [Direction.Left, Direction.Right]], ['horizontal_par', [Direction.Left, Direction.Right]],
  ['horizontal_perp', [Direction.Left, Direction.Right]], ['vertical', [Direction.Up, Direction.Down]],
  ['vertical_par', [Direction.Up, Direction.Down]], ['vertical_perp', [Direction.Up, Direction.Down]],
  ['orthogonal', orthogonal], ['moving', [...orthogonal, Direction.InPlace]],
]);
const controlCommands = new Map<string, Exclude<SourceRuleCommandKind, SourceRuleCommandKind.Message | SourceRuleCommandKind.SoundEffect>>([
  ['cancel', SourceRuleCommandKind.Cancel], ['restart', SourceRuleCommandKind.Restart], ['win', SourceRuleCommandKind.Win],
  ['checkpoint', SourceRuleCommandKind.Checkpoint], ['again', SourceRuleCommandKind.Again],
]);

function legacyCaptureRange(line: SourceLine): { start: number; end: number } {
  const match = /[^(]+/u.exec(line.original);
  return match === null ? { start: line.original.length, end: line.original.length } : { start: match.index, end: match.index + match[0].length };
}

/** Context is the completed lexical walk, not a resolved declaration namespace. */
export interface RuleParsingContext {
  readonly ruleNames: ReadonlySet<string>;
  readonly definedSounds: ReadonlySet<string>;
}

/**
 * The sole rule grammar. Its rows/cells/terms are the native recovered syntax;
 * lexicalTokens retain all authored fragments that recovery discards.
 */
export function readRule(line: SourceLine, compilerLine: string, entry: SourceEntry, context: RuleParsingContext,
  previous: SourcePatternRule | undefined): SourceRule {
  const captured = legacyCaptureRange(line);
  const legacyCapturedSpan = lineSpan(line, captured.start, captured.end);
  const lexicalTokens = scanRuleTokens(line, legacyCapturedSpan);
  const tokens = lexicalTokens.map(token => token.word);
  const base = { ...entry, originalLine: line, compilerLine,
    legacyCapturedText: line.original.slice(captured.start, captured.end).toLowerCase(), legacyCapturedSpan, tokens, lexicalTokens };
  const marker = lexicalTokens[0];
  if (lexicalTokens.length === 1 && marker !== undefined && ['startloop', 'endloop'].includes(marker.value)) {
    return { ...base, kind: marker.value === 'startloop' ? SourceRuleKind.StartLoop : SourceRuleKind.EndLoop, marker: marker.word };
  }

  const syntaxIssues: SourceRuleSyntaxIssue[] = [];
  const prefixWords: SourceWord[] = [], trailingWords: SourceWord[] = [];
  const lhs: SourceRuleRow[] = [], rhs: SourceRuleRow[] = [];
  const commands: SourceRuleCommand[] = [];
  const lineNumber = line.span.start.line;
  let sourceGroup = lineNumber;
  let directions: Direction[] = [];
  let late = false, rigid = false, random = false, hasPlus = false;
  let arrow: SourceWord | null = null;
  let header = true, onRight = false, insideRow = false;
  let bracketBalance = 0, abortsCompilation = false;
  let row: SourceRuleCell[] = [], cell: SourceRuleTerm[] = [];
  let openingBracket: SourceWord | null = null;
  let cellWords: SourceWord[] = [];
  let cellStart: SourcePosition = line.span.start;
  let pending: { readonly value: SourceQualifier; readonly word: SourceWord } | null = null;

  function problem(code: string, message: string, token?: SourceLexicalToken, warning = false, span: SourceSpan | null = token?.word.span ?? line.span): void {
    syntaxIssues.push({ kind: SourceRuleSyntaxIssueKind.Diagnostic, diagnostic: { code, message, span, phase: SourceDiagnosticPhase.Rules,
      severity: warning ? SourceDiagnosticSeverity.Warning : SourceDiagnosticSeverity.Error, countsAsError: !warning } });
  }
  function finish(retained: boolean): SourcePatternRule {
    const invalid = syntaxIssues.some(issue => issue.kind === SourceRuleSyntaxIssueKind.Diagnostic && issue.diagnostic.severity === SourceDiagnosticSeverity.Error);
    return { ...base, kind: invalid ? SourceRuleKind.Invalid : SourceRuleKind.Ordinary,
      prefixWords, lhs, rhs, arrow, commands, trailingWords, retained, abortsCompilation, syntaxIssues,
      sourceGroup, directions, late, rigid, random };
  }
  function appendName(token: SourceLexicalToken): void {
    const qualifier = pending?.word ?? null;
    cell.push({ qualifier, qualifierValue: pending?.value ?? RuleQualifier.Unspecified, name: token.word, nameValue: token.value,
      words: qualifier === null ? [token.word] : [qualifier, token.word],
      span: { start: qualifier?.span.start ?? token.word.span.start, end: token.word.span.end } });
    pending = null;
  }
  function appendCell(end: SourcePosition): void {
    const ellipsis = cell.length === 1 && cell[0]!.qualifierValue === RuleQualifier.Ellipsis && cell[0]!.nameValue === '...';
    row.push({ kind: ellipsis ? SourceRuleCellKind.Ellipsis : SourceRuleCellKind.Contents,
      words: cellWords, terms: cell, span: { start: cellStart, end } });
    cell = [];
    cellWords = [];
  }
  function unfinishedCell(token: SourceLexicalToken): void {
    if ((cell[0]?.qualifierValue ?? pending?.value) === RuleQualifier.Ellipsis) {
      problem('unfinished-ellipsis', 'Cannot end a rule with ellipses.', token);
    } else problem('unfinished-movement', 'In a rule, if you specify a movement, it has to act on an object.', token);
  }

  if (lexicalTokens.length === 0) problem('empty-rule', 'Spooky error!  Empty line passed to rule function.');
  if (compilerLine.includes('(') && !base.legacyCapturedText.includes('->')) {
    problem('comment-before-arrow', "You can't have comments inside rules, sorry. In PuzzleScript, '(' starts a comment, so everything after the first '(' on this line was ignored before your rule was parsed.");
    return finish(false);
  }
  if (!lexicalTokens.some(token => token.value === '->')) {
    problem('missing-rule-arrow', "A rule has to have an arrow in it.  There's no arrow here! Consider reading up about rules - you're clearly doing something weird");
  }

  for (let index = 0; index < lexicalTokens.length; index++) {
    const token = lexicalTokens[index]!;
    const value = token.value;
    const qualifier = qualifiers.get(value);
    if (header) {
      if (value !== '[') prefixWords.push(token.word);
      if (value === '+') {
        hasPlus = true;
        if (sourceGroup === lineNumber) {
          if (previous === undefined) {
            problem('group-without-previous-rule', 'The "+" symbol, for joining a rule with the group of the previous rule, needs a previous rule to be applied to.', token);
            hasPlus = false;
          }
          if (index !== 0) problem('misplaced-group-join', 'The "+" symbol, for joining a rule with the group of the previous rule, must be the first symbol on the line ', token);
          if (hasPlus) sourceGroup = previous!.sourceGroup;
        } else problem('repeated-group-join', 'Two "+"s (the "append to previous rule group" symbol) applied to the same rule.', token);
      } else if (qualifier !== undefined && relative.has(qualifier)) {
        problem('relative-rule-direction', 'You cannot use relative directions ("^v<>") to indicate in which direction(s) a rule applies.  Use absolute directions indicators (Up, Down, Left, Right, Horizontal, or Vertical, for instance), or, if you want the rule to apply in all four directions, do not specify directions', token);
      } else if (directionFamilies.has(value)) directions.push(...directionFamilies.get(value)!);
      else if (value === 'late') late = true;
      else if (value === 'rigid') rigid = true;
      else if (value === 'random') {
        random = true;
        if (hasPlus) problem('random-group-join', `A rule-group can only be marked random by the opening rule in the group (aka, a '+' and 'random' can't appear as rule modifiers on the same line).  Why? Well, you see "random" isn't a property of individual rules, but of whole rule groups.  It indicates that a single possible application of some rule from the whole group should be applied at random.`, token);
      } else if (absoluteDirections.has(value)) directions.push(absoluteDirections.get(value)!);
      else if (value === '[') {
        if (directions.length === 0) directions.push(...orthogonal);
        header = false;
        index--; // The first bracket belongs to the body reducer too.
      } else problem('invalid-rule-prefix', "The start of a rule must consist of some number of directions (possibly 0), before the first bracket, specifying in what directions to look (with no direction specified, it applies in all four directions).  It seems you've just entered \"" + value.toUpperCase() + '\".', token);
      continue;
    }

    if (insideRow && !['[', ']', '|'].includes(value)) cellWords.push(token.word);
    if (value === '[') {
      bracketBalance++;
      if (bracketBalance > 1) problem('nested-rule-bracket', "Multiple opening brackets without closing brackets.  Something fishy here.  Every '[' has to be closed by a ']', and you can't nest them.", token, true);
      if (cell.length > 0 || pending !== null) problem('cell-before-opening-bracket', 'Error, malformed cell rule - encountered a "["" before previous bracket was closed', token);
      openingBracket ??= token.word;
      insideRow = true;
      cell = [];
      cellWords = [];
      cellStart = token.word.span.end;
      pending = null;
    } else if (qualifier !== undefined) {
      if (pending !== null) problem('multiple-rule-qualifiers', "Error, an item can only have one direction/action at a time, but you're looking for several at once!", token);
      else if (!insideRow) problem('qualifier-outside-row', 'Invalid syntax. Directions should be placed at the start of a rule.', token, true);
      else if (late && qualifier !== RuleQualifier.No && qualifier !== RuleQualifier.RandomObject) {
        problem('movement-in-late-rule', 'Movements cannot appear in late rules.', token);
      } else pending = { value: qualifier, word: token.word };
    } else if (value === '|') {
      if (!insideRow) problem('pipe-outside-row', 'Janky syntax.  "|" should only be used inside cell rows (the square brackety bits).', token, true);
      else if (pending !== null) problem('unfinished-movement', 'In a rule, if you specify a movement, it has to act on an object.', token);
      else { appendCell(token.word.span.start); cellStart = token.word.span.end; }
    } else if (value === ']') {
      bracketBalance--;
      if (bracketBalance < 0) {
        problem('excess-closing-bracket', "Multiple closing brackets without corresponding opening brackets.  Something fishy here.  Every '[' has to be closed by a ']', and you can't nest them.", token, true);
        return finish(false);
      }
      if (pending !== null) unfinishedCell(token);
      else appendCell(token.word.span.start);
      // Native recovery can emit another row at a nested bracket's outer close.
      (onRight ? rhs : lhs).push({ cells: row, openingBracket, closingBracket: token.word,
        span: { start: openingBracket?.span.start ?? token.word.span.start, end: token.word.span.end } });
      row = [];
      openingBracket = null;
      insideRow = false;
    } else if (value === '->') {
      if (sourceGroup !== lineNumber && previous!.late !== late) {
        problem('mixed-late-rule-group', 'Oh gosh you can mix late and non-late rules in a rule-group if you really want to, but gosh why would you want to do that?  What do you expect to accomplish?', token, true);
      }
      if (insideRow) problem('arrow-inside-row', 'Encountered an unexpected "->" inside square brackets.  It\'s used to separate states, it has no place inside them >:| .', token, true);
      else if (onRight) {
        problem('multiple-rule-arrows', 'Error, you can only use "->" once in a rule; it\'s used to separate before and after states.', token);
        return finish(false);
      } else { onRight = true; arrow = token.word; }
    } else if (context.ruleNames.has(value)) {
      if (!insideRow) {
        trailingWords.push(token.word);
        problem('name-outside-row', 'Invalid token ' + value.toUpperCase() + '. Object names should only be used within cells (square brackets).', token, true);
      } else {
        for (const existing of cell) {
          if (existing.nameValue !== value) continue;
          if (existing.qualifierValue === RuleQualifier.No && pending?.value === RuleQualifier.No) {
            problem('duplicate-negative-name', `I notice that you have NO ${value.toUpperCase()} more than once in a single cell. That's redundant innit.`, token, true);
          } else {
            problem('duplicate-cell-name', `You cannot specify the same object more than once in a single cell (in this case ${value.toUpperCase()} occurs multiple times).`, token);
            syntaxIssues.push({ kind: SourceRuleSyntaxIssueKind.DuplicateProperty, name: value });
          }
        }
        appendName(token);
      }
    } else if (value === '...') {
      if (!insideRow) problem('ellipsis-outside-row', 'Invalid syntax, ellipses should only be used within cells (square brackets).', token, true);
      else if (pending === null) {
        cell.push({ qualifier: token.word, qualifierValue: RuleQualifier.Ellipsis, name: token.word, nameValue: value, words: [token.word], span: token.word.span });
      } else {
        // A pending qualifier shifts the ellipsis pairings; validation must see it.
        appendName(token);
        pending = { value: RuleQualifier.Ellipsis, word: token.word };
      }
    } else if (controlCommands.has(value) || /^sfx(?:[0-9]|10)$/.test(value) || value === 'message') {
      const placementMessage = 'Commands should only appear at the end of rules, not in or before the pattern-detection/-replacement sections.';
      if (!onRight) problem('command-before-rhs', placementMessage, token);
      else if (insideRow || lexicalTokens.slice(index).some(later => later.value === ']')) problem('command-before-pattern-end', placementMessage, token, true);
      if (value === 'message') {
        const range = trimmedRange(line.original, token.word.span.end.column - 1);
        const authoredPayload = line.original.slice(range.start, range.end);
        commands.push({ kind: SourceRuleCommandKind.Message, word: token.word, authoredPayload,
          legacyPayload: authoredPayload || ' ', payloadSpan: lineSpan(line, range.start, range.end),
          text: compilerMessagePayload(base, lexicalTokens, index) });
        break;
      } else if (controlCommands.has(value)) commands.push({ kind: controlCommands.get(value)!, word: token.word });
      else {
        if (!context.definedSounds.has(value)) problem('undefined-rule-sound', `Sound effect "${value}" not defined.`, token, true);
        commands.push({ kind: SourceRuleCommandKind.SoundEffect, word: token.word, index: Number(value.slice(3)) });
      }
    } else {
      if (!insideRow) trailingWords.push(token.word);
      problem('unknown-rule-token', 'Error, malformed cell rule - was looking for cell contents, but found "' + value + '".  What am I supposed to do with this, eh, please tell me that.', token);
    }
  }

  if (late && rigid) problem('late-rigid-rule', "Late rules cannot be marked as rigid (rigid rules are all about dealing with the consequences of unresolvable movements, and late rules can't even have movements).");
  if (lhs.length !== rhs.length) {
    if (commands.length === 0 || rhs.length !== 0) {
      problem('unequal-rule-row-count', 'Error, when specifying a rule, the number of matches (square bracketed bits) on the left hand side of the arrow must equal the number on the right', undefined, true);
      return finish(false);
    }
  } else {
    for (let index = 0; index < lhs.length; index++) {
      if (lhs[index]!.cells.length !== rhs[index]!.cells.length) {
        problem('unequal-rule-cell-count', 'In a rule, each pattern to match on the left must have a corresponding pattern on the right of equal length (number of cells).');
        abortsCompilation = true;
      }
      if (lhs[index]!.cells.length === 0) problem('empty-rule-pattern', "You have an totally empty pattern on the left-hand side.  This will match *everything*.  You certainly don't want this.", undefined, false, null);
    }
  }
  if (lhs.length === 0) problem('rule-without-pattern', 'This rule refers to nothing.  What the heck? :O');
  const directional = lhs.some(row => row.cells.length > 1)
    || [...lhs, ...rhs].some(row => row.cells.some(cell => cell.terms.some(term => relative.has(term.qualifierValue))));
  if (!directional && directions.length > 1) directions = directions.slice(0, 1);
  return finish(true);
}
