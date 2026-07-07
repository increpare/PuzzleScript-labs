#!/usr/bin/env python3
"""Flash the simulation corpus bundle onto the ESP32-P4 internal storage partition."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--bundle',
        default='build/codex-perf/simulation_corpus.bundle.ndjson',
        help='NDJSON simulation corpus bundle',
    )
    parser.add_argument(
        '--port',
        default='COM3',
        help='Serial port for esptool',
    )
    parser.add_argument(
        '--offset',
        default='0x710000',
        help='Flash offset for the storage partition',
    )
    parser.add_argument(
        '--partition-size',
        default='0x800000',
        help='Storage partition size',
    )
    parser.add_argument(
        '--idf-path',
        default='C:/esp/v6.0.2/esp-idf',
        help='ESP-IDF root path',
    )
    return parser.parse_args()


def run(command: list[str]) -> None:
    print('>', ' '.join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    bundle_path = (repo_root / args.bundle).resolve()
    if not bundle_path.is_file():
        raise SystemExit(f'missing bundle: {bundle_path}')

    fatfsgen = Path(args.idf_path) / 'components' / 'fatfs' / 'fatfsgen.py'
    if not fatfsgen.is_file():
        fatfsgen = Path(args.idf_path) / 'components' / 'fatfs' / 'image_generation' / 'fatfsgen.py'
    if not fatfsgen.is_file():
        raise SystemExit(f'missing fatfsgen.py: {fatfsgen}')

    py = Path('C:/Espressif/tools/python/v6.0.2/venv/Scripts/python.exe')
    if not py.is_file():
        py = Path(sys.executable)

    with tempfile.TemporaryDirectory(prefix='esp32-corpus-storage-') as tmp:
        staging = Path(tmp) / 'staging'
        staging.mkdir(parents=True, exist_ok=True)
        shutil.copy2(bundle_path, staging / 'CORPUS.NDJ')
        image_path = Path(tmp) / 'storage.bin'
        run([
            str(py),
            str(fatfsgen),
            str(staging),
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

    print(f'flashed corpus storage image from {bundle_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
