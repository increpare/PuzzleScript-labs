'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'puzzlescript-solver-'));
}

function removeTempDir(tempDir) {
    if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function parseSolverJson(stdout) {
    const text = String(stdout || '').trim();
    for (let start = text.indexOf('{'); start >= 0;) {
        let nextStart = text.indexOf('{', start + 1);
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < text.length; index++) {
            const char = text[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }
            if (char === '"') {
                inString = true;
            } else if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    try {
                        const parsed = JSON.parse(text.slice(start, index + 1));
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            if (Object.prototype.hasOwnProperty.call(parsed, 'results')) {
                                return parsed;
                            }
                            nextStart = text.indexOf('{', index + 1);
                        }
                    } catch (error) {
                        // Keep scanning; noisy output can contain non-JSON brace groups.
                    }
                    break;
                }
            }
        }
        start = nextStart;
    }
    throw new Error('Solver output did not contain JSON.');
}

function resolveSolverPath(configuredPath, repoRoot) {
    const configured = String(configuredPath || '').trim();
    if (configured) {
        return {
            path: configured,
            exists: fs.existsSync(configured),
            source: 'setting',
        };
    }
    const candidate = path.join(repoRoot, 'build', 'native', process.platform === 'win32' ? 'puzzlescript_solver.exe' : 'puzzlescript_solver');
    return {
        path: candidate,
        exists: fs.existsSync(candidate),
        source: 'repo',
    };
}

class PuzzleScriptSolverRun {
    constructor(options) {
        this.options = options;
        this.child = null;
        this.cancelled = false;
    }

    start() {
        let tempDir = null;
        try {
            tempDir = makeTempDir();
            const gamePath = path.join(tempDir, 'game.txt');
            fs.writeFileSync(gamePath, String(this.options.sourceText || ''), 'utf8');
            const args = [
                gamePath,
                '--timeout-ms', String(this.options.timeoutMs || 1000),
                '--jobs', '1',
                '--strategy', String(this.options.strategy || 'portfolio'),
                '--level', String(this.options.level || 0),
                '--no-solutions',
                '--quiet',
                '--json',
            ];
            return new Promise((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                let settled = false;
                const finishCancelled = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    this.child = null;
                    removeTempDir(tempDir);
                    resolve({ cancelled: true, tempDir });
                };
                const finishReject = error => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    this.child = null;
                    removeTempDir(tempDir);
                    reject(error);
                };
                const finishResolve = result => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    this.child = null;
                    removeTempDir(tempDir);
                    resolve({ cancelled: false, tempDir, result });
                };
                try {
                    this.child = childProcess.spawn(this.options.binaryPath, args, {
                        cwd: path.dirname(this.options.binaryPath),
                        windowsHide: true,
                    });
                } catch (error) {
                    finishReject(error);
                    return;
                }
                this.child.stdout.on('data', chunk => {
                    stdout += String(chunk);
                });
                this.child.stderr.on('data', chunk => {
                    stderr += String(chunk);
                });
                this.child.on('error', error => {
                    if (this.cancelled) {
                        finishCancelled();
                        return;
                    }
                    finishReject(error);
                });
                this.child.on('close', code => {
                    if (this.cancelled) {
                        finishCancelled();
                        return;
                    }
                    if (code !== 0) {
                        finishReject(new Error((stderr || `Solver exited with code ${code}`).trim()));
                        return;
                    }
                    try {
                        const result = parseSolverJson(stdout);
                        finishResolve(result);
                    } catch (error) {
                        finishReject(error);
                    }
                });
            });
        } catch (error) {
            this.child = null;
            removeTempDir(tempDir);
            return Promise.reject(error);
        }
    }

    cancel() {
        this.cancelled = true;
        if (this.child) {
            this.child.kill();
        }
    }
}

module.exports = {
    PuzzleScriptSolverRun,
    parseSolverJson,
    resolveSolverPath,
};
