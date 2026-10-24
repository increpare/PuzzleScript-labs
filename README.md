
`make` shows help. Use `make desktop` for this platform, `make serve` for web preparation/serving,
and `make distro` for archive assembly. See [root build commands](docs/build-commands.md).

PuzzleScript
============

Open Source HTML5 Puzzle Game Engine

Try it out at https://www.puzzlescript.net.

The Win95-style [PuzzleScript+MIS workbench](desktop/mis/README.md) also runs as a
GUI95 desktop app. With Node 22.12+ and GNU Make, `make` shows help, `make desktop` builds the workbench and
its web version, `make install` adds the stable per-user GUI95 launcher, and
`make serve` prepares and serves only the web build. `make help` lists the engine and hardware targets.

-----

If you're interested in recompiling/modifing/hacking the engine, there is [development setup info here](DEVELOPMENT.md).  If you're just interested in learning how to use the engine/make games in it, [the documentation is here](https://www.puzzlescript.net/Documentation/documentation.html).
