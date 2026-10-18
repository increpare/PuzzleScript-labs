'use strict';
// Export eval prompts through the shared context builder, for runners that live outside
// Node (the Qwen baseline in Python, later the browser model).
//
//   node autocomplete/eval/export_prompts.js [--data DIR] [--split val|test]
//
// Writes <data>/eval/prompts_<split>.jsonl, one row per case:
//   {i, task, section, header, prefix, suffix, stop: line|block}
// The target is removed before the header and suffix are built (context.js contract).

const fs = require('fs');
const path = require('path');
const ctx = require('../pipeline/context.js');
const { extractSymbols } = require('../pipeline/symbols.js');

function exportPrompts({ dataDir, split, config, quiet }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    const tasks = JSON.parse(fs.readFileSync(path.join(dataDir, 'eval', `tasks_${split}.json`), 'utf8'));
    const textDir = path.join(dataDir, 'raw', 'text');
    const texts = new Map();
    const text = id => { if (!texts.has(id)) texts.set(id, fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8')); return texts.get(id); };
    const outPath = path.join(dataDir, 'eval', `prompts_${split}.jsonl`);
    const fd = fs.openSync(outPath, 'w');
    tasks.cases.forEach((c, i) => {
        const built = ctx.buildContext({ text: text(c.id), from: c.from, to: c.to, symbols: doc => extractSymbols(doc), config });
        const row = { i, task: c.task, section: c.section, header: built.header, prefix: built.prefix, suffix: built.suffix, stop: c.task === 'next_block' ? 'block' : 'line' };
        fs.writeSync(fd, JSON.stringify(row) + '\n');
        if ((i + 1) % 1000 === 0) log(`prompts: ${i + 1}/${tasks.cases.length}`);
    });
    fs.closeSync(fd);
    log(`prompts: ${split}: ${tasks.cases.length} -> ${outPath}`);
    return outPath;
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
    }
    return args;
}

if (require.main === module) {
    const { resolvePaths } = require('../pipeline/paths.js');
    const args = parseArgs(process.argv.slice(2));
    const configPath = path.join(__dirname, '..', 'configs', 'context.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : undefined;
    exportPrompts({ dataDir: args.data || resolvePaths().dataDir, split: args.split || 'val', config });
}

module.exports = { exportPrompts };
