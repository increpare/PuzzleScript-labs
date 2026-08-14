import {buildCandidatePage} from "./build-candidate-page.mjs"

export default async function globalSetup() {
  await buildCandidatePage()
}
