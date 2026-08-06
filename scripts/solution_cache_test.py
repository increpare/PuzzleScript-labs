#!/usr/bin/env python3
"""Unit tests for solution_cache helpers."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import solution_cache as sc


class SolutionCacheTests(unittest.TestCase):
    def test_read_write_tokens_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "board-0.txt"
            sc.write_tokens(path, ["Up", "left", "ACTION"])
            self.assertEqual(sc.read_tokens(path), ["up", "left", "action"])

    def test_read_tokens_rejects_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "board-0.txt"
            path.write_text("jump\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                sc.read_tokens(path)

    def test_filter_entries_by_tag(self) -> None:
        entries = [
            {"slug": "a", "tags": ["js_valid"]},
            {"slug": "b", "tags": ["js_valid", "host_known_good"]},
        ]
        self.assertEqual(
            [e["slug"] for e in sc.filter_entries(entries, tag="host_known_good")],
            ["b"],
        )

    def test_validate_entry_detects_hash_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "game.txt"
            source.write_text("title x\n", encoding="utf-8")
            solution = root / "board-0.txt"
            sc.write_tokens(solution, ["up"])
            entry = {
                "slug": "x",
                "source": "game.txt",
                "solution_path": "board-0.txt",
                "source_sha256": "0" * 64,
                "tags": ["js_valid"],
            }
            errors = sc.validate_entry_against_source(root, entry)
            self.assertTrue(any("source_sha256 mismatch" in err for err in errors))

    def test_manifest_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "manifest.json"
            payload = {
                "format": "puzzlescript-eligible-solution-cache-v1",
                "entries": [{"slug": "a", "tags": ["js_valid"]}],
            }
            sc.save_manifest(path, payload)
            loaded = sc.load_manifest(path)
            self.assertEqual(loaded["entries"][0]["slug"], "a")


if __name__ == "__main__":
    unittest.main()
