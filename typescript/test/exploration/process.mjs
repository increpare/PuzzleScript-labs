import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const marker = 'PS_EXPLORATION_RESULT ';
const children = new Set();
export function cancelWorkers() { for (const child of children) child.kill('SIGKILL'); }
process.once('exit', cancelWorkers);
function processFailure(kind, message) {
  return { status: 'failed', phase: 'process', failureType: kind, nativeErrorFree: false,
    signature: 'process:' + kind, error: { name: 'WorkerError', message } };
}
function validResult(result) {
  if (typeof result?.nativeErrorFree !== 'boolean') return false;
  if (result?.status === 'excluded') return typeof result.reason === 'string';
  if (result?.status === 'failed') return typeof result.signature === 'string'
    && ['model', 'compiler', 'session'].includes(result.phase)
    && ['comparison', 'exception'].includes(result.failureType) && typeof result.error?.message === 'string';
  return result?.status === 'passed' && result.nativeErrorFree && ['snapshots', 'candidateOperations', 'levelLoads']
    .every(key => Number.isSafeInteger(result.report?.[key]) && result.report[key] >= 1);
}

/** One source game per child: native globals and a hung engine cannot contaminate another case. */
export function runIsolated(program, { timeoutMs = 5000, maxOutputBytes = 65536,
  worker = new URL('./worker.mjs', import.meta.url) } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error('Use positive process budgets');
  return new Promise(resolve => {
    const child = spawn(process.execPath, [fileURLToPath(worker)], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    const output = [], errors = [];
    let bytes = 0, terminal;
    const stop = result => { terminal ??= result; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(processFailure('timeout', 'Case exceeded ' + timeoutMs + ' ms')), timeoutMs);
    const capture = stream => chunk => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { stop(processFailure('process', 'Worker exceeded its output budget')); return; }
      (stream === 'stdout' ? output : errors).push(chunk);
    };
    child.stdout.on('data', capture('stdout')); child.stderr.on('data', capture('stderr'));
    child.on('error', error => { terminal ??= processFailure('process', error.message); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(processFailure('process', error.message)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      children.delete(child);
      if (terminal) { resolve(terminal); return; }
      const stdout = Buffer.concat(output).toString('utf8'), stderr = Buffer.concat(errors).toString('utf8');
      if (code !== 0) {
        resolve(processFailure('process', 'Worker exited ' + (signal ?? code) + ': ' + stderr.slice(0, 8000))); return;
      }
      const records = stdout.split('\n').filter(line => line.startsWith(marker));
      try {
        if (records.length !== 1) throw new Error('Worker must emit exactly one result');
        const result = JSON.parse(records[0].slice(marker.length));
        if (!validResult(result)) throw new Error('Worker emitted an invalid result');
        resolve(result);
      } catch (error) { resolve(processFailure('process', error.message + ': ' + stderr.slice(0, 8000))); }
    });
    child.stdin.end(JSON.stringify(program));
  });
}
