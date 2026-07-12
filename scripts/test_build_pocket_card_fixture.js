'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	buildFixture,
	parseArgs,
	validateIrText,
} = require('./build_pocket_card_fixture');

assert.deepStrictEqual(
	parseArgs(['--binary', 'bin', '--source', 'game.txt', '--out', 'game.ir.json']),
	{binary: 'bin', source: 'game.txt', out: 'game.ir.json'}
);

for (const args of [
	[],
	['--binary', 'bin', '--source', 'game.txt'],
	['--binary', 'bin', '--out', 'game.ir.json'],
	['--source', 'game.txt', '--out', 'game.ir.json'],
]) {
	assert.throws(() => parseArgs(args), /missing required option --(?:binary|source|out)/);
}

for (const args of [
	['--binary', '--source', 'game.txt', '--out', 'game.ir.json'],
	['--binary', 'bin', '--source', '--out', 'game.ir.json'],
	['--binary', 'bin', '--source', 'game.txt', '--out', '--binary'],
]) {
	assert.throws(() => parseArgs(args), /requires a value that is not an option/);
}

assert.throws(
	() => parseArgs(['--binary', 'bin', '--source', 'game.txt', '--out', 'game.ir.json', '--wat']),
	/unknown option --wat/
);

assert.throws(() => validateIrText('{'), /compiler emitted invalid JSON/);
for (const text of ['null', '[]', '1', '"text"']) {
	assert.throws(() => validateIrText(text), /IR root must be an object/);
}
assert.throws(
	() => validateIrText('{"schema_version":2,"game":{}}'),
	/unsupported schema_version/
);
for (const text of [
	'{"schema_version":1}',
	'{"schema_version":1,"game":null}',
	'{"schema_version":1,"game":[]}',
	'{"schema_version":1,"game":"not an object"}',
]) {
	assert.throws(() => validateIrText(text), /IR is missing game object/);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-card-fixture-'));
try {
	const out = path.join(tempDir, 'nested', 'game.ir.json');
	const compilerValue = {
		schema_version: 1,
		document: {},
		game: {levels: []},
	};
	let invocation;
	const result = buildFixture(
		{binary: 'compiler-bin', source: 'game.txt', out},
		(binary, args, options) => {
			invocation = {binary, args, options};
			return {
				status: 0,
				stdout: JSON.stringify(compilerValue),
				stderr: '',
			};
		}
	);
	assert.deepStrictEqual(invocation, {
		binary: 'compiler-bin',
		args: ['compile', 'game.txt', '--emit-ir-json'],
		options: {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024},
	});
	assert.deepStrictEqual(result, compilerValue);
	assert.strictEqual(
		fs.readFileSync(out, 'utf8'),
		JSON.stringify(compilerValue, null, 2) + '\n'
	);

	assert.throws(
		() => buildFixture(
			{binary: 'compiler-bin', source: 'game.txt', out},
			() => ({status: 7, stdout: '', stderr: 'compile exploded\n'})
		),
		/compiler exited with status 7: compile exploded/
	);

	assert.throws(
		() => buildFixture(
			{binary: 'compiler-bin', source: 'game.txt', out},
			() => ({status: null, signal: 'SIGKILL', stdout: '', stderr: 'killed loudly\n'})
		),
		/compiler terminated by SIGKILL: killed loudly/
	);

	assert.throws(
		() => buildFixture(
			{binary: 'compiler-bin', source: 'game.txt', out},
			() => ({status: null, stdout: '', stderr: '', error: new Error('spawn ENOENT')})
		),
		/failed to run compiler-bin: spawn ENOENT/
	);

	const compilerSuccess = () => ({
		status: 0,
		stdout: JSON.stringify(compilerValue),
		stderr: '',
	});
	const previousFixture = 'previous fixture bytes\n';

	const writeFailureDir = path.join(tempDir, 'write-failure');
	const writeFailureOut = path.join(writeFailureDir, 'game.ir.json');
	fs.mkdirSync(writeFailureDir);
	fs.writeFileSync(writeFailureOut, previousFixture);
	const writeFailureFs = Object.create(fs);
	writeFailureFs.writeFileSync = () => {
		throw new Error('injected write failure');
	};
	assert.throws(
		() => buildFixture(
			{binary: 'compiler-bin', source: 'game.txt', out: writeFailureOut},
			compilerSuccess,
			writeFailureFs
		),
		/injected write failure/
	);
	assert.strictEqual(fs.readFileSync(writeFailureOut, 'utf8'), previousFixture);
	assert.deepStrictEqual(fs.readdirSync(writeFailureDir), ['game.ir.json']);

	const renameFailureDir = path.join(tempDir, 'rename-failure');
	const renameFailureOut = path.join(renameFailureDir, 'game.ir.json');
	fs.mkdirSync(renameFailureDir);
	fs.writeFileSync(renameFailureOut, previousFixture);
	const renameFailureFs = Object.create(fs);
	renameFailureFs.renameSync = () => {
		throw new Error('injected rename failure');
	};
	assert.throws(
		() => buildFixture(
			{binary: 'compiler-bin', source: 'game.txt', out: renameFailureOut},
			compilerSuccess,
			renameFailureFs
		),
		/injected rename failure/
	);
	assert.strictEqual(fs.readFileSync(renameFailureOut, 'utf8'), previousFixture);
	assert.deepStrictEqual(fs.readdirSync(renameFailureDir), ['game.ir.json']);
} finally {
	fs.rmSync(tempDir, {recursive: true, force: true});
}

process.stdout.write('build_pocket_card_fixture: ok\n');
