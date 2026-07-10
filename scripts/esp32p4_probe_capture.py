#!/usr/bin/env python3
"""Capture ESP32-P4 probe serial output one line at a time."""

from __future__ import annotations

import argparse
import sys
import time

try:
    import serial
except ImportError as error:
    sys.stderr.write(
        'esp32p4_probe_capture: pyserial is required (install via ESP-IDF python env)\n',
    )
    raise SystemExit(2) from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Capture ESP32-P4 board-probe serial logs without splitting JSON lines.',
    )
    parser.add_argument('--port', required=True, help='Serial port, e.g. COM3')
    parser.add_argument('--out', required=True, help='Output log path')
    parser.add_argument('--baud', type=int, default=115200, help='Serial baud rate (default: 115200)')
    parser.add_argument(
        '--timeout-ms',
        type=int,
        default=30000,
        help='Stop after this many milliseconds (default: 30000)',
    )
    parser.add_argument(
        '--done-pattern',
        default='Returned from app_main',
        help='Stop early when a captured line contains this text',
    )
    parser.add_argument(
        '--reset',
        action='store_true',
        help='Pulse RTS/DTR to reset the board before capture',
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    deadline = time.time() + (args.timeout_ms / 1000.0)
    captured: list[str] = []
    done = False

    with serial.Serial(args.port, args.baud, timeout=0.2) as ser:
        if args.reset:
            ser.dtr = False
            ser.rts = True
            time.sleep(0.1)
            ser.rts = False
            time.sleep(0.1)

        while time.time() < deadline and not done:
            raw = ser.readline()
            if not raw:
                continue
            line = raw.decode('utf-8', errors='replace').rstrip('\r\n')
            if not line:
                continue
            captured.append(line)
            if args.done_pattern and args.done_pattern in line:
                done = True

    with open(args.out, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(captured))
        if captured:
            handle.write('\n')

    sys.stderr.write(
        f'esp32p4_probe_capture: wrote {len(captured)} lines to {args.out} done={done}\n',
    )
    return 0 if captured else 1


if __name__ == '__main__':
    raise SystemExit(main())
