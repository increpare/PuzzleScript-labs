"""Canonical PuzzlePocket silk layout — shared by HTML preview, SVG, and KiCad.

Paint-order model (matches locked v20 HTML):
  L0 brick → L1 rules (bbox masks + text) → L2 logo → L3 labels

Masks are FR4 knockouts over lower ink. For KiCad/Gerber (binary silk) that
means: omit brick/rule ink inside higher masks; still emit the higher ink.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from PIL import Image

import params as P

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "silk_rules_corpus.txt"
MASCOT_PNG = HERE.parents[2] / "src" / "images" / "mascot_16.png"

W, H = 80.5, 37.0
SIZE = 1.25
# Locked v20 — keep in lockstep with gen_silk_preview.py
CW = SIZE * 0.68          # column packing
MASK_ADV = 0.62           # knockout width factor (tighter than packing)
LEADING = SIZE * 1.05
PAD = 0.45
PIN_PITCH = 1.25
BRICK_U = 0.32
BRICK_TILE = [(0, 0, 5, 1), (2, 1, 1, 1), (0, 2, 5, 1), (1, 3, 1, 2)]
TW = TH = 5 * BRICK_U

AABB = Tuple[float, float, float, float]  # x0,y0,x1,y1


@dataclass
class TextItem:
    s: str
    x: float
    y: float
    size: float
    anchor: str = "start"  # start|middle|end
    rot: float = 0.0
    # SVG-only extras
    weight: str = "600"
    baseline_middle: bool = False


@dataclass
class Layer:
    """One paint-order band: clear masks, then silk rects/texts (matches HTML)."""
    masks: List[AABB] = field(default_factory=list)
    rects: List[AABB] = field(default_factory=list)
    texts: List[TextItem] = field(default_factory=list)


@dataclass
class Side:
    """Full side. ``layers`` are bottom→top (rules, logo, labels)."""
    layers: List[Layer] = field(default_factory=list)
    rule_count: int = 0

    # Convenience aggregates (for debug / legacy)
    @property
    def masks(self) -> List[AABB]:
        out: List[AABB] = []
        for ly in self.layers:
            out.extend(ly.masks)
        return out

    @property
    def rects(self) -> List[AABB]:
        out: List[AABB] = []
        for ly in self.layers:
            out.extend(ly.rects)
        return out

    @property
    def texts(self) -> List[TextItem]:
        out: List[TextItem] = []
        for ly in self.layers:
            out.extend(ly.texts)
        return out


def load_mascot() -> List[str]:
    im = Image.open(MASCOT_PNG).convert("RGBA")
    px = im.load()
    grid = []
    for y in range(16):
        row = []
        for x in range(16):
            r, g, b, a = px[x, y]
            if a < 20 or (r > 240 and g > 240 and b > 240):
                row.append(".")
            else:
                row.append("#")
        grid.append("".join(row))
    return grid


def load_corpus() -> List[str]:
    return [ln for ln in CORPUS.read_text(encoding="utf-8").splitlines() if ln.strip()
            and "rigid" not in ln.lower()]


def _rect(x, y, w, h) -> AABB:
    return (x, y, x + w, y + h)


def text_neg_bbox(x, y, s, size, anchor="start", pad=None) -> AABB:
    if pad is None:
        pad = PAD * 0.55
    cw = size * MASK_ADV
    n = max(len(s), 1)
    if anchor == "middle":
        x0 = x - n * cw / 2 - pad
    elif anchor == "end":
        x0 = x - n * cw - pad
    else:
        x0 = x - pad
    return (x0, y - size - pad * 0.35, x0 + n * cw + 2 * pad, y - size - pad * 0.35 + size + 1.7 * pad)


def text_neg_outline(x, y, s, size, anchor="start") -> List[AABB]:
    cw = size * MASK_ADV
    n = len(s)
    if anchor == "middle":
        x0 = x - n * cw / 2
    elif anchor == "end":
        x0 = x - n * cw
    else:
        x0 = x
    out = []
    for i, ch in enumerate(s):
        if ch == " ":
            continue
        out.append(_rect(
            x0 + i * cw - PAD * 0.7,
            y - size + PAD * 0.2,
            cw + 1.4 * PAD,
            size + 1.3 * PAD,
        ))
    return out


def vtext_neg_glyphs(x, y, s, size) -> List[AABB]:
    cw = size * MASK_ADV
    pad = 0.14
    x0 = x - size - pad
    w = min(size + 0.25 * size + 2 * pad, PIN_PITCH - 0.08)
    if w < size + 0.25 * size + 2 * pad:
        x0 = x - w + 0.2 * size
    out = []
    for i, _ch in enumerate(s):
        gy = y - (i + 1) * cw - pad * 0.35
        gh = cw + pad * 0.9
        out.append(_rect(x0, gy, w, gh))
    return out


def mascot_rects(ox, oy, px, grid, as_mask=False) -> List[AABB]:
    pad = PAD if as_mask else 0.0
    out = []
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch == "#":
                out.append(_rect(
                    ox + c * px - pad,
                    oy + r * px - pad,
                    px + 2 * pad,
                    px + 2 * pad,
                ))
    return out


class RuleStream:
    def __init__(self, rules, start=0):
        self.rules = list(rules)
        self.i = start
        self.n = 0

    def take(self, max_chars: int) -> Optional[str]:
        if not self.rules:
            return None
        for _ in range(len(self.rules) * 2):
            r = self.rules[self.i % len(self.rules)]
            self.i += 1
            if len(r) <= max_chars:
                self.n += 1
                return r
        return None


def columns_fill(side: Side, x0, y0, x1, y1, stream: RuleStream, n_cols=3, gap=0.55):
    total_w = x1 - x0
    col_w = (total_w - gap * (n_cols - 1)) / n_cols
    max_chars = max(6, int(col_w / CW))
    for c in range(n_cols):
        cx = x0 + c * (col_w + gap)
        y = y0 + SIZE * 0.85
        while y < y1 - 0.1:
            rule = stream.take(max_chars)
            if rule is None:
                break
            side.masks.append(text_neg_bbox(cx, y, rule, SIZE))
            side.texts.append(TextItem(rule, cx, y, SIZE))
            y += LEADING
    side.rule_count = stream.n


def brand_block(side: Side, mx, my, mascot_px, grid, word1, word2, word_size, sub_size):
    tx = mx + 16 * mascot_px + 1.2
    ty1 = my + mascot_px * 7
    ty2 = ty1 + word_size + 0.55
    side.masks.extend(mascot_rects(mx, my, mascot_px, grid, as_mask=True))
    side.masks.extend(text_neg_outline(tx, ty1, word1, word_size))
    side.masks.extend(text_neg_outline(tx, ty2, word2, sub_size))
    # ink (mascot cells slightly smaller than mask)
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch == "#":
                side.rects.append(_rect(mx + c * mascot_px, my + r * mascot_px, mascot_px * 0.95, mascot_px * 0.95))
    side.texts.append(TextItem(word1, tx, ty1, word_size))
    side.texts.append(TextItem(word2, tx, ty2, sub_size))


def sprite_logo(side: Side):
    # Full line bboxes (not per-glyph outlines) so rules can't seep through
    # gaps in ".000." / ".111." and look like missing/garbled text.
    for i, s in enumerate([".000.", ".111.", "22222", ".333.", ".3.3."]):
        y = 22.0 + i * 1.4
        side.masks.append(text_neg_bbox(35.2, y, s, 1.25))
        side.texts.append(TextItem(s, 35.2, y, 1.25))


def dir_labels(side: Side):
    for gx, gy, ch in (
        (17.2, 2.0, "^"),
        (17.2, 30.8, "V"),
        (2.3, 15.8, "<"),
        (32.1, 15.8, ">"),
    ):
        side.masks.append(_rect(gx - 1.6, gy - 1.6, 3.2, 3.0))
        side.texts.append(TextItem(
            ch, gx, gy, 4.2, anchor="middle", weight="700", baseline_middle=True,
        ))


def slide_labels(side: Side):
    for s, x in (("POWER", 20.0), ("MUTE", 58.0)):
        side.masks.extend(text_neg_outline(x, 34.8, s, 1.4, anchor="middle"))
        side.texts.append(TextItem(s, x, 34.8, 1.4, anchor="middle"))


def pin_xs(n: int) -> List[float]:
    if n == 4:
        return [-1.875, -0.625, 0.625, 1.875]
    if n == 2:
        return [-0.625, 0.625]
    return []


def io_block(side: Side, fx, fy, labels, title, flipped=True, below=False):
    n = len(labels)
    xs = pin_xs(n)
    board_xs = [fx + (-x if flipped else x) for x in xs]
    label_size = 0.95
    cw = label_size * MASK_ADV
    cols = ["%d·%s" % (i, lab) for i, lab in enumerate(labels, 1)]
    max_len = max(len(c) for c in cols)
    title_size = 1.05
    if below:
        # Stack mirrored SOUTH of the body: BAT_OUT sits 3 mm off the north
        # edge (module-socket clearance), so there is no room above it.
        # vtext runs upward from its anchor, so anchor each column lower by
        # its own length to keep the stacks top-aligned at the body.
        body_y = fy + 2.1
        anchors = [body_y + 0.35 + len(c) * cw for c in cols]
        title_y = body_y + 0.35 + max_len * cw + 1.4 + title_size
        tick_y = body_y - 0.1
    else:
        body_y = fy - 2.1
        anchors = [body_y - 0.35] * n
        title_y = body_y - 0.35 - max_len * cw - 1.4
        tick_y = body_y - 0.35

    side.masks.extend(text_neg_outline(fx, title_y, title, title_size, anchor="middle"))
    for bx, col, ay in zip(board_xs, cols, anchors):
        side.masks.extend(vtext_neg_glyphs(bx, ay, col, label_size))

    side.texts.append(TextItem(title, fx, title_y, title_size, anchor="middle"))
    for bx, col, ay in zip(board_xs, cols, anchors):
        side.texts.append(TextItem(col, bx, ay, label_size, rot=-90))
        side.rects.append(_rect(bx - 0.15, tick_y, 0.3, 0.45))


def conn_anchor(site):
    """Board-local silk anchor for a P.CONN_* connector position."""
    return (site[0] - P.PCB_X, site[1] - P.PCB_Y)


def brick_rects_full() -> List[AABB]:
    """Full-board brick tiles (no keepouts — masks clear them in paint order).

    Skip cells that would be clipped by the board margin so the FR4 frame
    stays a clean rectangle instead of chewed brick stubs.
    """
    parts = []
    margin = 0.1
    xs, x = [], margin
    while x < W - margin:
        xs.append(x)
        x += TW
    ys, y = [], margin
    while y < H - margin:
        ys.append(y)
        y += TH
    for ty in ys:
        for tx in xs:
            for bx, by, bw, bh in BRICK_TILE:
                rx, ry = tx + bx * BRICK_U, ty + by * BRICK_U
                rw, rh = bw * BRICK_U, bh * BRICK_U
                if rx < margin or ry < margin or rx + rw > W - margin or ry + rh > H - margin:
                    continue
                parts.append((rx, ry, rx + rw, ry + rh))
    return parts


def _aabb_intersects(a: AABB, b: AABB) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def text_approx_aabb(t: TextItem) -> AABB:
    cw = t.size * MASK_ADV
    n = max(len(t.s), 1)
    if t.rot == -90:
        return (t.x - t.size, t.y - n * cw, t.x + 0.3 * t.size, t.y)
    width = n * cw
    if t.anchor == "middle":
        x0 = t.x - width / 2
    elif t.anchor == "end":
        x0 = t.x - width
    else:
        x0 = t.x
    if t.baseline_middle:
        return (x0 - 0.2, t.y - t.size / 2, x0 + width + 0.2, t.y + t.size / 2)
    return (x0, t.y - t.size, x0 + width, t.y + 0.2)


def build_front(corpus=None, grid=None) -> Tuple[Side, RuleStream]:
    corpus = corpus if corpus is not None else load_corpus()
    grid = grid if grid is not None else load_mascot()
    stream = RuleStream(corpus)

    # Keep ALL rules — HTML paints them then covers with higher-layer masks.
    # Dropping intersections was deleting whole stretches of columns.
    rules = Layer()
    columns_fill(rules, 2.6, 2.4, 79.2, 36.3, stream, 3, 0.55)

    logo = Layer()
    brand_block(logo, 23.5, 1.2, 0.55, grid, "PuzzlePocket", "PuzzleScript", 2.1, 1.25)
    sprite_logo(logo)

    labels = Layer()
    dir_labels(labels)
    slide_labels(labels)

    side = Side(layers=[rules, logo, labels], rule_count=len(rules.texts))
    return side, stream


def build_back(corpus=None, grid=None, start: int = 0) -> Side:
    corpus = corpus if corpus is not None else load_corpus()
    grid = grid if grid is not None else load_mascot()
    stream = RuleStream(corpus, start=start)

    rules = Layer()
    columns_fill(rules, 2.6, 2.4, 79.2, 36.3, stream, 3, 0.55)

    logo = Layer()
    brand_block(logo, 8.0, 3.2, 0.88, grid, "PuzzlePocket", "PuzzleScript", 2.8, 1.55)

    labels = Layer()
    io_block(labels, *conn_anchor(P.CONN_I2C), ["3V3", "GND", "SCL", "SDA"], "J_I2C1")
    io_block(labels, *conn_anchor(P.CONN_EXP), ["INT", "NC", "NC", "NC"], "J_EXP1")
    io_block(labels, *conn_anchor(P.CONN_BAT_IN), ["BAT+", "GND"], "J_BAT_IN1")
    io_block(labels, *conn_anchor(P.CONN_BAT_OUT), ["BAT_SW", "GND"], "J_BAT_OUT1",
             below=True)

    return Side(layers=[rules, logo, labels], rule_count=len(rules.texts))


# --- SVG (HTML-identical paint order, for visual parity) --------------------

def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def side_to_preview_svg(side: Side, include_fr4=True) -> str:
    """Rebuild SVG using the same paint-order as gen_silk_preview (masks as FR4)."""
    # Recreate via layered emission from stored primitives is lossy for paint
    # order among equal layers; instead draw: FR4, bricks already clipped,
    # then all remaining ink. Bricks in side.rects are already mask-clipped.
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" '
        f'viewBox="0 0 {W} {H}">',
    ]
    if include_fr4:
        parts.append(f'<rect width="{W}" height="{H}" fill="#2d5a3d"/>')
    parts.append('<g id="ink" fill="#f5f0e1">')
    # Separate brick vs other rects: all in side.rects — fine, all silk.
    for x0, y0, x1, y1 in side.rects:
        parts.append(
            f'<rect x="{x0:.3f}" y="{y0:.3f}" width="{x1 - x0:.3f}" height="{y1 - y0:.3f}"/>'
        )
    for t in side.texts:
        anchor = {"start": "start", "middle": "middle", "end": "end"}[t.anchor]
        common = (
            f'fill="#f5f0e1" font-size="{t.size}" font-weight="{t.weight}" '
            f'text-anchor="{anchor}" font-family="ui-monospace, Menlo, Consolas, monospace" '
            f'xml:space="preserve"'
        )
        if t.baseline_middle:
            parts.append(
                f'<text x="{t.x}" y="{t.y}" {common} dominant-baseline="middle">{esc(t.s)}</text>'
            )
        elif t.rot:
            parts.append(
                f'<text x="{t.x:.2f}" y="{t.y:.2f}" {common} '
                f'transform="rotate({t.rot:.0f} {t.x:.2f},{t.y:.2f})">{esc(t.s)}</text>'
            )
        else:
            parts.append(f'<text x="{t.x}" y="{t.y}" {common}>{esc(t.s)}</text>')
    parts.append("</g></svg>")
    return "\n".join(parts)


def build_both() -> Tuple[Side, Side]:
    corpus = load_corpus()
    grid = load_mascot()
    front, stream = build_front(corpus, grid)
    back = build_back(corpus, grid, start=stream.i)
    return front, back
