#!/usr/bin/env python3
"""Flash PuzzleScript games onto the ESP32-P4 internal storage FAT partition."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

DEFAULT_GAMES = [
    'sokoban_basic.txt',
    'microban.txt',
    'push.txt',
    'actiontest.txt',
    'heroes_of_sokoban.txt',
    'nekopuzzle.txt',
]

SOLVER_TESTS_DIR = Path('src/tests/solver_tests')


@dataclass(frozen=True)
class GameRecord:
    title: str
    filename: str
    source_path: Path | None = None
    source_text: str | None = None

    @property
    def source_bytes(self) -> int:
        if self.source_text is not None:
            return len(self.source_text.encode('utf-8'))
        if self.source_path is not None:
            return self.source_path.stat().st_size
        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--corpus',
        choices=('solver_tests', 'demo', 'testdata'),
        default='solver_tests',
        help=(
            'Game set to flash '
            '(solver_tests=src/tests/solver_tests, demo=src/demo, testdata=simulation fixtures)'
        ),
    )
    parser.add_argument(
        '--demo-dir',
        default='src/demo',
        help='Directory containing .txt game sources for --corpus demo',
    )
    parser.add_argument(
        '--solver-dir',
        default=str(SOLVER_TESTS_DIR),
        help='Directory containing .txt game sources for --corpus solver_tests',
    )
    parser.add_argument(
        '--games',
        nargs='*',
        default=None,
        help='Game filenames to include when --corpus demo (default: curated demo set)',
    )
    parser.add_argument('--port', default='COM3', help='Serial port for esptool')
    parser.add_argument('--offset', default='0x710000', help='Storage partition flash offset')
    parser.add_argument('--partition-size', default='0xC01000', help='Storage partition size')
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


def sanitize_storage_filename(name: str) -> str:
    cleaned = name.strip().replace('\\', '_').replace('/', '_')
    for ch in ':*?"<>|':
        cleaned = cleaned.replace(ch, '_')
    cleaned = re.sub(r'\s+', ' ', cleaned)
    if not cleaned.lower().endswith('.txt'):
        cleaned = f'{cleaned}.txt'
    return cleaned or 'game.txt'


def sanitize_testdata_filename(name: str, index: int) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', ' ', name.strip())
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = cleaned.replace(' ', '_')
    cleaned = re.sub(r'_+', '_', cleaned).strip('._')
    if not cleaned:
        cleaned = 'game'
    return f'{index + 1:04d}_{cleaned[:180]}.txt'


def extract_title_from_source(text: str, fallback: str) -> str:
    for line in text.splitlines()[:40]:
        match = re.match(r'(?i)^title\s+(.+?)\s*$', line)
        if match:
            return match.group(1).strip()
    return fallback


def extract_title_from_file(path: Path) -> str:
    text = path.read_text(encoding='utf-8', errors='replace')
    return extract_title_from_source(text, path.stem.replace('_', ' '))


def load_solver_test_games(repo_root: Path, solver_dir: Path) -> list[GameRecord]:
    if not solver_dir.is_dir():
        raise SystemExit(f'missing solver corpus dir: {solver_dir}')

    records: list[GameRecord] = []
    for index, path in enumerate(sorted(solver_dir.glob('*.txt'), key=lambda item: item.name.lower())):
        title = extract_title_from_file(path)
        filename = f'{index + 1:04d} - {sanitize_storage_filename(path.name)}'
        records.append(GameRecord(title=title, filename=filename, source_path=path))
    return records


def load_testdata_games(repo_root: Path) -> list[tuple[int, str, str]]:
    testdata_path = repo_root / 'src' / 'tests' / 'resources' / 'testdata.js'
    if not testdata_path.is_file():
        raise SystemExit(f'missing testdata corpus: {testdata_path}')

    node_script = r"""
const fs = require('fs');
const vm = require('vm');
const filePath = process.argv[1];
const source = fs.readFileSync(filePath, 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: filePath });
for (let index = 0; index < sandbox.testdata.length; index += 1) {
    const row = sandbox.testdata[index];
    const name = row[0];
    const payload = row[1];
    const text = payload[0];
    process.stdout.write(JSON.stringify({ index, name, source: text }) + '\n');
}
"""
    result = subprocess.run(
        ['node', '-e', node_script, str(testdata_path)],
        check=True,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
    )
    games: list[tuple[int, str, str]] = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        games.append((int(record['index']), str(record['name']), str(record['source'])))
    return games


def load_demo_games(demo_dir: Path, game_names: list[str]) -> list[GameRecord]:
    records: list[GameRecord] = []
    for name in game_names:
        source = demo_dir / name
        if not source.is_file():
            print(f'skip missing game: {source}', flush=True)
            continue
        title = extract_title_from_file(source)
        records.append(
            GameRecord(
                title=title,
                filename=to_fat83(name),
                source_path=source,
            ),
        )
    return records


def load_testdata_records(repo_root: Path) -> list[GameRecord]:
    records: list[GameRecord] = []
    for index, name, source in load_testdata_games(repo_root):
        filename = sanitize_testdata_filename(name, index)
        records.append(GameRecord(title=name, filename=filename, source_text=source))
    return records


def load_corpus(repo_root: Path, args: argparse.Namespace) -> list[GameRecord]:
    if args.corpus == 'demo':
        demo_dir = (repo_root / args.demo_dir).resolve()
        game_names = args.games if args.games else DEFAULT_GAMES
        return load_demo_games(demo_dir, game_names)
    if args.corpus == 'testdata':
        return load_testdata_records(repo_root)
    solver_dir = (repo_root / args.solver_dir).resolve()
    return load_solver_test_games(repo_root, solver_dir)


def stage_games(staging: Path, records: list[GameRecord]) -> list[tuple[str, str]]:
    staging.mkdir(parents=True, exist_ok=True)
    copied: list[tuple[str, str]] = []
    catalog_lines: list[str] = []

    for index, record in enumerate(records):
        target = staging / record.filename
        if record.source_path is not None:
            shutil.copy2(record.source_path, target)
        elif record.source_text is not None:
            target.write_text(record.source_text, encoding='utf-8', newline='\n')
        else:
            raise SystemExit(f'missing source for {record.filename}')

        copied.append((record.title, record.filename))
        catalog_lines.append(f'{record.filename}|{record.title}\n')
        if index < 5 or index >= len(records) - 2:
            print(f'staged {record.title} -> GAMES/{record.filename}', flush=True)
        elif index == 5:
            print(f'... staging {len(records) - 7} more games ...', flush=True)

    (staging / '_CATALOG.TXT').write_text(''.join(catalog_lines), encoding='utf-8')
    print(f'staged catalog titles for {len(catalog_lines)} games', flush=True)
    return copied


def run(command: list[str]) -> None:
    print('>', ' '.join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    records = load_corpus(repo_root, args)

    if not records:
        raise SystemExit('no games staged')

    total_bytes = sum(record.source_bytes for record in records)
    partition_bytes = int(args.partition_size, 16)
    print(
        f'corpus={args.corpus} games={len(records)} source_bytes={total_bytes} '
        f'partition_bytes={partition_bytes}',
        flush=True,
    )
    if total_bytes > partition_bytes // 2:
        print('warning: source payload is large relative to partition size', flush=True)

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
        copied = stage_games(staging, records)

        if args.dry_run:
            print(f'dry run: would flash {len(copied)} games to {args.offset}')
            return 0

        image_path = Path(tmp) / 'storage.bin'
        fatgen_size = max(512 * 1024, partition_bytes - 4096)
        run([
            str(py),
            str(fatfsgen),
            str(staging.parent),
            '--output_file',
            str(image_path),
            '--partition_size',
            hex(fatgen_size),
            '--sector_size',
            '4096',
            '--long_name_support',
            '--use_default_datetime',
        ])
        image_bytes = image_path.stat().st_size
        print(f'fat image size={image_bytes} bytes', flush=True)
        if image_bytes > partition_bytes:
            raise SystemExit(
                f'FAT image ({image_bytes} bytes) exceeds partition ({partition_bytes} bytes); '
                f'increase storage partition in firmware/esp32p4/partitions.csv',
            )

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
