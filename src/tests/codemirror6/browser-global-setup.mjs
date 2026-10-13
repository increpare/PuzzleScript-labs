import {buildCandidatePage} from "./build-candidate-page.mjs"
import {buildPerformancePages} from "./build-performance-pages.mjs"

export default async function globalSetup() {
  await buildCandidatePage()
  await buildPerformancePages()
}
