#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const OPTION_NAMES = ['binary', 'source', 'out'];

function parseArgs(args) {
	const options = {};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (!argument.startsWith('--') || !OPTION_NAMES.includes(argument.slice(2))) {
			throw new Error(`unknown option ${argument}`);
		}

		const name = argument.slice(2);
		if (Object.prototype.hasOwnProperty.call(options, name)) {
			throw new Error(`duplicate option ${argument}`);
		}

		const value = args[index + 1];
		if (value === undefined || value.startsWith('-')) {
			throw new Error(`${argument} requires a value that is not an option`);
		}
		options[name] = value;
		index += 1;
	}

	for (const name of OPTION_NAMES) {
		if (!Object.prototype.hasOwnProperty.call(options, name)) {
			throw new Error(`missing required option --${name}`);
		}
	}

	return options;
}

function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateIrText(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(`compiler emitted invalid JSON: ${error.message}`);
	}

	if (!isObject(value)) {
		throw new Error('IR root must be an object');
	}
	if (value.schema_version !== 1) {
		throw new Error(`unsupported schema_version: ${String(value.schema_version)}`);
	}
	if (!isObject(value.game)) {
		throw new Error('IR is missing game object');
	}
	return value;
}

function buildFixture(options, spawn = childProcess.spawnSync) {
	const result = spawn(
		options.binary,
		['compile', options.source, '--emit-ir-json'],
		{encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}
	);
	if (result.error) {
		throw new Error(`failed to run ${options.binary}: ${result.error.message}`);
	}
	if (result.status !== 0) {
		const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
		const detail = stderr ? `: ${stderr}` : '';
		throw new Error(`compiler exited with status ${String(result.status)}${detail}`);
	}

	const value = validateIrText(result.stdout);
	fs.mkdirSync(path.dirname(options.out), {recursive: true});
	fs.writeFileSync(options.out, JSON.stringify(value, null, 2) + '\n');
	return value;
}

module.exports = {buildFixture, parseArgs, validateIrText};

if (require.main === module) {
	try {
		const options = parseArgs(process.argv.slice(2));
		buildFixture(options);
		process.stderr.write(`Wrote ${options.out}\n`);
	} catch (error) {
		process.stderr.write(`build_pocket_card_fixture: ${error.message}\n`);
		process.exitCode = 1;
	}
}
