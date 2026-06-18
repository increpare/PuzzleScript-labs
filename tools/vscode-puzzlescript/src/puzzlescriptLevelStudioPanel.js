'use strict';

const path = require('path');
const vscode = require('vscode');
const { CandidateBatchState } = require('./puzzlescriptCandidateScheduler');
const { GeneratedLevelsLog } = require('./puzzlescriptGeneratedLevelsLog');
const {
    boardFromLevel,
    generatedLevelsLogPath,
    glyphPaletteForSource,
    isPuzzleScriptCandidateDocument,
    replaceGlyphAt,
    replaceLevelRowsInSource,
    rowsFromBoard,
    statusLabel,
} = require('./puzzlescriptLevelStudioCore');
const {
    DEFAULT_GENERATOR_OPTIONS,
    candidateToRows,
    findPlayableLevels,
    normalizeRunOptions,
    readSidecarOrDefault,
    resolveGeneratorPath,
} = require('./puzzlescriptGeneratorCore');
const { PuzzleScriptGeneratorRun } = require('./puzzlescriptGeneratorRunner');
const { PuzzleScriptSolverRun, resolveSolverPath } = require('./puzzlescriptSolverRunner');

const DEFAULT_LEVEL_STUDIO_SOLVE_TIMEOUT_MS = 1000;

function uniqueBatchId() {
    return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLevelIndex(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function hasHashValue(value) {
    return value !== undefined && value !== null && String(value) !== '';
}

function normalizeExactHash(candidate) {
    const value = candidate && (candidate.level_hash_hex || candidate.levelHashHex);
    if (typeof value !== 'string' || !/^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{32})$/.test(value)) {
        return null;
    }
    return value.toLowerCase();
}

function normalizeLegacyHash(candidate) {
    const value = candidate && (candidate.level_hash != null ? candidate.level_hash : candidate.levelHash);
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        return value.replace(/^0+(?=\d)/, '') || '0';
    }
    return null;
}

function sameCandidateIdentity(left, right) {
    const leftExact = normalizeExactHash(left);
    const rightExact = normalizeExactHash(right);
    if (leftExact || rightExact) {
        return leftExact != null && leftExact === rightExact;
    }
    const leftLegacy = normalizeLegacyHash(left);
    const rightLegacy = normalizeLegacyHash(right);
    return leftLegacy != null && leftLegacy === rightLegacy;
}

function rankForCandidate(candidates, target) {
    return candidates.findIndex(candidate => sameCandidateIdentity(candidate, target));
}

function fallbackGlyphForCell(cell) {
    const names = String(cell || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const set = new Set(names);
    const hasCrate = set.has('crate');
    const hasTarget = set.has('target');
    if (set.has('player')) {
        return 'P';
    }
    if (hasCrate && hasTarget) {
        return '@';
    }
    if (hasCrate) {
        return '*';
    }
    if (hasTarget) {
        return 'O';
    }
    if (set.has('wall')) {
        return '#';
    }
    return '.';
}

function candidateRows(candidate, source) {
    if (candidate && Array.isArray(candidate.cells)) {
        const rows = candidateToRows(candidate, source);
        if (rows.length > 0) {
            return rows;
        }
    }
    if (candidate && Array.isArray(candidate.rows)) {
        return candidate.rows.map(row => Array.isArray(row) ? row.join('') : String(row));
    }
    if (candidate && Array.isArray(candidate.cells)) {
        return candidate.cells.map(row => {
            return (Array.isArray(row) ? row : []).map(fallbackGlyphForCell).join('');
        });
    }
    return [];
}

function fullDocumentRange(document) {
    const lastLineIndex = Math.max(0, document.lineCount - 1);
    const lastLine = document.lineAt(lastLineIndex);
    return new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(lastLineIndex, lastLine.text.length)
    );
}

function normalizePositiveInteger(value, fallback) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function renderCandidate(candidate, source) {
    return {
        ...candidate,
        rows: candidateRows(candidate, source),
    };
}

class PuzzleScriptLevelStudioPanel {
    constructor({ context, repoRoot, document, intelligence }) {
        this.context = context;
        this.repoRoot = repoRoot;
        this.document = document;
        this.intelligence = intelligence;
        this.currentRun = null;
        this.currentSolve = null;
        this.batchId = uniqueBatchId();
        this.batch = new CandidateBatchState({ batchId: this.batchId, topCount: 3 });
        this.options = { ...DEFAULT_GENERATOR_OPTIONS, topK: 3 };
        this.sidecar = readSidecarOrDefault(document.uri.fsPath, this.selectedLevel());
        this.generatedLog = new GeneratedLevelsLog(generatedLevelsLogPath(document.uri.fsPath));
        this.disposed = false;
        this.disposables = [];

        this.panel = vscode.window.createWebviewPanel(
            'puzzlescriptLevelStudio',
            'PuzzleScript Level Studio',
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        this.panel.webview.html = this.html();

        this.disposables.push(
            this.panel.onDidDispose(() => this.dispose()),
            this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message)),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.toString() !== this.document.uri.toString()) {
                    return;
                }
                this.document = event.document;
                this.stopGeneration();
                this.postState('documentChanged');
            })
        );
    }

    dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.stopGeneration();
        if (this.currentSolve) {
            this.currentSolve.cancel();
            this.currentSolve = null;
        }
        while (this.disposables.length > 0) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    post(message) {
        if (!this.disposed) {
            this.panel.webview.postMessage(message);
        }
    }

    source() {
        return this.document.getText();
    }

    levels() {
        return findPlayableLevels(this.source()).map(level => ({
            ...level,
            rows: level.rows.slice(),
            board: boardFromLevel(level),
        }));
    }

    selectedLevel(index = 0) {
        const levels = this.levels();
        if (levels.length === 0) {
            return null;
        }
        const normalizedIndex = normalizeLevelIndex(index);
        return levels.find(level => level.level === normalizedIndex) || levels[0];
    }

    diagnostics() {
        if (!this.intelligence || typeof this.intelligence.diagnose !== 'function') {
            return [];
        }
        return this.intelligence.diagnose(this.source()).map(entry => ({
            line: entry.line == null ? 0 : entry.line,
            severity: entry.severity || 'error',
            message: entry.message || '',
        }));
    }

    postState(reason) {
        const source = this.source();
        const config = vscode.workspace.getConfiguration('puzzlescript');
        this.post({
            type: 'state',
            reason,
            specText: this.sidecar.text,
            levels: this.levels(),
            palette: glyphPaletteForSource(source),
            diagnostics: this.diagnostics(),
            generatorOptions: this.options,
            sidecarPath: this.sidecar.path,
            generatedLogPath: this.generatedLog.logPath,
            sourceName: path.basename(this.document.uri.fsPath),
            sourcePath: this.document.uri.fsPath,
            generator: resolveGeneratorPath(config.get('generatorPath'), this.repoRoot),
            solver: resolveSolverPath(config.get('solverPath'), this.repoRoot),
        });
    }

    async handleMessage(message) {
        try {
            switch (message && message.type) {
                case 'ready':
                    this.postState('ready');
                    break;
                case 'paint':
                    await this.paint(message);
                    break;
                case 'solve':
                    await this.solve(message);
                    break;
                case 'runGeneration':
                    await this.runGeneration(message);
                    break;
                case 'stopGeneration':
                    this.stopGeneration();
                    this.post({ type: 'generationStopped' });
                    break;
                case 'adoptCandidate':
                    await this.adoptCandidate(message);
                    break;
                default:
                    break;
            }
        } catch (error) {
            this.post({ type: 'error', message: error.message || String(error) });
        }
    }

    async applySource(nextSource) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.document.uri, fullDocumentRange(this.document), String(nextSource || ''));
        await vscode.workspace.applyEdit(edit);
    }

    async paint(message) {
        const level = this.selectedLevel(message.levelIndex);
        if (!level) {
            throw new Error('No playable level selected.');
        }
        const glyph = String(message.glyph || '');
        if ([...glyph].length !== 1) {
            throw new Error('Choose a single glyph before painting.');
        }
        const x = normalizeLevelIndex(message.x);
        const y = normalizeLevelIndex(message.y);
        const board = boardFromLevel(level);
        if (!board[y] || x >= board[y].length) {
            throw new Error('Paint location is outside the selected level.');
        }
        const rows = rowsFromBoard(replaceGlyphAt(board, x, y, glyph));
        await this.applySource(replaceLevelRowsInSource(this.source(), level, rows));
    }

    async solve(message) {
        const config = vscode.workspace.getConfiguration('puzzlescript');
        const resolved = resolveSolverPath(config.get('solverPath'), this.repoRoot);
        if (!resolved.exists) {
            this.post({
                type: 'error',
                scope: 'solve',
                message: `Native solver not found at ${resolved.path}. Build it with: make build_solver`,
            });
            return;
        }
        const level = this.selectedLevel(message.levelIndex);
        if (!level) {
            throw new Error('No playable level selected.');
        }
        if (this.currentSolve) {
            this.currentSolve.cancel();
            this.currentSolve = null;
        }

        const timeoutMs = normalizePositiveInteger(message.timeoutMs, 1000);
        const strategy = String(message.strategy || 'portfolio');
        const run = new PuzzleScriptSolverRun({
            binaryPath: resolved.path,
            sourceText: this.source(),
            level: level.level,
            timeoutMs,
            strategy,
        });
        this.currentSolve = run;
        this.post({
            type: 'solving',
            levelIndex: level.level,
            timeoutMs,
            strategy,
            solver: resolved,
        });

        try {
            const output = await run.start();
            if (this.currentSolve === run) {
                this.currentSolve = null;
            }
            if (output.cancelled) {
                return;
            }
            this.post({
                type: 'solveResult',
                levelIndex: level.level,
                result: output.result,
                label: statusLabel(output.result),
            });
        } catch (error) {
            if (this.currentSolve === run) {
                this.currentSolve = null;
            }
            this.post({ type: 'error', scope: 'solve', message: error.message || String(error) });
        }
    }

    stopGeneration() {
        if (this.currentRun) {
            this.currentRun.cancel();
            this.currentRun = null;
        }
    }

    async runGeneration(message) {
        this.stopGeneration();

        const config = vscode.workspace.getConfiguration('puzzlescript');
        const resolved = resolveGeneratorPath(config.get('generatorPath'), this.repoRoot);
        if (!resolved.exists) {
            this.post({
                type: 'error',
                scope: 'generation',
                message: `Native generator not found at ${resolved.path}. Build it with: make build_generator`,
            });
            return;
        }

        const level = this.selectedLevel(message.levelIndex);
        if (!level) {
            throw new Error('No playable level selected.');
        }

        this.batchId = uniqueBatchId();
        this.batch = new CandidateBatchState({ batchId: this.batchId, topCount: 3 });

        const requestedOptions = {
            ...this.options,
            ...(message.generatorOptions || message.options || {}),
            topK: 3,
        };
        this.options = normalizeRunOptions(requestedOptions);
        const recipeText = String(message.specText != null ? message.specText : this.sidecar.text || '');
        this.sidecar.text = recipeText;
        const startedAt = Date.now();
        const batchId = this.batchId;
        const run = new PuzzleScriptGeneratorRun({
            binaryPath: resolved.path,
            sourceText: this.source(),
            specText: recipeText,
            runOptions: this.options,
            onProgress: progress => {
                this.post({
                    type: 'generationProgress',
                    batchId,
                    progress,
                    elapsedMs: Date.now() - startedAt,
                });
            },
            onCandidateEvent: event => this.handleCandidateEvent(event, recipeText, level),
        });
        this.currentRun = run;
        this.post({
            type: 'generationStarted',
            batchId,
            levelIndex: level.level,
            generatorOptions: this.options,
            generator: resolved,
        });

        try {
            const output = await run.start();
            if (this.currentRun === run) {
                this.currentRun = null;
            }
            if (output.cancelled) {
                if (this.batchId === batchId) {
                    this.post({ type: 'generationStopped', batchId });
                }
                return;
            }
            this.post({
                type: 'generationFinished',
                batchId,
                result: output.result,
                warnings: output.warnings || [],
            });
        } catch (error) {
            if (this.currentRun === run) {
                this.currentRun = null;
            }
            this.post({ type: 'error', scope: 'generation', message: error.message || String(error) });
        }
    }

    handleCandidateEvent(event, recipeText, sourceLevel) {
        if (!this.batch) {
            return;
        }
        const source = this.source();
        const outcome = this.batch.recordEvaluation(event);
        const solvedTop = this.batch.solvedTop().map(candidate => renderCandidate(candidate, source));
        const timeouts = this.batch.timeoutQueue().map(candidate => renderCandidate(candidate, source));

        this.post({
            type: 'candidateEvent',
            event: renderCandidate(event, source),
            solvedTop,
            timeouts,
        });

        if (event.status !== 'solved' || !outcome.becameTopSolved || !this.batch.shouldLogSolvedTop(event)) {
            return;
        }

        const rank = rankForCandidate(solvedTop, event);
        const matched = rank >= 0 ? solvedTop[rank] : null;
        const legacyHash = event.level_hash != null ? event.level_hash : event.levelHash;
        this.generatedLog.appendIfNewTopSolved({
            sourceFile: this.document.uri.fsPath,
            batchId: this.batchId,
            sourceLevel: sourceLevel ? sourceLevel.level : null,
            timestamp: new Date().toISOString(),
            levelHashHex: event.level_hash_hex || event.levelHashHex,
            levelHash: hasHashValue(legacyHash) ? legacyHash : undefined,
            rankWhenLogged: rank >= 0 ? rank + 1 : '',
            effortScore: matched && matched.effort_score != null
                ? matched.effort_score
                : event.effort_score != null ? event.effort_score : 0,
            solverStatus: event.status || 'solved',
            solverStrategy: event.solver_strategy || event.solverStrategy || this.options.solverStrategy,
            solverBudgetMs: event.solver_budget_ms != null
                ? event.solver_budget_ms
                : event.solverBudgetMs != null ? event.solverBudgetMs : this.options.solverTimeoutMs,
            solutionLength: event.solution_length != null
                ? event.solution_length
                : event.solutionLength != null ? event.solutionLength : Array.isArray(event.solution) ? event.solution.length : 0,
            solution: Array.isArray(event.solution) ? event.solution.slice() : [],
            expanded: event.expanded == null ? 0 : event.expanded,
            generated: event.generated == null ? 0 : event.generated,
            uniqueStates: event.unique_states != null
                ? event.unique_states
                : event.uniqueStates != null ? event.uniqueStates : matched && matched.unique_states != null ? matched.unique_states : 0,
            recipeText,
            rows: candidateRows(event, source),
        });
    }

    async adoptCandidate(message) {
        const level = this.selectedLevel(message.levelIndex);
        if (!level) {
            throw new Error('No playable level selected.');
        }
        const candidate = message.candidate || message.event;
        const rows = candidateRows(candidate, this.source());
        if (rows.length === 0) {
            throw new Error('No candidate rows available to adopt.');
        }
        await this.applySource(replaceLevelRowsInSource(this.source(), level, rows));
    }

    html() {
        const nonce = String(Date.now());
        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:12px}
.app{display:grid;grid-template-rows:auto 1fr;height:100vh}
.tabs{display:flex;gap:6px;padding:10px 10px 0}
.tab{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border);border-bottom:0;border-radius:6px 6px 0 0;padding:6px 10px;cursor:pointer}
.tab.active{background:var(--vscode-editor-background);color:var(--vscode-foreground)}
.panel{display:none;padding:10px;gap:10px;overflow:auto}
.panel.active{display:grid}
#levelsPanel{grid-template-columns:minmax(140px,180px) minmax(240px,1fr) minmax(220px,280px)}
#candidatesPanel{grid-template-columns:minmax(260px,320px) 1fr}
.section{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:10px;background:var(--vscode-sideBar-background)}
.section h2{font-size:11px;text-transform:uppercase;letter-spacing:0;margin:0 0 8px;color:var(--vscode-descriptionForeground)}
.stack{display:grid;gap:8px}
.level-list button,.palette button,.toolbar button,.candidate-actions button,.board-cell{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border);border-radius:4px;cursor:pointer}
.level-list{display:grid;gap:6px}
.level-list button{padding:6px 8px;text-align:left}
.level-list button.active,.palette button.active,.board-cell.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.board{display:grid;gap:2px;align-content:start;justify-content:start}
.board-row{display:grid;grid-auto-flow:column;grid-auto-columns:28px;gap:2px}
.board-cell{width:28px;height:28px;padding:0;font:600 13px/1 var(--vscode-editor-font-family);display:grid;place-items:center}
.palette{display:flex;flex-wrap:wrap;gap:6px}
.palette button{min-width:32px;padding:6px}
textarea,input,select{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;padding:6px;font:12px var(--vscode-font-family)}
textarea{min-height:220px;font-family:var(--vscode-editor-font-family);resize:vertical}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.toolbar,.candidate-actions{display:flex;gap:8px;flex-wrap:wrap}
.toolbar button,.candidate-actions button{padding:6px 10px}
.status,.meta,.diagnostics{white-space:pre-wrap;color:var(--vscode-descriptionForeground)}
.diagnostics{display:grid;gap:6px}
.candidate-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.candidate{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px;background:var(--vscode-editor-background);display:grid;gap:6px}
.mini-board{background:var(--vscode-textCodeBlock-background);border-radius:4px;padding:8px;white-space:pre;font:12px/1.2 var(--vscode-editor-font-family);overflow:auto}
.muted{color:var(--vscode-descriptionForeground)}
</style>
</head>
<body>
<div class="app">
  <div class="tabs">
    <button class="tab active" data-tab="levels">Levels</button>
    <button class="tab" data-tab="candidates">Candidates</button>
  </div>
  <div id="levelsPanel" class="panel active">
    <section class="section stack">
      <h2>Levels</h2>
      <div id="levelList" class="level-list"></div>
      <div class="meta" id="sourceMeta"></div>
      <div class="diagnostics" id="diagnostics"></div>
    </section>
    <section class="section stack">
      <h2>Board</h2>
      <div id="board" class="board"></div>
    </section>
    <section class="section stack">
      <h2>Palette</h2>
      <div id="palette" class="palette"></div>
      <h2>Solve</h2>
      <div class="grid2">
        <label>Timeout ms<input id="solveTimeoutMs" type="number" min="1"></label>
        <label>Strategy
          <select id="solveStrategy">
            <option value="portfolio">portfolio</option>
            <option value="bfs">bfs</option>
            <option value="weighted-astar">weighted-astar</option>
            <option value="greedy">greedy</option>
          </select>
        </label>
      </div>
      <div class="toolbar">
        <button id="solveButton">Solve</button>
      </div>
      <div class="status" id="solveStatus"></div>
    </section>
  </div>
  <div id="candidatesPanel" class="panel">
    <section class="section stack">
      <h2>Recipe</h2>
      <textarea id="recipe" spellcheck="false"></textarea>
      <div class="grid2">
        <label>Seed<input id="seed" type="number"></label>
        <label>Time ms<input id="timeMs" type="number" min="1"></label>
        <label>Samples<input id="samples"></label>
        <label>Jobs<input id="jobs"></label>
        <label>Solver ms<input id="solverTimeoutMs" type="number" min="1"></label>
        <label>Top K<input id="topK" type="number" min="1"></label>
      </div>
      <div class="toolbar">
        <button id="runGenerationButton">Run</button>
        <button id="stopGenerationButton">Stop</button>
      </div>
      <div class="status" id="generationStatus"></div>
      <div class="meta" id="pathMeta"></div>
    </section>
    <section class="section stack">
      <h2>Solved Top</h2>
      <div id="solvedTop" class="candidate-grid"></div>
      <h2>Timeouts</h2>
      <div id="timeouts" class="candidate-grid"></div>
    </section>
  </div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ui = {
  levelList: document.getElementById('levelList'),
  sourceMeta: document.getElementById('sourceMeta'),
  diagnostics: document.getElementById('diagnostics'),
  board: document.getElementById('board'),
  palette: document.getElementById('palette'),
  solveTimeoutMs: document.getElementById('solveTimeoutMs'),
  solveStrategy: document.getElementById('solveStrategy'),
  solveButton: document.getElementById('solveButton'),
  solveStatus: document.getElementById('solveStatus'),
  recipe: document.getElementById('recipe'),
  seed: document.getElementById('seed'),
  timeMs: document.getElementById('timeMs'),
  samples: document.getElementById('samples'),
  jobs: document.getElementById('jobs'),
  solverTimeoutMs: document.getElementById('solverTimeoutMs'),
  topK: document.getElementById('topK'),
  runGenerationButton: document.getElementById('runGenerationButton'),
  stopGenerationButton: document.getElementById('stopGenerationButton'),
  generationStatus: document.getElementById('generationStatus'),
  pathMeta: document.getElementById('pathMeta'),
  solvedTop: document.getElementById('solvedTop'),
  timeouts: document.getElementById('timeouts'),
};

const state = {
  tab: 'levels',
  levels: [],
  palette: [],
  diagnostics: [],
  selectedLevelIndex: 0,
  selectedGlyph: null,
  generatorOptions: {},
  specText: '',
  sourceName: '',
  sourcePath: '',
  sidecarPath: '',
  generatedLogPath: '',
  solveMessage: '',
  solveResult: null,
  solveTimeoutMs: ${DEFAULT_LEVEL_STUDIO_SOLVE_TIMEOUT_MS},
  generationMessage: '',
  solvedTop: [],
  timeouts: [],
  warnings: [],
};

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[char]));
}

function currentLevel() {
  return state.levels.find(level => level.level === state.selectedLevelIndex) || state.levels[0] || null;
}

function readGenerationOptions() {
  return {
    seed: Number(ui.seed.value || 0) || 1,
    timeMs: Number(ui.timeMs.value || 0) || 5000,
    samples: ui.samples.value,
    jobs: ui.jobs.value || 'auto',
    solverTimeoutMs: Number(ui.solverTimeoutMs.value || 0) || 250,
    solverStrategy: ui.solveStrategy.value || 'portfolio',
    topK: Number(ui.topK.value || 0) || 3,
  };
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === tab + 'Panel');
  });
}

function renderLevels() {
  ui.levelList.innerHTML = '';
  state.levels.forEach(level => {
    const button = document.createElement('button');
    button.textContent = 'Level ' + (level.level + 1);
    button.classList.toggle('active', level.level === state.selectedLevelIndex);
    button.addEventListener('click', () => {
      state.selectedLevelIndex = level.level;
      render();
    });
    ui.levelList.appendChild(button);
  });
}

function renderDiagnostics() {
  if (!state.diagnostics.length) {
    ui.diagnostics.textContent = '';
    return;
  }
  ui.diagnostics.innerHTML = state.diagnostics.map(entry => {
    return '<div>' + escapeHtml((entry.severity || 'error') + ' L' + ((entry.line || 0) + 1) + ': ' + entry.message) + '</div>';
  }).join('');
}

function renderBoard() {
  const level = currentLevel();
  ui.board.innerHTML = '';
  if (!level) {
    return;
  }
  (level.rows || []).forEach((row, y) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'board-row';
    [...String(row || '')].forEach((glyph, x) => {
      const cell = document.createElement('button');
      cell.className = 'board-cell';
      cell.textContent = glyph;
      cell.title = 'x ' + x + ', y ' + y;
      cell.addEventListener('click', () => {
        if (!state.selectedGlyph) {
          return;
        }
        vscode.postMessage({
          type: 'paint',
          levelIndex: state.selectedLevelIndex,
          x,
          y,
          glyph: state.selectedGlyph,
        });
      });
      rowEl.appendChild(cell);
    });
    ui.board.appendChild(rowEl);
  });
}

function renderPalette() {
  ui.palette.innerHTML = '';
  const glyphs = state.palette.length ? state.palette : [{ glyph: '.', label: '.' }];
  if (!state.selectedGlyph || !glyphs.some(entry => entry.glyph === state.selectedGlyph)) {
    state.selectedGlyph = glyphs[0].glyph;
  }
  glyphs.forEach(entry => {
    const button = document.createElement('button');
    button.textContent = entry.glyph;
    button.title = entry.label || entry.glyph;
    button.classList.toggle('active', entry.glyph === state.selectedGlyph);
    button.addEventListener('click', () => {
      state.selectedGlyph = entry.glyph;
      renderPalette();
    });
    ui.palette.appendChild(button);
  });
}

function candidateCard(candidate, index, source) {
  const rows = Array.isArray(candidate.rows) ? candidate.rows : [];
  const status = candidate.status || candidate.solverStatus || 'candidate';
  const effort = candidate.effort_score != null ? candidate.effort_score : candidate.unique_states != null ? candidate.unique_states : 0;
  return '<div class="candidate">'
    + '<div class="mini-board">' + escapeHtml(rows.join('\\n')) + '</div>'
    + '<div class="muted">' + escapeHtml('#' + (index + 1) + '  ' + status) + '</div>'
    + '<div class="muted">' + escapeHtml('effort ' + effort) + '</div>'
    + '<div class="candidate-actions"><button data-adopt="' + source + ':' + index + '">Adopt</button></div>'
    + '</div>';
}

function renderCandidates() {
  ui.solvedTop.innerHTML = state.solvedTop.map((candidate, index) => candidateCard(candidate, index, 'solved')).join('');
  ui.timeouts.innerHTML = state.timeouts.map((candidate, index) => candidateCard(candidate, index, 'timeout')).join('');
}

function render() {
  renderLevels();
  renderDiagnostics();
  renderBoard();
  renderPalette();
  renderCandidates();
  ui.sourceMeta.textContent = [state.sourceName, state.sourcePath].filter(Boolean).join('\\n');
  ui.pathMeta.textContent = [state.sidecarPath, state.generatedLogPath].filter(Boolean).join('\\n');
  ui.solveStatus.textContent = state.solveMessage;
  ui.generationStatus.textContent = [state.generationMessage].concat(state.warnings || []).filter(Boolean).join('\\n');
}

document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => setTab(button.dataset.tab));
});

ui.solveButton.addEventListener('click', () => {
  vscode.postMessage({
    type: 'solve',
    levelIndex: state.selectedLevelIndex,
    timeoutMs: Number(ui.solveTimeoutMs.value || 0) || ${DEFAULT_LEVEL_STUDIO_SOLVE_TIMEOUT_MS},
    strategy: ui.solveStrategy.value || 'portfolio',
  });
});

ui.solveTimeoutMs.addEventListener('input', () => {
  state.solveTimeoutMs = Number(ui.solveTimeoutMs.value || 0) || ${DEFAULT_LEVEL_STUDIO_SOLVE_TIMEOUT_MS};
});

ui.runGenerationButton.addEventListener('click', () => {
  state.warnings = [];
  vscode.postMessage({
    type: 'runGeneration',
    levelIndex: state.selectedLevelIndex,
    specText: ui.recipe.value,
    generatorOptions: readGenerationOptions(),
  });
});

ui.stopGenerationButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'stopGeneration' });
});

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const token = target.getAttribute('data-adopt');
  if (!token) {
    return;
  }
  const parts = token.split(':');
  const collection = parts[0] === 'timeout' ? state.timeouts : state.solvedTop;
  const candidate = collection[Number(parts[1])];
  if (!candidate) {
    return;
  }
  vscode.postMessage({
    type: 'adoptCandidate',
    levelIndex: state.selectedLevelIndex,
    candidate,
  });
});

window.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type === 'state') {
    state.levels = Array.isArray(msg.levels) ? msg.levels : [];
    state.palette = Array.isArray(msg.palette) ? msg.palette : [];
    state.diagnostics = Array.isArray(msg.diagnostics) ? msg.diagnostics : [];
    state.generatorOptions = msg.generatorOptions || {};
    state.sourceName = msg.sourceName || '';
    state.sourcePath = msg.sourcePath || '';
    state.sidecarPath = msg.sidecarPath || '';
    state.generatedLogPath = msg.generatedLogPath || '';
    state.specText = msg.specText || '';
    if (!state.levels.some(level => level.level === state.selectedLevelIndex)) {
      state.selectedLevelIndex = state.levels[0] ? state.levels[0].level : 0;
    }
    ui.recipe.value = state.specText;
    ui.seed.value = state.generatorOptions.seed != null ? state.generatorOptions.seed : 1;
    ui.timeMs.value = state.generatorOptions.timeMs != null ? state.generatorOptions.timeMs : 5000;
    ui.samples.value = state.generatorOptions.samples != null ? state.generatorOptions.samples : '';
    ui.jobs.value = state.generatorOptions.jobs != null ? state.generatorOptions.jobs : 'auto';
    ui.solverTimeoutMs.value = state.generatorOptions.solverTimeoutMs != null ? state.generatorOptions.solverTimeoutMs : 250;
    ui.topK.value = state.generatorOptions.topK != null ? state.generatorOptions.topK : 3;
    ui.solveTimeoutMs.value = state.solveTimeoutMs != null ? state.solveTimeoutMs : ${DEFAULT_LEVEL_STUDIO_SOLVE_TIMEOUT_MS};
    ui.solveStrategy.value = state.generatorOptions.solverStrategy || 'portfolio';
    render();
    return;
  }
  if (msg.type === 'solving') {
    state.solveMessage = 'Solving level ' + (msg.levelIndex + 1) + '...';
    render();
    return;
  }
  if (msg.type === 'solveResult') {
    state.solveResult = msg.result || null;
    state.solveMessage = msg.label || '';
    render();
    return;
  }
  if (msg.type === 'generationStarted') {
    state.generationMessage = 'Generating...';
    state.solvedTop = [];
    state.timeouts = [];
    render();
    return;
  }
  if (msg.type === 'generationProgress') {
    const progress = msg.progress || {};
    state.generationMessage = 'Generating... ' + Object.keys(progress).map(key => key + '=' + progress[key]).join(' ');
    render();
    return;
  }
  if (msg.type === 'candidateEvent') {
    state.solvedTop = Array.isArray(msg.solvedTop) ? msg.solvedTop : [];
    state.timeouts = Array.isArray(msg.timeouts) ? msg.timeouts : [];
    render();
    return;
  }
  if (msg.type === 'generationFinished') {
    state.generationMessage = 'Generation finished';
    state.warnings = Array.isArray(msg.warnings) ? msg.warnings : [];
    render();
    return;
  }
  if (msg.type === 'generationStopped') {
    state.generationMessage = 'Generation stopped';
    render();
    return;
  }
  if (msg.type === 'error') {
    if (msg.scope === 'solve') {
      state.solveMessage = msg.message || 'Error';
    } else {
      state.generationMessage = msg.message || 'Error';
    }
    render();
  }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}

module.exports = {
    PuzzleScriptLevelStudioPanel,
    candidateRows,
    isPuzzleScriptCandidateDocument,
};
