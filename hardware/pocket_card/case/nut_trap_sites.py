"""Pure authoritative captive-nut site metadata shared by CAD and reviews."""

import math
from dataclasses import dataclass

try:
    from . import params as P
except ImportError:
    import params as P


@dataclass(frozen=True)
class NutTrapSite:
    x: float
    y: float
    kind: str
    mouth: tuple[int, int]

    def __post_init__(self):
        try:
            mouth_x, mouth_y = self.mouth
        except (TypeError, ValueError) as error:
            raise ValueError("mouth must be a two-component vector") from error
        try:
            finite = all(
                math.isfinite(component) for component in (mouth_x, mouth_y)
            )
        except TypeError as error:
            raise ValueError("mouth components must be finite numbers") from error
        if not finite:
            raise ValueError("mouth components must be finite")
        if math.hypot(mouth_x, mouth_y) == 0.0:
            raise ValueError("mouth vector must be nonzero")

    @property
    def nut_front_z(self):
        return -P.FACE_T

    @property
    def cavity_back_z(self):
        return self.nut_front_z - P.NUT_CAVITY_T

    @property
    def roof_back_z(self):
        return self.cavity_back_z - P.NUT_ROOF_T


def sites():
    """Return the six closure sites in their stable assembly order."""
    module_x = (
        P.MOD_X + P.MOUNT_INSET,
        P.MOD_X + P.MOD_W - P.MOUNT_INSET,
    )
    module_y = (
        P.MOD_Y + P.MOUNT_INSET,
        P.MOD_Y + P.MOD_H - P.MOUNT_INSET,
    )
    return (
        NutTrapSite(module_x[0], module_y[0], "module", (1, 1)),
        NutTrapSite(module_x[0], module_y[1], "module", (1, -1)),
        NutTrapSite(module_x[1], module_y[0], "module", (-1, 1)),
        NutTrapSite(module_x[1], module_y[1], "module", (-1, -1)),
        # H1 stages westward under clear controller-board material.  A
        # southward chute would enter the neighbouring Undo cap travel.
        NutTrapSite(*P.PCB_MOUNTS[0], "pcb", (-1, 0)),
        NutTrapSite(*P.PCB_MOUNTS[1], "pcb", (0, -1)),
    )
