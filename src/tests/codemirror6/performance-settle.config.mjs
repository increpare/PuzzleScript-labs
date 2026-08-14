import {defineConfig, devices} from "@playwright/test"

export default defineConfig({
  testDir: "./browser",
  timeout: 15_000,
  use: {viewport: {width: 1280, height: 900}},
  projects: [{
    name: "chromium",
    use: {...devices["Desktop Chrome"], viewport: {width: 1280, height: 900}}
  }]
})
