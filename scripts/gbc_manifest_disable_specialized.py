#!/usr/bin/env python3
"""Mark a GBC export manifest as interpreter-only after a size-budget fallback."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument(
        "--reason",
        default="linked_rom_bank_or_total_over_budget",
        help="Recorded in specialized_turn_fallback_reason",
    )
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    manifest["specialized_turn"] = False
    manifest["specialized_resolve"] = False
    manifest["specialized_won"] = False
    manifest["specialized_turn_fallback_reason"] = args.reason
    args.manifest.write_text(
        json.dumps(manifest, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"gbc: disabled specialized_turn in {args.manifest}"
        f" (reason={args.reason})",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
