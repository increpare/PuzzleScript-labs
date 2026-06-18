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
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) {
        throw new Error('Solver output did not contain JSON.');
    }
    return JSON.parse(text.slice(start, end + 1));
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
        const tempDir = makeTempDir();
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
            this.child = childProcess.spawn(this.options.binaryPath, args, {
                cwd: path.dirname(this.options.binaryPath),
                windowsHide: true,
            });
            this.child.stdout.on('data', chunk => {
                stdout += String(chunk);
            });
            this.child.stderr.on('data', chunk => {
                stderr += String(chunk);
            });
            this.child.on('error', error => {
                removeTempDir(tempDir);
                reject(error);
            });
            this.child.on('close', code => {
                this.child = null;
                if (this.cancelled) {
                    removeTempDir(tempDir);
                    resolve({ cancelled: true, tempDir });
                    return;
                }
                if (code !== 0) {
                    removeTempDir(tempDir);
                    reject(new Error((stderr || `Solver exited with code ${code}`).trim()));
                    return;
                }
                try {
                    const result = parseSolverJson(stdout);
                    removeTempDir(tempDir);
                    resolve({ cancelled: false, tempDir, result });
                } catch (error) {
                    removeTempDir(tempDir);
                    reject(error);
                }
            });
        });
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
