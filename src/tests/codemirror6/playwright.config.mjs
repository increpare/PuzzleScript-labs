import {defineConfig, devices} from "@playwright/test"
import path from "node:path"
import {fileURLToPath} from "node:url"

const viewport = {width: 1440, height: 900}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

export default defineConfig({
  testDir: "./browser",
  globalSetup: "./browser-global-setup.mjs",
  timeout: 30_000,
  expect: {timeout: 5_000},
  use: {baseURL: "http://127.0.0.1:4173", viewport},
  webServer: {
    command: "python3 -m http.server 4173 --directory src",
    cwd: root,
    url: "http://127.0.0.1:4173/editor.html",
    reuseExistingServer: false
  },
  projects: [
    {name: "chromium", use: {...devices["Desktop Chrome"], viewport, deviceScaleFactor: 1}},
    {name: "firefox", use: {...devices["Desktop Firefox"], viewport, deviceScaleFactor: 1}},
    {name: "webkit", use: {...devices["Desktop Safari"], viewport, deviceScaleFactor: 1}}
  ]
})
