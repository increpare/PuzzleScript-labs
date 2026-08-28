"""SLA fit coupon for the Pocket Card's side-loading captive M2 nuts."""

from pathlib import Path

import cadquery as cq

import params as P
import nut_traps


VARIANTS = P.NUT_AF_VARIANTS
LABELS = tuple(f"{across_flats:.1f}" for across_flats in VARIANTS)
WIDTH = 39.0
DEPTH = 17.0
THICKNESS = P.FACE_T + P.NUT_CAVITY_T + P.NUT_ROOF_T
PITCH = 13.0
LABEL_Y = 13.0
LABEL_DEPTH = 0.25


def sites():
    """Return the three edge-loading stations in increasing AF order."""
    return tuple(
        nut_traps.NutTrapSite(x, P.NUT_ENVELOPE_R, "coupon", (0, -1))
        for x in (-PITCH, 0.0, PITCH)
    )


def blank():
    """Return the uncut coupon stock."""
    return (
        cq.Workplane("XY")
        .box(WIDTH, DEPTH, THICKNESS, centered=(True, False, False))
        .translate((0.0, 0.0, -THICKNESS))
    )


def station_void(site, across_flats):
    """Return a production trap plus the exact outside-to-seat nut sweep."""
    return nut_traps.front_voids(site, across_flats).union(
        nut_traps.insertion_sweep(site, P.NUT_NOMINAL_AF)
    )


def label_voids():
    """Return shallow AF engravings in the solid rear identification strip."""
    labels = cq.Workplane("XY")
    for site, label in zip(sites(), LABELS):
        mark = (
            cq.Workplane("XY")
            .text(label, 2.4, LABEL_DEPTH, combine=False)
            .translate((site.x, LABEL_Y, -LABEL_DEPTH))
        )
        labels = labels.union(mark)
    return labels


def build():
    """Return the one-piece coupon in front-shell negative-Z convention."""
    model = blank()
    for site, across_flats in zip(sites(), VARIANTS):
        model = model.cut(station_void(site, across_flats))
    return model.cut(label_voids())


def export(output_dir=None, model=None):
    """Write stable-path STL/STEP exports of the supplied or freshly built model."""
    destination = (
        Path(output_dir)
        if output_dir is not None
        else Path(__file__).resolve().parent / "out" / "order"
    )
    destination.mkdir(parents=True, exist_ok=True)
    paths = (
        destination / "nut_trap_coupon.stl",
        destination / "nut_trap_coupon.step",
    )
    model = build() if model is None else model
    for path in paths:
        cq.exporters.export(model, str(path))
    return paths


if __name__ == "__main__":
    for written_path in export():
        print(written_path)
