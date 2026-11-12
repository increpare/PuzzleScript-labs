#!/usr/bin/env python3
"""Build and compare opt-in mask kernels, with counters disabled during timing."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import shutil
import statistics
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path('build/asm-mask-experiment/repeated'))
    parser.add_argument('--runs', type=int, default=4)
    parser.add_argument('--repeat', type=int, default=3)
    parser.add_argument('--extra-corpus', type=Path)
    parser.add_argument('--build-dir', type=Path, help='Reuse an isolated experiment build directory')
    parser.add_argument('--kernels', nargs='+', choices=['original', 'cpp', 'neon', 'asm', 'asm-early', 'copy', 'asm-loop', 'anchor', 'anchor-short', 'asm-readonly', 'asm-anchor', 'anchor-cache', 'anchor-adaptive'])
    parser.add_argument('--skip-microbench', action='store_true')
    parser.add_argument('--hardware-counters', action='store_true', help='macOS /usr/bin/time -lp; may require additional OS permissions')
    parser.add_argument('--jobs', type=int, default=4, help='Build parallelism; replays always use one thread')
    args = parser.parse_args()
    if args.runs < 2 or args.repeat < 1:
        parser.error('--runs must be >= 2 and --repeat >= 1')
    root = Path(__file__).resolve().parents[2]
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    build = args.build_dir.resolve() if args.build_dir else out / 'build'
    kernels = ['original', 'anchor-cache', 'anchor-adaptive']
    if args.kernels:
        supported = ['original', 'cpp', 'copy', 'anchor', 'anchor-short', 'anchor-cache', 'anchor-adaptive']
        if platform.machine().lower() in ('arm64', 'aarch64'):
            supported += ['neon', 'asm', 'asm-early', 'asm-loop', 'asm-readonly', 'asm-anchor', 'anchor-cache', 'anchor-adaptive']
        if any(k not in supported for k in args.kernels):
            parser.error('neon/asm require an ARM64 host')
        kernels = list(dict.fromkeys(args.kernels))

    def run(command, log):
        with log.open('w') as stream:
            subprocess.run([str(x) for x in command], cwd=root, stdout=stream,
                           stderr=subprocess.STDOUT, check=True)

    metadata = {'machine': platform.machine(), 'platform': platform.platform(),
                'runs': args.runs, 'repeat': args.repeat, 'kernels': kernels, 'counters_enabled': False,
                'build_flags': ['Release', '-O3', 'LTO', '-march=native', '64-bit masks'],
                'git_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
                'source_hashes': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in
                                  ['native/src/runtime/core.cpp', 'native/src/runtime/core.hpp',
                                   'native/src/cli/main.cpp', 'native/src/runtime/pattern_match_kernels.hpp']},
                'compiler': subprocess.check_output(['c++', '--version'], text=True).splitlines()[0]}
    metadata['binary_hashes'] = {}
    corpora = [root / 'src/tests/resources/testdata.js']
    if args.extra_corpus:
        corpora.append(args.extra_corpus.resolve())
    metadata['corpus_hashes'] = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in corpora}
    (out / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    for kernel in kernels:
        print(f'Building {kernel}', flush=True)
        run(['cmake', '-S', root, '-B', build, '-DCMAKE_BUILD_TYPE=Release',
             '-DPS_MASK_WORD_BITS=64', '-DPS_BUILD_MASK_EXPERIMENTS=ON',
             '-DPS_ENABLE_LTO=ON', '-DPS_ENABLE_MARCH_NATIVE=ON',
             f'-DPS_PATTERN_MATCH_KERNEL={kernel}'], out / f'configure-{kernel}.log')
        run(['cmake', '--build', build, '--target', 'puzzlescript_cpp', 'pattern_match_kernels', 'line_precondition_cache_tests',
             '-j', args.jobs], out / f'build-{kernel}.log')
        native = build / 'native'
        shutil.copy2(native / 'puzzlescript_cpp', out / kernel)
        metadata['binary_hashes'][kernel] = hashlib.sha256((out / kernel).read_bytes()).hexdigest()
        (out / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
        run([native / 'pattern_match_kernels'], out / f'kernel-tests-{kernel}.log')
        run([native / 'line_precondition_cache_tests'], out / f'cache-tests-{kernel}.log')
    for p, expected in metadata['source_hashes'].items():
        if hashlib.sha256((root / p).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'Source changed during builds: {p}')
    if not args.skip_microbench:
        run([build / 'native/pattern_match_kernels', '--bench'], out / 'microbench.jsonl')

    workloads = [('corpus', root / 'src/tests/resources/testdata.js', args.repeat)]
    if args.extra_corpus:
        workloads.append(('extra', args.extra_corpus.resolve(), 1))
    results = []
    # Alternating forward/reverse order puts every variant at both ends.
    for trial in range(args.runs):
        order = kernels if trial % 2 == 0 else list(reversed(kernels))
        for kernel in order:
            for workload, corpus, repeats in workloads:
                stem = f'{workload}-{kernel}-{trial + 1}'
                summary = out / f'{stem}.json'
                command = [out / kernel, 'test', 'simulation-corpus', corpus,
                     '--repeat', repeats, '--jobs', '1', '--quiet',
                     '--cpu-timers', '--top-slow-cases', '10000',
                     '--json-summary-out', summary]
                if args.hardware_counters and platform.system() == 'Darwin':
                    command = ['/usr/bin/time', '-lp', *command]
                log = out / f'{stem}.log'
                run(command, log)
                data = json.loads(summary.read_text())
                status = data['status_summary']
                if status['failed'] or status['passed'] != status['cases'] * repeats:
                    raise RuntimeError(f'Incomplete or failed replay: {stem}')
                if any(data['runtime_counters'].values()):
                    raise RuntimeError('Runtime counters contaminated timing')
                row = {'trial': trial + 1, 'kernel': kernel, 'workload': workload,
                       'replay_ms': data['profile']['replay_ms'] / repeats,
                       'replay_cpu_ms': data['profile']['replay_cpu_ms'] / repeats,
                       'passed': status['passed'], 'cases': status['cases']}
                resource_log = log.read_text()
                for label, key in [('instructions retired', 'process_instructions'),
                                   ('cycles elapsed', 'process_cycles')]:
                    match = re.search(r'^\s*(\d+)\s+' + label + r'\s*$', resource_log, re.MULTILINE)
                    if match:
                        row[key] = int(match.group(1))
                results.append(row)
                print(json.dumps(row), flush=True)
    medians = {}
    for workload, _, _ in workloads:
        medians[workload] = {k: statistics.median(r['replay_ms'] for r in results
                                                 if r['kernel'] == k and r['workload'] == workload)
                             for k in kernels}
    cpu_medians = {w: {k: statistics.median(r['replay_cpu_ms'] for r in results if r['kernel'] == k and r['workload'] == w) for k in kernels} for w, _, _ in workloads}
    report = {'metadata': metadata, 'results': results, 'median_replay_ms': medians, 'median_replay_cpu_ms': cpu_medians}
    (out / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'wall_ms': medians, 'cpu_ms': cpu_medians}, indent=2), flush=True)


if __name__ == '__main__':
    main()
