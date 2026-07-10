# PuzzleScript Card - DSI Panel Interface

Date: 2026-07-09. Status: electrical pinout locked, physical card-end
orientation still gated.

## Locked Panel Choice

Use the Waveshare 43H-800480-IPS no-touch display assembly for spin 1.
The card connects to it as a Raspberry-Pi-style 15-pin, 1.0 mm DSI FFC.
The panel is powered through the FFC from switched `+3V3_PANEL`; there is no
display boost converter on the card.

## J3 Pinout

| J3 pin | Waveshare label | Card net |
|---:|---|---|
| 1 | GND | `GND` |
| 2 | DSI1_DN1 | `DSI_D1_N` |
| 3 | DSI1_DP1 | `DSI_D1_P` |
| 4 | GND | `GND` |
| 5 | DSI1_CN | `DSI_CLK_N` |
| 6 | DSI1_CP | `DSI_CLK_P` |
| 7 | GND | `GND` |
| 8 | DSI1_DN0 | `DSI_D0_N` |
| 9 | DSI1_DP0 | `DSI_D0_P` |
| 10 | GND | `GND` |
| 11 | SCL0 | not routed on no-touch card |
| 12 | SDA0 | not routed on no-touch card |
| 13 | GND | `GND` |
| 14 | 3V3 | `+3V3_PANEL` |
| 15 | 3V3 | `+3V3_PANEL` |

Pins 14 and 15 are both `+3V3_PANEL`. Pin 15 is not ground.

## Orientation Evidence

Confirmed from Waveshare:

- The wiki says the screen-side cable gold finger faces upward.
- Product photos show a hinged FFC connector on the display board.
- The official STEP drawing confirms the no-touch display envelope, but it
  does not identify the shipped cable contact parity at the card end.

Still unknown:

- Whether the same-side cable assumption matches the shipped 15-pin cable.
- Whether the custom card needs a top-contact or bottom-contact J3 footprint.
- Which way the J3 latch and cable exit should face in the final shell fold.
- Which pad is pin 1 after the actual KiCad footprint is selected.

## Working Assumption

Working assumption: same-side 15-pin FFC cable.

Treat this as a layout-planning assumption, not physical evidence. It is enough
to keep schematic/preview work moving, but it does not close
GATE-DSI-FFC-CONTACT. If the shipped cable is actually opposite-side, swap the
J3 contact orientation before routing or before ordering the PCB.

## Physical Closeout Checklist

Do not close GATE-DSI-FFC-CONTACT until all four checks are done:

- Confirm the same-side 15-pin cable assumption against the shipped FFC.
- Lay the shipped FFC flat and determine whether it is a same-side or opposite-side 15-pin cable.
- Take a card-end photo of the exposed contacts with the panel in the intended
  shell fold.
- Select J3 top-contact or bottom-contact orientation so the exposed card-end
  contacts face the connector contacts without twisting the cable.
- Mark pin 1 on the PCB silkscreen and verify it against the connector footprint
  before routing.

## Layout Notes

- Keep J3 at the top-edge `CONN_DSI_FFC` anchor.
- Route DSI before power loops, USB, controls, storage, audio, haptic, and LEDs.
- Target 100 ohm differential on a 4-layer board with a continuous reference
  plane.
- Place C3 close to J3 pins 14 and 15.
- Keep buck-boost hot loops away from the DSI pairs.

## Sources

- Waveshare 43H-800480-IPS wiki:
  https://www.waveshare.com/wiki/43H-800480-IPS
- Waveshare 43H-800480-IPS product page:
  https://www.waveshare.com/43h-800480-ips.htm
- Waveshare 43H-800480-IPS STEP drawing:
  https://files.waveshare.com/upload/c/cd/43h-800480-IPS.zip
