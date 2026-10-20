// Main-thread side of the PuzzleScript autocomplete model: the ghost-text provider the
// CM6 plugin calls (see codemirror6/plugins/ghost-text.js), the worker client, the
// editor setting and its toolbar toggle.
//
// Per request: an isolated parser pass over the document gives the symbol table and the
// baseline error count; the shared context builder (autocomplete/pipeline/context.js)
// renders the prompt in SPM order; the worker generates up to one line; the gate
// (autocomplete_gate.js) rejects candidates that add parse errors, unbalance brackets,
// mismatch cell counts or reference undeclared names. Nothing loads until the setting is
// on and the user pauses in the editor.
(function() {
    "use strict";

    const SETTING_KEY = "aiGhostText";
    const WORKER_VERSION = "4";   // bump when the worker changes: module workers are cached hard
    const MODEL_KEY = "aiGhostTextModel";
    const DEFAULT_MODEL = "ps-ac-xs";

    const Context = globalThis.PuzzleScriptAutocompleteContext;
    const Symbols = globalThis.PuzzleScriptAutocompleteSymbols;
    const Gate = globalThis.PuzzleScriptAutocompleteGate;

    let worker = null;
    let ready = null;
    let nextId = 1;
    const pending = new Map();
    let status = "off";
    let lastInfo = null;

    function storageGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }

    function enabled() { return storageGet(SETTING_KEY) === "true"; }
    function modelName() { return storageGet(MODEL_KEY) || DEFAULT_MODEL; }

    // bin/ serves the bundle from js/scripts_compiled.js and the raw files from js/source/.
    function sourceDir() {
        const bundled = document.querySelector('script[src$="scripts_compiled.js"]');
        return bundled ? "js/source/" : "js/";
    }

    function paths() {
        const name = modelName();
        return {
            workerUrl: sourceDir() + "autocomplete_model_worker.js?v=" + WORKER_VERSION,
            vendorUrl: new URL(sourceDir() + "vendor/", document.baseURI).href,
            modelUrl: new URL("models/" + name + ".int8.onnx", document.baseURI).href,
            configUrl: new URL("models/" + name + ".config.json", document.baseURI).href,
            tokenizerUrl: new URL("models/tokenizer.json", document.baseURI).href,
        };
    }

    function setStatus(text) {
        status = text;
        const el = document.getElementById("aiGhostTextStatus");
        if (el) el.textContent = text === "off" || text === "ready" ? "" : " (" + text + ")";
    }

    function updateToolbar() {
        const link = document.getElementById("aiGhostTextClickLink");
        if (link) link.textContent = enabled() ? "AI ON" : "AI OFF";
    }

    function setEnabled(value) {
        storageSet(SETTING_KEY, value ? "true" : "false");
        updateToolbar();
        if (value) ensureWorker().catch(() => {});
        else setStatus("off");
    }

    function toggle() { setEnabled(!enabled()); }

    function ensureWorker() {
        if (ready) return ready;
        const p = paths();
        setStatus("loading model");
        worker = new Worker(p.workerUrl, { type: "module" });
        ready = new Promise((resolve, reject) => {
            worker.onmessage = event => {
                const m = event.data;
                if (m.type === "ready") { lastInfo = m.info; setStatus("ready"); resolve(m.info); return; }
                if (m.type === "result") {
                    const entry = pending.get(m.id);
                    if (entry) { pending.delete(m.id); entry.resolve(m); }
                    return;
                }
                if (m.type === "error") {
                    if (m.id != null) {
                        const entry = pending.get(m.id);
                        if (entry) { pending.delete(m.id); entry.reject(new Error(m.message)); }
                    } else {
                        setStatus("model failed: " + m.message);
                        reject(new Error(m.message));
                    }
                }
            };
            worker.onerror = event => {
                setStatus("worker failed");
                reject(new Error(event.message || "worker error"));
            };
            worker.postMessage({
                type: "init",
                modelUrl: p.modelUrl, configUrl: p.configUrl, tokenizerUrl: p.tokenizerUrl,
                vendorUrl: p.vendorUrl,
                provider: storageGet("aiGhostTextProvider") || "wasm"
            });
        });
        return ready;
    }

    function generate(parts, options, isCancelled) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            worker.postMessage({ type: "generate", id, parts, maxTokens: options.maxTokens, stop: options.stop });
            // Poll cancellation cheaply so a stale request stops burning CPU.
            const timer = setInterval(() => {
                if (!pending.has(id)) { clearInterval(timer); return; }
                if (isCancelled()) { worker.postMessage({ type: "cancel", id }); clearInterval(timer); }
            }, 50);
        });
    }

    async function request({ doc, pos, isCancelled }) {
        if (!enabled()) return null;
        if (!Context || !Symbols || !Gate) return null;
        const runtime = globalThis.PuzzleScriptCM6Runtime;
        const StringStream = runtime && runtime.StringStream;
        if (!StringStream) return null;

        const baseline = Gate.parseIsolated(doc, StringStream);
        const symbols = Symbols.symbolsFromParserState(baseline.state || {});
        const config = Object.assign({}, Context.DEFAULT_CONFIG, globalThis.PuzzleScriptAutocompleteContextConfig || {});
        const ctx = Context.buildContext({ text: doc, from: pos, to: pos, symbols, config });
        // The worker assembles the SPM prompt from the parts and trims it to the model's
        // context by token count (the char budget alone cannot guarantee a fit).
        const parts = { header: ctx.header, suffix: ctx.suffix, prefix: ctx.prefix };

        try { await ensureWorker(); } catch (e) { return null; }
        if (isCancelled()) return null;
        setStatus("thinking");
        let result;
        try {
            result = await generate(parts, { maxTokens: 48, stop: "line" }, isCancelled);
        } catch (error) {
            setStatus("error: " + error.message);
            return null;
        }
        setStatus("ready");
        if (!result || result.cancelled) return null;
        const text = (result.text || "").replace(/\s+$/, "");
        const verdict = text === "" ? { ok: false, reason: "empty" }
            : Gate.check({ text: doc, from: pos, to: pos, candidate: text, StringStream, baseline });
        lastInfo = Object.assign({}, lastInfo, { lastMs: result.ms, lastGate: verdict, lastText: text, cached: result.cachedTokens, prefill: result.prefillTokens });
        if (!verdict.ok) return null;
        return text;
    }

    function install() {
        const link = document.getElementById("aiGhostTextClickLink");
        if (link) link.addEventListener("click", event => { event.preventDefault(); toggle(); });
        updateToolbar();
        if (enabled()) ensureWorker().catch(() => {});
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
    else install();

    globalThis.PuzzleScriptAutocompleteModel = Object.freeze({
        enabled, setEnabled, toggle, request, ensureWorker,
        info: () => lastInfo, status: () => status, paths
    });
})();
