import { appendSourceIssue, type SourceIssueReporter } from './source-diagnostics.js';
import { CommandKind, type Command, type SoundIndex } from './commands.js';
import type { ResolvedDeclarations } from './declaration-model.js';
import { Direction } from './model.js';
import { compilerMessagePayload, compilerRuleTokens } from './rule-lexing.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity, SourceSectionKind, type SourceDiagnostic,
  type SourceDocument, type SourceLexicalToken, type SourceLoopMarker, type SourcePatternRule, type SourceSpan } from './source-model.js';
import { RuleQualifier, type NamedRuleCell, type NamedRuleRows, type NamedRuleTerm,
  type RuleSyntax, type RuleSyntaxResult } from './source-rule-model.js';

const qualifiers = new Map<string, RuleQualifier>([
  ['up', RuleQualifier.Up], ['down', RuleQualifier.Down], ['left', RuleQualifier.Left], ['right', RuleQualifier.Right],
  ['action', RuleQualifier.Action], ['stationary', RuleQualifier.Stationary], ['no', RuleQualifier.No],
  ['random', RuleQualifier.RandomObject], ['randomdir', RuleQualifier.RandomDirection],
  ['horizontal', RuleQualifier.Horizontal], ['vertical', RuleQualifier.Vertical], ['orthogonal', RuleQualifier.Orthogonal],
  ['moving', RuleQualifier.Moving], ['>', RuleQualifier.Forward], ['<', RuleQualifier.Backward],
  ['^', RuleQualifier.Counterclockwise], ['v', RuleQualifier.Clockwise],
  ['parallel', RuleQualifier.Parallel], ['perpendicular', RuleQualifier.Perpendicular],
]);
const absoluteDirections = new Map<string, Direction>([
  ['up', Direction.Up], ['down', Direction.Down], ['left', Direction.Left], ['right', Direction.Right],
]);
const orthogonal = [Direction.Up, Direction.Down, Direction.Left, Direction.Right];
const directionFamilies = new Map<string, readonly Direction[]>([
  ['horizontal', [Direction.Left, Direction.Right]], ['horizontal_par', [Direction.Left, Direction.Right]],
  ['horizontal_perp', [Direction.Left, Direction.Right]], ['vertical', [Direction.Up, Direction.Down]],
  ['vertical_par', [Direction.Up, Direction.Down]], ['vertical_perp', [Direction.Up, Direction.Down]],
  ['orthogonal', orthogonal], ['moving', [...orthogonal, Direction.InPlace]],
]);
const controlCommands = new Map<string, CommandKind.Cancel | CommandKind.Restart | CommandKind.Win | CommandKind.Checkpoint | CommandKind.Again>([
  ['cancel', CommandKind.Cancel], ['restart', CommandKind.Restart], ['win', CommandKind.Win],
  ['checkpoint', CommandKind.Checkpoint], ['again', CommandKind.Again],
]);

function relative(qualifier: RuleQualifier): boolean {
  return qualifier === RuleQualifier.Forward || qualifier === RuleQualifier.Backward
    || qualifier === RuleQualifier.Counterclockwise || qualifier === RuleQualifier.Clockwise
    || qualifier === RuleQualifier.Parallel || qualifier === RuleQualifier.Perpendicular;
}

function directional(lhs: NamedRuleRows, rhs: NamedRuleRows): boolean {
  return lhs.some(row => row.length > 1)
    || [...lhs, ...rhs].some(row => row.some(cell => cell.some(term => relative(term.qualifier))));
}

/** Recover the compiler's effective syntax without changing the authored AST. */
export function recoverRuleSyntax(document: SourceDocument, declarations: ResolvedDeclarations, report?: SourceIssueReporter): RuleSyntaxResult {
  const rules: RuleSyntax[] = [];
  const loops: SourceLoopMarker[] = [];
  const diagnostics: SourceDiagnostic[] = [];
  let abortsCompilation = false;

  // The native parser snapshots accepted names only on entering SOUNDS.
  // Repeated snapshots accumulate registrations, so the latest heading supplies
  // membership for every captured rule, including rules earlier in the source.
  let lastSoundsOffset = -1;
  for (const section of document.sections) {
    if (section.kind === SourceSectionKind.Sounds) lastSoundsOffset = section.name.span.start.offset;
  }
  const definedSounds = new Set(document.sounds.flatMap(sound => sound.eventDefinition === null ? [] : [sound.eventDefinition.value]));
  const knownNames = new Set<string>();
  for (const [name, word] of declarations.firstDeclarationWords) {
    if (word.span.start.offset < lastSoundsOffset) knownNames.add(name);
  }

  function issue(code: string, message: string, span: SourceSpan | null, warning = false, countsAsError = !warning): void {
    appendSourceIssue(diagnostics, { code, message, span, phase: SourceDiagnosticPhase.Rules,
      severity: warning ? SourceDiagnosticSeverity.Warning : SourceDiagnosticSeverity.Error, countsAsError }, report);
  }

  function recover(source: SourcePatternRule): RuleSyntax | null {
    const tokens = compilerRuleTokens(source);
    const line = source.originalLine.span.start.line;
    const lineSpan = source.originalLine.span;
    let sourceGroup = line;
    let directions: Direction[] = [];
    let late = false;
    let rigid = false;
    let random = false;
    let hasPlus = false;
    const previous = rules[rules.length - 1];
    const commands: Command[] = [];
    const lhs: NamedRuleCell[][] = [];
    const rhs: NamedRuleCell[][] = [];
    let header = true;
    let onRight = false;
    let insideRow = false;
    let bracketBalance = 0;
    let row: NamedRuleCell[] = [];
    let cell: NamedRuleTerm[] = [];
    let pending: { readonly qualifier: RuleQualifier; readonly origin: SourceSpan } | null = null;

    function problem(code: string, message: string, token?: SourceLexicalToken, warning = false): void {
      issue(code, message, token?.word.span ?? lineSpan, warning);
    }
    function appendName(name: string, origin: SourceSpan): void {
      cell.push({ qualifier: pending?.qualifier ?? RuleQualifier.Unspecified, name,
        origin: pending === null ? origin : { start: pending.origin.start, end: origin.end } });
      pending = null;
    }
    function unfinishedCell(token: SourceLexicalToken): void {
      if ((cell[0]?.qualifier ?? pending?.qualifier) === RuleQualifier.Ellipsis) {
        problem('unfinished-ellipsis', 'Cannot end a rule with ellipses.', token);
      } else problem('unfinished-movement', 'In a rule, if you specify a movement, it has to act on an object.', token);
    }

    if (tokens.length === 0) problem('empty-rule', 'Spooky error!  Empty line passed to rule function.');
    if (source.compilerLine.includes('(') && !source.legacyCapturedText.includes('->')) {
      problem('comment-before-arrow', "You can't have comments inside rules, sorry. In PuzzleScript, '(' starts a comment, so everything after the first '(' on this line was ignored before your rule was parsed.");
      return null;
    }
    if (!tokens.some(token => token.value === '->')) {
      problem('missing-rule-arrow', "A rule has to have an arrow in it.  There's no arrow here! Consider reading up about rules - you're clearly doing something weird");
    }

    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      const value = token.value;
      const qualifier = qualifiers.get(value);
      if (header) {
        if (value === '+') {
          hasPlus = true;
          if (sourceGroup === line) {
            if (previous === undefined) {
              problem('group-without-previous-rule', 'The "+" symbol, for joining a rule with the group of the previous rule, needs a previous rule to be applied to.', token);
              hasPlus = false;
            }
            if (index !== 0) problem('misplaced-group-join', 'The "+" symbol, for joining a rule with the group of the previous rule, must be the first symbol on the line ', token);
            if (hasPlus) sourceGroup = previous!.sourceGroup;
          } else problem('repeated-group-join', 'Two "+"s (the "append to previous rule group" symbol) applied to the same rule.', token);
        } else if (qualifier !== undefined && relative(qualifier)) {
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

      if (value === '[') {
        bracketBalance++;
        if (bracketBalance > 1) problem('nested-rule-bracket', "Multiple opening brackets without closing brackets.  Something fishy here.  Every '[' has to be closed by a ']', and you can't nest them.", token, true);
        if (cell.length > 0 || pending !== null) problem('cell-before-opening-bracket', 'Error, malformed cell rule - encountered a "["" before previous bracket was closed', token);
        insideRow = true;
        cell = [];
        pending = null;
      } else if (qualifier !== undefined) {
        if (pending !== null) problem('multiple-rule-qualifiers', "Error, an item can only have one direction/action at a time, but you're looking for several at once!", token);
        else if (!insideRow) problem('qualifier-outside-row', 'Invalid syntax. Directions should be placed at the start of a rule.', token, true);
        else if (late && qualifier !== RuleQualifier.No && qualifier !== RuleQualifier.RandomObject) {
          problem('movement-in-late-rule', 'Movements cannot appear in late rules.', token);
        } else pending = { qualifier, origin: token.word.span };
      } else if (value === '|') {
        if (!insideRow) problem('pipe-outside-row', 'Janky syntax.  "|" should only be used inside cell rows (the square brackety bits).', token, true);
        else if (pending !== null) problem('unfinished-movement', 'In a rule, if you specify a movement, it has to act on an object.', token);
        else { row.push(cell); cell = []; }
      } else if (value === ']') {
        bracketBalance--;
        if (bracketBalance < 0) {
          problem('excess-closing-bracket', "Multiple closing brackets without corresponding opening brackets.  Something fishy here.  Every '[' has to be closed by a ']', and you can't nest them.", token, true);
          return null;
        }
        if (pending !== null) unfinishedCell(token);
        else { row.push(cell); cell = []; }
        (onRight ? rhs : lhs).push(row);
        row = [];
        insideRow = false;
      } else if (value === '->') {
        if (sourceGroup !== line && previous!.late !== late) {
          problem('mixed-late-rule-group', 'Oh gosh you can mix late and non-late rules in a rule-group if you really want to, but gosh why would you want to do that?  What do you expect to accomplish?', token, true);
        }
        if (insideRow) problem('arrow-inside-row', 'Encountered an unexpected "->" inside square brackets.  It\'s used to separate states, it has no place inside them >:| .', token, true);
        else if (onRight) {
          problem('multiple-rule-arrows', 'Error, you can only use "->" once in a rule; it\'s used to separate before and after states.', token);
          return null;
        } else onRight = true;
      } else if (knownNames.has(value)) {
        if (!insideRow) problem('name-outside-row', 'Invalid token ' + value.toUpperCase() + '. Object names should only be used within cells (square brackets).', token, true);
        else {
          for (const existing of cell) {
            if (existing.name !== value) continue;
            if (existing.qualifier === RuleQualifier.No && pending?.qualifier === RuleQualifier.No) {
              problem('duplicate-negative-name', `I notice that you have NO ${value.toUpperCase()} more than once in a single cell. That's redundant innit.`, token, true);
            } else {
              problem('duplicate-cell-name', `You cannot specify the same object more than once in a single cell (in this case ${value.toUpperCase()} occurs multiple times).`, token);
              if (declarations.ruleNames.properties.has(value)) {
                issue('duplicate-property-name', `( However, noticing that you're committing this crime with <i>properties</i>, and not being able to help but acknowledge that you <i>may</i> be trying to do something esoteric and <i>clever</i> with the property inference system,  I might be brought to suggest that you consider this: you can have multiple equivalent properties with different names. )`, null, true, true);
              }
            }
          }
          appendName(value, token.word.span);
        }
      } else if (value === '...') {
        if (!insideRow) problem('ellipsis-outside-row', 'Invalid syntax, ellipses should only be used within cells (square brackets).', token, true);
        else {
          // Ellipsis contributes both a qualifier and a name. A preceding pending
          // qualifier shifts those pairings, which later validation must still see.
          if (pending === null) cell.push({ qualifier: RuleQualifier.Ellipsis, name: value, origin: token.word.span });
          else {
            appendName(value, token.word.span);
            pending = { qualifier: RuleQualifier.Ellipsis, origin: token.word.span };
          }
        }
      } else if (controlCommands.has(value) || /^sfx(?:[0-9]|10)$/.test(value) || value === 'message') {
        const placementMessage = 'Commands should only appear at the end of rules, not in or before the pattern-detection/-replacement sections.';
        if (!onRight) problem('command-before-rhs', placementMessage, token);
        else if (insideRow || tokens.slice(index).some(later => later.value === ']')) problem('command-before-pattern-end', placementMessage, token, true);
        if (value === 'message') {
          commands.push({ kind: CommandKind.Message, text: compilerMessagePayload(source, tokens, index) });
          break;
        } else if (controlCommands.has(value)) commands.push({ kind: controlCommands.get(value)! });
        else {
          if (!definedSounds.has(value)) problem('undefined-rule-sound', `Sound effect "${value}" not defined.`, token, true);
          commands.push({ kind: CommandKind.Sound, index: Number(value.slice(3)) as SoundIndex });
        }
      } else problem('unknown-rule-token', 'Error, malformed cell rule - was looking for cell contents, but found "' + value + '".  What am I supposed to do with this, eh, please tell me that.', token);
    }

    if (late && rigid) problem('late-rigid-rule', "Late rules cannot be marked as rigid (rigid rules are all about dealing with the consequences of unresolvable movements, and late rules can't even have movements).");
    if (lhs.length !== rhs.length) {
      if (commands.length === 0 || rhs.length !== 0) {
        problem('unequal-rule-row-count', 'Error, when specifying a rule, the number of matches (square bracketed bits) on the left hand side of the arrow must equal the number on the right', undefined, true);
        return null;
      }
    } else {
      for (let index = 0; index < lhs.length; index++) {
        if (lhs[index]!.length !== rhs[index]!.length) {
          problem('unequal-rule-cell-count', 'In a rule, each pattern to match on the left must have a corresponding pattern on the right of equal length (number of cells).');
          abortsCompilation = true;
        }
        if (lhs[index]!.length === 0) issue('empty-rule-pattern', "You have an totally empty pattern on the left-hand side.  This will match *everything*.  You certainly don't want this.", null);
      }
    }
    if (lhs.length === 0) problem('rule-without-pattern', 'This rule refers to nothing.  What the heck? :O');
    if (!directional(lhs, rhs) && directions.length > 1) directions = directions.slice(0, 1);
    return { source, sourceGroup, directions, lhs, rhs, late, rigid, random, commands };
  }

  for (const source of document.rules) {
    if ('lhs' in source) {
      const rule = recover(source);
      if (rule !== null) rules.push(rule);
    } else loops.push(source);
  }
  return { rules, loops, diagnostics, abortsCompilation };
}
