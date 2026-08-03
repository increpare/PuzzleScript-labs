"""Shaded views of a shell STL, so shape changes can be eyeballed.

The check suite proves a feature clears what it must; it says nothing about
whether the result looks like a considered edge or like a wart stuck on the
back. This renders the mesh directly — no CAD kernel, no extra dependencies —
with backface culling, a painter's sort and Lambert shading.

Run:  .venv/bin/python tools/render_shell.py [stl ...]
"""
import os
import struct
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

CASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(CASE, "out", "render_shell.png")

# These files are in MODEL space, not layout space: shell_*.to_model_space
# mirrors about XZ, so model y = BODY_H - layout y and the north edge (layout
# y = 0, where the rib is) sits at model y = 93. Worth stating because reading
# a render with the layout frame in mind puts the rib at the wrong end and
# invites you to go hunting for a defect that is not there.
#
# Camera azimuth/elevation, screen-up reference, specular, caption. Elevation
# 90 looks straight at the outer back (which faces -z); azimuth 90 puts the
# camera off the east side. The up reference has to switch — model +y puts
# north at the top of a plan view but is parallel to the view axis in an
# elevation, where +z (the front face) is what should be up.
NORTH_UP, FRONT_UP = (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)
VIEWS = [
    (0.0, 90.0, NORTH_UP, False, "outer back, north (rib) at top"),
    (-40.0, 30.0, FRONT_UP, False, "three-quarter from behind, rib edge nearest"),
    (90.0, 0.0, FRONT_UP, False, "east elevation — north at right"),
    (0.0, 90.0, NORTH_UP, True, "specular — a kink in the band is a bad blend"),
]


def read_stl(path):
    with open(path, "rb") as fh:
        blob = fh.read()
    n = struct.unpack("<I", blob[80:84])[0]
    rec = np.frombuffer(blob, dtype=np.dtype([("n", "<3f4"), ("v", "<9f4"),
                                              ("a", "<u2")]),
                        count=n, offset=84)
    return rec["v"].reshape(n, 3, 3).astype(np.float64)


def basis(az_deg, el_deg, up_ref):
    """Camera frame, looking at the outer back (which faces -z)."""
    az, el = np.radians(az_deg), np.radians(el_deg)
    cam = np.array([np.cos(el) * np.sin(az), -np.cos(el) * np.cos(az),
                    -np.sin(el)])
    fwd = -cam / np.linalg.norm(cam)
    up0 = np.asarray(up_ref, dtype=float)
    up = up0 - fwd * (up0 @ fwd)
    if np.linalg.norm(up) < 1e-6:
        raise ValueError("up reference is parallel to the view axis")
    up /= np.linalg.norm(up)
    return np.cross(fwd, up), up, fwd


BG = np.array([0.973, 0.980, 0.988])


def rasterize(tris, az, el, up_ref, px=900, specular=False):
    """Z-buffered orthographic render. Returns an RGB array.

    A painter's sort is not good enough here. Sorting by mean depth puts
    interior tray faces in front of the skin at grazing angles, which is what
    made a real 2.40 step in the side wall look like it was somewhere else
    entirely on the first pass.
    """
    right, up, fwd = basis(az, el, up_ref)
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    nrm = np.cross(b - a, c - a)
    ln = np.linalg.norm(nrm, axis=1)
    keep = ln > 1e-12
    tris, nrm = tris[keep], nrm[keep] / ln[keep, None]
    vis = (nrm @ fwd) < -1e-9                 # normals point out of the solid
    tris, nrm = tris[vis], nrm[vis]

    key = -(right * 0.35 + up * 0.45 + fwd * 1.0)
    key /= np.linalg.norm(key)
    fill = -(right * -0.7 + up * -0.2 + fwd * 0.6)
    fill /= np.linalg.norm(fill)
    lam = (0.30 + 0.62 * np.clip(nrm @ key, 0, None)
           + 0.16 * np.clip(nrm @ fill, 0, None))
    if specular:
        # A tight highlight is the honest test of a blend: G1 joins show up as
        # a kink in the band, G2 joins do not.
        lam = 0.22 + 0.35 * lam + 0.75 * np.clip(nrm @ key, 0, None) ** 42
    shade = np.clip(lam, 0, 1) ** (1 / 2.2)
    base = np.array([0.36, 0.44, 0.56])
    cols = np.clip(shade[:, None] * base[None, :] * 1.35, 0, 1)

    u = tris @ right
    v = tris @ up
    d = tris @ fwd
    u0, u1 = u.min(), u.max()
    v0, v1 = v.min(), v.max()
    pad = 0.03 * max(u1 - u0, v1 - v0)
    u0, u1, v0, v1 = u0 - pad, u1 + pad, v0 - pad, v1 + pad
    scale = px / max(u1 - u0, v1 - v0)
    W = max(int((u1 - u0) * scale), 1)
    H = max(int((v1 - v0) * scale), 1)

    su = (u - u0) * scale
    sv = (v1 - v) * scale                     # image rows run downward
    img = np.tile(BG, (H, W, 1))
    zbuf = np.full((H, W), np.inf)

    for i in range(len(tris)):
        x0 = max(int(np.floor(su[i].min())), 0)
        x1 = min(int(np.ceil(su[i].max())) + 1, W)
        y0 = max(int(np.floor(sv[i].min())), 0)
        y1 = min(int(np.ceil(sv[i].max())) + 1, H)
        if x0 >= x1 or y0 >= y1:
            continue
        ax_, ay_ = su[i, 0], sv[i, 0]
        bx, by = su[i, 1], sv[i, 1]
        cx, cy = su[i, 2], sv[i, 2]
        det = (by - ay_) * (cx - ax_) - (bx - ax_) * (cy - ay_)
        if abs(det) < 1e-12:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        xx = xx + 0.5
        yy = yy + 0.5
        w1 = ((yy - ay_) * (cx - ax_) - (xx - ax_) * (cy - ay_)) / det
        w2 = ((xx - ax_) * (by - ay_) - (yy - ay_) * (bx - ax_)) / det
        w0 = 1.0 - w1 - w2
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        z = w0 * d[i, 0] + w1 * d[i, 1] + w2 * d[i, 2]
        sl = (slice(y0, y1), slice(x0, x1))
        hit = inside & (z < zbuf[sl])
        if not hit.any():
            continue
        zbuf[sl] = np.where(hit, z, zbuf[sl])
        img[sl] = np.where(hit[..., None], cols[i], img[sl])
    return img


def render(ax, tris, az, el, up_ref, title, specular=False):
    ax.imshow(rasterize(tris, az, el, up_ref, specular=specular),
              interpolation="bilinear")
    ax.axis("off")
    ax.set_title(title, fontsize=9.5)


def main(paths):
    for path in paths:
        tris = read_stl(path)
        name = os.path.basename(path)
        fig, axes = plt.subplots(1, len(VIEWS), figsize=(3.6 * len(VIEWS), 5.0))
        for ax, (az, el, up_ref, spec, cap) in zip(np.atleast_1d(axes), VIEWS):
            render(ax, tris, az, el, up_ref, cap, specular=spec)
        fig.suptitle(f"{name} — {len(tris)} triangles", fontsize=11)
        fig.patch.set_facecolor("#f8fafc")
        fig.tight_layout()
        out = OUT if len(paths) == 1 else OUT.replace(
            ".png", f"_{os.path.splitext(name)[0]}.png")
        fig.savefig(out, dpi=150)
        plt.close(fig)
        print(f"wrote {out}")


if __name__ == "__main__":
    args = sys.argv[1:] or [os.path.join(CASE, "out", "order", "shell_back.stl")]
    main(args)
