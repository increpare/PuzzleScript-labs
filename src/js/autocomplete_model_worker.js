// Web Worker that runs the PuzzleScript autocomplete model with onnxruntime-web.
// Module worker: started by js/autocomplete_model.js as
//   new Worker("js/autocomplete_model_worker.js", {type: "module"})
//
// Messages in:
//   {type: "init", modelUrl, configUrl, tokenizerUrl, vendorUrl, provider}
//       provider: "wasm" (default) or "webgpu"
//   {type: "generate", id, parts: {header, suffix, prefix}, maxTokens, stop}
//       stop: "line" | "block" | "eos"; `prompt` (a flat string) is accepted instead of parts
//   {type: "cancel", id}
// Messages out:
//   {type: "ready", info}  {type: "error", id?, message}
//   {type: "result", id, text, tokens, ms, prefillTokens, cachedTokens, healedTail}
//
// The exported graph (autocomplete/train/export_onnx.py) takes input_ids, position_ids
// and past_key_values.<i>.key/value [1, heads, past, headDim] (no attention mask: the
// graph is causal from the shapes, batch 1 only), and returns logits plus
// present.<i>.key/value. The KV cache of the previous request is kept and the longest
// shared token prefix with the new prompt is reused, so while the user types on a line
// only the new tokens are prefilled (the editor renders prompts in SPM order, where the
// prefix comes last, for exactly this reason).
//
// Token healing: the prompt's last pre-token (a word with its leading space, or a run of
// spaces; structural tokens and newlines are always whole tokens) is cut off and
// regenerated under the constraint that the output starts with it, so a cursor after
// "| " or inside "Pla" does not leave the model with a token split it never saw.

import * as ort from "./vendor/onnxruntime-web/ort.wasm.min.mjs"
import {Tokenizer} from "./vendor/tokenizers/tokenizers.min.mjs"

const PREFILL_CHUNK = 256
const MAX_POSITIONS = 2048   // the model's context; prompts that would overrun it are refused

// The pre-tokeniser (train/tokenizer.py) isolates newline, "->", "=+", "[ ] | , ( )" and
// " ?\S+| +"; a word tail therefore never contains those characters.
const TAIL = /( ?[^\s\[\]|,()=]+| +)$/

let session = null
let tokenizer = null
let graph = null          // {layers, kvHeads, headDim, eosId}
let vocabStrings = null   // id -> decoded string, for token healing
let cache = {ids: [], kv: null}
const cancelled = new Set()
let busy = Promise.resolve()

function post(message) { self.postMessage(message) }

async function init(options) {
  const vendorUrl = options.vendorUrl || new URL("./vendor/", import.meta.url).href
  ort.env.wasm.wasmPaths = vendorUrl + "onnxruntime-web/"
  ort.env.wasm.numThreads = (self.crossOriginIsolated ? Math.min(4, self.navigator.hardwareConcurrency || 1) : 1)

  const [tokenizerJson, config] = await Promise.all([
    fetch(options.tokenizerUrl).then(r => { if (!r.ok) throw new Error("tokenizer " + r.status); return r.json() }),
    fetch(options.configUrl).then(r => { if (!r.ok) throw new Error("model config " + r.status); return r.json() })
  ])
  tokenizer = new Tokenizer(tokenizerJson, {})

  const providers = options.provider === "webgpu" ? ["webgpu", "wasm"] : ["wasm"]
  const t0 = performance.now()
  session = await ort.InferenceSession.create(options.modelUrl, {
    executionProviders: providers,
    graphOptimizationLevel: "all"
  })
  const loadMs = performance.now() - t0

  const heads = config.num_attention_heads
  const kvHeads = config.num_key_value_heads || heads
  const layers = config.num_hidden_layers
  const headDim = config.head_dim || Math.floor(config.hidden_size / heads)
  const eosId = tokenizer.encode("<EOS>", {add_special_tokens: false}).ids[0]
  graph = {layers, kvHeads, headDim, eosId}

  const vocabSize = config.vocab_size || 8192
  vocabStrings = new Array(vocabSize)
  for (let i = 0; i < vocabSize; i++) {
    try { vocabStrings[i] = tokenizer.decode([i], {skip_special_tokens: false}) } catch (e) { vocabStrings[i] = "" }
  }
  cache = {ids: [], kv: null}
  post({type: "ready", info: {
    loadMs: Math.round(loadMs),
    inputs: session.inputNames,
    outputs: session.outputNames,
    providers
  }})
}

function emptyKV() {
  const kv = []
  for (let i = 0; i < graph.layers; i++) {
    kv.push({
      key: new ort.Tensor("float32", new Float32Array(0), [1, graph.kvHeads, 0, graph.headDim]),
      value: new ort.Tensor("float32", new Float32Array(0), [1, graph.kvHeads, 0, graph.headDim])
    })
  }
  return kv
}

// Keep the first `length` positions of every layer's key/value.
function sliceKV(kv, length) {
  if (!kv) return emptyKV()
  const out = []
  for (const layer of kv) {
    const [b, h, t, d] = layer.key.dims
    if (length >= t) { out.push(layer); continue }
    const keep = h * length * d
    const key = new Float32Array(keep), value = new Float32Array(keep)
    for (let head = 0; head < h; head++) {
      const src = head * t * d, dst = head * length * d
      key.set(layer.key.data.subarray(src, src + length * d), dst)
      value.set(layer.value.data.subarray(src, src + length * d), dst)
    }
    out.push({
      key: new ort.Tensor("float32", key, [b, h, length, d]),
      value: new ort.Tensor("float32", value, [b, h, length, d])
    })
  }
  return out
}

async function step(ids, kv, pastLength) {
  const n = ids.length
  const feeds = {
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, x => BigInt(x)), [1, n]),
    position_ids: new ort.Tensor("int64", BigInt64Array.from({length: n}, (_, i) => BigInt(pastLength + i)), [1, n])
  }
  for (let i = 0; i < graph.layers; i++) {
    feeds[`past_key_values.${i}.key`] = kv[i].key
    feeds[`past_key_values.${i}.value`] = kv[i].value
  }
  const out = await session.run(feeds)
  const next = []
  for (let i = 0; i < graph.layers; i++) {
    next.push({key: out[`present.${i}.key`], value: out[`present.${i}.value`]})
  }
  const logits = out.logits
  const vocab = logits.dims[2]
  const last = logits.data.subarray((n - 1) * vocab, n * vocab)
  return {kv: next, last}
}

function argmax(row) {
  let best = 0, bestValue = -Infinity
  for (let i = 0; i < row.length; i++) if (row[i] > bestValue) { bestValue = row[i]; best = i }
  return best
}

// Assemble the SPM prompt from its parts and make it fit the context by token count:
// drop lines from the start of the prefix (farthest from the cursor), then from the end
// of the suffix. The same rule lives in train/run_model.py (fit_prompt).
function splitLines(text) {
  const out = []
  let start = 0
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") { out.push(text.slice(start, i + 1)); start = i + 1 }
  if (start < text.length) out.push(text.slice(start))
  return out
}

function countTokens(text) {
  return text === "" ? 0 : tokenizer.encode(text, {add_special_tokens: false}).ids.length
}

function fitPrompt(parts, limit) {
  const headerLines = splitLines(parts.header || "")
  const prefixLines = splitLines(parts.prefix || "")
  const suffixLines = splitLines(parts.suffix || "")
  const markers = countTokens("<PRE><SUF>") + countTokens("<MID>")
  const headerTokens = headerLines.map(countTokens)
  const prefixTokens = prefixLines.map(countTokens)
  const suffixTokens = suffixLines.map(countTokens)
  const sum = a => a.reduce((x, y) => x + y, 0)
  // A symbol header may not take more than 40% of the budget (games with hundreds of
  // objects): drop its lines from the end (sfx, legend, then objects), then cut the last
  // line short, so the code context keeps the rest.
  const headerCap = Math.floor(limit * 0.4)
  const shrinkHeader = cap => {
    while (sum(headerTokens) > cap && headerLines.length > 2) { headerTokens.pop(); headerLines.pop() }
    while (sum(headerTokens) > cap && headerLines.length > 1) {
      const last = headerLines[headerLines.length - 1]
      if (last.length <= 64) { headerTokens.pop(); headerLines.pop(); continue }
      const cut = last.slice(0, Math.floor(last.length / 2)).replace(/\S*$/, "") + "\n"
      headerLines[headerLines.length - 1] = cut
      headerTokens[headerTokens.length - 1] = countTokens(cut)
    }
  }
  shrinkHeader(headerCap)
  let total = markers + sum(headerTokens) + sum(prefixTokens) + sum(suffixTokens)
  while (total > limit && prefixLines.length > 1) { total -= prefixTokens.shift(); prefixLines.shift() }
  while (total > limit && suffixLines.length > 0) { total -= suffixTokens.pop(); suffixLines.pop() }
  if (total > limit) { shrinkHeader(sum(headerTokens) - (total - limit)); total = markers + sum(headerTokens) + sum(prefixTokens) + sum(suffixTokens) }
  return {prompt: headerLines.join("") + "<PRE><SUF>" + suffixLines.join("") + "<MID>" + prefixLines.join(""), tokens: total}
}

function splitTail(prompt) {
  if (/<(?:SYM|PRE|SUF|MID)>$/.test(prompt)) return {head: prompt, tail: ""}
  const m = TAIL.exec(prompt)
  if (!m || m[1].length >= prompt.length) return {head: prompt, tail: ""}
  return {head: prompt.slice(0, prompt.length - m[1].length), tail: m[1]}
}

// Best token whose string is consistent with the required prefix `req`: either the token
// string starts with req (req is then fully consumed) or req starts with the token string.
function argmaxConstrained(row, req) {
  let best = -1, bestValue = -Infinity
  for (let i = 0; i < vocabStrings.length; i++) {
    const t = vocabStrings[i]
    if (!t || i === graph.eosId) continue
    if (!(t.startsWith(req) || req.startsWith(t))) continue
    if (row[i] > bestValue) { bestValue = row[i]; best = i }
  }
  return best
}

async function generate({id, prompt, parts, maxTokens = 48, stop = "line"}) {
  const t0 = performance.now()
  const limit = MAX_POSITIONS - maxTokens - 4
  if (parts) prompt = fitPrompt(parts, limit).prompt
  const {head, tail} = splitTail(prompt)
  const ids = tokenizer.encode(head, {add_special_tokens: false}).ids
  if (ids.length > limit) {
    return {type: "result", id, text: null, tooLong: true, tokens: ids.length, limit, ms: Math.round(performance.now() - t0)}
  }
  let common = 0
  while (common < ids.length - 1 && common < cache.ids.length && ids[common] === cache.ids[common]) common++
  let kv = sliceKV(cache.kv, common)
  let pastLength = common
  let last = null
  for (let at = common; at < ids.length; at += PREFILL_CHUNK) {
    if (cancelled.has(id)) return null
    const chunk = ids.slice(at, Math.min(ids.length, at + PREFILL_CHUNK))
    const r = await step(chunk, kv, pastLength)
    kv = r.kv; last = r.last; pastLength += chunk.length
  }
  const base = {id, prefillTokens: ids.length - common, cachedTokens: common, healedTail: tail}
  const generated = []
  let text = ""
  let required = tail          // what the healed tokens still have to reproduce
  let healed = tail === ""
  while (generated.length < maxTokens + (tail ? 2 : 0)) {
    if (cancelled.has(id)) return null
    let next
    if (!healed) {
      next = argmaxConstrained(last, required)
      if (next < 0) return Object.assign({type: "result", text: null, healFailed: true, tokens: 0, ms: Math.round(performance.now() - t0)}, base)
      const t = vocabStrings[next]
      required = t.startsWith(required) ? "" : required.slice(t.length)
      if (required === "") healed = true
    } else {
      next = argmax(last)
      if (next === graph.eosId) break
    }
    generated.push(next)
    if (healed) {
      text = tokenizer.decode(generated, {skip_special_tokens: true}).slice(tail.length)
      if (stop === "line" && text.includes("\n")) { text = text.slice(0, text.indexOf("\n")); break }
      if (stop === "block" && text.includes("\n\n")) { text = text.slice(0, text.indexOf("\n\n")); break }
    }
    const r = await step([next], kv, pastLength)
    kv = r.kv; last = r.last; pastLength += 1
  }
  cache = {ids: ids.concat(generated), kv}
  return Object.assign({type: "result", text, tokens: generated.length, ms: Math.round(performance.now() - t0)}, base)
}

self.onmessage = event => {
  const message = event.data
  if (message.type === "init") {
    busy = busy.then(() => init(message)).catch(error => post({type: "error", message: String(error && error.message || error)}))
  } else if (message.type === "generate") {
    busy = busy.then(async () => {
      if (!session) { post({type: "error", id: message.id, message: "model not loaded"}); return }
      try {
        const result = await generate(message)
        if (result) post(result)
        else post({type: "result", id: message.id, text: null, cancelled: true})
      } catch (error) {
        post({type: "error", id: message.id, message: String(error && error.message || error)})
      } finally {
        cancelled.delete(message.id)
      }
    })
  } else if (message.type === "cancel") {
    cancelled.add(message.id)
  }
}
