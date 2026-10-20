// Phase 1.5 browser spike: load the random-weight ONNX exports and measure size, load
// time, memory and warm latency (200-token prompt + 16 cached decode steps) per size,
// per variant (int8 / fp32 / fp16) and per execution provider (wasm / webgpu).
//
// Query params: ?auto=1 runs everything on load; ?threads=N sets ort.env.wasm.numThreads
// before the first session is created (default 1); sizes=, variants=, eps=, reps=.

'use strict';

// Architecture facts the page needs to build the empty cache (see train/model.py SIZES).
const ARCH = {
    xs: { layers: 6, heads: 4, headDim: 64 },
    s: { layers: 8, heads: 6, headDim: 64 },
    m: { layers: 8, heads: 8, headDim: 64 },
};
const VARIANT_FILE = { int8: '.int8.onnx', fp32: '.onnx', fp16: '.fp16.onnx' };

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const results = [];
let tokenizer = null;

function log(msg, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `[${(performance.now() / 1000).toFixed(1)}s] ${msg}`;
    $('log').appendChild(line);
    $('log').scrollTop = $('log').scrollHeight;
}

async function memoryMB() {
    try {
        if (performance.measureUserAgentSpecificMemory) {
            const m = await performance.measureUserAgentSpecificMemory();
            return m.bytes / 1e6;
        }
    } catch (e) { /* not cross-origin isolated */ }
    if (performance.memory) return performance.memory.usedJSHeapSize / 1e6;
    return NaN;
}

function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
}

// ORT's WASM module binds console.error at initialisation, so the hook has to be in
// place before the first session is created (init() installs it). Everything logged
// afterwards lands in ortLog; captureConsole() slices the part produced by one call.
const ortLog = [];
function installConsoleHook() {
    for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
        const orig = console[k].bind(console);
        console[k] = (...args) => { ortLog.push(args.map(String).join(' ')); if (ortLog.length > 200000) ortLog.splice(0, 100000); orig(...args); };
    }
}
async function captureConsole(fn) {
    const start = ortLog.length;
    const result = await fn();
    return { result, lines: ortLog.slice(start) };
}

// Each placement line arrives as its own console message with an ORT prefix:
//   "... VerifyEachNodeIsAssignedToAnEp]  Node(s) placed on [CPUExecutionProvider]. Number of nodes: 81"
//   "... VerifyEachNodeIsAssignedToAnEp]   Shape (node_Shape_5)"
function parsePlacements(lines) {
    const out = { cpuNodes: 0, cpuOps: {}, providers: {}, sawPlacements: false };
    let current = null;
    for (const line of lines) {
        let m = line.match(/Node\(s\) placed on \[(\w+)\]\. Number of nodes: (\d+)/);
        if (m) {
            out.sawPlacements = true;
            current = m[1];
            out.providers[current] = (out.providers[current] || 0) + Number(m[2]);
            if (current === 'CPUExecutionProvider') out.cpuNodes += Number(m[2]);
            continue;
        }
        m = line.match(/All nodes placed on \[(\w+)\]\. Number of nodes: (\d+)/);
        if (m) { out.sawPlacements = true; out.providers[m[1]] = Number(m[2]); current = null; continue; }
        if (current === 'CPUExecutionProvider') {
            m = line.match(/VerifyEachNodeIsAssignedToAnEp\]\s+(\w+) \(/);
            if (m) out.cpuOps[m[1]] = (out.cpuOps[m[1]] || 0) + 1;
        }
    }
    out.notAssignedWarning = lines.some((l) => /were not assigned to the preferred execution providers/.test(l));
    return out;
}

function int64(arr) { return new ort.Tensor('int64', BigInt64Array.from(arr, (x) => BigInt(x)), [1, arr.length]); }

function emptyPast(arch) {
    const feeds = {};
    for (let i = 0; i < arch.layers; i++) {
        feeds[`past_key_values.${i}.key`] = new ort.Tensor('float32', new Float32Array(0), [1, arch.heads, 0, arch.headDim]);
        feeds[`past_key_values.${i}.value`] = new ort.Tensor('float32', new Float32Array(0), [1, arch.heads, 0, arch.headDim]);
    }
    return feeds;
}

function argmaxLast(logits) {
    const dims = logits.dims;
    const vocab = dims[2];
    const data = logits.data;
    const off = (dims[1] - 1) * vocab;
    let best = 0, bestV = -Infinity;
    for (let i = 0; i < vocab; i++) if (data[off + i] > bestV) { bestV = data[off + i]; best = i; }
    return best;
}

// One prompt + N decode steps. Returns {promptMs, decodeMs: [...], tokens}.
async function runSequence(session, arch, promptIds, decodeSteps) {
    let feeds = { input_ids: int64(promptIds), position_ids: int64(promptIds.map((_, i) => i)), ...emptyPast(arch) };
    let t0 = performance.now();
    let out = await session.run(feeds);
    const promptMs = performance.now() - t0;
    let pos = promptIds.length;
    let next = argmaxLast(out.logits);
    const decodeMs = [], tokens = [];
    for (let step = 0; step < decodeSteps; step++) {
        const prevOut = out;
        feeds = { input_ids: int64([next]), position_ids: int64([pos]) };
        for (let i = 0; i < arch.layers; i++) {
            feeds[`past_key_values.${i}.key`] = prevOut[`present.${i}.key`];
            feeds[`past_key_values.${i}.value`] = prevOut[`present.${i}.value`];
        }
        t0 = performance.now();
        out = await session.run(feeds);
        decodeMs.push(performance.now() - t0);
        for (let i = 0; i < arch.layers; i++) {
            const k = prevOut[`present.${i}.key`], v = prevOut[`present.${i}.value`];
            if (k.location === 'gpu-buffer') { k.dispose(); v.dispose(); }
        }
        tokens.push(next);
        next = argmaxLast(out.logits);
        pos++;
    }
    for (let i = 0; i < arch.layers; i++) {
        const k = out[`present.${i}.key`], v = out[`present.${i}.value`];
        if (k.location === 'gpu-buffer') { k.dispose(); v.dispose(); }
    }
    return { promptMs, decodeMs, tokens };
}

async function measure(size, variant, ep, opts) {
    const arch = ARCH[size];
    const row = { size, variant, ep, threads: opts.threads, status: 'running' };
    results.push(row);
    render();
    const url = `/models/${size}${VARIANT_FILE[variant]}`;
    try {
        row.memBefore = await memoryMB();
        let t0 = performance.now();
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        row.fetchMs = performance.now() - t0;
        row.fileMB = bytes.byteLength / 1e6;

        const sessionOptions = {
            executionProviders: [ep],
            graphOptimizationLevel: 'all',
            logSeverityLevel: 2,
        };
        if (ep === 'webgpu') {
            // keep the KV cache on the GPU between steps; logits come back to the CPU
            const loc = {};
            for (let i = 0; i < arch.layers; i++) { loc[`present.${i}.key`] = 'gpu-buffer'; loc[`present.${i}.value`] = 'gpu-buffer'; }
            sessionOptions.preferredOutputLocation = loc;
        }
        // 1) a verbose throwaway session to read the node placements (verbose logging also
        //    prints every WebGPU program launch, which would distort the timings);
        // 2) the quiet session that is timed.
        let lines = [];
        if (ep === 'webgpu') {
            const probe = await captureConsole(() => ort.InferenceSession.create(bytes, { ...sessionOptions, logSeverityLevel: 0, logVerbosityLevel: 1 }));
            lines = probe.lines;
            await probe.result.release();
        }
        t0 = performance.now();
        const session = await ort.InferenceSession.create(bytes, sessionOptions);
        row.createMs = performance.now() - t0;
        const placement = parsePlacements(lines);
        window.lastPlacementLines = lines;
        row.cpuNodes = placement.sawPlacements ? placement.cpuNodes : (placement.notAssignedWarning ? 'some (unparsed)' : (ep === 'wasm' ? 'all' : 'unknown'));
        row.cpuOps = Object.entries(placement.cpuOps).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
        row.providers = placement.providers;
        if (ep === 'webgpu' && placement.sawPlacements && !placement.providers.WebGpuExecutionProvider && placement.providers.CPUExecutionProvider === undefined) {
            row.cpuOps += ' (no WebGPU nodes seen)';
        }
        row.memAfterLoad = await memoryMB();

        const promptIds = opts.promptIds.slice(0, opts.promptTokens);
        t0 = performance.now();
        const first = await runSequence(session, arch, promptIds, opts.decodeTokens);
        row.coldMs = performance.now() - t0;
        row.firstTokens = first.tokens.slice(0, 6).join(',');
        const prompts = [], decodes = [], totals = [];
        for (let r = 0; r < opts.reps; r++) {
            const t = performance.now();
            const seq = await runSequence(session, arch, promptIds, opts.decodeTokens);
            totals.push(performance.now() - t);
            prompts.push(seq.promptMs);
            decodes.push(seq.decodeMs.reduce((a, b) => a + b, 0) / seq.decodeMs.length);
            if (seq.tokens.join(',') !== first.tokens.join(',')) row.nondeterministic = true;
        }
        row.promptMs = median(prompts);
        row.decodeMs = median(decodes);
        row.totalMs = median(totals);
        row.memAfter = await memoryMB();
        row.status = 'ok';
        await session.release();
        log(`${size} ${variant} ${ep}: ${row.fileMB.toFixed(1)} MB, create ${row.createMs.toFixed(0)} ms, cold ${row.coldMs.toFixed(0)} ms, warm prompt ${row.promptMs.toFixed(1)} ms, decode ${row.decodeMs.toFixed(2)} ms/tok, total ${row.totalMs.toFixed(0)} ms, cpu nodes ${row.cpuNodes} ${row.cpuOps}`, 'ok');
    } catch (e) {
        row.status = 'error: ' + (e && e.message ? e.message : e);
        log(`${size} ${variant} ${ep}: ${row.status}`, 'bad');
    }
    render();
    return row;
}

function fmt(x, d = 0) { return typeof x === 'number' && isFinite(x) ? x.toFixed(d) : (x === undefined ? '' : String(x)); }

function render() {
    const tbody = $('results').querySelector('tbody');
    tbody.innerHTML = '';
    for (const r of results) {
        const tr = document.createElement('tr');
        const cells = [r.size, r.variant, r.ep, fmt(r.fileMB, 1), fmt(r.fetchMs), fmt(r.createMs), fmt(r.coldMs),
            fmt(r.promptMs, 1), fmt(r.decodeMs, 2), fmt(r.totalMs), fmt(r.memBefore), fmt(r.memAfter), fmt(r.cpuNodes), r.cpuOps || '', r.status];
        cells.forEach((c, i) => { const td = document.createElement('td'); td.textContent = c; if (i === 13 || i === 14) td.className = 'l'; tr.appendChild(td); });
        tbody.appendChild(tr);
    }
}

function markdown() {
    const head = '| size | variant | EP | threads | file MB | create ms | cold ms | warm prompt ms | warm decode ms/tok | warm total ms | mem before MB | mem after MB | nodes on CPU | status |';
    const rows = results.map((r) => `| ${r.size} | ${r.variant} | ${r.ep} | ${r.threads} | ${fmt(r.fileMB, 1)} | ${fmt(r.createMs)} | ${fmt(r.coldMs)} | ${fmt(r.promptMs, 1)} | ${fmt(r.decodeMs, 2)} | ${fmt(r.totalMs)} | ${fmt(r.memBefore)} | ${fmt(r.memAfter)} | ${fmt(r.cpuNodes)}${r.cpuOps ? ' (' + r.cpuOps + ')' : ''} | ${r.status} |`);
    return [head, '|' + '---|'.repeat(14), ...rows].join('\n');
}

async function loadTokenizer() {
    const t0 = performance.now();
    const json = await (await fetch('/tokenizer/tokenizer.json', { cache: 'no-store' })).json();
    tokenizer = BpeTokenizer.fromJSON(json);
    return performance.now() - t0;
}

async function tokenizerCheck() {
    const out = $('tokres');
    try {
        const loadMs = await loadTokenizer();
        const fixture = await (await fetch('/tokenizer/fixture.json', { cache: 'no-store' })).json();
        let encodeOk = 0, roundTripOk = 0, chars = 0, tokens = 0, failures = [];
        const t0 = performance.now();
        for (const c of fixture.cases) {
            const ids = tokenizer.encode(c.text);
            chars += c.text.length; tokens += ids.length;
            const sameIds = ids.length === c.ids.length && ids.every((x, i) => x === c.ids[i]);
            const text = tokenizer.decode(ids);
            if (sameIds) encodeOk++; else if (failures.length < 5) failures.push({ text: c.text.slice(0, 80), js: ids.slice(0, 20), py: c.ids.slice(0, 20) });
            if (text === c.text) roundTripOk++;
        }
        const ms = performance.now() - t0;
        const msg = `tokenizer.json loaded in ${loadMs.toFixed(0)} ms, vocab ${tokenizer.vocabSize}; ` +
            `${encodeOk}/${fixture.cases.length} cases match the Python ids, ${roundTripOk}/${fixture.cases.length} round-trip exactly; ` +
            `${chars} chars -> ${tokens} tokens in ${ms.toFixed(0)} ms (${(chars / tokens).toFixed(2)} chars/token)`;
        out.textContent = msg;
        out.className = encodeOk === fixture.cases.length && roundTripOk === fixture.cases.length ? 'ok' : 'bad';
        log(msg, out.className);
        if (failures.length) log('first mismatches: ' + JSON.stringify(failures), 'bad');
        window.tokenizerResult = { loadMs, cases: fixture.cases.length, encodeOk, roundTripOk, chars, tokens, ms };
    } catch (e) {
        out.textContent = 'tokenizer check failed: ' + e.message; out.className = 'bad'; log(out.textContent, 'bad');
    }
}

async function promptIds(n) {
    if (!tokenizer) await loadTokenizer();
    const fixture = await (await fetch('/tokenizer/fixture.json', { cache: 'no-store' })).json();
    let ids = [];
    for (const c of fixture.cases) { ids = ids.concat(tokenizer.encode(c.text)); if (ids.length >= n) break; }
    while (ids.length < n) ids = ids.concat(ids);
    return ids.slice(0, n);
}

async function runAll() {
    $('run').disabled = true;
    const sizes = $('sizes').value.split(',').map((s) => s.trim()).filter(Boolean);
    const variants = $('variants').value.split(',').map((s) => s.trim()).filter(Boolean);
    const eps = $('eps').value.split(',').map((s) => s.trim()).filter(Boolean);
    const opts = {
        reps: Number($('reps').value), promptTokens: Number($('prompt').value), decodeTokens: Number($('decode').value),
        threads: ort.env.wasm.numThreads,
    };
    opts.promptIds = await promptIds(opts.promptTokens);
    log(`prompt: ${opts.promptTokens} tokens, decode ${opts.decodeTokens}, reps ${opts.reps}, wasm threads ${opts.threads}, webgpu ${!!navigator.gpu}`);
    for (const ep of eps) {
        if (ep === 'webgpu' && !navigator.gpu) { log('no navigator.gpu: skipping webgpu', 'bad'); continue; }
        for (const size of sizes) for (const variant of variants) await measure(size, variant, ep, opts);
    }
    window.spikeResults = results;
    window.spikeDone = true;
    log('done');
    $('run').disabled = false;
}

async function init() {
    installConsoleHook();
    $('ortver').textContent = ort.env.versions ? ort.env.versions.common : '';
    ort.env.wasm.wasmPaths = '/ort/';
    const threads = Number(params.get('threads') || $('threads').value || 1);
    $('threads').value = threads;
    ort.env.wasm.numThreads = threads;
    ort.env.wasm.proxy = false;
    let gpuInfo = 'none';
    if (navigator.gpu) {
        try {
            const adapter = await navigator.gpu.requestAdapter();
            const info = adapter && (adapter.info || (adapter.requestAdapterInfo && await adapter.requestAdapterInfo()));
            gpuInfo = info ? `${info.vendor || ''} ${info.architecture || ''} ${info.description || ''}`.trim() : 'adapter without info';
            if (adapter && adapter.features) gpuInfo += adapter.features.has('shader-f16') ? ' (shader-f16)' : ' (no shader-f16)';
        } catch (e) { gpuInfo = 'requestAdapter failed: ' + e.message; }
    }
    $('env').textContent = `UA: ${navigator.userAgent}; cores ${navigator.hardwareConcurrency}; crossOriginIsolated ${self.crossOriginIsolated}; ` +
        `SharedArrayBuffer ${typeof SharedArrayBuffer !== 'undefined'}; WebGPU adapter: ${gpuInfo}; measureUserAgentSpecificMemory ${!!performance.measureUserAgentSpecificMemory}`;
    for (const k of ['sizes', 'variants', 'eps', 'reps', 'prompt', 'decode']) if (params.get(k)) $(k).value = params.get(k);
    $('run').onclick = runAll;
    $('tok').onclick = tokenizerCheck;
    $('copy').onclick = () => navigator.clipboard.writeText(JSON.stringify(results, null, 1));
    $('md').onclick = () => navigator.clipboard.writeText(markdown());
    window.spikeMarkdown = markdown;
    if (params.get('auto')) { await tokenizerCheck(); await runAll(); }
}

init();
