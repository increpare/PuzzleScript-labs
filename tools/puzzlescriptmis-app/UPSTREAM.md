# PuzzleScript+MIS Upstream

This directory vendors the permitted PuzzleScript+MIS openFrameworks application from:

https://github.com/bvoq/puzzlescriptmis

Vendored source commit: `1ddb2ea43374ff19cb630783e35332c09dddbf45`

Stephen has permission from the upstream author to use this code for this engine-bridge work.

The vendored copy intentionally excludes packaged binaries and generated build output:

- `bin/`
- `obj/`
- `src/a.out`
- `src/a.out.dSYM/`
- temporary TeX build directories under `bscwriteup3/`

The first milestone keeps the openFrameworks front-end and replaces the PuzzleScript parser/runtime path with PuzzleScript-labs native libraries.
