#!/usr/bin/env python3
"""Focused contracts for the cartridge-native solution scoreboard."""

from __future__ import annotations

from pathlib import Path

import bench_gbc_cart_solutions as bench
import build_gbc_cart
from build_gbc_eligible_roms import ELIGIBLE_GAMES


def telemetry_bytes(
    *,
    magic: int = bench.CART_BENCH_MAGIC,
    version: int = bench.CART_BENCH_VERSION,
    game_index: int = 2,
    user_turns: int = 5,
    redraws: int = 7,
    logic_ticks: int = 100,
    render_ticks: int = 40,
    max_turn_ticks: int = 42,
    won: int = 1,
) -> bytes:
    return bench.CART_BENCH_RECORD.pack(
        magic,
        version,
        game_index,
        user_turns,
        redraws,
        logic_ticks,
        render_ticks,
        max_turn_ticks,
        won,
    )


def test_key_script_order_and_releases() -> None:
    keys = bench.build_key_script(2, ["up", "action"])
    pressed = [(index, key) for index, key in enumerate(keys) if key]
    assert [key for _, key in pressed] == [
        bench.KEY_DOWN,
        bench.KEY_DOWN,
        bench.KEY_A,
        bench.KEY_A,
        bench.KEY_UP,
        bench.KEY_A,
    ]
    menu_frames = [index for index, _ in pressed[:4]]
    assert all(
        keys[index + 1 : index + 3] == [0, 0]
        for index in menu_frames
    )
    first_solution_frame = pressed[4][0]
    second_solution_frame = pressed[5][0]
    assert second_solution_frame - first_solution_frame == 503
    assert keys[first_solution_frame + 1 : second_solution_frame] == [0] * 502
    assert keys[second_solution_frame + 1 :] == [0] * 502
    assert keys[: bench.BOOT_RELEASE_FRAMES] == [0] * bench.BOOT_RELEASE_FRAMES


def test_launcher_page_boundary_settling() -> None:
    last_page_zero_script = bench.build_key_script(7, ["action"])
    first_page_one_script = bench.build_key_script(8, ["action"])
    page_zero_presses = [
        (index, key)
        for index, key in enumerate(last_page_zero_script)
        if key
    ]
    page_one_presses = [
        (index, key)
        for index, key in enumerate(first_page_one_script)
        if key
    ]
    assert [key for _, key in page_zero_presses[:7]] == [
        bench.KEY_DOWN
    ] * 7
    assert [key for _, key in page_one_presses[:8]] == [
        bench.KEY_DOWN
    ] * 8
    assert all(
        right[0] - left[0] == 10
        for left, right in zip(
            page_one_presses[:8],
            page_one_presses[1:9],
        )
    )
    assert (
        page_one_presses[8][0] - page_one_presses[7][0] == 10
    ), "the launch press must wait for the page transition to settle"


def test_token_mapping_and_validation() -> None:
    assert bench.KEY_RIGHT == 1 << 4
    assert bench.KEY_LEFT == 1 << 5
    assert bench.TOKEN_KEYS == {
        "up": bench.KEY_UP,
        "left": bench.KEY_LEFT,
        "down": bench.KEY_DOWN,
        "right": bench.KEY_RIGHT,
        "action": bench.KEY_A,
    }
    try:
        bench.build_key_script(0, ["undo"])
    except ValueError as error:
        assert "unsupported solution token" in str(error)
    else:
        raise AssertionError("invalid solution token was accepted")


def test_telemetry_parser() -> None:
    record = bench.parse_telemetry(
        telemetry_bytes(),
        expected_game_index=2,
    )
    assert record == bench.CartBenchTelemetry(
        game_index=2,
        user_turns=5,
        redraws=7,
        logic_ticks=100,
        render_ticks=40,
        max_turn_ticks=42,
        won=True,
    )
    bad_cases = (
        telemetry_bytes(magic=0),
        telemetry_bytes(version=2),
        telemetry_bytes(game_index=3),
        telemetry_bytes(user_turns=0),
        telemetry_bytes(won=2),
        telemetry_bytes()[:-1],
    )
    for payload in bad_cases:
        try:
            bench.parse_telemetry(payload, expected_game_index=2)
        except ValueError:
            pass
        else:
            raise AssertionError(f"bad telemetry was accepted: {payload!r}")


def test_weighted_means_and_stable_worst_ten() -> None:
    rows = [
        {
            "index": 0,
            "slug": "small",
            "success": True,
            "user_turns": 1,
            "redraws": 2,
            "logic_ticks": 10,
            "render_ticks": 4,
            "max_turn_ticks": 14,
        },
        {
            "index": 1,
            "slug": "large",
            "success": True,
            "user_turns": 3,
            "redraws": 3,
            "logic_ticks": 60,
            "render_ticks": 12,
            "max_turn_ticks": 30,
        },
    ]
    summary = bench.summarize_rows(rows)
    assert summary["weighted_logic_ticks_per_turn"] == 17.5
    assert summary["weighted_interaction_ticks_per_turn"] == 21.5
    assert summary["weighted_render_ticks_per_redraw"] == 3.2

    tied = [
        {
            "index": index,
            "slug": f"game-{index:02d}",
            "success": True,
            "logic_ticks_per_turn": 20.0 if index < 11 else 30.0,
            "interaction_ticks_per_turn": 50.0,
        }
        for index in range(12)
    ]
    logic = bench.worst_ten(tied, "logic_ticks_per_turn")
    interaction = bench.worst_ten(tied, "interaction_ticks_per_turn")
    assert [row["slug"] for row in logic] == [
        "game-11",
        *[f"game-{index:02d}" for index in range(9)],
    ]
    assert [row["slug"] for row in interaction] == [
        f"game-{index:02d}" for index in range(10)
    ]


def test_benchmark_cart_build_mode_contract() -> None:
    assert build_gbc_cart.shared_build_defines(
        autotest=False,
        benchmark=False,
    ) == ("PS_GBC_CART_BUILD=1",)
    assert build_gbc_cart.shared_build_defines(
        autotest=False,
        benchmark=True,
    ) == (
        "PS_GBC_CART_BUILD=1",
        "PS_GBC_CART_BENCHMARK=1",
    )
    try:
        build_gbc_cart.shared_build_defines(
            autotest=True,
            benchmark=True,
        )
    except ValueError as error:
        assert "mutually exclusive" in str(error)
    else:
        raise AssertionError("autotest+benchmark build was accepted")
    assert build_gbc_cart.cart_rom_name(
        46, autotest=False, benchmark=True
    ) == "puzzlescript-compilation-benchmark-46.gb"


def test_reused_cart_manifest_is_bound_to_current_corpus() -> None:
    games = list(ELIGIBLE_GAMES[:2])
    manifest_games = []
    for index, (slug, source) in enumerate(games):
        manifest_games.append(
            {
                "index": index,
                "slug": slug,
                "source": source,
                "source_hash": bench.source_hash(
                    Path(source).read_bytes()
                ),
            }
        )
    manifest = {
        "benchmark": True,
        "game_count": len(games),
        "games": manifest_games,
    }
    assert bench.validate_benchmark_manifest(
        manifest,
        games=games,
        repository=Path.cwd(),
    ) == manifest_games

    stale = {
        **manifest,
        "games": [
            {**manifest_games[0], "source_hash": 0},
            manifest_games[1],
        ],
    }
    reordered = {
        **manifest,
        "games": [manifest_games[1], manifest_games[0]],
    }
    for invalid in (stale, reordered):
        try:
            bench.validate_benchmark_manifest(
                invalid,
                games=games,
                repository=Path.cwd(),
            )
        except RuntimeError:
            pass
        else:
            raise AssertionError("stale/reordered cart manifest was accepted")


def test_benchmark_helpers_are_banked_and_messages_auto_ack() -> None:
    benchmark_source = Path(
        "firmware/gbc/source/benchmark.c"
    ).read_text(encoding="utf-8")
    main_source = Path(
        "firmware/gbc/source/main.c"
    ).read_text(encoding="utf-8")
    builder_source = Path(
        "scripts/build_gbc_cart.py"
    ).read_text(encoding="utf-8")
    assert benchmark_source.startswith("#pragma bank 1\n")
    assert "void cartBenchAccumulateLogic(" in benchmark_source
    assert "void cartBenchRender(void) BANKED" in benchmark_source
    assert (
        "cartBenchHasActiveTurn() || (pressed & J_A) != 0U"
        not in main_source
    )
    assert "cartBenchHasActiveTurn() && status.pending_again" in main_source
    assert "drain_again ? PS_INPUT_TICK : PS_INPUT_ACTION" in main_source
    assert "cartBenchAccumulateLogic(logic_ticks);" in main_source
    assert (
        '*((firmware_source / "benchmark.c",) if benchmark else ())'
        in builder_source
    )


def test_timer_interrupt_masks_are_mode_specific() -> None:
    main_source = Path(
        "firmware/gbc/source/main.c"
    ).read_text(encoding="utf-8")
    assert (
        "#if defined(PS_GBC_CART_BENCHMARK)\n"
        "    set_interrupts((uint8_t)(VBL_IFLAG | TIM_IFLAG));\n"
        "#else\n"
        "    set_interrupts(TIM_IFLAG);\n"
        "#endif"
    ) in main_source
    assert (
        "#if defined(PS_GBC_CART_BENCHMARK)\n"
        "    enable_interrupts();\n"
        "#endif\n"
        "    return ticks;"
    ) in main_source
    assert (
        "#if defined(PS_GBC_CART_BENCHMARK)\n"
        "    set_interrupts(VBL_IFLAG);\n"
        "    enable_interrupts();\n"
        "#else\n"
        "    set_interrupts(0U);\n"
        "#endif"
    ) in main_source


def main() -> int:
    test_key_script_order_and_releases()
    test_launcher_page_boundary_settling()
    test_token_mapping_and_validation()
    test_telemetry_parser()
    test_weighted_means_and_stable_worst_ten()
    test_benchmark_cart_build_mode_contract()
    test_reused_cart_manifest_is_bound_to_current_corpus()
    test_benchmark_helpers_are_banked_and_messages_auto_ack()
    test_timer_interrupt_masks_are_mode_specific()
    print("bench_gbc_cart_solutions_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
