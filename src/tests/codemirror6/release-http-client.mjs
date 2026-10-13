import http from "node:http"
import https from "node:https"

export function readResponse(response) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let ended = false
    let settled = false
    const fail = error => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    response.on("data", chunk => chunks.push(chunk))
    response.once("aborted", () => fail(new Error("HTTP response was aborted")))
    response.once("error", fail)
    response.once("end", () => {
      ended = true
      if (!settled) {
        settled = true
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks)
        })
      }
    })
    response.once("close", () => {
      if (!ended) {
        fail(new Error("HTTP response closed before end"))
      }
    })
  })
}

export function request(url, acceptEncoding, {timeoutMs = 10_000} = {}) {
  const client = url.protocol === "https:" ? https : http
  return new Promise((resolve, reject) => {
    const outgoingRequest = client.get(url, {headers: {"Accept-Encoding": acceptEncoding}}, response => {
      readResponse(response).then(result => {
        outgoingRequest.setTimeout(0)
        resolve(result)
      }, error => {
        outgoingRequest.setTimeout(0)
        reject(error)
      })
    })
    outgoingRequest.setTimeout(timeoutMs, () => {
      outgoingRequest.destroy(new Error(`HTTP request timed out after ${timeoutMs} ms`))
    })
    outgoingRequest.on("error", error => {
      outgoingRequest.setTimeout(0)
      reject(error)
    })
  })
}
