"""Emit PuzzlePocket silk into KiCad + SVG.

SVGs come from gen_silk_preview (HTML-identical).

KiCad silk is vectorized: layout is painted with the packing TTF into a
bitmap, then horizontal runs become filled ``gr_rect``s. No ``gr_text``,
so glyph ink cannot drift away from the knockout masks.
"""
from __future__ import annotations

import math
import os
import uuid
from collections import defaultdict
from typing import List, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFont, ImageOps

import params as P
import silk_layout as L

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
    "/System/Library/Fonts/Supplemental/PTMono.ttc",
    "/System/Library/Fonts/Menlo.ttc",
]

# mm per pixel — ~0.15 mm fab min feature ⇒ 3px.
PX_MM = 0.05


def _uid() -> str:
    return str(uuid.uuid4())


def _fmt(v: float) -> str:
    return ("%.4f" % v).rstrip("0").rstrip(".")


def _font_path() -> str:
    for path in FONT_CANDIDATES:
        if os.path.isfile(path):
            return path
    raise RuntimeError("no monospace TTF/TTC found for silk vectorization")


def _truetype(size_px: int) -> ImageFont.FreeTypeFont:
    path = _font_path()
    try:
        return ImageFont.truetype(path, size_px)
    except Exception:
        return ImageFont.truetype(path, size_px, index=0)


def _gr_rect(x0, y0, x1, y1, layer: str) -> str:
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    if x1 - x0 < 1e-4 or y1 - y0 < 1e-4:
        return ""
    return (
        "\t(gr_rect\n"
        "\t\t(start %s %s)\n"
        "\t\t(end %s %s)\n"
        "\t\t(stroke\n"
        "\t\t\t(width 0)\n"
        "\t\t\t(type default)\n"
        "\t\t)\n"
        "\t\t(fill yes)\n"
        '\t\t(layer "%s")\n'
        '\t\t(uuid "%s")\n'
        "\t)" % (_fmt(x0), _fmt(y0), _fmt(x1), _fmt(y1), layer, _uid())
    )


def _paste_luma(dst: Image.Image, src: Image.Image, x: int, y: int):
    """OR-paste a luma glyph image onto dst (white ink)."""
    if src.mode != "L":
        src = src.convert("L")
    dw, dh = dst.size
    sw, sh = src.size
    # Clip
    dx0, dy0 = max(x, 0), max(y, 0)
    sx0, sy0 = dx0 - x, dy0 - y
    dx1, dy1 = min(x + sw, dw), min(y + sh, dh)
    if dx0 >= dx1 or dy0 >= dy1:
        return
    region = src.crop((sx0, sy0, sx0 + (dx1 - dx0), sy0 + (dy1 - dy0)))
    patch = dst.crop((dx0, dy0, dx1, dy1))
    dst.paste(ImageChops_lighter(patch, region), (dx0, dy0))


def ImageChops_lighter(a: Image.Image, b: Image.Image) -> Image.Image:
    from PIL import ImageChops
    return ImageChops.lighter(a, b)


def _render_horizontal(t: L.TextItem) -> Tuple[Image.Image, float, float, int, int]:
    """Return (glyph_img, paste_x_mm, paste_y_mm, bl_x_px, bl_y_px).

    paste_* is top-left of the glyph image in local mm.
    bl_* is baseline-left inside the glyph image (pixels).
    """
    size_px = max(1, int(round(t.size / PX_MM)))
    font = _truetype(size_px)
    # Bounding box relative to left-baseline anchor.
    left, top, right, bottom = font.getbbox(t.s, anchor="ls")
    pad = 2
    tw = max(1, int(math.ceil(right - left)) + pad * 2)
    th = max(1, int(math.ceil(bottom - top)) + pad * 2)
    im = Image.new("L", (tw, th), 0)
    draw = ImageDraw.Draw(im)
    bl_x = int(-left + pad)
    bl_y = int(-top + pad)
    draw.text((bl_x, bl_y), t.s, font=font, fill=255, anchor="ls")
    # FreeType AA → hard binary silk (masks are hard rects).
    im = im.point(lambda p: 255 if p >= 128 else 0)

    text_w_mm = (right - left) * PX_MM
    if t.anchor == "middle":
        x_left = t.x - text_w_mm / 2
    elif t.anchor == "end":
        x_left = t.x - text_w_mm
    else:
        x_left = t.x

    if t.baseline_middle:
        y_top = t.y - (th * PX_MM) / 2
        # Keep bl_y consistent with centered box (approx).
    else:
        y_top = t.y - bl_y * PX_MM

    return im, x_left, y_top, bl_x, bl_y


def _draw_text(dst: Image.Image, t: L.TextItem, mirror_x: bool = False):
    """Paint text.

    ``mirror_x``: flip glyph pixels in place (same AABB as the HTML layout) so
    B.SilkS reads correctly on the physical back while knockouts stay aligned.
    Do *not* reflect about the start anchor — that walks left-column rules off
    the board and desyncs masks.
    """
    if not t.s:
        return
    if abs(t.rot) < 1e-6:
        im, x_mm, y_mm, bl_x, _ = _render_horizontal(t)
        if mirror_x:
            # Same paste box; characters face the other way.
            im = ImageOps.mirror(im)
        _paste_luma(dst, im, int(round(x_mm / PX_MM)), int(round(y_mm / PX_MM)))
        return

    # SVG rotate(-90°) about anchor, Y-down:
    #   (u, v) from baseline-left → (t.x + v, t.y - u)  — advances north (−Y).
    upright, _, _, bl_x, bl_y = _render_horizontal(
        L.TextItem(t.s, 0, 0, t.size, anchor="start")
    )
    upx = upright.load()
    dw, dh = dst.size
    # Board-X center of this legend — in-place mirror keeps ink on the pad masks.
    aabb = L.text_approx_aabb(t)
    axis_x = 0.5 * (aabb[0] + aabb[2])
    for yy in range(upright.size[1]):
        for xx in range(upright.size[0]):
            val = upx[xx, yy]
            if val < 128:
                continue
            u_mm = (xx - bl_x) * PX_MM
            v_mm = (yy - bl_y) * PX_MM
            mx = t.x + v_mm
            my = t.y - u_mm
            if mirror_x:
                mx = 2.0 * axis_x - mx
            ix = int(round(mx / PX_MM))
            iy = int(round(my / PX_MM))
            if 0 <= ix < dw and 0 <= iy < dh and val > dst.getpixel((ix, iy)):
                dst.putpixel((ix, iy), val)


# Silk must not cover pads / NPTH (unsolderable). Expand pad AABB by this.
PAD_SILK_CLEAR = 0.25  # mm beyond copper pad edge


def _pad_clearances(back: bool) -> List[Tuple[float, float, float, float]]:
    """Silk-local AABBs (0..W, 0..H) to keep clear of SMT pads / holes."""
    ox, oy = P.PCB_X, P.PCB_Y
    clr = PAD_SILK_CLEAR
    out: List[Tuple[float, float, float, float]] = []

    def add_fp(fx, fy, pads_local, flipped: bool):
        # KiCad back footprints are mirrored in X about the anchor.
        for lx, ly, w, h in pads_local:
            if flipped:
                lx = -lx
            x0 = fx - ox + lx - w / 2 - clr
            x1 = fx - ox + lx + w / 2 + clr
            y0 = fy - oy + ly - h / 2 - clr
            y1 = fy - oy + ly + h / 2 + clr
            out.append((x0, y0, x1, y1))

    # SKQG — four SMD pads (KiCad SW_SPST_SKQG_WithStem)
    skqg = [
        (-3.1, -1.85, 1.8, 1.1), (3.1, -1.85, 1.8, 1.1),
        (-3.1, 1.85, 1.8, 1.1), (3.1, 1.85, 1.8, 1.1),
    ]
    # PCM12 — signal + mech SMD + NPTH (treat holes as clearances too)
    pcm12 = [
        (-3.65, -0.78, 1.0, 0.8), (-3.65, 1.43, 1.0, 0.8),
        (3.65, -0.78, 1.0, 0.8), (3.65, 1.43, 1.0, 0.8),
        (-2.25, -1.43, 0.7, 1.5), (0.75, -1.43, 0.7, 1.5),
        (2.25, -1.43, 0.7, 1.5),
        (-1.5, 0.33, 0.9, 0.9), (1.5, 0.33, 0.9, 0.9),
    ]
    # MCP23017 SOIC-28W — body keepout + pad rows
    soic = []
    for i in range(14):
        y = -8.255 + i * 1.27
        soic.append((-4.65, y, 2.05, 0.6))
        soic.append((4.65, y, 2.05, 0.6))
    # JST GH R/A
    jst4 = [
        (-1.875, -1.85, 0.6, 1.7), (-0.625, -1.85, 0.6, 1.7),
        (0.625, -1.85, 0.6, 1.7), (1.875, -1.85, 0.6, 1.7),
        (-3.725, 1.35, 1.0, 2.7), (3.725, 1.35, 1.0, 2.7),
    ]
    jst2 = [
        (-0.625, -1.85, 0.6, 1.7), (0.625, -1.85, 0.6, 1.7),
        (-2.475, 1.35, 1.0, 2.7), (2.475, 1.35, 1.0, 2.7),
    ]

    if not back:
        for fx, fy in (
            (P.DIR_CX, P.DIR_CY - P.DIR_RADIUS),
            (P.DIR_CX, P.DIR_CY + P.DIR_RADIUS),
            (P.DIR_CX - P.DIR_RADIUS, P.DIR_CY),
            (P.DIR_CX + P.DIR_RADIUS, P.DIR_CY),
            (P.UNDO_X, P.UNDO_Y),
            (P.ACT_X, P.ACT_Y),
            (P.RESET_X, P.RESET_Y),
            (P.MENU_X, P.MENU_Y),
        ):
            add_fp(fx, fy, skqg, False)
        add_fp(P.POWER_SW_X, P.POWER_SW_Y, pcm12, False)
        add_fp(P.MUTE_SW_X, P.MUTE_SW_Y, pcm12, False)
        add_fp(P.U1_X, P.U1_Y, soic, False)
        for fx, fy in P.PCB_MOUNTS:
            add_fp(fx, fy, [(0.0, 0.0, 2.7, 2.7)], False)
    else:
        add_fp(*P.CONN_I2C, jst4, True)
        add_fp(*P.CONN_EXP, jst4, True)
        add_fp(*P.CONN_BAT_IN, jst2, True)
        add_fp(*P.CONN_BAT_OUT, jst2, True)
        # Mounting holes pierce both sides — keep silk clear on back too.
        for fx, fy in P.PCB_MOUNTS:
            add_fp(fx, fy, [(0.0, 0.0, 2.7, 2.7)], False)
    return out


def rasterize_side(side: L.Side, mirror_glyphs: bool = False) -> Image.Image:
    """HTML paint order: full brick → for each layer: clear masks → ink."""
    w = max(1, int(math.ceil(L.W / PX_MM)))
    h = max(1, int(math.ceil(L.H / PX_MM)))
    im = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(im)

    # L0 — full brick wallpaper; higher layers carve clean FR4 then draw ink
    for x0, y0, x1, y1 in L.brick_rects_full():
        draw.rectangle(
            [x0 / PX_MM, y0 / PX_MM, x1 / PX_MM - 1e-6, y1 / PX_MM - 1e-6],
            fill=255,
        )

    for layer in side.layers:
        masks = list(layer.masks)
        rects = list(layer.rects)
        texts = list(layer.texts)
        # Mascot pixel-art (many cells): in-place X flip of cells + their
        # masks so the face isn't backwards on B.SilkS. Text is flipped
        # separately inside its own AABB. Sparse tick layers are left alone.
        if mirror_glyphs and len(rects) >= 20:
            ax0 = min(r[0] for r in rects)
            ax1 = max(r[2] for r in rects)
            axis = 0.5 * (ax0 + ax1)

            def _flip_box(box):
                x0, y0, x1, y1 = box
                a, b = 2 * axis - x1, 2 * axis - x0
                if b < a:
                    a, b = b, a
                return (a, y0, b, y1)

            # Flip only masks centered over the mascot cells — brand/word
            # outline masks stay put with the in-place-mirrored text.
            masks = [
                _flip_box(m)
                if ax0 - 0.05 <= 0.5 * (m[0] + m[2]) <= ax1 + 0.05
                else m
                for m in masks
            ]
            rects = [_flip_box(r) for r in rects]
        for x0, y0, x1, y1 in masks:
            # Expand to pixel bounds so brick AA/snap can't leave hairlines
            # on the mask edge (looks like an unclean knockout).
            draw.rectangle(
                [
                    math.floor(x0 / PX_MM),
                    math.floor(y0 / PX_MM),
                    math.ceil(x1 / PX_MM),
                    math.ceil(y1 / PX_MM),
                ],
                fill=0,
            )
        for x0, y0, x1, y1 in rects:
            draw.rectangle(
                [x0 / PX_MM, y0 / PX_MM, x1 / PX_MM - 1e-6, y1 / PX_MM - 1e-6],
                fill=255,
            )
        for t in texts:
            _draw_text(im, t, mirror_x=mirror_glyphs)

    # Last: punch pads / NPTH so fab silk never lands on solderable copper.
    for x0, y0, x1, y1 in _pad_clearances(back=mirror_glyphs):
        draw.rectangle(
            [
                math.floor(x0 / PX_MM),
                math.floor(y0 / PX_MM),
                math.ceil(x1 / PX_MM),
                math.ceil(y1 / PX_MM),
            ],
            fill=0,
        )
    return im


def rle_rects(im: Image.Image) -> List[Tuple[float, float, float, float]]:
    px = im.load()
    w, h = im.size
    runs = []
    for y in range(h):
        x = 0
        while x < w:
            while x < w and px[x, y] < 128:
                x += 1
            if x >= w:
                break
            x0 = x
            while x < w and px[x, y] >= 128:
                x += 1
            runs.append((x0 * PX_MM, y * PX_MM, x * PX_MM, (y + 1) * PX_MM))
    return _merge_vertical_runs(runs)


def _merge_vertical_runs(
    runs: Sequence[Tuple[float, float, float, float]],
) -> List[Tuple[float, float, float, float]]:
    cols = defaultdict(list)
    for x0, y0, x1, y1 in runs:
        cols[(round(x0, 4), round(x1, 4))].append((y0, y1))
    merged = []
    for (x0, x1), ys in cols.items():
        ys.sort()
        cur0, cur1 = ys[0]
        for y0, y1 in ys[1:]:
            if abs(y0 - cur1) < PX_MM * 0.51:
                cur1 = y1
            else:
                merged.append((x0, cur0, x1, cur1))
                cur0, cur1 = y0, y1
        merged.append((x0, cur0, x1, cur1))
    return merged


def side_to_kicad(side: L.Side, layer: str, back: bool) -> List[str]:
    # Back silk: same board XY as the HTML layout (IO stays on JST pads).
    # Glyphs are flipped in-place inside those boxes so the physical back
    # reads normally — not a whole-board X flip, and not a start-anchor
    # reflect (which walked column 0 off the left edge).
    im = rasterize_side(side, mirror_glyphs=back)
    os.makedirs(OUT_DIR, exist_ok=True)
    im.save(os.path.join(OUT_DIR, "silk_raster_%s.png" % ("B" if back else "F")))

    ox, oy = P.PCB_X, P.PCB_Y
    parts = []
    for x0, y0, x1, y1 in rle_rects(im):
        sexpr = _gr_rect(ox + x0, oy + y0, ox + x1, oy + y1, layer)
        if sexpr:
            parts.append(sexpr)
    return parts


def write_svgs() -> tuple:
    import gen_silk_preview as G
    os.makedirs(OUT_DIR, exist_ok=True)
    front_svg, back_svg = G.silk_svgs_only()
    f_path = os.path.join(OUT_DIR, "silk_front.svg")
    b_path = os.path.join(OUT_DIR, "silk_back.svg")
    open(f_path, "w", encoding="utf-8").write(front_svg)
    open(b_path, "w", encoding="utf-8").write(back_svg)
    return f_path, b_path


def silk_sexpr() -> str:
    front, back = L.build_both()
    write_svgs()
    return "\n".join(
        side_to_kicad(front, "F.SilkS", back=False)
        + side_to_kicad(back, "B.SilkS", back=True)
    )


def refresh_board_silk(board_path=None) -> str:
    """Replace top-level F/B silk gr_rects in an existing board (keeps copper)."""
    import re

    path = board_path or os.path.join(OUT_DIR, "pcb", "pocket_card_controller.kicad_pcb")
    text = open(path, encoding="utf-8").read()
    pat = re.compile(
        r'\t\(gr_rect\n'
        r'(?:.*\n)*?'
        r'\t\t\(layer "(?:F|B)\.SilkS"\)\n'
        r'(?:.*\n)*?'
        r'\t\)\n',
    )
    stripped, n = pat.subn("", text)
    silk_txt = silk_sexpr()
    ef = stripped.rfind("\t(embedded_fonts")
    if ef > 0:
        out = stripped[:ef] + silk_txt + "\n" + stripped[ef:]
    else:
        cut = stripped.rstrip().rfind("\n)")
        out = stripped[:cut] + "\n" + silk_txt + stripped[cut:]
    open(path, "w", encoding="utf-8").write(out)
    return "refreshed %s silk gr_rects (removed %d)" % (path, n)


if __name__ == "__main__":
    print("font", _font_path(), "pack CW", round(L.CW, 4), "maskAdv", L.MASK_ADV)
    front, back = L.build_both()
    write_svgs()
    f_parts = side_to_kicad(front, "F.SilkS", back=False)
    b_parts = side_to_kicad(back, "B.SilkS", back=True)
    print("front vector rects", len(f_parts))
    print("back  vector rects", len(b_parts))
    print("debug rasters: out/silk_raster_F.png out/silk_raster_B.png")
