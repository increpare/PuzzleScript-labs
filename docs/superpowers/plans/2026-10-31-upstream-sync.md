# Vanilla PuzzleScript sync, 31 October 2026

**Goal:** Review and port vanilla master from the previous selective-port checkpoint
`b44aa2654f70fe347c8dcac16f82542b33547a12` through
`57f9f6cba69f6aa52ed738d5aee1d709d0037648`, preserving Labs extensions.

**Approach:** Apply the final upstream source delta, adapting shared parser,
compiler, engine and CM6 behavior. Preserve the pinned TypeScript vanilla reference.
Record a reviewed-through revision and explicit exclusions rather than claiming
upstream Git ancestry or complete tree identity.

- [x] Fetch both remotes, establish the earlier checkpoint, create an ignored
  worktree, and run the unmodified core suite (934 passing).
- [x] Import changed/new upstream simulation and diagnostic fixtures without
  removing Labs cases; run them before implementation to identify regressions.
- [x] Port runtime/compiler/parser fixes and applicable editor/player/gallery/docs
  updates. Check native equivalents of changed runtime/compiler semantics.
- [x] Keep browser regression cases and dependencies in the standalone
  `/Users/stephenlavelle/Documents/puzzlescript_testdump/ui/` collection.
- [x] Add a machine-readable checkpoint and a short guide listing dispositions
  and exact Git commands for future updates; link it from AGENTS.md.
- [x] Rebuild standalone assets; run core, relevant native/CM6/browser and release
  checks. Review the final diff against every upstream commit in the range.
- [x] Commit the verified port and integrate it into the original clean master
  checkout without pushing.
