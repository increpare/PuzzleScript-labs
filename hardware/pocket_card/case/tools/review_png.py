"""Small, dependency-free PNG normalizer and review-render validator."""

from dataclasses import dataclass
import os
from pathlib import Path
import struct
import tempfile
import zlib


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
VOLATILE_CHUNKS = {b"tEXt", b"zTXt", b"iTXt", b"tIME", b"eXIf"}


class PngError(ValueError):
    pass


@dataclass(frozen=True)
class PngInfo:
    width: int
    height: int
    pixels: bytes
    variance: float


def _chunks(data):
    if not data.startswith(PNG_SIGNATURE):
        raise PngError("not a PNG file")
    offset = len(PNG_SIGNATURE)
    while offset < len(data):
        if offset + 12 > len(data):
            raise PngError("truncated PNG chunk")
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        end = offset + 12 + length
        if end > len(data):
            raise PngError("truncated PNG chunk payload")
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        raw = data[offset:end]
        yield kind, payload, raw
        offset = end
        if kind == b"IEND":
            if offset != len(data):
                raise PngError("data follows IEND")
            return
    raise PngError("PNG has no IEND chunk")


def normalize_png(path):
    """Remove producer/path/time metadata while retaining compressed pixel bytes."""
    path = Path(path)
    normalized = bytearray(PNG_SIGNATURE)
    for kind, _payload, raw in _chunks(path.read_bytes()):
        if kind not in VOLATILE_CHUNKS:
            normalized.extend(raw)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(normalized)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _paeth(a, b, c):
    prediction = a + b - c
    distances = abs(prediction - a), abs(prediction - b), abs(prediction - c)
    return (a, b, c)[distances.index(min(distances))]


def inspect_png(path):
    header = None
    compressed = bytearray()
    for kind, payload, _raw in _chunks(Path(path).read_bytes()):
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            compressed.extend(payload)
    if header is None:
        raise PngError("PNG has no IHDR chunk")
    width, height, depth, color_type, compression, filtering, interlace = header
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if depth != 8 or channels is None or compression or filtering or interlace:
        raise PngError("review PNG must be non-interlaced 8-bit grayscale/RGB/RGBA")
    packed = zlib.decompress(bytes(compressed))
    stride = width * channels
    if len(packed) != height * (stride + 1):
        raise PngError("unexpected decompressed PNG size")
    pixels = bytearray()
    prior = bytearray(stride)
    cursor = 0
    for _row in range(height):
        filter_type = packed[cursor]
        cursor += 1
        filtered = packed[cursor:cursor + stride]
        cursor += stride
        current = bytearray(stride)
        for index, value in enumerate(filtered):
            left = current[index - channels] if index >= channels else 0
            above = prior[index]
            upper_left = prior[index - channels] if index >= channels else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                predictor = _paeth(left, above, upper_left)
            else:
                raise PngError(f"unsupported PNG filter {filter_type}")
            current[index] = (value + predictor) & 0xff
        pixels.extend(current)
        prior = current
    count = len(pixels)
    total = sum(pixels)
    variance = sum(value * value for value in pixels) / count - (total / count) ** 2
    return PngInfo(width, height, bytes(pixels), variance)


def validate_review_set(directory, expected_names, expected_size):
    directory = Path(directory)
    expected_names = set(expected_names)
    actual_names = {path.name for path in directory.iterdir() if path.is_file()}
    if actual_names != expected_names:
        raise PngError(f"review filenames differ: expected {sorted(expected_names)}, got {sorted(actual_names)}")
    infos = {}
    for name in sorted(expected_names):
        info = inspect_png(directory / name)
        if (info.width, info.height) != tuple(expected_size):
            raise PngError(f"{name}: expected {tuple(expected_size)}, got {(info.width, info.height)}")
        if info.variance <= 100.0:
            raise PngError(f"{name}: image is blank or has insufficient color variance")
        infos[name] = info
    for index, first_name in enumerate(sorted(infos)):
        first = infos[first_name].pixels
        for second_name in sorted(infos)[index + 1:]:
            second = infos[second_name].pixels
            if len(first) != len(second):
                continue
            mean_difference = sum(abs(a - b) for a, b in zip(first, second)) / len(first)
            if mean_difference <= 3.0:
                raise PngError(f"{first_name} and {second_name} are not materially different")
    return infos
