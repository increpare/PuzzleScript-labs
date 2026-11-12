#!/usr/bin/env node
'use strict';

// Evaluate the explicitly requested JS fixture file, never an inferred corpus.
const fs = require('node:fs');
const vm = require('node:vm');
const filename = process.argv[2];
if (!filename) throw new Error('Pass a testdata.js or errormessage_testdata.js file');
const context = Object.create(null);
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename, timeout: 5000 });
const data = context.errormessage_testdata ?? context.testdata;
if (!Array.isArray(data)) throw new Error('Fixture file must define testdata or errormessage_testdata as an array');
process.stdout.write(JSON.stringify(data));
