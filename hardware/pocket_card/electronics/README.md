# Pocket Card electronics

This directory contains the authoritative native KiCad project for the Pocket
Card controller. Engineers edit `pocket_card_controller.kicad_pro` here.

Annotate every new symbol before updating the PCB. PCB updates must use the
established symbol associations so existing footprints, placement, and routing
remain attached to their intended symbols.

Custom symbols, footprints, and 3D models must use `${KIPRJMOD}`-relative paths.
Machine-local or absolute asset paths are not permitted.

KiCad local state is not source: do not commit `.kicad_prl` files, `.lck` files,
backups, or caches.

Normal Make targets validate or export this project. They never regenerate the
schematic, component placement, or routing.
