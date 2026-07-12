# BOM availability record

Date checked: 2026-07-12. Sources: `schematic/jlc_catalog.json` (LCSC ids
inherited from the card track's sourcing pass, 2026-07), JLCPCB parts pages,
and this phase's web checks. Stock numbers move; re-check every line before
the actual order. The generated PnP order file is `bom_jlc.csv` — it lists
only LCSC-mapped lines by design.

## The line that decides the board

| Ref | Part | LCSC | Status |
|---|---|---|---|
| U1 | ESP32-P4NRW32**X** | C22387510 | **JLC's listing is titled NRW32; the design requires the X (v3.x silicon) revision. Before ordering: confirm with JLC which silicon revision ships, or consign the chip.** Plain NRW32 is NRND and must not be accepted. This is the one part with a real consignment contingency. |

## Pick-and-place lines (JLC)

| Ref | Part | LCSC | Status / note |
|---|---|---|---|
| U2 | BQ24075RGTR charger | C15464 | locked |
| U3 | MAX17048G+T10 gauge | C2682616 | locked |
| U4 | TPS63070 buck-boost | C964639 | locked |
| U6 | TPS22919DCK load switch | C2149796 | locked |
| U7 | MAX98357AETE+T I2S amp | C910544 | candidate; alternate listing C20745475; stock fluctuates — use JLC pre-order if empty |
| U9 | 32 MB QSPI NOR | C97522 | candidate; confirm Espressif ref-design voltage domain |
| X1 | 40 MHz crystal 3225 | C9010 | candidate; match load caps to Espressif ref |
| L1 | 2.2 µH 2 A inductor | C692155 | candidate; per Espressif P4 DC-DC ref |
| J1 | USB-C HRO TYPE-C-31-M-12 | C2765186 | locked; re-check stock at order |
| J3 | 15-pin 1.0 mm FFC | C2832207 | candidate; contact side gated (GATE-PANEL-FFC-CONTACT) |
| J4 | microSD push-push | C113206 | candidate; height vs enclosure gated (GATE-MICROSD-FOOTPRINT) |
| D4 | charge LED 0603 | C72043 | locked |
| R1/R2 | 5.1k CC | C25905 | locked, basic |
| R3/R4 | 4.7k I2C pull-ups | C25900 | locked, basic |
| R5/R6 | 10k pulls | C25744 | locked, basic |
| R8 | 1k LED | C11702 | locked, basic |
| C1–C4 | 10 µF 0603 | C19702 | locked, basic |

## Gated lines (footprint follows a physical gate; placeholder ids for costing)

| Ref | Gate | Placeholder |
|---|---|---|
| SW1–SW4, SW11 | GATE-BUTTON-COUPON | C2886877 dome tact class |
| SW5–SW8 | GATE-BUTTON-COUPON | C318438 face tact class |
| SW9 | GATE-POWER-SLIDE-SLOT | C431544 SPDT slide class |
| SW10A/B | GATE-BUTTON-COUPON | C569760 |
| J2 | GATE-BATTERY-SAMPLE | C160404 JST-SH; confirm against measured cell leads |

## Hand-attached lines (never PnP)

| Item | Source | Note |
|---|---|---|
| Panel: Waveshare 2.8inch DSI LCD | waveshare.com / Amazon / PiShop | see PANEL_RESEARCH.md; FFC clipped after assembly |
| Battery: protected 1S LiPo | distributor, at mechanical phase | GATE-BATTERY-SAMPLE |
| Speaker + J5 pigtail | distributor | J5 connector (C160404) is PnP; the speaker itself is hand-attached (GATE-SPEAKER-SELECT) |

## Test pads

TP1–TP8 are copper-only pads: no part, no BOM line.
