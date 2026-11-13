# Vanilla concordance — 2026-11-12

Authority: vanilla 5a94bde1a5127a3a45306ea28598eba2874d446d, pinned by typescript/oracle-source.json.

Fixed two JS solver shortcuts: skipping speculative AGAIN turns, and skipping win checks on unchanged inputs. Both can change gameplay. Every solver mode now preserves the normal probe and win checks. Ordinary Labs gameplay already matched the authored valid-source audit; the claim that current gameplay used an older cached AGAIN implementation was outdated.

Native Drain and legacy Defer also preserve speculative probes. Native and WebAssembly were rebuilt. The native regression checks RNG, restart targets, undo depth/boards and subsequent undo against repeated Yield.

Verification: 478 pinned recordings / 20,034 observations match the corrected JS fast path; 184 valid authored cases / 501 observations match in both player and fast-path modes. The complete Labs suite passes 473 simulation and 321 diagnostic cases, plus all auxiliary tests. The native interpreter passes all 473 Labs simulation cases and its API regressions. MIS native/WASM generator equivalence and actual CUDA desktop generation/fallback checks pass.

Run the small regression with node src/tests/again_solver_parity_node.cjs. It is also registered in node src/tests/run_tests_node.js. Native coverage is in native/tests/player_api_tests.cpp and its existing CTest target.

The broader differential harness, preserved failures, original bytes, binary patch, logs and corrected Windows package are owned by the companion workspace at C:/Users/Anwender/Documents/puzzlescript-labs/gpu/concordance and gpu/mis. That audit compares complete RNG, board/movements, commands/sounds, every undo snapshot and restart/checkpoint state after each input and AGAIN step. Historical invalid late-movement recovery cases are excluded from the valid-source comparison; modern compiler validation fixes remain. Native corpus coverage is recorded simulation parity, not a full native history/audio proof.

No new speedup is claimed for these corrected binaries. Independent solution replay remains enabled for implementation and canonicalization checks.
