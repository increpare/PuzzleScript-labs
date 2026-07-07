#!/usr/bin/env python3
"""Flash PuzzleScript demo games onto the ESP32-P4 internal storage FAT partition."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_GAMES = [
    'sokoban_basic.txt',
    'microban.txt',
    'push.txt',
    'actiontest.txt',
    'heroes_of_sokoban.txt',
    'nekopuzzle.txt',
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--demo-dir',
        default='src/demo',
        help='Directory containing .txt game sources',
    )
    parser.add_argument(
        '--games',
        nargs='*',
        default=None,
        help='Game filenames to include (default: curated demo set)',
    )
    parser.add_argument('--port', default='COM3', help='Serial port for esptool')
    parser.add_argument('--offset', default='0x710000', help='Storage partition flash offset')
    parser.add_argument('--partition-size', default='0x800000', help='Storage partition size')
    parser.add_argument(
        '--idf-path',
        default='C:/esp/v6.0.2/esp-idf',
        help='ESP-IDF root path',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Print staging layout without flashing',
    )
    return parser.parse_args()


def to_fat83(filename: str) -> str:
    stem = Path(filename).stem.upper()
    stem = re.sub(r'[^A-Z0-9]', '', stem)
    if not stem:
        stem = 'GAME'
    return f'{stem[:8]}.TXT'


def run(command: list[str]) -> None:
    print('>', ' '.join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    demo_dir = (repo_root / args.demo_dir).resolve()
    if not demo_dir.is_dir():
        raise SystemExit(f'missing demo dir: {demo_dir}')

    game_names = args.games if args.games else DEFAULT_GAMES
    fatfsgen = Path(args.idf_path) / 'components' / 'fatfs' / 'fatfsgen.py'
    if not fatfsgen.is_file():
        fatfsgen = Path(args.idf_path) / 'components' / 'fatfs' / 'image_generation' / 'fatfsgen.py'
    if not fatfsgen.is_file():
        raise SystemExit(f'missing fatfsgen.py: {fatfsgen}')

    py = Path('C:/Espressif/tools/python/v6.0.2/venv/Scripts/python.exe')
    if not py.is_file():
        py = Path(sys.executable)

    with tempfile.TemporaryDirectory(prefix='esp32-games-storage-') as tmp:
        staging = Path(tmp) / 'staging' / 'GAMES'
        staging.mkdir(parents=True, exist_ok=True)
        copied = []
        for name in game_names:
            source = demo_dir / name
            if not source.is_file():
                print(f'skip missing game: {source}', flush=True)
                continue
            target_name = to_fat83(name)
            shutil.copy2(source, staging / target_name)
            copied.append((name, target_name))
            print(f'staged {name} -> GAMES/{target_name}', flush=True)

        if not copied:
            raise SystemExit('no games staged')

        if args.dry_run:
            print(f'dry run: would flash {len(copied)} games to {args.offset}')
            return 0

        image_path = Path(tmp) / 'storage.bin'
        run([
            str(py),
            str(fatfsgen),
            str(staging.parent),
            '--output_file',
            str(image_path),
            '--partition_size',
            args.partition_size,
            '--sector_size',
            '4096',
            '--use_default_datetime',
        ])
        run([
            str(py),
            '-m',
            'esptool',
            '--chip',
            'esp32p4',
            '-p',
            args.port,
            '-b',
            '460800',
            'write_flash',
            args.offset,
            str(image_path),
        ])

    print(f'flashed {len(copied)} games to storage partition')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
