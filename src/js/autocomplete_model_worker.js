// Web Worker that runs the PuzzleScript autocomplete model with onnxruntime-web.
// Module worker: started by js/autocomplete_model.js as
//   new Worker("js/autocomplete_model_worker.js", {type: "module"})
//
// Messages in:
//   {type: "init", modelUrl, configUrl, tokenizerUrl, vendorUrl, provider}
//       provider: "wasm" (default) or "webgpu"
//   {type: "generate", id, prompt, maxTokens, stop}   stop: "line" | "block" | "eos"
//   {type: "cancel", id}
// Messages out:
//   {type: "ready", info}  {type: "error", id?, message}
//   {type: "result", id, text, tokens, ms, prefillTokens, cachedTokens}
//
// The exported graph (autocomplete/train/export_onnx.py) takes input_ids, attention_mask,
// position_ids and past_key_values.<i>.key/value [1, kvHeads, past, headDim], and returns
// logits plus present.<i>.key/value. The KV cache of the previous request is kept and the
// longest shared token prefix with the new prompt is reused, so while the user types on a
// line only the new tokens are prefilled (the editor renders prompts in SPM order, where
// the prefix comes last, for exactly this reason).

import * as ort from "./vendor/onnxruntime-web/ort.min.mjs"
import {Tokenizer} from "./vendor/tokenizers/tokenizers.min.mjs"

const PREFILL_CHUNK = 256

let session = null
let tokenizer = null
let graph = null          // {layers, kvHeads, headDim, eosId, newlineIds}
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
  const newlineIds = new Set()
  for (const t of ["\n", "\n\n"]) {
    const enc = tokenizer.encode(t, {add_special_tokens: false}).ids
    if (enc.length === 1) newlineIds.add(enc[0])
  }
  graph = {layers, kvHeads, headDim, eosId, newlineIds}
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
    attention_mask: new ort.Tensor("int64", new BigInt64Array(pastLength + n).fill(1n), [1, pastLength + n]),
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

async function generate({id, prompt, maxTokens = 48, stop = "line"}) {
  const t0 = performance.now()
  const ids = tokenizer.encode(prompt, {add_special_tokens: false}).ids
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
  const generated = []
  let text = ""
  for (let i = 0; i < maxTokens; i++) {
    if (cancelled.has(id)) return null
    const next = argmax(last)
    if (next === graph.eosId) break
    generated.push(next)
    text = tokenizer.decode(generated, {skip_special_tokens: true})
    if (stop === "line" && text.includes("\n")) { text = text.slice(0, text.indexOf("\n")); break }
    if (stop === "block" && text.includes("\n\n")) { text = text.slice(0, text.indexOf("\n\n")); break }
    const r = await step([next], kv, pastLength)
    kv = r.kv; last = r.last; pastLength += 1
  }
  cache = {ids: ids.concat(generated), kv}
  return {
    type: "result", id, text, tokens: generated.length,
    ms: Math.round(performance.now() - t0),
    prefillTokens: ids.length - common, cachedTokens: common
  }
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
