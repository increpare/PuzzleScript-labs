#!/usr/bin/env python3
"""Focused tests for reproducible GBC benchmark-suite tool paths."""

from __future__ import annotations

import os
from pathlib import Path
import py_compile

import run_gbc_benchmark_suite


def test_script_compiles() -> None:
    py_compile.compile(
        run_gbc_benchmark_suite.__file__,
        doraise=True,
    )


def test_repository_relative_tool_paths() -> None:
    if os.name == "nt":
        repository = Path("C:/repo")
        compiler = Path("C:/repo/build/native/puzzlescript_cpp.exe")
        gbdk_home = Path("C:/repo/.codex_tmp/toolchains/gbdk")
    else:
        repository = Path("/repo")
        compiler = Path("/repo/build/native/puzzlescript_cpp")
        gbdk_home = Path("/repo/.codex_tmp/toolchains/gbdk")

    assert run_gbc_benchmark_suite.default_compiler(repository) == compiler
    assert run_gbc_benchmark_suite.resolve_tool_path(
        Path(".codex_tmp/toolchains/gbdk"),
        repository=repository,
    ) == gbdk_home


def main() -> None:
    test_script_compiles()
    test_repository_relative_tool_paths()
    print("run_gbc_benchmark_suite_test: ok")


if __name__ == "__main__":
    main()
