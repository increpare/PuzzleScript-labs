import { parentPort, workerData } from 'node:worker_threads';
import { findMatches } from '../../build/matching.js';
import { Ellipsis } from '../../build/rule-model.js';

// A worker deadline keeps a regressed zero-step wildcard loop from hanging tests.
const rule = { ...workerData.rule,
  rows: workerData.rule.rows.map(row => row.map(cell => cell === null ? Ellipsis : cell)) };
parentPort.postMessage(findMatches(rule, workerData.before));
