#!/usr/bin/env python3
"""Focused unit tests for the GBC smoke harness."""

import run_gbc_smoke


def main() -> int:
    run_gbc_smoke.enforce_emulator_warning_limit(4, 4)
    run_gbc_smoke.enforce_emulator_warning_limit(None, 4)

    try:
        run_gbc_smoke.enforce_emulator_warning_limit(5, 4)
    except SystemExit as error:
        assert str(error) == (
            "libmgba emitted too many warnings: 5, maximum allowed is 4"
        ), str(error)
    else:
        raise AssertionError("warning counts above the ceiling must fail")

    print("run_gbc_smoke_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
