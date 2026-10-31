import { readFileSync } from 'node:fs';
import { createProgramChecker } from './check.mjs';

const program = JSON.parse(readFileSync(0, 'utf8'));
const check = await createProgramChecker();
console.log('PS_EXPLORATION_RESULT ' + JSON.stringify(check(program)));
