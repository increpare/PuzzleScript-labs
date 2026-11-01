# Accepted Declarations Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Keep the broader frontend goal active until its completion checklist is proven.

**Goal:** Make accepted source registrations authoritative for canonical declaration construction.

**Architecture:** Transport typed registrations with exact source ownership from the walk into the document. Project them into canonical objects and kind-specific compiler definitions; retain final name normalization and its distinct semantics.

**Tech Stack:** Strict TypeScript, Node tests, pinned vanilla parser/compiler oracles.

---

## Task 1: Characterize the seam

- [x] Inspect authoritative state and create `codex/typescript-compiler-declarations`.
- [x] Independently audit declaration acceptance, provenance and malformed recovery.
- [x] Audit the whole frontend and retain its full completion checklist.
- [x] Verify the unchanged focused baseline.
- [x] Add failing native comparisons for missed/fabricated registrations, duplicate
  object alias ownership, late sprite-row aliases and inherited empty layers.

## Task 2: Replace reconstruction

- [x] Give accepted registrations exact token provenance and owning anchors.
- [x] Carry registration/layer results through the walk and bind them to authored
  identities once in the reader.
- [x] Replace prepareDeclarations reconstruction with canonical construction and
  membership translation; remove duplicate lookup, recovery and expansion.
- [x] Use required alias/property/aggregate payloads through final compiler code.
- [x] Preserve helper advice with structured source facts rather than re-parsing.
- [x] Add tree-consumption and negative type tests proving the new boundary.

## Task 3: Verify and integrate

- [x] Independent spec review, then correctness/readability review.
- [x] Full TypeScript suite, including all original parser/compiler comparisons.
- [x] Bounded generated sample: seed `accepted-declarations-2026-11-01`, 128 cases,
  four workers; report `/private/tmp/ps-accepted-declarations-campaign.json`.
- [x] Update reading guide and current-state goal checklist without claiming the
  remaining scanner/sound/win/rule-type work is complete.
- [x] Commit and integrate locally with focused checks. Preserve unrelated user
  work and leave the active goal running unless the full completion audit passes.

## Verification audit

- Unchanged focused baseline: **81 passed**; log
  `/private/tmp/ps-accepted-declarations-baseline.log`.
- New independent native declaration cases initially **5 failed / 4 passed**;
  log `/private/tmp/ps-accepted-declarations-native-red.log`. The new accepted
  stream fixes the five old reconstruction differences.
- Final complete strict suite: **1,964 passed**, zero failures; log
  `/private/tmp/ps-accepted-declarations-final-full.log`. This includes all **335
  compilation fixtures**, **492 simulation sources** and **99,192 executable
  rules**, plus the new semantic/type/provenance checks.
- Final focused asset/declaration/native run: **136 passed**, including all 492
  original games' **12,295 objects**, **307,375 pixels** and **22,975 colors**;
  log `/private/tmp/ps-accepted-assets-oracles-final.log`.
- Review caught a shared-container asset overwrite: `.Bad !`, `Blue`, `00000`,
  `White`, `Red` produces distinct accepted Blue/White definitions inside one raw
  authored grouping. The native oracle reproduced the missing Blue color error.
  Accepted objects now own assets independently, raw asset mirrors are gone,
  and the regression passes after failing first in
  `/private/tmp/ps-accepted-separate-assets-red.log`.
- Canonical object diagnostic lines come from actual accepted object name tokens,
  not an earlier alias's first registration or a raw container primary. The
  declaration oracle projects that token while still checking the unchanged native
  line, and strengthens object/source/token identity. A negative control rejects
  substituting the raw primary. The asset oracle similarly projects accepted
  per-primary data; native producers, expected output and all comparisons remain.
- Independent spec and correctness/readability reviews approved after the asset
  fix. Quality review independently ran 28 focused tests and probed 15,625
  malformed three-line object combinations without reader exceptions.
- Final generated differential sample: **128 games**, **883 observations and
  operations**, **128 loads**; zero exclusions, mismatches, exceptions or timeouts.
  Includes 127 distinct sources, 44 rule sets and 124 boards. Report:
  `/private/tmp/ps-accepted-declarations-campaign.json`.
- No exhaustive gameplay replay or test server was started. The overall frontend
  goal is still incomplete; see its separate completion checklist.
