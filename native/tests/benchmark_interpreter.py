#!/usr/bin/env python3
"""Compare already-built interpreters using alternating, single-threaded replays."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import statistics
import subprocess


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', action='append', required=True, metavar='NAME=PATH')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--corpus', type=Path, default=root / 'src/tests/resources/testdata.js')
    parser.add_argument('--extra-corpus', type=Path)
    parser.add_argument('--runs', type=int, default=4)
    parser.add_argument('--repeat', type=int, default=3)
    parser.add_argument('--hardware-counters', action='store_true', help='Use macOS time -lp for process instruction/cycle counts')
    args = parser.parse_args()
    if args.runs < 2 or args.repeat < 1:
        parser.error('--runs must be >= 2 and --repeat >= 1')
    if args.hardware_counters and platform.system() != 'Darwin':
        parser.error('--hardware-counters requires macOS')
    binaries = {}
    for spec in args.binary:
        name, separator, path = spec.partition('=')
        if not separator or not name or not all(c.isalnum() or c in '-_' for c in name) or name in binaries:
            parser.error('--binary needs a unique simple NAME=PATH')
        binaries[name] = Path(path).resolve(strict=True)
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    workloads = [('corpus', args.corpus.resolve(strict=True), args.repeat)]
    if args.extra_corpus:
        workloads.append(('extra', args.extra_corpus.resolve(strict=True), 1))
    metadata = dict(platform=platform.platform(), machine=platform.machine(), runs=args.runs, repeat=args.repeat,
                    binary_sha256={name: sha256(path) for name, path in binaries.items()},
                    corpus_sha256={name: sha256(path) for name, path, _ in workloads},
                    counters_enabled=False, jobs=1)
    results, cases = [], {}
    names = list(binaries)
    for trial in range(args.runs):
        for name in names if trial % 2 == 0 else names[::-1]:
            for workload, corpus, repeats in workloads:
                stem = f'{workload}-{name}-{trial + 1}'
                summary = out / f'{stem}.json'
                command = [binaries[name], 'test', 'simulation-corpus', corpus, '--turn-executor', 'interpreter',
                           '--repeat', str(repeats), '--jobs', '1', '--quiet', '--cpu-timers',
                           '--top-slow-cases', '10000', '--json-summary-out', summary]
                if args.hardware_counters:
                    command = ['/usr/bin/time', '-lp', *command]
                log = out / f'{stem}.log'
                with log.open('w') as stream:
                    subprocess.run(list(map(str, command)), cwd=root, stdout=stream, stderr=subprocess.STDOUT, check=True)
                data = json.loads(summary.read_text())
                status = data['status_summary']
                if status['failed'] or status['passed'] != status['cases'] * repeats:
                    raise RuntimeError(f'Incomplete or failed replay: {stem}')
                if any(data['runtime_counters'].values()):
                    raise RuntimeError(f'Runtime counters contaminated timing: {stem}')
                row = dict(trial=trial + 1, variant=name, workload=workload,
                           cpu_ms=data['profile']['replay_cpu_ms'] / repeats,
                           wall_ms=data['profile']['replay_ms'] / repeats)
                for label, key in [('instructions retired', 'process_instructions'), ('cycles elapsed', 'process_cycles')]:
                    match = re.search(r'^\s*(\d+)\s+' + label + r'\s*$', log.read_text(), re.MULTILINE)
                    if match:
                        row[key] = int(match.group(1))
                results.append(row)
                if workload == 'corpus':
                    for case in data['slow_cases']:
                        entry = cases.setdefault(str(case['index']), dict(name=case['name'], times={}))
                        entry['times'].setdefault(name, []).append(case['replay_cpu_ms'] / repeats)
                print(json.dumps(row), flush=True)
    if metadata['binary_sha256'] != {name: sha256(path) for name, path in binaries.items()}:
        raise RuntimeError('A benchmark binary changed during timing')
    medians = {w: {n: statistics.median(r['cpu_ms'] for r in results if r['variant'] == n and r['workload'] == w)
                   for n in names} for w, _, _ in workloads}
    case_medians = {i: dict(name=c['name'], cpu_ms={n: statistics.median(t) for n, t in c['times'].items()})
                    for i, c in cases.items()}
    report = dict(metadata=metadata, medians=medians, results=results, cases=case_medians)
    (out / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(medians, indent=2), flush=True)


if __name__ == '__main__':
    main()
