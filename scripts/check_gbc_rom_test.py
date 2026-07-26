#!/usr/bin/env python3
"""Focused parser tests for the GBC linked-ROM structural gates."""

from __future__ import annotations

import tempfile
from pathlib import Path

import check_gbc_rom


def write_object(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def main() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        build_dir = Path(temporary)
        core_object = write_object(
            build_dir / "core.o",
            "A _CODE size 0 flags 0 addr 0\n"
            "A _CODE_7 size 123 flags 0 addr 0\n",
        )
        game_object = write_object(
            build_dir / "generated_game.o",
            "A _CODE_7 size 456 flags 0 addr 0\n"
            "A _DATA size 0 flags 0 addr 0\n",
        )
        shared_object = write_object(
            build_dir / "audio.o",
            "S _ps_gbc_generated_game Ref00000000\n"
            "S _ps_gbc_active_game_view Ref00000000\n",
        )
        namespaced_shared_object = write_object(
            build_dir / "tile_cache.o",
            "S _g07_ps_gbc_generated_render_objects Ref00000000\n",
        )
        write_object(
            build_dir / "generated_specialized_turn.o",
            "A _DATA size C flags 0 addr 0\n"
            "A _BSS size 0 flags 0 addr 0\n"
            "A _INITIALIZED size 2 flags 0 addr 0\n",
        )

        assert check_gbc_rom.object_code_banks(core_object) == {7}
        assert check_gbc_rom.object_code_banks(game_object) == {7}
        assert check_gbc_rom.forbidden_generated_references(shared_object) == [
            "ps_gbc_generated_game"
        ]
        assert check_gbc_rom.forbidden_generated_references(
            namespaced_shared_object
        ) == ["g07_ps_gbc_generated_render_objects"]
        assert check_gbc_rom.generated_static_bytes(build_dir) == {
            "generated_specialized_turn.o": 14
        }

    print("check_gbc_rom_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
