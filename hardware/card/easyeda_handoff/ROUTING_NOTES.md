# Routing Notes

## Priority

1. DSI differential pairs: target 100 ohm differential on the selected stackup, short, length-matched, continuous reference plane.
2. USB 2.0: route D+/D- as a pair from J1 to U1, keep stubs short, review connector orientation.
3. Power: replace point-to-point generated routes with pours/planes and compact charger/buck-boost loops.
4. Storage: route after selecting the exact microSD footprint.
5. Low-speed controls, LEDs, haptic, and piezo can be routed last.

## DSI Physical Gate

The schematic pinout is captured, but the card-end contact orientation is still gated.
Confirm same-side/opposite-side cable parity, latch side, cable exit, and pin 1 before fabrication.

## Generated Reference

`reference/card_routed_reference.kicad_pcb` contains the generated first-pass traces.
Use it only to see what nets need to connect; do not preserve those traces unless you deliberately reroute and review them.
