import {spawn} from "node:child_process"

const SAFARIDRIVER = "http://127.0.0.1:4444"
const CONTROL_REQUEST_TIMEOUT_MS = 30_000
export const WEBDRIVER_SCRIPT_TIMEOUT_MS = 600_000
const BENCHMARK_REQUEST_TIMEOUT_MS = WEBDRIVER_SCRIPT_TIMEOUT_MS + 10_000

export async function webdriverRequest(
  pathname,
  method = "GET",
  body,
  timeout = CONTROL_REQUEST_TIMEOUT_MS,
  fetchImplementation = fetch
) {
  const response = await fetchImplementation(SAFARIDRIVER + pathname, {
    method,
    headers: body === undefined ? undefined : {"content-type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  })
  const payload = await response.json()
  if (!response.ok || payload.value?.error) {
    throw new Error(payload.value?.message || `SafariDriver ${method} ${pathname} failed (${response.status})`)
  }
  return payload.value
}

async function waitForSafariDriver(process, request = webdriverRequest) {
  const deadline = Date.now() + 20_000
  let lastError
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`safaridriver exited with ${process.exitCode}`)
    try {
      await request("/status")
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  throw new Error(`safaridriver did not become ready: ${lastError}`)
}

function childExited(child) {
  return (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
}

function waitForChildExit(child, timeout, signal) {
  if (childExited(child)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timeoutId)
      resolve()
    }
    const timeoutId = setTimeout(() => {
      child.removeListener("exit", onExit)
      reject(new Error(`safaridriver did not exit after ${signal} within ${timeout}ms`))
    }, timeout)
    child.once("exit", onExit)
  })
}

export async function terminateOwnedDriver(
  driver,
  {termTimeout = 2_000, killTimeout = 2_000} = {}
) {
  if (childExited(driver)) return
  driver.kill("SIGTERM")
  try {
    await waitForChildExit(driver, termTimeout, "SIGTERM")
    return
  } catch {}
  driver.kill("SIGKILL")
  await waitForChildExit(driver, killTimeout, "SIGKILL")
}

function aggregateWithPrimary(primary, cleanupErrors, message) {
  return new AggregateError([primary, ...cleanupErrors], message, {cause: primary})
}

export async function connectSafari(overrides = {}) {
  const request = overrides.request || webdriverRequest
  const spawnDriver = overrides.spawnDriver || (() =>
    spawn("safaridriver", ["-p", "4444"], {stdio: ["ignore", "ignore", "ignore"]}))
  const waitForDriver = overrides.waitForDriver || (driver => waitForSafariDriver(driver, request))
  const stopDriver = overrides.stopDriver || terminateOwnedDriver
  let driver = null
  try {
    await request("/status")
  } catch {
    driver = spawnDriver()
  }

  try {
    if (driver) await waitForDriver(driver)
    const value = await request("/session", "POST", {
      capabilities: {alwaysMatch: {browserName: "safari"}}
    })
    return {driver, sessionId: value.sessionId, capabilities: value.capabilities || {}}
  } catch (error) {
    if (driver) {
      try {
        await stopDriver(driver)
      } catch (cleanupError) {
        throw aggregateWithPrimary(error, [cleanupError], "Safari connection and driver cleanup failed")
      }
    }
    throw error
  }
}

export async function safariExecute(
  sessionId,
  script,
  args = [],
  async = false,
  request = webdriverRequest
) {
  return request(
    `/session/${sessionId}/execute/${async ? "async" : "sync"}`,
    "POST",
    {script, args},
    async ? BENCHMARK_REQUEST_TIMEOUT_MS : CONTROL_REQUEST_TIMEOUT_MS
  )
}

export async function withSafariSessionLifecycle(
  connect,
  deleteSession,
  operation,
  stopDriver = terminateOwnedDriver
) {
  const connection = await connect()
  let result
  let primaryError
  try {
    result = await operation(connection)
  } catch (error) {
    primaryError = error
  }
  const cleanupErrors = []
  try {
    await deleteSession(connection.sessionId)
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (connection.driver) {
    try {
      await stopDriver(connection.driver)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (primaryError && cleanupErrors.length) {
    throw aggregateWithPrimary(primaryError, cleanupErrors, "Safari benchmark and cleanup failed")
  }
  if (primaryError) throw primaryError
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "Safari cleanup failed")
  return result
}
