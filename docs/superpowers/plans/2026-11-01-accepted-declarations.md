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
- [ ] Verify the unchanged focused baseline.
- [ ] Add failing native comparisons for missed/fabricated registrations, duplicate
  object alias ownership, late sprite-row aliases and inherited empty layers.

## Task 2: Replace reconstruction

- [ ] Give accepted registrations exact token provenance and owning anchors.
- [ ] Carry registration/layer results through the walk and bind them to authored
  identities once in the reader.
- [ ] Replace prepareDeclarations reconstruction with canonical construction and
  membership translation; remove duplicate lookup, recovery and expansion.
- [ ] Use required alias/property/aggregate payloads through final compiler code.
- [ ] Preserve helper advice with structured source facts rather than re-parsing.
- [ ] Add tree-consumption and negative type tests proving the new boundary.

## Task 3: Verify and integrate

- [ ] Independent spec review, then correctness/readability review.
- [ ] Full TypeScript suite, including all original parser/compiler comparisons.
- [ ] Bounded generated sample: seed `accepted-declarations-2026-11-01`, 128 cases,
  four workers; report `/private/tmp/ps-accepted-declarations-campaign.json`.
- [ ] Update reading guide and current-state goal checklist without claiming the
  remaining scanner/sound/win/rule-type work is complete.
- [ ] Commit and integrate locally with focused checks. Preserve unrelated user
  work and leave the active goal running unless the full completion audit passes.
