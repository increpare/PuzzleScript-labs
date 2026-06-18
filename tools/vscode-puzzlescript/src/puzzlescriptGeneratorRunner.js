'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('./puzzlescriptGeneratorCore');

function parseProgressLine(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('generator_progress ')) {
        return null;
    }
    const progress = {};
    for (const part of text.slice('generator_progress '.length).split(/\s+/)) {
        const [key, value] = part.split('=');
        if (!key || value == null) {
            continue;
        }
        const numeric = Number(value);
        progress[key] = Number.isFinite(numeric) ? numeric : value;
    }
    return progress;
}

function parseEventLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function parseGeneratorJson(stdout, jsonPath) {
    if (jsonPath && fs.existsSync(jsonPath)) {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }
    const text = String(stdout || '').trim();
    if (!text) {
        throw new Error('Generator produced no JSON output.');
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) {
        throw new Error('Generator output did not contain JSON.');
    }
    return JSON.parse(text.slice(start, end + 1));
}

function removeTempDir(tempDir) {
    if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

class PuzzleScriptGeneratorRun {
    constructor(options) {
        this.options = options;
        this.child = null;
        this.cancelled = false;
    }

    start() {
        const {
            binaryPath,
            sourceText,
            specText,
            runOptions,
            onProgress,
            onCandidateEvent,
        } = this.options;
        const tempDir = makeTempDir();
        const gamePath = path.join(tempDir, 'game.ps');
        const specPath = path.join(tempDir, 'recipe.gen');
        const jsonPath = path.join(tempDir, 'result.json');
        const shouldCollectCandidateEvents = typeof onCandidateEvent === 'function';
        const eventsPath = shouldCollectCandidateEvents ? path.join(tempDir, 'events.jsonl') : null;
        fs.writeFileSync(gamePath, sourceText, 'utf8');
        fs.writeFileSync(specPath, specText, 'utf8');

        const args = [
            gamePath,
            specPath,
            '--time-ms', String(runOptions.timeMs),
            '--jobs', String(runOptions.jobs),
            '--seed', String(runOptions.seed),
            '--solver-timeout-ms', String(runOptions.solverTimeoutMs),
            '--solver-strategy', String(runOptions.solverStrategy),
            '--top-k', String(runOptions.topK),
            '--json-out', jsonPath,
        ];
        if (eventsPath) {
            args.push('--events-jsonl', eventsPath);
        }
        if (runOptions.samples !== '' && runOptions.samples != null) {
            args.push('--samples', String(runOptions.samples));
        }

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
            const finishResolve = output => {
                if (settled) {
                    return;
                }
                settled = true;
                this.child = null;
                removeTempDir(tempDir);
                resolve(output);
            };
            this.child = childProcess.spawn(binaryPath, args, {
                cwd: path.dirname(binaryPath),
                windowsHide: true,
            });
            this.child.stdout.on('data', chunk => {
                stdout += String(chunk);
            });
            this.child.stderr.on('data', chunk => {
                const text = String(chunk);
                stderr += text;
                for (const line of text.split(/\r?\n/)) {
                    const progress = parseProgressLine(line);
                    if (progress && onProgress) {
                        onProgress(progress);
                    }
                }
            });
            this.child.on('error', error => {
                if (this.cancelled) {
                    finishCancelled();
                    return;
                }
                finishReject(error);
            });
            this.child.on('close', async code => {
                if (this.cancelled) {
                    finishCancelled();
                    return;
                }
                if (code !== 0) {
                    finishReject(new Error((stderr || `Generator exited with code ${code}`).trim()));
                    return;
                }
                try {
                    const warnings = [];
                    if (eventsPath && fs.existsSync(eventsPath)) {
                        try {
                            for (const event of parseEventLines(fs.readFileSync(eventsPath, 'utf8'))) {
                                if (this.cancelled) {
                                    finishCancelled();
                                    return;
                                }
                                try {
                                    await onCandidateEvent(event);
                                } catch (error) {
                                    warnings.push(`Generator candidate event callback failed: ${error.message || error}`);
                                }
                                if (this.cancelled) {
                                    finishCancelled();
                                    return;
                                }
                            }
                        } catch (error) {
                            warnings.push(`Generator candidate events failed: ${error.message || error}`);
                        }
                    }
                    if (this.cancelled) {
                        finishCancelled();
                        return;
                    }
                    const result = parseGeneratorJson(stdout, jsonPath);
                    if (this.cancelled) {
                        finishCancelled();
                        return;
                    }
                    finishResolve({
                        cancelled: false,
                        tempDir,
                        result,
                        warnings,
                    });
                } catch (error) {
                    if (this.cancelled) {
                        finishCancelled();
                        return;
                    }
                    finishReject(error);
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
    PuzzleScriptGeneratorRun,
    parseEventLines,
    parseGeneratorJson,
    parseProgressLine,
    removeTempDir,
};
