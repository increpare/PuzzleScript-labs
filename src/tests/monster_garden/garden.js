'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

function Random(seed) {
    this._state = seed >>> 0;
}

Random.prototype.next = function() {
    this._state = (this._state + 0x6D2B79F5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

Random.prototype.integer = function(n) {
    if (!(n > 0)) {
        throw new Error('n must be positive');
    }
    return Math.floor(this.next() * n);
};

Random.prototype.pick = function(array) {
    return array[this.integer(array.length)];
};

function evaluateDataFile(filePath) {
    const context = {};
    vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context);
    return context;
}

function loadCorpus(resourceDir) {
    const testdata = evaluateDataFile(path.join(resourceDir, 'testdata.js')).testdata;
    const errors = evaluateDataFile(path.join(resourceDir, 'errormessage_testdata.js')).errormessage_testdata;
    const corpus = [];
    for (let i = 0; i < testdata.length; i++) {
        const payload = testdata[i][1];
        corpus.push({
            name: testdata[i][0],
            corpusIndex: corpus.length,
            fixtureIndex: i,
            kind: 'simulation',
            source: payload[0],
            inputs: payload[1] || [],
            level: payload[3] !== undefined ? payload[3] : 0,
            randomSeed: payload[4] !== undefined ? payload[4] : null,
            expectedOutput: payload[2] !== undefined ? payload[2] : null,
            expectedErrors: null,
            expectedErrorCount: null
        });
    }
    for (let i = 0; i < errors.length; i++) {
        const payload = errors[i][1];
        corpus.push({
            name: errors[i][0],
            corpusIndex: corpus.length,
            fixtureIndex: i,
            kind: 'compiler-message',
            source: payload[0],
            inputs: [],
            level: 0,
            randomSeed: null,
            expectedOutput: null,
            expectedErrors: payload[1],
            expectedErrorCount: payload[2]
        });
    }
    return corpus;
}

const DEFAULT_GAME_BYTES = 65536;

// Sorted, because directory order is not stable across machines and a campaign
// must reproduce from its seed alone. The cap keeps the rare enormous game out:
// the corpus p95 is 23 KB but its max is 899 KB, and a donor that size would
// dominate any mutant it entered and shrink badly.
function loadGameDir(dir, maxBytes) {
    const cap = maxBytes === undefined ? DEFAULT_GAME_BYTES : maxBytes;
    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch (error) {
        throw new Error('game directory is unreadable: ' + dir);
    }
    const kept = [];
    for (let i = 0; i < entries.length; i++) {
        const full = path.join(dir, entries[i]);
        let stat;
        try {
            stat = fs.statSync(full);
        } catch (error) {
            continue;
        }
        if (stat.isFile() && stat.size > 0 && stat.size <= cap) {
            kept.push(full);
        }
    }
    if (kept.length === 0) {
        throw new Error('no games at or below ' + cap + ' bytes in ' + dir);
    }
    kept.sort();
    return kept;
}

const SECTION_NAMES = [
    'OBJECTS', 'LEGEND', 'SOUNDS', 'COLLISIONLAYERS', 'RULES', 'WINCONDITIONS', 'LEVELS'
];

function findSection(source, name) {
    const lines = source.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().toUpperCase() === name) {
            start = i;
            break;
        }
    }
    if (start < 0) {
        return null;
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (SECTION_NAMES.indexOf(lines[i].trim().toUpperCase()) >= 0) {
            end = i;
            break;
        }
    }
    return { name: name, start: start, end: end, lines: lines };
}

function replaceRange(source, start, end, insert) {
    return source.slice(0, start) + insert + source.slice(end);
}

function marksIn(text, regex) {
    const marks = [];
    const re = new RegExp(regex.source, regex.flags.indexOf('g') >= 0 ? regex.flags : regex.flags + 'g');
    let match;
    while ((match = re.exec(text))) {
        marks.push({ index: match.index, text: match[0] });
    }
    return marks;
}

function mutateSection(source, sectionName, fn) {
    const section = findSection(source, sectionName);
    if (!section) {
        return null;
    }
    const body = section.lines.slice(section.start, section.end).join('\n');
    const next = fn(body);
    if (!next) {
        return null;
    }
    const lines = section.lines.slice();
    const replacement = next.source.split('\n');
    lines.splice(section.start, section.end - section.start, ...replacement);
    return { source: lines.join('\n'), detail: next.detail };
}

function sectionBlocks(body) {
    const lines = body.split('\n');
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (/^=+$/.test(trimmed) || SECTION_NAMES.indexOf(trimmed.toUpperCase()) >= 0) {
            i++;
            continue;
        }
        break;
    }
    const header = lines.slice(0, i);
    const blocks = [];
    let current = [];
    for (; i < lines.length; i++) {
        if (lines[i].trim() === '') {
            if (current.length) {
                blocks.push(current);
                current = [];
            }
            continue;
        }
        current.push(lines[i]);
    }
    if (current.length) {
        blocks.push(current);
    }
    return { header: header, blocks: blocks };
}

const MERGE_APPEND_SECTIONS = ['RULES', 'LEVELS', 'WINCONDITIONS', 'SOUNDS'];

// findSection's `end` is the index of the NEXT section's NAME line. Every section
// header is a border/NAME/border sandwich, so the next section's opening "===="
// border sits directly above that name line and would otherwise leak into
// anything that treats `end` as the boundary — whether that's slicing out this
// section's content (sectionBodyLines, bodyOnly) or choosing where to splice new
// content in (appendIntoSection). This walks back from `end` past any such
// border line(s) to the true content boundary of the current section.
function sectionContentEnd(lines, start, end) {
    let boundary = end;
    while (boundary > start && /^=+$/.test(lines[boundary - 1].trim())) {
        boundary--;
    }
    return boundary;
}

function sectionBodyLines(source, name) {
    const section = findSection(source, name);
    if (!section) {
        return null;
    }
    const body = section.lines.slice(section.start, sectionContentEnd(section.lines, section.start, section.end));
    const parsed = sectionBlocks(body.join('\n'));
    return { header: parsed.header, blocks: parsed.blocks, lines: body };
}

// Names declared by a game: its OBJECTS block heads plus its LEGEND keys.
// An object's head line can declare more than just its name: PuzzleScript
// lets a level glyph be given inline on that same line (e.g. "Background .",
// "Player p"). Every whitespace-separated token on the head line is a
// declared name, not just the first one — otherwise a donor's LEGEND entry
// for that glyph survives the dedupe and collides at compile time.
function declaredNames(source) {
    const names = {};
    const objects = sectionBodyLines(source, 'OBJECTS');
    if (objects) {
        for (let i = 0; i < objects.blocks.length; i++) {
            const head = objects.blocks[i][0].trim();
            const tokens = head.split(/\s+/);
            // An object may declare its level glyph on its own name line
            // ("Background ."), and that glyph is a declared name. But nothing
            // here strips PuzzleScript's (...) comments, and a standalone
            // divider comment inside OBJECTS ("( Physical Objects )") is a
            // common idiom — 14% of sampled corpus games have one. Registering
            // its words would make a donor's real object look like a duplicate,
            // dropping its declaration while its legend entry and rules
            // survive: a silently broken merge. So only trust extra tokens on a
            // head line with no parenthesis anywhere.
            const trustExtras = head.indexOf('(') < 0 && head.indexOf(')') < 0;
            const limit = trustExtras ? tokens.length : 1;
            for (let j = 0; j < limit; j++) {
                if (tokens[j]) {
                    names[tokens[j].toLowerCase()] = true;
                }
            }
        }
    }
    const legend = findSection(source, 'LEGEND');
    if (legend) {
        for (let i = legend.start; i < legend.end; i++) {
            const match = /^\s*([^=\s]+)\s*=/.exec(legend.lines[i]);
            if (match) {
                names[match[1].toLowerCase()] = true;
            }
        }
    }
    return names;
}

function bodyOnly(source, name) {
    const section = findSection(source, name);
    if (!section) {
        return [];
    }
    const lines = section.lines.slice(section.start, sectionContentEnd(section.lines, section.start, section.end));
    const parsed = sectionBlocks(lines.join('\n'));
    return lines.slice(parsed.header.length);
}

function appendIntoSection(lines, name, extra) {
    const source = lines.join('\n');
    const section = findSection(source, name);
    if (!section || extra.length === 0) {
        return lines;
    }
    const insertAt = sectionContentEnd(lines, section.start, section.end);
    const next = lines.slice();
    next.splice(insertAt, 0, '');
    next.splice(insertAt + 1, 0, ...extra);
    return next;
}

// A union of two games: nothing in A is replaced. Duplicate declarations are the
// interesting part — B's rules then rebind to A's same-named objects, giving a
// valid game with foreign semantics.
function mergeGames(sourceA, sourceB, rng) {
    const required = ['OBJECTS', 'LEGEND', 'COLLISIONLAYERS', 'RULES', 'LEVELS'];
    for (let i = 0; i < required.length; i++) {
        if (!findSection(sourceA, required[i]) || !findSection(sourceB, required[i])) {
            return null;
        }
    }
    const known = declaredNames(sourceA);
    let lines = sourceA.split('\n');

    const donorObjects = sectionBodyLines(sourceB, 'OBJECTS');
    const newObjects = [];
    for (let i = 0; i < donorObjects.blocks.length; i++) {
        const block = donorObjects.blocks[i];
        const name = block[0].trim().split(/\s+/)[0];
        if (name && !known[name.toLowerCase()]) {
            newObjects.push('');
            for (let j = 0; j < block.length; j++) {
                newObjects.push(block[j]);
            }
        }
    }
    lines = appendIntoSection(lines, 'OBJECTS', newObjects);

    const donorLegend = bodyOnly(sourceB, 'LEGEND');
    const newLegend = [];
    for (let i = 0; i < donorLegend.length; i++) {
        const match = /^\s*([^=\s]+)\s*=/.exec(donorLegend[i]);
        if (match && !known[match[1].toLowerCase()]) {
            newLegend.push(donorLegend[i]);
        }
    }
    lines = appendIntoSection(lines, 'LEGEND', newLegend);

    const rawLayers = rng.integer(2) === 0;
    const donorLayers = bodyOnly(sourceB, 'COLLISIONLAYERS');
    const newLayers = [];
    for (let i = 0; i < donorLayers.length; i++) {
        const trimmed = donorLayers[i].trim();
        if (trimmed === '') {
            continue;
        }
        if (rawLayers) {
            newLayers.push(donorLayers[i]);
            continue;
        }
        const kept = trimmed.split(',').map(function(part) {
            return part.trim();
        }).filter(function(part) {
            return part !== '' && !known[part.toLowerCase()];
        });
        if (kept.length > 0) {
            newLayers.push(kept.join(', '));
        }
    }
    lines = appendIntoSection(lines, 'COLLISIONLAYERS', newLayers);

    for (let i = 0; i < MERGE_APPEND_SECTIONS.length; i++) {
        const name = MERGE_APPEND_SECTIONS[i];
        lines = appendIntoSection(lines, name, bodyOnly(sourceB, name));
    }

    const merged = lines.join('\n');
    if (merged === sourceA) {
        return null;
    }
    return {
        source: merged,
        detail: 'merged a donor game with ' + (rawLayers ? 'raw layers' : 'filtered layers')
    };
}

function deleteRulePunctuation(source, rng) {
    return mutateSection(source, 'RULES', function(body) {
        const marks = marksIn(body, /->|[\[\]|]/);
        if (marks.length === 0) {
            return null;
        }
        const mark = marks[rng.integer(marks.length)];
        return {
            source: replaceRange(body, mark.index, mark.index + mark.text.length, ''),
            detail: 'deleted ' + mark.text
        };
    });
}

function duplicateRulePunctuation(source, rng) {
    return mutateSection(source, 'RULES', function(body) {
        const marks = marksIn(body, /->|[\[\]|]/);
        if (marks.length === 0) {
            return null;
        }
        const mark = marks[rng.integer(marks.length)];
        return {
            source: replaceRange(body, mark.index, mark.index + mark.text.length, mark.text + mark.text),
            detail: 'duplicated ' + mark.text
        };
    });
}

function swapLegendOperator(source, rng) {
    return mutateSection(source, 'LEGEND', function(body) {
        const marks = marksIn(body, /\s+(and|or)\s+/i);
        if (marks.length === 0) {
            return null;
        }
        const mark = marks[rng.integer(marks.length)];
        const swapped = /and/i.test(mark.text)
            ? mark.text.replace(/and/i, 'or')
            : mark.text.replace(/or/i, 'and');
        return {
            source: replaceRange(body, mark.index, mark.index + mark.text.length, swapped),
            detail: 'swapped ' + mark.text.trim()
        };
    });
}

function invalidViewport(source, rng) {
    const marks = marksIn(source, /\b(flickscreen|zoomscreen)\s+-?\d+x-?\d+/i);
    const replacement = rng.integer(2) === 0 ? '0x0' : '-1x3';
    if (marks.length > 0) {
        const mark = marks[rng.integer(marks.length)];
        const next = mark.text.replace(/-?\d+x-?\d+/, replacement);
        return {
            source: replaceRange(source, mark.index, mark.index + mark.text.length, next),
            detail: 'viewport ' + next
        };
    }
    return {
        source: 'flickscreen ' + replacement + '\n' + source,
        detail: 'injected flickscreen ' + replacement
    };
}

function duplicateRuleCommand(source, rng) {
    return mutateSection(source, 'RULES', function(body) {
        const marks = marksIn(body, /\b(again|cancel|restart|checkpoint|win)\b/i);
        if (marks.length === 0) {
            return null;
        }
        const mark = marks[rng.integer(marks.length)];
        return {
            source: replaceRange(body, mark.index, mark.index + mark.text.length, mark.text + ' ' + mark.text),
            detail: 'duplicated command ' + mark.text
        };
    });
}

function legendCycle(source) {
    return mutateSection(source, 'LEGEND', function(body) {
        return {
            source: body.replace(/\s*$/, '') + '\nGardenCycleA = GardenCycleB\nGardenCycleB = GardenCycleA\n',
            detail: 'added GardenCycleA/GardenCycleB synonym cycle'
        };
    });
}

function swapLineRanges(lines, first, second) {
    const lo = first.start < second.start ? first : second;
    const hi = first.start < second.start ? second : first;
    return lines.slice(0, lo.start)
        .concat(lines.slice(hi.start, hi.end))
        .concat(lines.slice(lo.end, hi.start))
        .concat(lines.slice(lo.start, lo.end))
        .concat(lines.slice(hi.end))
        .join('\n');
}

function swapSections(source, rng) {
    const lines = source.split('\n');
    const found = [];
    for (let i = 0; i < SECTION_NAMES.length; i++) {
        const section = findSection(source, SECTION_NAMES[i]);
        if (section) {
            found.push(section);
        }
    }
    const candidates = [];
    for (let i = 0; i < found.length; i++) {
        for (let j = i + 1; j < found.length; j++) {
            const swapped = swapLineRanges(lines, found[i], found[j]);
            if (swapped !== source) {
                candidates.push({
                    source: swapped,
                    detail: 'swapped ' + found[i].name + ' and ' + found[j].name
                });
            }
        }
    }
    if (candidates.length === 0) {
        return null;
    }
    return candidates[rng.integer(candidates.length)];
}

function oddWhitespace(source, rng) {
    const indexes = [];
    for (let i = 1; i < source.length - 1; i++) {
        if (source[i] === ' ' && /[A-Za-z0-9]/.test(source[i - 1]) && /[A-Za-z0-9]/.test(source[i + 1])) {
            indexes.push(i);
        }
    }
    if (indexes.length === 0) {
        return null;
    }
    const index = indexes[rng.integer(indexes.length)];
    const insert = rng.integer(2) === 0 ? '\t' : '\u00a0';
    return {
        source: replaceRange(source, index, index + 1, insert),
        detail: 'replaced a token-boundary space'
    };
}

function unterminatedComment(source, rng) {
    const lines = source.split('\n');
    const index = rng.integer(lines.length);
    lines[index] = '(' + lines[index];
    return {
        source: lines.join('\n'),
        detail: 'unterminated comment on line ' + (index + 1)
    };
}

function duplicateRuleLine(source, rng) {
    return mutateSection(source, 'RULES', function(body) {
        const lines = body.split('\n');
        const indexes = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('->') >= 0) {
                indexes.push(i);
            }
        }
        if (indexes.length === 0) {
            return null;
        }
        const index = indexes[rng.integer(indexes.length)];
        lines.splice(index + 1, 0, lines[index]);
        return {
            source: lines.join('\n'),
            detail: 'duplicated rule line ' + (index + 1)
        };
    });
}

function swapObjectColors(source, rng) {
    return mutateSection(source, 'OBJECTS', function(body) {
        const colorRe = /^\s*(black|white|gray|grey|red|green|blue|yellow|pink|orange|brown|purple)\s*$/i;
        const lines = body.split('\n');
        const indexes = [];
        let wantName = true;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '') {
                wantName = true;
                continue;
            }
            if (/^=+$/.test(trimmed)) {
                continue;
            }
            if (wantName) {
                wantName = false;
                continue;
            }
            if (colorRe.test(lines[i])) {
                indexes.push(i);
            }
        }
        if (indexes.length < 2) {
            return null;
        }
        const first = rng.integer(indexes.length);
        let second = rng.integer(indexes.length - 1);
        if (second >= first) {
            second++;
        }
        const earlier = indexes[first] < indexes[second] ? indexes[first] : indexes[second];
        const later = indexes[first] < indexes[second] ? indexes[second] : indexes[first];
        if (lines[earlier].trim().toLowerCase() === lines[later].trim().toLowerCase()) {
            return null;
        }
        const swapped = lines.slice();
        const tmp = swapped[earlier];
        swapped[earlier] = swapped[later];
        swapped[later] = tmp;
        return {
            source: swapped.join('\n'),
            detail: 'swapped ' + lines[earlier].trim() + ' and ' + lines[later].trim()
        };
    });
}

function legendMapKeys(source) {
    const legend = findSection(source, 'LEGEND');
    if (!legend) {
        return [];
    }
    const keys = [];
    const body = legend.lines.slice(legend.start, legend.end);
    for (let i = 0; i < body.length; i++) {
        const match = body[i].match(/^([^\s=])\s*=/);
        if (match && keys.indexOf(match[1]) < 0) {
            keys.push(match[1]);
        }
    }
    return keys;
}

function nudgeLevelCell(source, rng) {
    const keys = legendMapKeys(source);
    if (keys.length < 2) {
        return null;
    }
    return mutateSection(source, 'LEVELS', function(body) {
        const lines = body.split('\n');
        const cells = [];
        for (let i = 0; i < lines.length; i++) {
            if (i === 0 || /^\s*LEVELS\s*$/i.test(lines[i])) {
                continue;
            }
            if (/^\s*=+\s*$/.test(lines[i]) || lines[i].trim() === '') {
                continue;
            }
            if (/^\s*message\b/i.test(lines[i])) {
                continue;
            }
            for (let j = 0; j < lines[i].length; j++) {
                if (keys.indexOf(lines[i][j]) >= 0) {
                    cells.push({ line: i, col: j, ch: lines[i][j] });
                }
            }
        }
        if (cells.length === 0) {
            return null;
        }
        const cell = cells[rng.integer(cells.length)];
        const others = keys.filter(function(key) { return key !== cell.ch; });
        const replacement = others[rng.integer(others.length)];
        const chars = lines[cell.line].split('');
        chars[cell.col] = replacement;
        lines[cell.line] = chars.join('');
        return {
            source: lines.join('\n'),
            detail: 'nudged ' + cell.ch + ' to ' + replacement
        };
    });
}

function flipWinQuantifier(source) {
    return mutateSection(source, 'WINCONDITIONS', function(body) {
        const allMatch = /\ball\b/i.exec(body);
        const someMatch = /\bsome\b/i.exec(body);
        if (!allMatch && !someMatch) {
            return null;
        }
        let from;
        let to;
        let index;
        if (allMatch && (!someMatch || allMatch.index <= someMatch.index)) {
            from = allMatch[0];
            to = 'some';
            index = allMatch.index;
        } else {
            from = someMatch[0];
            to = 'all';
            index = someMatch.index;
        }
        return {
            source: replaceRange(body, index, index + from.length, to),
            detail: 'flipped ' + from + ' to ' + to
        };
    });
}

function arrowRuleIndexes(body) {
    const lines = body.split('\n');
    const indexes = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('->') >= 0) {
            indexes.push(i);
        }
    }
    return { lines: lines, indexes: indexes };
}

function mutateArrowRule(source, rng, fn) {
    return mutateSection(source, 'RULES', function(body) {
        const found = arrowRuleIndexes(body);
        if (found.indexes.length === 0) {
            return null;
        }
        const index = found.indexes[rng.integer(found.indexes.length)];
        const next = fn(found.lines[index], rng);
        if (!next) {
            return null;
        }
        found.lines[index] = next.line;
        return { source: found.lines.join('\n'), detail: next.detail };
    });
}

const CELL_QUALIFIERS = [
    'no', 'moving', 'stationary', 'perpendicular', 'parallel',
    'horizontal', 'vertical', 'orthogonal', 'up', 'down', 'left', 'right',
    'action', 'randomdir', 'random', 'v'
];

function cellObjectNames(text) {
    return String(text).trim().split(/\s+/).filter(function(token) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(token)) {
            return false;
        }
        return CELL_QUALIFIERS.indexOf(token.toLowerCase()) < 0;
    });
}

function mutateRuleCell(source, rng, fn) {
    return mutateArrowRule(source, rng, function(line, ruleRng) {
        const match = /\[([^\]]*)\]/.exec(line);
        if (!match) {
            return null;
        }
        const cells = match[1].split('|');
        const index = ruleRng.integer(cells.length);
        const next = fn(cells[index], ruleRng);
        if (!next) {
            return null;
        }
        cells[index] = next.text;
        return {
            line: line.slice(0, match.index) + '[' + cells.join('|') + ']' +
                line.slice(match.index + match[0].length),
            detail: next.detail
        };
    });
}

function insertRuleLine(source, line) {
    return mutateSection(source, 'RULES', function(body) {
        const found = arrowRuleIndexes(body);
        const lines = body.split('\n');
        const at = found.indexes.length > 0 ? found.indexes[0] : lines.length;
        lines.splice(at, 0, line);
        return { source: lines.join('\n'), detail: 'inserted ' + line };
    });
}

const NAUGHTY_STRINGS = [
    '\u200b',
    '\ufeff',
    '\u202e',
    '\u0301Player',
    '\u0410',
    '\u{1D400}',
    'NaN',
    'Infinity',
    'null',
    'undefined',
    '__proto__',
    '%s',
    '{0}',
    '........',
    '\uFF11',
    '\u000b',
    '\u2028',
    'constructor'
];

const KEYWORD_NAMES = ['^', 'v', 'late', 'no', 'and', 'or', 'random', 'moving', 'win', '...'];
const PRELUDE_FLAGS = [
    'noundo',
    'norestart',
    'noaction',
    'scanline',
    'throttle_movement',
    'run_rules_on_level_start',
    'realtime_interval 0',
    'again_interval -1',
    'key_repeat_interval 0',
    'color_palette not-a-palette'
];
const NUDGE_INPUT_CHOICES = [0, 1, 2, 3, 4, 'tick', 'undo', 'restart'];
const POISON_SEEDS = ['', '0', 'NaN', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'];

function blnsSlot(source, rng) {
    const naughty = NAUGHTY_STRINGS[rng.integer(NAUGHTY_STRINGS.length)];
    const title = /^\s*title\s+.+$/im.exec(source);
    if (title) {
        return {
            source: replaceRange(source, title.index, title.index + title[0].length, title[0] + naughty),
            detail: 'appended naughty string to title'
        };
    }
    return {
        source: 'title ' + naughty + '\n' + source,
        detail: 'injected naughty title'
    };
}

function keywordAsName(source, rng) {
    const name = KEYWORD_NAMES[rng.integer(KEYWORD_NAMES.length)];
    return mutateSection(source, 'OBJECTS', function(body) {
        return {
            source: body.replace(/\s*$/, '') + '\n' + name + '\nred\n',
            detail: 'added object named ' + name
        };
    });
}

function orphanLegendMember(source) {
    return mutateSection(source, 'LEGEND', function(body) {
        return {
            source: body.replace(/\s*$/, '') + '\nGardenGhost = MissingName or Player\n',
            detail: 'legend member MissingName does not exist'
        };
    });
}

function injectEllipsis(source, rng) {
    return mutateArrowRule(source, rng, function(line) {
        const pipe = line.indexOf('|');
        if (pipe < 0) {
            const arrow = line.indexOf('->');
            if (arrow < 0) {
                return null;
            }
            return {
                line: line.slice(0, arrow) + '| ... ' + line.slice(arrow),
                detail: 'injected ellipsis before arrow'
            };
        }
        return {
            line: line.slice(0, pipe + 1) + ' ... ' + line.slice(pipe + 1),
            detail: 'injected ellipsis after |'
        };
    });
}

function injectNo(source, rng) {
    return mutateArrowRule(source, rng, function(line) {
        const bracket = line.indexOf('[');
        if (bracket < 0) {
            return null;
        }
        return {
            line: line.slice(0, bracket + 1) + ' no Player ' + line.slice(bracket + 1),
            detail: 'injected no Player'
        };
    });
}

function injectControlChar(source, rng) {
    const ch = rng.integer(2) === 0 ? '\u000b' : '\u2028';
    const marks = marksIn(source, /[A-Za-z]{3,}/);
    if (marks.length === 0) {
        return {
            source: ch + source,
            detail: 'prefixed a control character'
        };
    }
    const mark = marks[rng.integer(marks.length)];
    const at = mark.index + Math.floor(mark.text.length / 2);
    return {
        source: replaceRange(source, at, at, ch),
        detail: 'inserted a control character inside ' + mark.text
    };
}

function spriteMatrixNoise(source) {
    return mutateSection(source, 'OBJECTS', function(body) {
        const lines = body.split('\n');
        let wantName = true;
        let colorLine = -1;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '') {
                wantName = true;
                continue;
            }
            if (wantName) {
                wantName = false;
                colorLine = -1;
                continue;
            }
            if (colorLine < 0 && /[A-Za-z#]/.test(trimmed)) {
                colorLine = i;
                break;
            }
        }
        if (colorLine < 0) {
            return null;
        }
        lines.splice(colorLine + 1, 0, '0123');
        return { source: lines.join('\n'), detail: 'inserted a 4-wide sprite row' };
    });
}

function duplicateObjectName(source) {
    return mutateSection(source, 'OBJECTS', function(body) {
        const lines = body.split('\n');
        let blockStart = -1;
        let wantName = true;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '' || /^\s*=+\s*$/.test(trimmed) || trimmed.toUpperCase() === 'OBJECTS') {
                wantName = true;
                continue;
            }
            if (wantName) {
                blockStart = i;
                break;
            }
        }
        if (blockStart < 0) {
            return null;
        }
        let blockEnd = lines.length;
        for (let i = blockStart + 1; i < lines.length; i++) {
            if (lines[i].trim() === '') {
                blockEnd = i;
                break;
            }
        }
        const block = lines.slice(blockStart, blockEnd);
        lines.splice(blockEnd, 0, '', ...block);
        return { source: lines.join('\n'), detail: 'duplicated object ' + lines[blockStart].trim() };
    });
}

function caseFlipName(source) {
    return mutateSection(source, 'OBJECTS', function(body) {
        const lines = body.split('\n');
        let wantName = true;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '') {
                wantName = true;
                continue;
            }
            if (wantName && /[A-Za-z]/.test(trimmed) && trimmed.toUpperCase() !== 'OBJECTS') {
                const flipped = trimmed === trimmed.toLowerCase() ? trimmed.toUpperCase() : trimmed.toLowerCase();
                if (flipped === trimmed) {
                    wantName = false;
                    continue;
                }
                lines[i] = lines[i].replace(trimmed, flipped);
                return { source: lines.join('\n'), detail: 'case-flipped ' + trimmed };
            }
            wantName = false;
        }
        return null;
    });
}

function layerDrop(source) {
    return mutateSection(source, 'COLLISIONLAYERS', function(body) {
        const lines = body.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (/,/.test(lines[i]) && /[A-Za-z]/.test(lines[i])) {
                const parts = lines[i].split(',').map(function(part) { return part.trim(); }).filter(Boolean);
                if (parts.length < 2) {
                    continue;
                }
                const dropped = parts.shift();
                lines[i] = parts.join(', ');
                return { source: lines.join('\n'), detail: 'dropped ' + dropped + ' from a collision layer' };
            }
        }
        return null;
    });
}

function layerDoubleBook(source) {
    return mutateSection(source, 'COLLISIONLAYERS', function(body) {
        const names = [];
        const lines = body.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const parts = lines[i].split(',');
            for (let j = 0; j < parts.length; j++) {
                const name = parts[j].trim();
                if (name && name.toUpperCase() !== 'COLLISIONLAYERS' && !/^=+$/.test(name)) {
                    names.push(name);
                }
            }
        }
        if (names.length === 0) {
            return null;
        }
        const name = names[names.length - 1];
        return {
            source: body.replace(/\s*$/, '') + '\n' + name + '\n',
            detail: 'duplicated ' + name + ' onto a second layer'
        };
    });
}

function backgroundAsAggregate(source) {
    return mutateSection(source, 'LEGEND', function(body) {
        return {
            source: body.replace(/\s*$/, '') + '\nBackground = Player and Wall\n',
            detail: 'redefined Background as an aggregate'
        };
    });
}

function soundOnProperty(source) {
    return mutateSection(source, 'SOUNDS', function(body) {
        return {
            source: body.replace(/\s*$/, '') + '\nObstacle MOVE 12345607\n',
            detail: 'MOVE sound on property Obstacle'
        };
    });
}

function winOnUndefined(source) {
    return mutateSection(source, 'WINCONDITIONS', function(body) {
        return {
            source: body.replace(/\s*$/, '') + '\nall Floop on Player\n',
            detail: 'win condition on undefined Floop'
        };
    });
}

function emptyCellRow(source) {
    return insertRuleLine(source, '[ > ] -> cancel');
}

function commandOnLhs(source) {
    return insertRuleLine(source, 'win [ Player ] -> [ Player ]');
}

function groupPlus(source, rng) {
    return mutateArrowRule(source, rng, function(line) {
        if (/^\s*\+/.test(line)) {
            return null;
        }
        return { line: '+ ' + line, detail: 'prefixed rule with +' };
    });
}

function startloopMismatch(source) {
    return insertRuleLine(source, 'startloop');
}

function directionPrefixSalad(source, rng) {
    return mutateArrowRule(source, rng, function(line) {
        if (/^\s*late\b/i.test(line)) {
            return { line: 'randomdir perpendicular ' + line, detail: 'prefixed randomdir perpendicular' };
        }
        return { line: 'late rigid randomdir perpendicular ' + line, detail: 'prefixed late rigid randomdir perpendicular' };
    });
}

function injectAgainLoop(source) {
    return insertRuleLine(source, '[ Player ] -> [ Player ] again');
}

function injectRandomFill(source) {
    return insertRuleLine(source, 'random [ no Player ] -> [ Player ] again');
}

function preludeInjection(source, rng) {
    const flag = PRELUDE_FLAGS[rng.integer(PRELUDE_FLAGS.length)];
    if (new RegExp('^\\s*' + flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'im').test(source)) {
        const alt = PRELUDE_FLAGS[(PRELUDE_FLAGS.indexOf(flag) + 1) % PRELUDE_FLAGS.length];
        return { source: alt + '\n' + source, detail: 'injected ' + alt };
    }
    return { source: flag + '\n' + source, detail: 'injected ' + flag };
}

function raggedLevel(source) {
    return mutateSection(source, 'LEVELS', function(body) {
        const lines = body.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i === 0 || /^\s*LEVELS\s*$/i.test(lines[i]) || /^\s*=+\s*$/.test(lines[i])) {
                continue;
            }
            if (lines[i].trim() === '' || /^\s*message\b/i.test(lines[i])) {
                continue;
            }
            lines[i] = lines[i] + '.';
            return { source: lines.join('\n'), detail: 'appended . to a level row' };
        }
        return null;
    });
}

function messageSandwich(source) {
    return mutateSection(source, 'LEVELS', function(body) {
        const lines = body.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i === 0 || /^\s*LEVELS\s*$/i.test(lines[i]) || /^\s*=+\s*$/.test(lines[i])) {
                continue;
            }
            if (lines[i].trim() === '' || /^\s*message\b/i.test(lines[i])) {
                continue;
            }
            lines.splice(i, 0, 'message garden sandwich');
            return { source: lines.join('\n'), detail: 'inserted a message before a map' };
        }
        return null;
    });
}

function ruleCanTakeMessage(line) {
    if (line.indexOf('->') < 0) {
        return false;
    }
    const close = line.lastIndexOf(']');
    if (close < 0) {
        return false;
    }
    return line.slice(close + 1).trim() === '';
}

function isMapBlock(block) {
    for (let i = 0; i < block.length; i++) {
        const trimmed = block[i].trim();
        if (trimmed !== '' && !/^\s*message\b/i.test(block[i])) {
            return true;
        }
    }
    return false;
}

function appendNaughtyRuleMessage(source, rng) {
    const payload = NAUGHTY_STRINGS[rng.integer(NAUGHTY_STRINGS.length)];
    return mutateSection(source, 'RULES', function(body) {
        const found = arrowRuleIndexes(body);
        const eligible = [];
        for (let i = 0; i < found.indexes.length; i++) {
            const index = found.indexes[i];
            if (ruleCanTakeMessage(found.lines[index])) {
                eligible.push(index);
            }
        }
        if (eligible.length === 0) {
            return null;
        }
        const index = eligible[rng.integer(eligible.length)];
        found.lines[index] = found.lines[index].replace(/\s+$/, '') + ' message ' + payload;
        return {
            source: found.lines.join('\n'),
            detail: 'appended a naughty message to a rule'
        };
    });
}

function insertNaughtyLevelMessage(source, rng) {
    const payload = NAUGHTY_STRINGS[rng.integer(NAUGHTY_STRINGS.length)];
    return mutateSection(source, 'LEVELS', function(body) {
        const parsed = sectionBlocks(body);
        const mapIndexes = [];
        for (let i = 0; i < parsed.blocks.length; i++) {
            if (isMapBlock(parsed.blocks[i])) {
                mapIndexes.push(i);
            }
        }
        if (mapIndexes.length < 2) {
            return null;
        }
        const gap = rng.integer(mapIndexes.length - 1);
        const blocks = parsed.blocks.slice();
        blocks.splice(mapIndexes[gap] + 1, 0, ['message ' + payload]);
        let out = parsed.header.slice();
        for (let i = 0; i < blocks.length; i++) {
            out.push('');
            out = out.concat(blocks[i]);
        }
        out.push('');
        return {
            source: out.join('\n'),
            detail: 'inserted a naughty message between maps'
        };
    });
}

function injectNastyMessage(source, rng) {
    const withRule = appendNaughtyRuleMessage(source, rng);
    const base = withRule ? withRule.source : source;
    const withLevel = insertNaughtyLevelMessage(base, rng);
    if (!withRule && !withLevel) {
        return null;
    }
    const parts = [];
    if (withRule) {
        parts.push(withRule.detail);
    }
    if (withLevel) {
        parts.push(withLevel.detail);
    }
    return {
        source: withLevel ? withLevel.source : withRule.source,
        detail: parts.join('; ')
    };
}

function commentEatSection(source) {
    const section = findSection(source, 'LEGEND') || findSection(source, 'RULES');
    if (!section) {
        return null;
    }
    const lines = source.split('\n');
    lines[section.start] = '(' + lines[section.start];
    return {
        source: lines.join('\n'),
        detail: 'comment ate ' + section.name
    };
}

function duplicateSection(source, rng) {
    const found = [];
    for (let i = 0; i < SECTION_NAMES.length; i++) {
        const section = findSection(source, SECTION_NAMES[i]);
        if (section) {
            found.push(section);
        }
    }
    if (found.length === 0) {
        return null;
    }
    const section = found[rng.integer(found.length)];
    const lines = source.split('\n');
    const block = lines.slice(section.start, section.end);
    lines.splice(section.end, 0, ...block);
    return { source: lines.join('\n'), detail: 'duplicated section ' + section.name };
}

function nudgeInput(source, rng, fixture) {
    const extras = NUDGE_INPUT_CHOICES;
    const inputs = ((fixture && fixture.inputs) || []).slice();
    if (inputs.length === 0) {
        inputs.push(extras[rng.integer(extras.length)]);
    } else {
        const index = rng.integer(inputs.length);
        const current = inputs[index];
        const choices = extras.filter(function(choice) { return choice !== current; });
        inputs[index] = choices[rng.integer(choices.length)];
    }
    return {
        source: source,
        detail: 'nudged inputs to ' + JSON.stringify(inputs),
        inputs: inputs
    };
}

function offByOneLevel(source, rng, fixture) {
    const level = fixture && Number.isInteger(fixture.level) ? fixture.level : 0;
    const next = rng.integer(2) === 0 ? level + 1 : level - 1;
    return { source: source, detail: 'level ' + level + ' -> ' + next, level: next };
}

function seedPoison(source, rng) {
    const seed = POISON_SEEDS[rng.integer(POISON_SEEDS.length)];
    return { source: source, detail: 'poisoned engine seed', randomSeed: seed };
}

function prefixChop(source, rng, fixture) {
    const inputs = ((fixture && fixture.inputs) || []).slice();
    if (inputs.length < 2) {
        return null;
    }
    const keep = 1 + rng.integer(inputs.length - 1);
    return {
        source: source,
        detail: 'chopped inputs to length ' + keep,
        inputs: inputs.slice(0, keep)
    };
}

// Background and Player are structurally required by the engine, so renaming
// either breaks the game and every resulting hit would be noise.
const UNRENAMEABLE = ['background', 'player'];

// The exact closed vocabulary of PuzzleScript color keywords (languageConstants.js
// reg_color). Games commonly name objects after colors ("White", "Black",
// "Red" chess pieces and the like); an object's own color list can legally
// reuse the same word as a *different* object's color (e.g. object "White"
// exists, and object "Alice"'s color list also says "... White ..." to mean
// the literal colour, not the object). A \b-anchored rename cannot tell those
// two uses apart, so renaming a color-named object silently corrupts an
// unrelated object's color declaration. Measured on the real corpus fixture
// "gallery game: mad queens": renaming object "White" turned another
// object's "Blue Brown White Yellow" color line into "...WhiteRenamed...",
// which the parser then rejects.
const COLOR_NAMES = [
    'black', 'white', 'gray', 'darkgray', 'lightgray',
    'grey', 'darkgrey', 'lightgrey',
    'red', 'darkred', 'lightred',
    'brown', 'darkbrown', 'lightbrown',
    'orange', 'yellow',
    'green', 'darkgreen', 'lightgreen',
    'blue', 'lightblue', 'darkblue',
    'purple', 'pink', 'transparent'
];

function objectNamesIn(source) {
    const section = findSection(source, 'OBJECTS');
    if (!section) {
        return [];
    }
    const body = section.lines.slice(section.start, section.end).join('\n');
    const parsed = sectionBlocks(body);
    const names = [];
    for (let i = 0; i < parsed.blocks.length; i++) {
        const first = parsed.blocks[i][0].trim().split(/\s+/)[0];
        if (/^[A-Za-z][A-Za-z0-9_]*$/.test(first)) {
            names.push(first);
        }
    }
    return names;
}

function renameObject(source, rng) {
    const names = objectNamesIn(source).filter(function(name) {
        // A one-character object name is auto-registered by the parser as its
        // own LEVELS glyph with no LEGEND entry required (parser.js populates
        // state.abbrevNames from any object/legend key of length 1 when the
        // LEVELS section begins). Renaming it removes that auto-glyph even
        // though we never touch the grid text itself, so any row still using
        // the bare character becomes an unresolvable symbol at compile time.
        // Only multi-character names -- which can never appear as a level
        // glyph on their own -- are safe to rename. Names that double as a
        // PuzzleScript color keyword are excluded too: see COLOR_NAMES above.
        return UNRENAMEABLE.indexOf(name.toLowerCase()) < 0
            && name.length > 1
            && COLOR_NAMES.indexOf(name.toLowerCase()) < 0;
    });
    if (names.length === 0) {
        return null;
    }
    const oldName = names[rng.integer(names.length)];
    const newName = oldName + 'Renamed';
    if (new RegExp('\\b' + newName + '\\b', 'i').test(source)) {
        return null;
    }
    // Defense in depth: even though only multi-character names reach here,
    // still leave LEVELS lines untouched so a rename can never rewrite grid
    // content under any future relaxation of the length filter above.
    const levels = findSection(source, 'LEVELS');
    const re = new RegExp('\\b' + oldName + '\\b', 'gi');
    const lines = source.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
        if (levels && i >= levels.start && i < levels.end) {
            continue;
        }
        const replaced = lines[i].replace(re, newName);
        if (replaced !== lines[i]) {
            changed = true;
        }
        lines[i] = replaced;
    }
    if (!changed) {
        return null;
    }
    const renames = {};
    renames[newName] = oldName;
    return {
        source: lines.join('\n'),
        detail: 'renamed ' + oldName + ' to ' + newName,
        equivalenceContext: { renames: renames }
    };
}

// A PuzzleScript "(...)" comment nests (parser.js tracks state.commentLevel,
// incrementing on every '(' and decrementing on every ')', regardless of
// blank lines in between) and can legally span several blank-line-separated
// blocks -- the real corpus fixture "Rigidbody fix bug #246" has one that
// opens at "(AHBlock" and does not close until four blocks later at
// ".000.)". sectionBlocks splits purely on blank lines with no awareness of
// comment nesting, so reorderObjects could swap the block containing the
// opening '(' away from the block containing the matching ')', silently
// commenting out every object in between. Refusing whenever any line of the
// OBJECTS body ends with the comment still open is conservative (it also
// forbids reordering when a *single* block contains an unclosed multi-line
// comment, not just ones that span a blank line) but it is simple, requires
// no change to sectionBlocks (which objectNamesIn and other mutators also
// rely on), and is cheap: measured cost is refusing on 19 of 388 eligible
// corpus fixtures (4.9%).
function objectsBodyHasUnbalancedComment(body) {
    const lines = body.split('\n');
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (let j = 0; j < line.length; j++) {
            const ch = line.charAt(j);
            if (ch === '(') {
                depth++;
            } else if (ch === ')' && depth > 0) {
                depth--;
            }
        }
        if (depth > 0) {
            return true;
        }
    }
    return false;
}

function reorderObjects(source, rng) {
    return mutateSection(source, 'OBJECTS', function(body) {
        if (objectsBodyHasUnbalancedComment(body)) {
            return null;
        }
        const parsed = sectionBlocks(body);
        if (parsed.blocks.length < 2) {
            return null;
        }
        const blocks = parsed.blocks.slice();
        const a = rng.integer(blocks.length);
        let b = rng.integer(blocks.length);
        if (a === b) {
            b = (b + 1) % blocks.length;
        }
        const swap = blocks[a];
        blocks[a] = blocks[b];
        blocks[b] = swap;
        let out = parsed.header.slice();
        for (let i = 0; i < blocks.length; i++) {
            out.push('');
            out = out.concat(blocks[i]);
        }
        out.push('');
        return {
            source: out.join('\n'),
            detail: 'swapped object blocks ' + a + ' and ' + b
        };
    });
}

function reorderSectionLines(sectionName, label, isMember, options) {
    return function(source, rng) {
        return mutateSection(source, sectionName, function(body) {
            const lines = body.split('\n');
            if (options && options.refuseUnbalancedComments) {
                const memberBody = [];
                for (let i = 0; i < lines.length; i++) {
                    if (isMember(lines[i])) {
                        memberBody.push(lines[i]);
                    }
                }
                if (objectsBodyHasUnbalancedComment(memberBody.join('\n'))) {
                    return null;
                }
            }
            const indexes = [];
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (trimmed === '' || /^=+$/.test(trimmed)) {
                    continue;
                }
                if (SECTION_NAMES.indexOf(trimmed.toUpperCase()) >= 0) {
                    continue;
                }
                // findSection matches a section header by exact line equality,
                // so a fixture whose next header is malformed (e.g. "LEVELS("
                // instead of "LEVELS") makes this "section" run on into
                // whatever follows, including level rows. Requiring each
                // swapped line to look like a real member of this section is
                // what keeps that overrun from corrupting unrelated content;
                // findSection itself is left alone since other code depends
                // on its exact-match behaviour.
                if (!isMember(lines[i])) {
                    continue;
                }
                indexes.push(i);
            }
            if (indexes.length < 2) {
                return null;
            }
            const first = rng.integer(indexes.length);
            let second = rng.integer(indexes.length);
            if (first === second) {
                second = (second + 1) % indexes.length;
            }
            const a = indexes[first];
            const b = indexes[second];
            const next = lines.slice();
            const swap = next[a];
            next[a] = next[b];
            next[b] = swap;
            return {
                source: next.join('\n'),
                detail: 'swapped ' + label + ' lines ' + a + ' and ' + b
            };
        });
    };
}

function inlineLegendSynonym(source, rng) {
    const section = findSection(source, 'LEGEND');
    if (!section) {
        return null;
    }
    const lines = section.lines.slice();
    const candidates = [];
    for (let i = section.start; i < section.end; i++) {
        const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(lines[i]);
        // "Player = LowPlayer" is a standard PuzzleScript idiom: Player is the
        // alias, not the target. Blanking that definition line would delete
        // the game's only Player declaration, same reasoning as UNRENAMEABLE
        // above for rename-object.
        if (match && match[1].length > 1 && UNRENAMEABLE.indexOf(match[1].toLowerCase()) < 0) {
            candidates.push({ index: i, alias: match[1], target: match[2] });
        }
    }
    if (candidates.length === 0) {
        return null;
    }
    const pick = candidates[rng.integer(candidates.length)];
    // Blanking rather than deleting keeps the mutant line-aligned with the
    // fixture, which is what lets shrinkEquivalencePair reduce the pair.
    lines[pick.index] = '';
    // PuzzleScript identifiers are case-insensitive (the parser lower-cases
    // every token before resolving names), so a reference elsewhere in the
    // source can use different casing than the alias's own definition --
    // e.g. LEGEND defines "playerbody = Playerbody_main" but a RULES line
    // references "Playerbody" (capital P). A case-sensitive \b-anchored
    // replace (the bare 'g' flag) does not touch that reference, so once the
    // definition line is blanked the reference is left dangling. This is the
    // exact hazard commit 24b9abf9 already fixed for the sibling
    // rename-object mutator by switching to the 'gi' flag; it was missed
    // here. Measured on the real corpus fixture "Neoprenanzieher": inlining
    // "playerbody" left "Playerbody" unresolved and produced a false
    // equivalence-break ("You're talking about PLAYERBODY but it's not
    // defined anywhere.").
    const re = new RegExp('\\b' + pick.alias + '\\b', 'gi');
    // Defense in depth, mirroring rename-object: never touch LEVELS lines.
    // pick.alias is always longer than one character (the candidate filter
    // above requires it), so it can never itself be a level glyph, but
    // skipping LEVELS keeps this mutator safe against grid content under any
    // future relaxation of that filter, exactly as rename-object documents.
    const levels = findSection(source, 'LEVELS');
    for (let i = 0; i < lines.length; i++) {
        if (levels && i >= levels.start && i < levels.end) {
            continue;
        }
        lines[i] = lines[i].replace(re, pick.target);
    }
    const next = lines.join('\n');
    if (next === source) {
        return null;
    }
    return {
        source: next,
        detail: 'inlined legend synonym ' + pick.alias + ' to ' + pick.target
    };
}

function addLegendAlias(source, rng) {
    const alias = 'GardenAlias';
    if (new RegExp('\\b' + alias + '\\b', 'i').test(source)) {
        return null;
    }
    const names = objectNamesIn(source).filter(function(name) {
        return UNRENAMEABLE.indexOf(name.toLowerCase()) < 0;
    });
    if (names.length === 0) {
        return null;
    }
    const target = names[rng.integer(names.length)];
    const withAlias = mutateSection(source, 'LEGEND', function(body) {
        return {
            source: body.replace(/\s*$/, '') + '\n' + alias + ' = ' + target + '\n',
            detail: ''
        };
    });
    if (!withAlias) {
        return null;
    }
    const routeThrough = function(sectionName) {
        return mutateSection(withAlias.source, sectionName, function(body) {
            const re = new RegExp('\\b' + target + '\\b');
            if (!re.test(body)) {
                return null;
            }
            return { source: body.replace(re, alias), detail: '' };
        });
    };
    // Prefer routing through RULES, since that is what the mutator is meant to
    // probe, but fall back to WINCONDITIONS: a target's OBJECTS name does not
    // always appear literally in RULES (it may only be reachable there through
    // a legend synonym), while WINCONDITIONS references object names directly.
    const routed = routeThrough('RULES') || routeThrough('WINCONDITIONS');
    if (!routed) {
        return null;
    }
    return {
        source: routed.source,
        detail: 'aliased ' + target + ' as ' + alias
    };
}

function addUnreachableRule(source) {
    const name = 'GardenGhost';
    if (new RegExp('\\b' + name + '\\b', 'i').test(source)) {
        return null;
    }
    const withObject = mutateSection(source, 'OBJECTS', function(body) {
        return {
            source: body.replace(/\s*$/, '') + '\n\n' + name + '\ntransparent\n',
            detail: ''
        };
    });
    if (!withObject) {
        return null;
    }
    const withLayer = mutateSection(withObject.source, 'COLLISIONLAYERS', function(body) {
        return { source: body.replace(/\s*$/, '') + '\n' + name + '\n', detail: '' };
    });
    if (!withLayer) {
        return null;
    }
    const withRule = mutateSection(withLayer.source, 'RULES', function(body) {
        return { source: body.replace(/\s*$/, '') + '\n[ ' + name + ' ] -> [ ]\n', detail: '' };
    });
    if (!withRule) {
        return null;
    }
    return {
        source: withRule.source,
        detail: 'added an unreachable rule for ' + name
    };
}

// A trailing line comment is invisible to the rule parser: '(' starts a comment
// that runs to end of line, so it must come after the finished rule. Putting
// '(' inside the brackets eats the rest of the line, including `->`.
// `message` is different: it copies the rest of the original line into the
// message text, so `(garden)` would show up on screen rather than commenting.
function commentReflow(source, rng) {
    return mutateSection(source, 'RULES', function(body) {
        const found = arrowRuleIndexes(body);
        const candidates = [];
        for (let i = 0; i < found.indexes.length; i++) {
            const index = found.indexes[i];
            if (!/\bmessage\b/i.test(found.lines[index])) {
                candidates.push(index);
            }
        }
        if (candidates.length === 0) {
            return null;
        }
        const index = candidates[rng.integer(candidates.length)];
        found.lines[index] = found.lines[index].replace(/\s+$/, '') + ' (garden)';
        return {
            source: found.lines.join('\n'),
            detail: 'inserted a comment after a rule'
        };
    });
}

function scrambleCase(source, rng) {
    let out = '';
    let changed = false;
    for (let i = 0; i < source.length; i++) {
        const code = source.charCodeAt(i);
        if (code >= 65 && code <= 90) {
            if (rng.integer(2) === 0) {
                out += String.fromCharCode(code + 32);
                changed = true;
            } else {
                out += source.charAt(i);
            }
        } else if (code >= 97 && code <= 122) {
            if (rng.integer(2) === 0) {
                out += String.fromCharCode(code - 32);
                changed = true;
            } else {
                out += source.charAt(i);
            }
        } else {
            out += source.charAt(i);
        }
    }
    if (!changed) {
        return null;
    }
    return { source: out, detail: 'scrambled ASCII letter case' };
}

// Issues #1169, #1136, #1071, #762: an object negated in a cell that also
// contains it. injectNo never produces this contradiction.
function noXWithX(source, rng) {
    return mutateRuleCell(source, rng, function(cellText, cellRng) {
        const objects = cellObjectNames(cellText);
        if (objects.length === 0) {
            return null;
        }
        const object = objects[cellRng.integer(objects.length)];
        const twice = cellRng.integer(2) === 0;
        const addition = twice ? ' no ' + object + ' no ' + object : ' no ' + object;
        return {
            text: cellText.replace(/\s*$/, '') + addition + ' ',
            detail: 'negated ' + object + ' beside itself' + (twice ? ' twice' : '')
        };
    });
}

const RELATIVE_DIRECTIONS = [
    'perpendicular', 'parallel', 'vertical', 'horizontal',
    'orthogonal', 'moving', 'stationary'
];

// Issues #682, #498, #496, #941: relative qualifiers on individual cell objects.
function relativeDirectionCell(source, rng) {
    return mutateRuleCell(source, rng, function(cellText, cellRng) {
        const objects = cellObjectNames(cellText);
        if (objects.length === 0) {
            return null;
        }
        const object = objects[cellRng.integer(objects.length)];
        const qualifier = RELATIVE_DIRECTIONS[cellRng.integer(RELATIVE_DIRECTIONS.length)];
        const next = cellText.replace(new RegExp('\\b' + object + '\\b'), qualifier + ' ' + object);
        if (next === cellText) {
            return null;
        }
        return { text: next, detail: 'qualified ' + object + ' with ' + qualifier };
    });
}

// Issues #735, #605, #734: a rule cell demanding two objects that can never
// overlap. layerDoubleBook only edits the COLLISIONLAYERS section.
function sameLayerCell(source, rng) {
    const section = findSection(source, 'COLLISIONLAYERS');
    if (!section) {
        return null;
    }
    const pairs = [];
    for (let i = section.start; i < section.end; i++) {
        const trimmed = section.lines[i].trim();
        if (trimmed === '' || /^=+$/.test(trimmed) || trimmed.toUpperCase() === 'COLLISIONLAYERS') {
            continue;
        }
        const parts = trimmed.split(',').map(function(part) {
            return part.trim();
        }).filter(function(part) {
            return /^[A-Za-z][A-Za-z0-9_]*$/.test(part);
        });
        for (let a = 0; a < parts.length; a++) {
            for (let b = a + 1; b < parts.length; b++) {
                pairs.push([parts[a], parts[b]]);
            }
        }
    }
    if (pairs.length === 0) {
        return null;
    }
    const pair = pairs[rng.integer(pairs.length)];
    return mutateRuleCell(source, rng, function() {
        return {
            text: ' ' + pair[0] + ' ' + pair[1] + ' ',
            detail: 'same-layer ' + pair[0] + ' and ' + pair[1] + ' in one cell'
        };
    });
}

// Issues #929, #495, #812, #824: a property or aggregate where a concrete
// object is required. Generalises background-as-aggregate and sound-on-property.
//
// Candidates are harvested from DECLARED names only (objectNamesIn's OBJECTS
// scan plus multi-character LEGEND keys) rather than by tokenizing whatever
// text happens to sit in the target section body. An earlier version
// tokenized the section body directly and only excluded SECTION_NAMES
// keywords; that let rule flags like "again" and WINCONDITIONS words like
// "all"/"on" through as "victims", diluting the mutation away from the
// #929-shaped construct (a genuine object/alias reference replaced by a
// property) into generic syntax noise indistinguishable from what
// delete-rule-punctuation etc. already cover.
function propertyInConcreteSlot(source, rng) {
    const section = findSection(source, 'LEGEND');
    if (!section) {
        return null;
    }
    const properties = [];
    const legendKeys = [];
    for (let i = section.start; i < section.end; i++) {
        const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(section.lines[i]);
        if (match && match[1].length > 1) {
            legendKeys.push(match[1]);
            if (/\bor\b/i.test(match[2])) {
                properties.push(match[1]);
            }
        }
    }
    if (properties.length === 0) {
        return null;
    }
    const property = properties[rng.integer(properties.length)];
    const declared = objectNamesIn(source).concat(legendKeys).filter(function(name) {
        return name.toLowerCase() !== property.toLowerCase();
    });
    if (declared.length === 0) {
        return null;
    }
    const targets = ['RULES', 'WINCONDITIONS', 'SOUNDS', 'COLLISIONLAYERS'];
    for (let i = targets.length - 1; i > 0; i--) {
        const j = rng.integer(i + 1);
        const swap = targets[i];
        targets[i] = targets[j];
        targets[j] = swap;
    }
    for (let i = 0; i < targets.length; i++) {
        const applied = mutateSection(source, targets[i], function(body) {
            // The candidate's casing comes from its OBJECTS/LEGEND
            // declaration, not from this section body -- PuzzleScript
            // identifiers are case-insensitive, so a RULES/WINCONDITIONS/
            // SOUNDS/COLLISIONLAYERS reference to a declared name can
            // legitimately use different casing than the declaration. Both
            // the presence check and the replace must therefore be
            // case-insensitive ('i' flag), or a same-casing-only match would
            // silently skip real, differently-cased references.
            const present = declared.filter(function(name) {
                return new RegExp('\\b' + name + '\\b', 'i').test(body);
            });
            if (present.length === 0) {
                return null;
            }
            const victim = present[rng.integer(present.length)];
            const re = new RegExp('\\b' + victim + '\\b', 'i');
            return {
                source: body.replace(re, property),
                detail: 'replaced ' + victim + ' with property ' + property + ' in ' + targets[i]
            };
        });
        if (applied) {
            return applied;
        }
    }
    return null;
}

// Issues #952, #1118, #869: rigid bodies. directionPrefixSalad only ever emits
// rigid alongside three other qualifiers, so it never isolates rigid behaviour.
// late rigid is unconditionally invalid PuzzleScript ("Late rules cannot be
// marked as rigid"), regardless of rule content, so it never isolates rigid
// behaviour by itself; it is still worth keeping to check the known-invalid
// combination stays a clean diagnostic rather than a crash. Issue #952
// ("rigid disablement applies to whole rule-groups") is covered by the
// rule-group mode instead.
function rigidPrefix(source, rng) {
    return mutateArrowRule(source, rng, function(line, ruleRng) {
        const mode = ruleRng.integer(3);
        if (mode === 0) {
            return { line: 'rigid ' + line, detail: 'prefixed rigid' };
        }
        if (mode === 1) {
            return { line: '+ rigid ' + line, detail: 'prefixed + rigid (rule group)' };
        }
        // mode === 2: late rigid. Guard matches directionPrefixSalad's late
        // guard above: don't double up 'late' on a rule that already begins
        // with it.
        if (/^\s*late\b/i.test(line)) {
            return { line: 'rigid ' + line, detail: 'prefixed rigid' };
        }
        return { line: 'late rigid ' + line, detail: 'prefixed late rigid' };
    });
}

// Issues #973, #927: sprites that are not 5x5. spriteMatrixNoise only flips
// pixels and never changes the shape.
function spriteMatrixResize(source, rng) {
    return mutateSection(source, 'OBJECTS', function(body) {
        const lines = body.split('\n');
        const indexes = [];
        for (let i = 0; i < lines.length; i++) {
            if (/^[0-9.]{2,}$/.test(lines[i].trim())) {
                indexes.push(i);
            }
        }
        if (indexes.length === 0) {
            return null;
        }
        const index = indexes[rng.integer(indexes.length)];
        const next = lines.slice();
        const mode = rng.integer(3);
        let detail;
        if (mode === 0) {
            next.splice(index, 1);
            detail = 'dropped a sprite matrix row';
        } else if (mode === 1) {
            next.splice(index, 0, next[index]);
            detail = 'duplicated a sprite matrix row';
        } else {
            next[index] = next[index].replace(/\s*$/, '') + '0';
            detail = 'widened a sprite matrix row';
        }
        return { source: next.join('\n'), detail: detail };
    });
}

const TURN_COMMANDS = ['again', 'restart', 'checkpoint', 'win', 'cancel'];

// Issues #774, #981, #341: restart, again and message interacting. The garden
// has inject-again-loop and message-sandwich but never combines them, and never
// puts a restart in the tape alongside them.
function restartAgainMessage(source, rng, fixture) {
    const command = TURN_COMMANDS[rng.integer(TURN_COMMANDS.length)];
    const applied = mutateArrowRule(source, rng, function(line) {
        return {
            line: line + ' ' + command + ' message garden',
            detail: 'appended ' + command + ' and a message'
        };
    });
    if (!applied) {
        return null;
    }
    const inputs = (fixture && fixture.inputs ? fixture.inputs : []).slice();
    inputs.splice(rng.integer(inputs.length + 1), 0, 'restart');
    return {
        source: applied.source,
        detail: applied.detail + ' with a restart in the tape',
        inputs: inputs
    };
}

// Issues #1012, #1002, #980: behaviour that only appears with several errors at
// once. Every other mutator injects exactly one fault, so the error-count
// thresholds are otherwise unreachable. Mutators that declare equivalence are
// excluded: mixing a damaging mutation into a preserving one leaves a program
// that is neither, with nothing meaningful to assert about it.
function multiFault(source, rng, fixture, context) {
    const pool = mutators.filter(function(mutator) {
        return !mutator.equivalence && mutator.name !== 'multi-fault';
    });
    if (pool.length === 0) {
        return null;
    }
    // Stacking does not accumulate errors without bound: loadFile aborts at
    // `errorCount > MAX_ERRORS` (5) in compiler.js, so error counts saturate
    // around 6 no matter how deep the stack goes. Measured: a stack of 3 gives
    // a median of 2 errors, while stacks of 25, 60, 120 and 200 all give 6.
    // The burst therefore aims at the compile-abort branch, which one or two
    // faults rarely reach, rather than at parser.js's MAX_ERRORS_FOR_REAL of
    // 100 — that threshold is unreachable through compilation at all.
    const wanted = rng.integer(4) === 0 ? 12 + rng.integer(17) : 2 + rng.integer(3);
    const names = [];
    let current = source;
    let inputs = fixture && fixture.inputs ? fixture.inputs : undefined;
    for (let attempt = 0; attempt < wanted * 4 && names.length < wanted; attempt++) {
        const mutator = pool[rng.integer(pool.length)];
        const job = Object.assign({}, fixture, { source: current, inputs: inputs });
        let applied;
        try {
            applied = mutator.apply(current, rng, job, context);
        } catch (error) {
            continue;
        }
        if (!applied || applied.source === current) {
            continue;
        }
        current = applied.source;
        if (applied.inputs) {
            inputs = applied.inputs;
        }
        names.push(mutator.name);
    }
    if (names.length < 2) {
        return null;
    }
    const result = { source: current, detail: 'applied ' + names.join(' + ') };
    if (inputs) {
        result.inputs = inputs;
    }
    return result;
}

// Issue #1128: a parenthetical inside a rule. compiler.js rejects this on
// purpose ("You can't have comments inside rules, sorry") because '(' starts a
// comment and would otherwise swallow the rest of the line including the arrow.
// That rejection IS #1128's fix, so this mutator checks it stays a clean error
// rather than becoming a crash. Distinct from comment-reflow, which appends a
// legal comment after the finished rule and must preserve meaning.
function commentInRule(source, rng) {
    return mutateArrowRule(source, rng, function(line) {
        const bracket = line.indexOf('[');
        if (bracket < 0) {
            return null;
        }
        return {
            line: line.slice(0, bracket + 1) + ' (garden)' + line.slice(bracket + 1),
            detail: 'inserted a comment inside a rule'
        };
    });
}

// Crossover: union a real game from the donor pool into the fixture. Where both
// declare the same name the donor's declaration is skipped, so the donor's rules
// rebind to the fixture's objects — a valid game with foreign semantics. Merging
// also grows the object table and layer list, crossing the 32-object STRIDE_OBJ
// and 5-layer STRIDE_MOV boundaries in compiler.js.
function mergeGame(source, rng, fixture, context) {
    if (!context || !context.donors || context.donors.length === 0) {
        return null;
    }
    const donorPath = context.donors[rng.integer(context.donors.length)];
    let donor;
    try {
        donor = context.readDonor(donorPath);
    } catch (error) {
        return null;
    }
    const merged = mergeGames(source, donor, rng);
    if (!merged) {
        return null;
    }
    return {
        source: merged.source,
        detail: merged.detail + ' (' + path.basename(donorPath) + ')'
    };
}

function shuffleInPlace(items, rng) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = rng.integer(i + 1);
        const swap = items[i];
        items[i] = items[j];
        items[j] = swap;
    }
    return items;
}

// Rule order is semantically significant in PuzzleScript, so this changes
// behaviour. It reaches rule-group formation and startLoop/endLoop pairing,
// which startloop-mismatch only pokes crudely.
function shuffleRules(source, rng) {
    return mutateSection(source, 'RULES', function(body) {
        const found = arrowRuleIndexes(body);
        if (found.indexes.length < 2) {
            return null;
        }
        const picked = found.indexes.slice();
        const contents = picked.map(function(index) { return found.lines[index]; });
        shuffleInPlace(contents, rng);
        let changed = false;
        for (let i = 0; i < picked.length; i++) {
            if (found.lines[picked[i]] !== contents[i]) {
                changed = true;
            }
            found.lines[picked[i]] = contents[i];
        }
        if (!changed) {
            return null;
        }
        return { source: found.lines.join('\n'), detail: 'shuffled ' + picked.length + ' rule lines' };
    });
}

function shuffleLevels(source, rng) {
    return mutateSection(source, 'LEVELS', function(body) {
        const parsed = sectionBlocks(body);
        if (parsed.blocks.length === 0) {
            return null;
        }
        const blocks = parsed.blocks.map(function(block) { return block.slice(); });
        let detail;
        if (blocks.length > 1 && rng.integer(2) === 0) {
            shuffleInPlace(blocks, rng);
            detail = 'permuted ' + blocks.length + ' levels';
        } else {
            const index = rng.integer(blocks.length);
            if (blocks[index].length < 2) {
                return null;
            }
            shuffleInPlace(blocks[index], rng);
            detail = 'scrambled the rows of level ' + index;
        }
        let out = parsed.header.slice();
        for (let i = 0; i < blocks.length; i++) {
            out.push('');
            out = out.concat(blocks[i]);
        }
        out.push('');
        const next = out.join('\n');
        if (next === body) {
            return null;
        }
        return { source: next, detail: detail };
    });
}

const mutators = [
    { name: 'delete-rule-punctuation', apply: deleteRulePunctuation },
    { name: 'duplicate-rule-punctuation', apply: duplicateRulePunctuation },
    { name: 'swap-legend-operator', apply: swapLegendOperator },
    { name: 'invalid-viewport', apply: invalidViewport },
    { name: 'duplicate-rule-command', apply: duplicateRuleCommand },
    { name: 'legend-cycle', apply: legendCycle },
    { name: 'swap-sections', apply: swapSections },
    { name: 'odd-whitespace', apply: oddWhitespace },
    { name: 'unterminated-comment', apply: unterminatedComment },
    { name: 'duplicate-rule-line', apply: duplicateRuleLine },
    { name: 'swap-object-colors', apply: swapObjectColors },
    { name: 'nudge-level-cell', apply: nudgeLevelCell },
    { name: 'flip-win-quantifier', apply: flipWinQuantifier },
    { name: 'blns-slot', apply: blnsSlot },
    { name: 'keyword-as-name', apply: keywordAsName },
    { name: 'orphan-legend-member', apply: orphanLegendMember },
    { name: 'inject-ellipsis', apply: injectEllipsis },
    { name: 'inject-no', apply: injectNo },
    { name: 'inject-control-char', apply: injectControlChar },
    { name: 'sprite-matrix-noise', apply: spriteMatrixNoise },
    { name: 'duplicate-object-name', apply: duplicateObjectName },
    { name: 'case-flip-name', apply: caseFlipName },
    { name: 'layer-drop', apply: layerDrop },
    { name: 'layer-double-book', apply: layerDoubleBook },
    { name: 'background-as-aggregate', apply: backgroundAsAggregate },
    { name: 'sound-on-property', apply: soundOnProperty },
    { name: 'win-on-undefined', apply: winOnUndefined },
    { name: 'empty-cell-row', apply: emptyCellRow },
    { name: 'command-on-lhs', apply: commandOnLhs },
    { name: 'group-plus', apply: groupPlus },
    { name: 'startloop-mismatch', apply: startloopMismatch },
    { name: 'direction-prefix-salad', apply: directionPrefixSalad },
    { name: 'inject-again-loop', apply: injectAgainLoop },
    { name: 'inject-random-fill', apply: injectRandomFill },
    { name: 'prelude-injection', apply: preludeInjection },
    { name: 'ragged-level', apply: raggedLevel },
    { name: 'message-sandwich', apply: messageSandwich },
    { name: 'inject-nasty-message', apply: injectNastyMessage },
    { name: 'comment-eat-section', apply: commentEatSection },
    { name: 'duplicate-section', apply: duplicateSection },
    { name: 'nudge-input', apply: nudgeInput },
    { name: 'off-by-one-level', apply: offByOneLevel },
    { name: 'seed-poison', apply: seedPoison },
    { name: 'prefix-chop', apply: prefixChop },
    {
        name: 'rename-object',
        apply: renameObject,
        equivalence: 'board',
        normalise: normaliseBoardNames
    },
    { name: 'reorder-objects', apply: reorderObjects, equivalence: 'board' },
    {
        name: 'reorder-winconditions',
        apply: reorderSectionLines('WINCONDITIONS', 'wincondition', function(line) {
            return /^\s*(all|any|no|some)\b/i.test(line);
        }),
        equivalence: 'full'
    },
    {
        name: 'reorder-sounds',
        apply: reorderSectionLines('SOUNDS', 'sound', function(line) {
            return /\d/.test(line);
        }, { refuseUnbalancedComments: true }),
        equivalence: 'full'
    },
    { name: 'inline-legend-synonym', apply: inlineLegendSynonym, equivalence: 'full' },
    {
        name: 'add-legend-alias',
        apply: addLegendAlias,
        // Inserting a LEGEND line shifts every later line number, and
        // errorStrings embed "line N" / jumpToLine(N) text that the 'full'
        // fingerprint compares verbatim, so a harmless insertion looks like a
        // divergence there even though the board is untouched.
        equivalence: 'board'
    },
    { name: 'add-unreachable-rule', apply: addUnreachableRule, equivalence: 'board' },
    { name: 'comment-reflow', apply: commentReflow, equivalence: 'full' },
    { name: 'scramble-case', apply: scrambleCase, equivalence: 'board' },
    { name: 'no-x-with-x', apply: noXWithX },
    { name: 'relative-direction-cell', apply: relativeDirectionCell },
    { name: 'same-layer-cell', apply: sameLayerCell },
    { name: 'property-in-concrete-slot', apply: propertyInConcreteSlot },
    { name: 'rigid-prefix', apply: rigidPrefix },
    { name: 'sprite-matrix-resize', apply: spriteMatrixResize },
    { name: 'restart-again-message', apply: restartAgainMessage },
    { name: 'multi-fault', apply: multiFault },
    { name: 'comment-in-rule', apply: commentInRule },
    { name: 'merge-game', apply: mergeGame },
    { name: 'shuffle-rules', apply: shuffleRules },
    { name: 'shuffle-levels', apply: shuffleLevels }
];

function mutationChangedJob(applied, fixture) {
    if (!applied) {
        return false;
    }
    if (applied.source !== fixture.source) {
        return true;
    }
    if (applied.inputs && JSON.stringify(applied.inputs) !== JSON.stringify(fixture.inputs || [])) {
        return true;
    }
    if (applied.level !== undefined && applied.level !== fixture.level) {
        return true;
    }
    if (applied.randomSeed !== undefined && applied.randomSeed !== fixture.randomSeed) {
        return true;
    }
    return false;
}

const RANDOMNESS_RE = /\brandom(dir)?\b/i;

function mutateFixture(fixture, rng, mutatorNames, options) {
    // Randomness draws from object sets whose iteration order depends on bit
    // assignment, so a reordering mutation can legitimately change a draw.
    // Equivalence cannot be asserted for those fixtures.
    const usesRandomness = RANDOMNESS_RE.test(fixture.source || '');
    const allowed = mutators.filter(function(mutator) {
        if (mutatorNames && mutatorNames.indexOf(mutator.name) < 0) {
            return false;
        }
        if (mutator.equivalence && usesRandomness) {
            return false;
        }
        return true;
    });
    if (allowed.length === 0) {
        throw new Error('inapplicable mutation: no mutators selected');
    }
    const maxAttempts = options && options.maxAttempts ? options.maxAttempts : 8;
    const donors = (options && options.donors) || [];
    const context = {
        donors: donors,
        readDonor: function(donorPath) {
            return fs.readFileSync(donorPath, 'utf8');
        }
    };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const mutator = allowed[rng.integer(allowed.length)];
        const applied = mutator.apply(fixture.source, rng, fixture, context);
        if (applied && mutationChangedJob(applied, fixture)) {
            return {
                mutator: mutator.name,
                fixtureName: fixture.name,
                fixtureIndex: fixture.fixtureIndex,
                corpusIndex: fixture.corpusIndex,
                kind: fixture.kind,
                source: applied.source,
                detail: applied.detail,
                equivalenceContext: applied.equivalenceContext || null,
                inputs: applied.inputs || fixture.inputs,
                level: applied.level !== undefined ? applied.level : fixture.level,
                randomSeed: applied.randomSeed !== undefined ? applied.randomSeed : fixture.randomSeed,
                expectedOutput: fixture.expectedOutput,
                expectedErrors: fixture.expectedErrors,
                expectedErrorCount: fixture.expectedErrorCount,
                attempt: attempt
            };
        }
    }
    throw new Error('inapplicable mutation after ' + maxAttempts + ' attempts');
}

function isInapplicableMutation(error) {
    return Boolean(error && /inapplicable/.test(String(error.message)));
}

function needValue(argv, i, name) {
    if (i + 1 >= argv.length) {
        throw new Error('Missing value for ' + name);
    }
    return argv[i + 1];
}

function needPositiveInt(argv, i, name) {
    const value = Number(needValue(argv, i, name));
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(name + ' must be a positive integer');
    }
    return value;
}

function parseArguments(argv, options) {
    const now = options && options.now ? options.now : Date.now;
    const result = {
        seed: typeof now === 'function' ? now() : now,
        count: 100,
        forever: false,
        timeoutMs: 2000,
        shrink: true,
        replay: true,
        maxInputs: 8,
        extraInputs: 0,
        shrinkBudget: 200,
        maxAttempts: 8,
        output: '.build/monster_garden',
        fixture: null,
        mutators: null,
        gameDirs: [],
        listMutators: false
    };
    const names = mutators.map(function(mutator) { return mutator.name; });
    let sawCount = false;
    let sawForever = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--seed': {
                const raw = needValue(argv, i, 'seed');
                if (!/^\d+$/.test(raw)) {
                    throw new Error('seed must be a non-negative integer');
                }
                const value = Number(raw);
                if (!Number.isInteger(value) || value < 0 || value > 4294967295) {
                    throw new Error('seed must be a non-negative integer at most 4294967295');
                }
                result.seed = value;
                i++;
                break;
            }
            case '--count':
                sawCount = true;
                result.count = needPositiveInt(argv, i, 'count');
                i++;
                break;
            case '--forever':
                sawForever = true;
                result.forever = true;
                break;
            case '--timeout-ms': {
                const value = needPositiveInt(argv, i, 'timeout-ms');
                if (value > 2147483647) {
                    throw new Error('timeout-ms must be a positive integer at most 2147483647');
                }
                result.timeoutMs = value;
                i++;
                break;
            }
            case '--fixture':
                result.fixture = needValue(argv, i, 'fixture');
                i++;
                break;
            case '--game-dir': {
                const dir = needValue(argv, i, 'game-dir');
                // Fail loudly at parse time rather than yielding a silent empty
                // pool that makes every donor mutator report inapplicable.
                loadGameDir(dir);
                result.gameDirs.push(dir);
                i++;
                break;
            }
            case '--mutator': {
                const selected = needValue(argv, i, 'mutator').split(',').map(function(name) {
                    return name.trim();
                }).filter(Boolean);
                if (selected.length === 0) {
                    throw new Error('mutator list is empty');
                }
                for (let j = 0; j < selected.length; j++) {
                    if (names.indexOf(selected[j]) < 0) {
                        throw new Error('Unknown mutator: ' + selected[j]);
                    }
                }
                result.mutators = selected;
                i++;
                break;
            }
            case '--output':
                result.output = needValue(argv, i, 'output');
                i++;
                break;
            case '--no-shrink':
                result.shrink = false;
                break;
            case '--no-replay':
                result.replay = false;
                break;
            case '--max-inputs':
                result.maxInputs = needPositiveInt(argv, i, 'max-inputs');
                i++;
                break;
            case '--extra-inputs':
                result.extraInputs = needPositiveInt(argv, i, 'extra-inputs');
                i++;
                break;
            case '--shrink-budget':
                result.shrinkBudget = needPositiveInt(argv, i, 'shrink-budget');
                i++;
                break;
            case '--max-attempts':
                result.maxAttempts = needPositiveInt(argv, i, 'max-attempts');
                i++;
                break;
            case '--list-mutators':
                result.listMutators = true;
                break;
            default:
                throw new Error('Unknown option: ' + arg);
        }
    }
    if (sawCount && sawForever) {
        throw new Error('--forever cannot be combined with --count');
    }
    return result;
}

const EXTRA_INPUT_CHOICES = [0, 1, 2, 3, 4, 'tick'];

function extendInputs(recorded, rng, options) {
    const maxInputs = options && options.maxInputs ? options.maxInputs : recorded.length;
    const extraInputs = options && options.extraInputs ? options.extraInputs : 0;
    const prefix = (recorded || []).slice(0, maxInputs);
    const extras = [];
    for (let i = 0; i < extraInputs; i++) {
        extras.push(rng.pick(EXTRA_INPUT_CHOICES));
    }
    return prefix.concat(extras);
}

function prepareTrialInputs(recorded, rng, options) {
    const extraInputs = options && options.extraInputs ? options.extraInputs : 0;
    if (extraInputs === 0) {
        return (recorded || []).slice();
    }
    return extendInputs(recorded, rng, options);
}

function trialMaxInputs(options, inputs) {
    const extraInputs = options && options.extraInputs ? options.extraInputs : 0;
    if (extraInputs === 0) {
        return options.maxInputs;
    }
    return (inputs || []).length;
}

function clip(value, n) {
    return String(value == null ? '' : value).slice(0, n || 80);
}

function failureSignature(result) {
    if (!result || !result.kind) {
        return 'unknown';
    }
    if (result.kind === 'timeout') {
        return 'timeout';
    }
    if (result.kind === 'crash' && result.error) {
        const message = String(result.error.message || '').split('\n')[0];
        return 'crash:' + result.error.name + ':' + message;
    }
    if (result.kind === 'invariant' || result.kind === 'semantic-mismatch') {
        return result.kind + ':' + clip(result.detail) + ':' + clip(result.fingerprint);
    }
    return result.kind + ':' + clip(result.fingerprint) + ':' + clip(result.detail);
}

function isIntArrayLike(value, length) {
    return value && typeof value.length === 'number' && value.length === length;
}

function checkLevelInvariants(level, strideObj, strideMov, state) {
    if (!(strideObj > 0) || !(strideMov > 0) || !Number.isInteger(strideObj) || !Number.isInteger(strideMov)) {
        return 'strides are invalid';
    }
    if (!level || typeof level !== 'object') {
        return 'level is missing';
    }
    if (!Number.isInteger(level.width) || !Number.isInteger(level.height) || !(level.width > 0) || !(level.height > 0)) {
        return 'level dimensions are invalid';
    }
    if (level.n_tiles !== level.width * level.height) {
        return 'n_tiles does not match width*height';
    }
    const expectedObjects = level.n_tiles * strideObj;
    if (!isIntArrayLike(level.objects, expectedObjects)) {
        return 'objects length is ' + (level.objects && level.objects.length) + ' expected ' + expectedObjects;
    }
    const expectedMovements = level.n_tiles * strideMov;
    if (!isIntArrayLike(level.movements, expectedMovements)) {
        return 'movements length is ' + (level.movements && level.movements.length) + ' expected ' + expectedMovements;
    }
    if (level.commandQueue && level.commandQueue.length) {
        return 'commandQueue is not empty';
    }
    if (level.rowCellContents && level.rowCellContents.length !== level.height) {
        return 'rowCellContents length is invalid';
    }
    if (level.colCellContents && level.colCellContents.length !== level.width) {
        return 'colCellContents length is invalid';
    }
    if (state && state.rigid) {
        if (!level.rigidMovementAppliedMask || level.rigidMovementAppliedMask.length !== level.n_tiles) {
            return 'rigidMovementAppliedMask length is invalid';
        }
        if (!level.rigidGroupIndexMask || level.rigidGroupIndexMask.length !== level.n_tiles) {
            return 'rigidGroupIndexMask length is invalid';
        }
    }
    if (state && state.idDict) {
        const objectCount = Object.keys(state.idDict).length;
        const maxBit = objectCount;
        for (let tile = 0; tile < level.n_tiles; tile++) {
            for (let word = 0; word < strideObj; word++) {
                const bits = level.objects[tile * strideObj + word];
                for (let bit = 0; bit < 32; bit++) {
                    const abs = word * 32 + bit;
                    if (abs >= maxBit && (bits & (1 << bit))) {
                        return 'object bit ' + abs + ' is set but idDict has ' + maxBit + ' entries';
                    }
                }
            }
        }
    }
    const layerMasks = state && (state.layerMasks || state.collisionMasks);
    if (layerMasks && layerMasks.length) {
        for (let tile = 0; tile < level.n_tiles; tile++) {
            for (let layer = 0; layer < layerMasks.length; layer++) {
                const mask = layerMasks[layer];
                if (!mask || !mask.data) {
                    continue;
                }
                let count = 0;
                for (let word = 0; word < strideObj; word++) {
                    const bits = level.objects[tile * strideObj + word] & mask.data[word];
                    if (bits) {
                        count += (bits >>> 0).toString(2).replace(/0/g, '').length;
                    }
                }
                if (count > 1) {
                    return 'collision layer ' + layer + ' has ' + count + ' objects at tile ' + tile;
                }
            }
        }
    }
    return null;
}

function normaliseBoardNames(board, renames) {
    if (!renames) {
        return String(board);
    }
    const lookup = Object.create(null);
    const keys = Object.keys(renames);
    for (let i = 0; i < keys.length; i++) {
        lookup[keys[i].toLowerCase()] = renames[keys[i]];
    }
    return String(board).replace(/([^,:\n]*):/g, function(match, names) {
        if (names === '') {
            return match;
        }
        const mapped = names.split(' ').map(function(name) {
            const replacement = lookup[name.toLowerCase()];
            if (replacement == null) {
                return name;
            }
            if (name === name.toLowerCase()) {
                return String(replacement).toLowerCase();
            }
            if (name === name.toUpperCase()) {
                return String(replacement).toUpperCase();
            }
            return replacement;
        });
        mapped.sort();
        return mapped.join(' ') + ':';
    });
}

function fingerprintBoard(result) {
    if (!result || typeof result.fingerprint !== 'string') {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(result.fingerprint);
    } catch (error) {
        return null;
    }
    if (!parsed || typeof parsed.board !== 'string') {
        return null;
    }
    return parsed.board;
}

// A crash, timeout or invariant is already interesting on its own, so this only
// speaks about the two cases the other classifiers cannot see: a clean run that
// answers differently, and a valid transformation that stops compiling. A new
// warning is not a break, because mutators that add declarations can legitimately
// provoke one.
function compareEquivalence(mutator, baseline, mutantResult, context) {
    if (!mutator || !mutator.equivalence || !baseline || !mutantResult) {
        return null;
    }
    if (baseline.kind !== 'ok') {
        return null;
    }
    if (mutantResult.kind === 'compiler-error') {
        return { detail: 'semantics-preserving mutation produced compiler-error' };
    }
    if (mutantResult.kind !== 'ok') {
        return null;
    }
    if (mutator.equivalence === 'full') {
        if (mutantResult.fingerprint !== baseline.fingerprint) {
            return { detail: 'fingerprint differs' };
        }
        return null;
    }
    const baselineBoard = fingerprintBoard(baseline);
    let mutantBoard = fingerprintBoard(mutantResult);
    if (baselineBoard === null || mutantBoard === null) {
        return null;
    }
    if (mutator.normalise) {
        mutantBoard = mutator.normalise(mutantBoard, context && context.renames);
    }
    if (mutantBoard !== baselineBoard) {
        return { detail: 'board differs' };
    }
    return null;
}

function isInteresting(result) {
    return result.kind === 'crash'
        || result.kind === 'timeout'
        || result.kind === 'invariant'
        || result.kind === 'nondeterministic'
        || result.kind === 'replay-divergence'
        || result.kind === 'semantic-mismatch'
        || result.kind === 'equivalence-break';
}

function baselineOracleFields(fixture, options) {
    if (fixture.kind === 'compiler-message') {
        return {
            expectedErrors: fixture.expectedErrors,
            expectedErrorCount: fixture.expectedErrorCount
        };
    }
    if (options && options.extraInputs === 0
        && fixture.inputs && fixture.inputs.length <= options.maxInputs
        && typeof fixture.expectedOutput === 'string') {
        return { expectedOutput: fixture.expectedOutput };
    }
    return {};
}

function isHealthyKind(kind) {
    return kind === 'ok' || kind === 'compiler-error' || kind === 'compiler-warning';
}

function attributeMonster(baseline, mutantResult) {
    if (!baseline || isHealthyKind(baseline.kind)) {
        return { save: isInteresting(mutantResult), tally: mutantResult.kind, baseline: false };
    }
    if (failureSignature(baseline) === failureSignature(mutantResult)) {
        return { save: false, tally: 'baseline', baseline: true };
    }
    if (!isInteresting(mutantResult)) {
        return { save: false, tally: 'baseline', baseline: true };
    }
    return { save: true, tally: mutantResult.kind, baseline: true };
}

function shrinkSource(source, keep, budget) {
    let current = source.split('\n');
    let remaining = budget;
    let changed = true;
    while (changed && remaining > 0) {
        changed = false;
        let i = 0;
        while (i < current.length && remaining > 0) {
            const candidate = current.slice(0, i).concat(current.slice(i + 1));
            remaining--;
            if (keep(candidate.join('\n'))) {
                current = candidate;
                changed = true;
            } else {
                i++;
            }
        }
    }
    return { source: current.join('\n'), steps: budget - remaining };
}

async function shrinkInteresting(mutant, originalResult, options) {
    const signature = failureSignature(originalResult);
    if (!options.shrink || originalResult.kind === 'timeout') {
        return { source: mutant.source, steps: 0, signature: signature, result: originalResult };
    }
    let current = mutant.source.split('\n');
    let steps = 0;
    let remaining = options.shrinkBudget;
    let changed = true;
    while (changed && remaining > 0) {
        changed = false;
        let i = 0;
        while (i < current.length && remaining > 0) {
            if (i === current.length - 1 && current[i] === '') {
                break;
            }
            let candidateSource = current.slice(0, i).concat(current.slice(i + 1)).join('\n');
            if (mutant.source.endsWith('\n') && !candidateSource.endsWith('\n')) {
                candidateSource += '\n';
            }
            remaining--;
            steps++;
            const next = await options.evaluate({
                source: candidateSource,
                inputs: mutant.inputs,
                level: mutant.level,
                randomSeed: mutant.randomSeed
            });
            if (failureSignature(next) === signature) {
                current = candidateSource.split('\n');
                changed = true;
            } else {
                i++;
            }
        }
    }
    const minimizedSource = current.join('\n');
    const verified = await options.evaluate({
        source: minimizedSource,
        inputs: mutant.inputs,
        level: mutant.level,
        randomSeed: mutant.randomSeed
    });
    steps++;
    if (failureSignature(verified) !== signature) {
        return { source: mutant.source, steps: steps, signature: signature, result: originalResult };
    }
    return { source: minimizedSource, steps: steps, signature: signature, result: verified };
}

// An equivalence-break is a relation between two sources, so a line must leave
// both or neither. That is only meaningful while the mutant stays line-aligned
// with the fixture; when it is not, shrinking is skipped rather than done wrongly.
async function shrinkEquivalencePair(mutant, baselineSource, mutator, options) {
    const unshrunk = {
        source: mutant.source,
        baselineSource: baselineSource,
        steps: 0,
        skipped: true
    };
    if (!options.shrink) {
        return unshrunk;
    }
    let mutantLines = mutant.source.split('\n');
    let baseLines = baselineSource.split('\n');
    if (mutantLines.length !== baseLines.length) {
        return unshrunk;
    }
    let steps = 0;
    let remaining = options.shrinkBudget;
    let changed = true;
    while (changed && remaining > 0) {
        changed = false;
        let i = 0;
        while (i < mutantLines.length && remaining > 0) {
            if (i === mutantLines.length - 1 && mutantLines[i] === '') {
                break;
            }
            const candidateMutant = mutantLines.slice(0, i).concat(mutantLines.slice(i + 1));
            const candidateBase = baseLines.slice(0, i).concat(baseLines.slice(i + 1));
            remaining--;
            steps++;
            const mutantResult = await options.evaluate({
                source: candidateMutant.join('\n'),
                inputs: mutant.inputs,
                level: mutant.level,
                randomSeed: mutant.randomSeed
            });
            const baselineResult = await options.evaluate({
                source: candidateBase.join('\n'),
                inputs: mutant.inputs,
                level: mutant.level,
                randomSeed: mutant.randomSeed
            });
            const stillBroken = compareEquivalence(
                mutator,
                baselineResult,
                mutantResult,
                mutant.equivalenceContext
            );
            if (stillBroken) {
                mutantLines = candidateMutant;
                baseLines = candidateBase;
                changed = true;
            } else {
                i++;
            }
        }
    }
    return {
        source: mutantLines.join('\n'),
        baselineSource: baseLines.join('\n'),
        steps: steps,
        skipped: false
    };
}

function artifactDirName(signature, seed, index) {
    const safe = String(signature)
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return (safe || 'monster') + '-s' + seed + '_' + String(index).padStart(4, '0');
}

function formatRegression(name, source, job) {
    job = job || {};
    const inputs = job.inputs || [];
    const level = job.level == null ? 0 : job.level;
    const seed = job.randomSeed == null ? null : job.randomSeed;
    return '[\n    ' + JSON.stringify(name) + ',\n    [' +
        JSON.stringify(source) + ', ' + JSON.stringify(inputs) + ', "", ' +
        JSON.stringify(level) + ', ' + JSON.stringify(seed) + ']\n],\n';
}

const KNOWN_RESULT_KINDS = [
    'ok', 'compiler-error', 'compiler-warning', 'crash',
    'invariant', 'nondeterministic', 'replay-divergence', 'semantic-mismatch',
    'equivalence-break'
];

function decodeBuffers(chunks) {
    if (!chunks.length) {
        return '';
    }
    return Buffer.concat(chunks).toString('utf8');
}

function runChild(command, args, stdin, timeoutMs, onSpawn) {
    return new Promise(function(resolve) {
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        if (typeof onSpawn === 'function') {
            onSpawn(child);
        }
        const stdoutChunks = [];
        const stderrChunks = [];
        let timedOut = false;
        let settled = false;
        const timer = setTimeout(function() {
            if (child.exitCode !== null || child.signalCode !== null) {
                return;
            }
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);

        function finish(result) {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(result);
        }

        function crashResult(name, message, detail) {
            return {
                kind: 'crash',
                error: { name: name, message: String(message || '').split('\n')[0] },
                fingerprint: '',
                detail: detail || '',
                errorCount: 0
            };
        }

        function crashFromError(error) {
            if (timedOut) {
                finish({
                    kind: 'timeout',
                    error: null,
                    fingerprint: '',
                    detail: 'timeout',
                    errorCount: 0
                });
                return;
            }
            const message = error && error.message ? error.message : 'spawn failed';
            finish(crashResult((error && error.name) || 'ChildError', message, decodeBuffers(stderrChunks) || message));
        }

        child.stdout.on('data', function(chunk) { stdoutChunks.push(Buffer.from(chunk)); });
        child.stderr.on('data', function(chunk) { stderrChunks.push(Buffer.from(chunk)); });
        child.on('error', crashFromError);
        child.stdin.on('error', crashFromError);
        child.on('close', function(code, signal) {
            const stdout = decodeBuffers(stdoutChunks);
            const stderr = decodeBuffers(stderrChunks);
            const lines = stdout.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
            const hadOutput = lines.length > 0;
            let parsed;
            let parseError;
            if (hadOutput) {
                try {
                    parsed = JSON.parse(lines.pop());
                } catch (error) {
                    parseError = error;
                }
            }
            const validParsedResult = Boolean(
                parsed
                && typeof parsed === 'object'
                && !Array.isArray(parsed)
                && KNOWN_RESULT_KINDS.indexOf(parsed.kind) >= 0
            );

            if (validParsedResult && code === 0) {
                finish(parsed);
                return;
            }
            if (timedOut) {
                finish({
                    kind: 'timeout',
                    error: null,
                    fingerprint: '',
                    detail: 'timeout',
                    errorCount: 0
                });
                return;
            }
            if (!hadOutput) {
                finish(crashResult('ChildOutputError', 'empty worker stdout', stderr));
                return;
            }
            if (parseError) {
                finish(crashResult('ChildOutputError', (stdout || stderr || parseError.message).split('\n')[0], stderr));
                return;
            }
            if (!validParsedResult) {
                finish(crashResult('ChildOutputError', 'invalid worker result', stderr));
                return;
            }
            if (code && code !== 0 && parsed.kind !== 'crash') {
                finish(crashResult('ChildExitError', 'worker exited ' + code, stderr));
                return;
            }
            if (signal && signal !== 'SIGKILL') {
                finish(crashResult('ChildExitError', 'worker signal ' + signal, stderr));
                return;
            }
            finish(parsed);
        });
        try {
            child.stdin.write(stdin);
            child.stdin.end();
        } catch (error) {
            crashFromError(error);
        }
    });
}

function writeArtifacts(outputDir, dirName, files) {
    fs.mkdirSync(outputDir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(outputDir, '.' + dirName + '-'));
    const dest = path.join(outputDir, dirName);
    let bak = null;
    try {
        const names = Object.keys(files);
        for (let i = 0; i < names.length; i++) {
            fs.writeFileSync(path.join(tmp, names[i]), files[names[i]]);
        }
        try {
            fs.renameSync(tmp, dest);
        } catch (error) {
            if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') {
                throw error;
            }
            bak = fs.mkdtempSync(path.join(outputDir, '.' + dirName + '-old-'));
            fs.renameSync(dest, bak);
            try {
                fs.renameSync(tmp, dest);
            } catch (renameError) {
                try {
                    fs.renameSync(bak, dest);
                    bak = null;
                } catch (restoreError) {
                    // Leave bak in place if dest cannot be restored.
                }
                throw renameError;
            }
            fs.rmSync(bak, { recursive: true, force: true });
            bak = null;
        }
        return dest;
    } finally {
        if (fs.existsSync(tmp)) {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
        if (bak && fs.existsSync(bak) && fs.existsSync(dest)) {
            fs.rmSync(bak, { recursive: true, force: true });
        }
    }
}

function tallyPayload(fields, now) {
    const stamp = now === undefined ? function() { return new Date().toISOString(); } : now;
    return {
        seed: fields.seed,
        forever: !!fields.forever,
        trials: fields.trials,
        saved: fields.saved,
        counts: fields.counts,
        lastSaved: fields.lastSaved == null ? null : fields.lastSaved,
        updatedAt: typeof stamp === 'function' ? stamp() : stamp
    };
}

function writeTally(outputDir, payload) {
    fs.mkdirSync(outputDir, { recursive: true });
    const dest = path.join(outputDir, 'tally.json');
    const tmp = path.join(outputDir, '.tally.json.' + process.pid + '.tmp');
    try {
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
        fs.renameSync(tmp, dest);
    } catch (error) {
        if (fs.existsSync(tmp)) {
            fs.unlinkSync(tmp);
        }
        throw error;
    }
}

function formatForeverStatus(counts, trials, saved) {
    return 'trials=' + trials +
        ' saved=' + saved +
        ' crash=' + (counts.crash || 0) +
        ' timeout=' + (counts.timeout || 0) +
        ' invariant=' + (counts.invariant || 0) +
        ' nondeterministic=' + (counts.nondeterministic || 0) +
        ' replay-divergence=' + (counts['replay-divergence'] || 0) +
        ' semantic-mismatch=' + (counts['semantic-mismatch'] || 0) +
        ' equivalence-break=' + (counts['equivalence-break'] || 0);
}

module.exports = {
    Random: Random,
    NAUGHTY_STRINGS: NAUGHTY_STRINGS,
    loadCorpus: loadCorpus,
    loadGameDir: loadGameDir,
    mergeGames: mergeGames,
    cellObjectNames: cellObjectNames,
    mutateRuleCell: mutateRuleCell,
    sectionBlocks: sectionBlocks,
    mutators: mutators,
    mutateFixture: mutateFixture,
    isInapplicableMutation: isInapplicableMutation,
    parseArguments: parseArguments,
    extendInputs: extendInputs,
    prepareTrialInputs: prepareTrialInputs,
    trialMaxInputs: trialMaxInputs,
    failureSignature: failureSignature,
    checkLevelInvariants: checkLevelInvariants,
    isInteresting: isInteresting,
    normaliseBoardNames: normaliseBoardNames,
    compareEquivalence: compareEquivalence,
    baselineOracleFields: baselineOracleFields,
    isHealthyKind: isHealthyKind,
    attributeMonster: attributeMonster,
    shrinkSource: shrinkSource,
    shrinkInteresting: shrinkInteresting,
    shrinkEquivalencePair: shrinkEquivalencePair,
    artifactDirName: artifactDirName,
    formatRegression: formatRegression,
    writeArtifacts: writeArtifacts,
    tallyPayload: tallyPayload,
    writeTally: writeTally,
    formatForeverStatus: formatForeverStatus,
    runChild: runChild,
    KNOWN_RESULT_KINDS: KNOWN_RESULT_KINDS
};
