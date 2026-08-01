#!/usr/bin/env python3
"""Generate horror-vacui silkscreen HTML preview (design iteration helper)."""
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT_HTML = HERE / "out" / "silk_preview.html"
CORPUS = HERE / "silk_rules_corpus.txt"
MASCOT_PNG = HERE.parents[2] / "src" / "images" / "mascot_16.png"
SCREEN = Path(
    "/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs/"
    ".superpowers/brainstorm/38038-1785600512/content/silk-layout-v20-rule-bbox.html"
)

W, H = 80.5, 37.0
SCALE = 5.5
SIZE = 1.25
# Locked v20 metrics (do not "fix" without re-locking the HTML):
# packing advance vs tighter per-glyph/line mask advance.
CW = SIZE * 0.68
MASK_ADV = 0.62  # mask width factor (× size); tighter than packing CW/SIZE
LEADING = SIZE * 1.05
FR4 = "#2d5a3d"
SILK = "#f5f0e1"
MASK = "#2d5a3d"
PAD = 0.45  # brand / general glyph pad
PIN_PITCH = 1.25

# Solid brick motif at ~readable masonry scale (was wrongly ~1.05 mm/cell).
BRICK_U = 0.32
BRICK_TILE = [(0, 0, 5, 1), (2, 1, 1, 1), (0, 2, 5, 1), (1, 3, 1, 2)]
TW, TH = 5 * BRICK_U, 5 * BRICK_U
# Layer stack (bottom → top), each masks what is below near its ink:
#   BG (brick) → RULES → LOGO → LABELS


def load_mascot():
    im = Image.open(MASCOT_PNG).convert("RGBA")
    px = im.load()
    grid = []
    for y in range(16):
        row = []
        for x in range(16):
            r, g, b, a = px[x, y]
            if a < 20:
                row.append(".")
            elif r > 240 and g > 240 and b > 240:
                row.append(".")
            else:
                row.append("#")
        grid.append("".join(row))
    return grid


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text_line(x, y, s, size=SIZE, fill=SILK, weight="600", anchor="start"):
    return (
        f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" '
        f'font-weight="{weight}" text-anchor="{anchor}" '
        f'font-family="ui-monospace, Menlo, Consolas, monospace" '
        f'xml:space="preserve">{esc(s)}</text>'
    )


def neg_rect(x, y, w, h):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{MASK}"/>'


def mascot_pixels(ox, oy, px, grid, as_mask=False):
    fill = MASK if as_mask else SILK
    pad = PAD if as_mask else 0
    parts = [f'<g transform="translate({ox},{oy})" fill="{fill}">']
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch == "#":
                parts.append(
                    f'<rect x="{c * px - pad:.2f}" y="{r * px - pad:.2f}" '
                    f'width="{px + 2 * pad:.2f}" height="{px + 2 * pad:.2f}"/>'
                )
    parts.append("</g>")
    return "\n".join(parts)


def text_neg_outline(x, y, s, size, anchor="start"):
    """Per-glyph pads (spaces skipped) — close outline for logo/labels."""
    cw = size * MASK_ADV
    n = len(s)
    if anchor == "middle":
        x0 = x - n * cw / 2
    elif anchor == "end":
        x0 = x - n * cw
    else:
        x0 = x
    parts = []
    for i, ch in enumerate(s):
        if ch == " ":
            continue
        parts.append(
            neg_rect(
                x0 + i * cw - PAD * 0.7,
                y - size + PAD * 0.2,
                cw + 1.4 * PAD,
                size + 1.3 * PAD,
            )
        )
    return "\n".join(parts)


def text_neg_bbox(x, y, s, size, anchor="start", pad=None):
    """Single axis-aligned knockout under a whole string (includes spaces)."""
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
    return neg_rect(x0, y - size - pad * 0.35, n * cw + 2 * pad, size + 1.7 * pad)


def brand_block(mx, my, mascot_px, grid, word1, word2, word_size, sub_size):
    tx = mx + 16 * mascot_px + 1.2
    ty1 = my + mascot_px * 7
    ty2 = ty1 + word_size + 0.55
    return "\n".join([
        mascot_pixels(mx, my, mascot_px, grid, as_mask=True),
        text_neg_outline(tx, ty1, word1, word_size),
        text_neg_outline(tx, ty2, word2, sub_size),
        mascot_pixels(mx, my, mascot_px, grid, as_mask=False),
        text_line(tx, ty1, word1, word_size),
        text_line(tx, ty2, word2, sub_size),
    ])


def brick_full():
    """BG layer: solid brick motif tiled over the whole board.

    Skip cells that would clip against the margin so the FR4 frame stays clean.
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
                parts.append(
                    f'<rect x="{rx:.2f}" y="{ry:.2f}" '
                    f'width="{rw:.2f}" height="{rh:.2f}" fill="{SILK}"/>'
                )
    return "\n".join(parts)


class RuleStream:
    def __init__(self, rules, start=0):
        self.rules = rules
        self.i = start
        self.n = 0

    def take(self, max_chars):
        for _ in range(len(self.rules) * 2):
            r = self.rules[self.i % len(self.rules)]
            self.i += 1
            if len(r) <= max_chars:
                self.n += 1
                return r
        return None


def columns_fill(x0, y0, x1, y1, stream, n_cols, gap=0.55):
    """RULE layer: one bbox mask per rule (spaces included), then rule silk."""
    total_w = x1 - x0
    col_w = (total_w - gap * (n_cols - 1)) / n_cols
    max_chars = max(6, int(col_w / CW))
    masks, inks = [], []
    for c in range(n_cols):
        cx = x0 + c * (col_w + gap)
        y = y0 + SIZE * 0.85
        while y < y1 - 0.1:
            rule = stream.take(max_chars)
            if rule is None:
                break
            masks.append(text_neg_bbox(cx, y, rule, SIZE))
            inks.append(text_line(cx, y, rule))
            y += LEADING
    return "\n".join(masks + inks)


def pin_xs(n):
    if n == 4:
        return [-1.875, -0.625, 0.625, 1.875]
    if n == 2:
        return [-0.625, 0.625]
    return []


def vtext(x, y, s, size, fill=SILK):
    return (
        f'<text x="{x:.2f}" y="{y:.2f}" fill="{fill}" font-size="{size}" '
        f'font-weight="600" transform="rotate(-90 {x:.2f},{y:.2f})" '
        f'font-family="ui-monospace, Menlo, Consolas, monospace" '
        f'xml:space="preserve">{esc(s)}</text>'
    )


def vtext_neg_glyphs(x, y, s, size):
    """Per-glyph FR4 pads under rotate(-90) text, aligned to the real AABB.

    SVG rotate(-90) about (x,y): local (dx,dy) → parent (x+dy, y-dx).
    Text advances in local +x (parent −Y). Ascenders are local −y (parent −X).
    Spaces are masked too so rules can't seep between "1" and "GND".
    """
    cw = size * MASK_ADV
    pad = 0.14
    # Parent X span for a glyph: roughly [x - size - pad, x + 0.25*size + pad]
    x0 = x - size - pad
    # Keep under pitch so neighbours don't erase each other
    w = min(size + 0.25 * size + 2 * pad, PIN_PITCH - 0.08)
    # If capped, bias toward the ascender side (left of anchor)
    if w < size + 0.25 * size + 2 * pad:
        x0 = x - w + 0.2 * size
    parts = []
    for i, _ch in enumerate(s):
        # Overlap pads slightly in Y so no hairline gaps between glyphs
        gy = y - (i + 1) * cw - pad * 0.35
        gh = cw + pad * 0.9
        parts.append(neg_rect(x0, gy, w, gh))
    return "\n".join(parts)


def io_block(fx, fy, labels, title, flipped=True, preview_body=False):
    """Per-pin vertical legends *north* of the footprint; tight per-glyph masks."""
    n = len(labels)
    xs = pin_xs(n)
    board_xs = [fx + (-x if flipped else x) for x in xs]
    body_w = (n - 1) * PIN_PITCH + 4.5
    body_h = 5.2
    body_x = fx - body_w / 2
    body_y = fy - 2.1
    label_size = 0.95
    cw = label_size * MASK_ADV
    # No spaces — avoids seep gaps; thin separator still readable
    cols = ["%d·%s" % (i, lab) for i, lab in enumerate(labels, 1)]
    max_len = max(len(c) for c in cols)
    pin_anchor_y = body_y - 0.35
    title_size = 1.05
    title_y = pin_anchor_y - max_len * cw - 1.4

    # masks first
    parts = [text_neg_outline(fx, title_y, title, title_size, anchor="middle")]
    for bx, col in zip(board_xs, cols):
        parts.append(vtext_neg_glyphs(bx, pin_anchor_y, col, label_size))

    # silk
    parts.append(text_line(fx, title_y, title, title_size, anchor="middle"))
    for bx, col in zip(board_xs, cols):
        parts.append(vtext(bx, pin_anchor_y, col, label_size))
        parts.append(
            f'<rect x="{bx - 0.15:.2f}" y="{body_y - 0.35:.2f}" '
            f'width="0.3" height="0.45" fill="{SILK}"/>'
        )
    # Connector body is preview chrome only — never part of fab silk.
    if preview_body:
        parts.append(
            f'<rect x="{body_x:.2f}" y="{body_y:.2f}" width="{body_w:.2f}" '
            f'height="{body_h:.2f}" fill="#1e3d2a" stroke="#163024" stroke-width="0.12"/>'
        )
    return "\n".join(parts)


def _dir_labels():
    parts = []
    for gx, gy, ch in [
        (17.2, 2.0, "^"),
        (17.2, 30.8, "V"),
        (2.3, 15.8, "<"),
        (32.1, 15.8, ">"),
    ]:
        parts.append(neg_rect(gx - 1.6, gy - 1.6, 3.2, 3.0))
        parts.append(
            f'<text x="{gx}" y="{gy}" fill="{SILK}" font-size="4.2" '
            f'font-weight="700" text-anchor="middle" dominant-baseline="middle" '
            f'font-family="ui-monospace, Menlo, Consolas, monospace">{esc(ch)}</text>'
        )
    return "\n".join(parts)


def _slide_labels():
    return "\n".join([
        text_neg_outline(20.0, 34.8, "POWER", 1.4, anchor="middle"),
        text_line(20.0, 34.8, "POWER", 1.4, anchor="middle"),
        text_neg_outline(58.0, 34.8, "MUTE", 1.4, anchor="middle"),
        text_line(58.0, 34.8, "MUTE", 1.4, anchor="middle"),
    ])


def _sprite_logo():
    # Line bboxes (not per-glyph outlines) so rules can't seep through gaps.
    parts = []
    for i, s in enumerate([".000.", ".111.", "22222", ".333.", ".3.3."]):
        y = 22.0 + i * 1.4
        parts.append(text_neg_bbox(35.2, y, s, 1.25))
        parts.append(text_line(35.2, y, s, 1.25))
    return "\n".join(parts)


def build_silk_svgs(corpus=None, grid=None, disp=True):
    """Return (front_svg, back_svg, n_f, n_b) — exact locked v20 artwork."""
    if corpus is None:
        corpus = [ln for ln in CORPUS.read_text().splitlines() if ln.strip()]
    if grid is None:
        grid = load_mascot()
    disp_w, disp_h = int(W * SCALE), int(H * SCALE)
    size_attr = f'width="{disp_w}" height="{disp_h}" ' if disp else f'width="{W}mm" height="{H}mm" '

    sf = RuleStream(corpus)
    front = "\n".join([
        f'<svg xmlns="http://www.w3.org/2000/svg" class="pcb" {size_attr}'
        f'viewBox="0 0 {W} {H}">',
        f'<rect width="{W}" height="{H}" fill="{FR4}"/>',
        f'<g id="bg">{brick_full()}</g>',
        f'<g id="rules">{columns_fill(2.6, 2.4, 79.2, 36.3, sf, 3, 0.55)}</g>',
        '<g id="logo">',
        brand_block(23.5, 1.2, 0.55, grid, "PuzzlePocket", "PuzzleScript", 2.1, 1.25),
        _sprite_logo(),
        '</g>',
        '<g id="labels">',
        _dir_labels(),
        _slide_labels(),
        '</g>',
        "</svg>",
    ])
    n_f = sf.n

    sb = RuleStream(corpus, start=sf.i)
    back = "\n".join([
        f'<svg xmlns="http://www.w3.org/2000/svg" class="pcb" {size_attr}'
        f'viewBox="0 0 {W} {H}">',
        f'<rect width="{W}" height="{H}" fill="{FR4}"/>',
        f'<g id="bg">{brick_full()}</g>',
        f'<g id="rules">{columns_fill(2.6, 2.4, 79.2, 36.3, sb, 3, 0.55)}</g>',
        f'<g id="logo">{brand_block(8.0, 3.2, 0.88, grid, "PuzzlePocket", "PuzzleScript", 2.8, 1.55)}</g>',
        '<g id="labels">',
        io_block(60.5, 10.0, ["3V3", "GND", "SCL", "SDA"], "J_I2C", preview_body=False),
        io_block(75.5, 10.0, ["INT", "NC", "NC", "NC"], "J_EXP", preview_body=False),
        io_block(60.5, 23.0, ["BAT+", "GND"], "J_BAT_IN", preview_body=False),
        io_block(75.5, 23.0, ["BAT_SW", "GND"], "J_BAT_OUT", preview_body=False),
        '</g>',
        "</svg>",
    ])
    return front, back, n_f, sb.n


def silk_svgs_only():
    """Bare silk SVGs for out/silk_{front,back}.svg (no component overlays)."""
    front, back, _, _ = build_silk_svgs(disp=False)
    return front + "\n", back + "\n"


def main():
    corpus = [ln for ln in CORPUS.read_text().splitlines() if ln.strip()]
    grid = load_mascot()
    disp_w, disp_h = int(W * SCALE), int(H * SCALE)

    comps_f = """<g fill="#1e3d2a" stroke="#163024" stroke-width="0.1">
<rect x="14.6" y="4.1" width="5.2" height="5.2" rx="0.3"/>
<rect x="14.6" y="22.1" width="5.2" height="5.2" rx="0.3"/>
<rect x="5.6" y="13.1" width="5.2" height="5.2" rx="0.3"/>
<rect x="23.6" y="13.1" width="5.2" height="5.2" rx="0.3"/>
<rect x="55.3" y="10.1" width="5.2" height="5.2" rx="0.3"/>
<rect x="72.0" y="5.4" width="5.2" height="5.2" rx="0.3"/>
<rect x="51.4" y="24.3" width="5.2" height="5.2" rx="0.3"/>
<rect x="34.5" y="29.7" width="8" height="4" rx="1.5"/>
<rect x="38.75" y="10.05" width="7.5" height="17.9"/>
<rect x="14.5" y="32.5" width="11" height="4" rx="0.4"/>
<rect x="52.5" y="32.5" width="11" height="4" rx="0.4"/></g>"""
    holes = """<g fill="#152a1e" stroke="#6a9" stroke-width="0.12">
<circle cx="2" cy="3" r="1.3"/><circle cx="2" cy="35" r="1.3"/>
<circle cx="62.5" cy="3" r="1.3"/><circle cx="63.5" cy="28" r="1.3"/></g>"""

    front_bare, back_bare, n_f, n_b = build_silk_svgs(corpus, grid, disp=True)

    def _conn_ghost(fx, fy, n):
        body_w = (n - 1) * PIN_PITCH + 4.5
        body_h = 5.2
        return (
            f'<rect x="{fx - body_w / 2:.2f}" y="{fy - 2.1:.2f}" width="{body_w:.2f}" '
            f'height="{body_h:.2f}" fill="#1e3d2a" stroke="#163024" stroke-width="0.12"/>'
        )

    conn_ghosts = "\n".join([
        _conn_ghost(60.5, 10.0, 4), _conn_ghost(75.5, 10.0, 4),
        _conn_ghost(60.5, 23.0, 2), _conn_ghost(75.5, 23.0, 2),
    ])
    front = front_bare.replace("</svg>", comps_f + "\n" + holes + "\n</svg>")
    back = back_bare.replace(
        "</svg>",
        conn_ghosts + "\n"
        '<rect x="6.5" y="2" width="50" height="34" fill="none" stroke="#5a8" '
        'stroke-width="0.2" stroke-dasharray="1.2 0.7"/>\n'
        + holes + "\n</svg>",
    )
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    (HERE / "out" / "silk_front.svg").write_text(silk_svgs_only()[0])
    (HERE / "out" / "silk_back.svg").write_text(silk_svgs_only()[1])

    fragment = f"""<h2>Silk v20 — rule line bboxes</h2>
<p class="subtitle">
  Same layer stack. RULE layer now knocks out a <strong>bounding box per rule line</strong> (spaces included) so brick can’t peek through gaps.
</p>
<style>
 .boards{{display:flex;flex-wrap:wrap;gap:1.2rem;justify-content:center}}
 .board-card h3{{margin:0 0 .3rem;font-size:.95rem}}
 .board-card p{{margin:0 0 .5rem;font-size:.8rem;opacity:.75;max-width:520px}}
 svg.pcb{{display:block;border-radius:4px;box-shadow:0 2px 14px rgba(0,0,0,.3)}}
 .options{{margin-top:1rem}}
</style>
<div class="boards">
<div class="board-card"><h3>F.SilkS</h3><p>Brick wallpaper · rules · logo by UP · &lt;^V&gt;/POWER/MUTE · F≈{n_f}</p>{front}</div>
<div class="board-card"><h3>B.SilkS</h3><p>Brick wallpaper · rules · logo · north IO labels · B≈{n_b}</p>{back}</div>
</div>
<div class="section"><p class="label">Lock this layer model?</p></div>
<div class="options">
<div class="option" data-choice="v20-y" onclick="toggleSelect(this)"><div class="letter">Y</div><div class="content"><h3>Yes — lock</h3><p>Write spec + implement on the board.</p></div></div>
<div class="option" data-choice="v20-n" onclick="toggleSelect(this)"><div class="letter">N</div><div class="content"><h3>Nudge</h3><p>Bbox pad, logo/label outline style, etc.</p></div></div>
</div>"""

    standalone = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<title>PuzzlePocket silk v20</title>
<style>body{{margin:0;padding:2rem;background:#141816;color:#e8e4d9;font-family:Palatino,Georgia,serif}}
.sub{{color:#9aa396;max-width:48rem;line-height:1.45}}.boards{{display:flex;flex-wrap:wrap;gap:1.4rem}}
svg.pcb{{display:block;border-radius:4px;box-shadow:0 4px 24px #0007}}</style></head><body>
<h1>Silk v20 — rule bboxes · layered stack</h1>
<p class="sub">BG brick → rules (line bbox masks) → logo → labels. F≈{n_f} · B≈{n_b}</p>
<div class="boards"><div>{front}</div><div>{back}</div></div>
</body></html>"""

    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(standalone)
    if SCREEN.parent.exists():
        SCREEN.write_text(fragment)
    print(f"wrote {OUT_HTML} F≈{n_f} B≈{n_b}")


if __name__ == "__main__":
    main()
