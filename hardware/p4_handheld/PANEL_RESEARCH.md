# DSI panel research — five-check gate (+ mechanical check added 2026-07-12)

Date: 2026-07-12. Spec: `docs/superpowers/specs/2026-07-12-p4-handheld-circuit-design.md`

> **Owner review (2026-07-12) added a sixth check the original gate missed:**
> **mechanical stack.** The RPi-style DSI products are *assemblies* — panel
> glass plus a rear adapter PCB carrying the bridge and I2C controller — and
> the original five checks never measured that stack. Status and the
> resulting dual-footprint hedge are recorded below; the assemblies also
> carry a bonded touch layer the product doesn't use (accepted only as the
> protective cover glass, same trade the pocket card makes on the ES3C28P).

## Candidates

| Panel | Size | Res | Controller | Lanes | Backlight | Touch | Buyable | Checks passed |
|---|---|---|---|---|---|---|---|---|
| Waveshare 2.8inch DSI LCD | 2.8" | 480×640 | undisclosed, driven by vendor `esp_lcd_dsi` DCS init | 2 | integrated, I2C `0x45` ctrl | GT911, bonded, optical-bonded glass | Waveshare / Amazon / PiShop | **5/5** |
| Waveshare 4inch DSI LCD | 4.0" | 480×800 | undisclosed, same `esp_lcd_dsi` | 2 | integrated, I2C `0x45` ctrl | GT911-class | Waveshare / distributors | **5/5** |
| Waveshare 3.4inch DSI LCD (C) | 3.4" round | 800×800 | same component family | 2 | integrated | yes | Waveshare | fails shape fit (round) |
| Raw 2.8–3.5" MIPI panels (Panelook-class vendors) | var | var | ILI9881C/JD9365 etc. | 2–4 | usually needs board-side boost | var | MOQ/quote-gated | fails check 5 in 1–10 qty |

## Five-check detail

### Waveshare 2.8inch DSI LCD (primary)

1. **esp_lcd driver support: PASS.** Vendor-maintained
   [`waveshare/esp_lcd_dsi`](https://components.espressif.com/components/waveshare/esp_lcd_dsi)
   ESP-IDF component lists the panel with full DPI timing
   (dpi_clock 48 MHz, 480×640, porches published) and marks it **tested** on
   ESP32-P4; the [ESP32-P4-NANO BSP](https://github.com/waveshareteam/Waveshare-ESP32-components)
   selects it as a supported display. Touch uses the standard
   `esp_lcd_touch_gt911` driver. The panel's internal display controller IC is
   not named by Waveshare; the check is satisfied by the working, maintained
   ESP-IDF init path rather than by controller identity.
2. **Published pinout, ≤2 lanes: PASS.** Standard Raspberry-Pi-style 15-pin
   1.0 mm DSI FFC; `esp_lcd_dsi` drives it with `num_data_lanes = 2`.
   Pinout is the same 15-pin table already transcribed in
   `hardware/card/DSI_PANEL_INTERFACE.md` (GND / D1− / D1+ / GND / CLK− /
   CLK+ / GND / D0− / D0+ / GND / SCL / SDA / GND / 3V3 / 3V3).
3. **Backlight feasible: PASS.** Backlight driver is integrated on the panel
   assembly and controlled over I2C at address `0x45`
   (Raspberry-Pi-DSI-display convention; init writes visible in
   `esp_lcd_dsi.c`). The panel takes only 3V3 on FFC pins 14/15 — **no boost
   stage on our board**.
4. **Touch policy satisfiable: PASS.** Bonded capacitive GT911 on the shared
   FFC I2C, INT/RST not present on the 15-pin cable (BSP uses `GPIO_NUM_NC`,
   polling mode). Wired-but-disabled-in-firmware matches the spec. The
   optically bonded toughened-glass stack also protects the TFT, same
   benefit the pocket card gets from the ES3C28P's bonded touch layer.
5. **Buyable in small quantity: PASS.**
   [Waveshare product page](https://www.waveshare.com/2.8inch-dsi-lcd.htm),
   [Amazon](https://www.amazon.com/2-8inch-Capacitive-Compatible-Resolution-DSI/dp/B0B2LKQ2QB),
   [PiShop](https://www.pishop.us/product/2-8inch-capacitive-touch-display-for-raspberry-pi-480-640-dsi-ips-fully-laminated-screen/) —
   all single-unit channels.

### Waveshare 4inch DSI LCD (fallback)

Same component (`dpi_clock 48.6 MHz`, 480×800, tested), same 15-pin FFC and
I2C `0x45` convention, same purchase channels. Costs body size: the display
zone grows well past the 2.8" pocket proportions, and 480×800 has no integer
relationship to 320×240 (640×480 letterboxed inside 480×800 rotated gives
1.5×… non-integer; rendering would run at 2× into a 640×480 window with
borders). Chosen as fallback because it de-risks *supply* with identical
electrical interface, not because it is equivalent for the product.

## Orientation note

The primary panel is natively portrait 480×640; landscape 640×480 is exactly
2× the pocket card's 320×240 contract, so the existing corpus statistics carry
over at doubled integer scales. Rotation happens on the P4 (PPA/framebuffer
rotation) — a software-phase cost, recorded there, not a circuit blocker.

## Decision (revised 2026-07-12 after owner review)

**Bring-up vehicle and electrical primary: Waveshare 2.8inch DSI LCD** —
passes checks 1–5 with a vendor-maintained ESP-IDF driver proven on
ESP32-P4 hardware; check 6 (mechanical stack) is OPEN pending a measured
sample. Firmware development runs on it via the P4-NANO devkit regardless
of the product-panel outcome.

**Thin-product path: bare MIPI-DSI panel** via the J3B DNP footprint, if a
sample passes all six checks. The Waveshare 2.8" then remains dev-bench
hardware.

**Supply fallback: Waveshare 4inch DSI LCD** — identical electrical
contract and driver path; de-risks supply, not thickness.

## Frozen interface facts (consumed by display sheet + power budget)

- FFC: 15 pin, 1.0 mm pitch, Raspberry-Pi-style DSI; connector on our board
  is an FH12-15S-class right-angle FFC (contact orientation gated:
  `GATE-PANEL-FFC-CONTACT`)
- Panel rail: 3V3 on pins 14 and 15 (both must be driven), switched by the
  panel load switch; current budget carried as ≤400 mA peak (card baseline)
  until measured at bring-up — expected lower for 2.8"
- Backlight: integrated on panel; controlled over FFC I2C at address `0x45`;
  no board-side backlight parts
- Touch: GT911, FFC I2C (address `0x5D`/`0x14` per GT911 convention), polling
  mode — no INT/RST lines exist on the 15-pin cable; disabled in release
  firmware
- Reset/enable lines: none on the FFC beyond rail switching; panel power
  cycle = panel reset (via PANEL_EN on the load switch)

## Check 6: mechanical stack — OPEN (`GATE-PANEL-STACK`)

Not measured yet, and not resolvable from Waveshare's published pages. On
arrival of the ordered sample (see `bom/ORDER_LIST.md`), measure with
calipers and record here:

- total assembly thickness: glass top surface → tallest rear component
- adapter-PCB outline vs glass outline (overhang matters for the bezel)
- FFC exit position and bend clearance

The pocket-class body ceiling from the pocket-card spec is 12 mm; the
ES3C28P precedent burned 10.6 mm on its display stack. If this assembly
measures materially worse, the thin-product path switches to a bare panel
(below) and the assembly remains the bring-up vehicle only.

## Dual-footprint decision (2026-07-12, owner-approved direction)

To keep panel uncertainty from forcing a board respin, the layout phase
carries **both** display attachment options on the one board:

1. **J3** — 15-pin 1.0 mm RPi-style DSI FFC (this document's frozen pinout);
   the proven bring-up path, validated on the P4-NANO devkit.
2. **J3B (DNP)** — FPC footprint for the selected bare MIPI-DSI panel, plus a
   **DNP backlight-boost stage** (the bare panel's LED string needs board
   drive; the assembly's does not). Populated only if a bare panel passes
   checks 1–6.

DSI pairs, I2C, and the switched panel rail are shared by both connectors;
the hedge costs one footprint and a DNP boost, not a second architecture.
This mirrors the card design's DNP piezo-driver escape-path pattern.

## Bare-panel candidate slots (fill on sample arrival)

Ordering criteria (from `bom/ORDER_LIST.md`): 2.8–3.4", ~480×640, MIPI-DSI
1–2 lanes, bare FPC with published pinout, named controller with an esp_lcd
driver (ST7701S-class preferred), ~1.5–2.5 mm glass. Record per sample:
controller, lanes, FPC pins/pitch, measured thickness, init source,
verdict against all six checks.

| Sample | Controller | Lanes | FPC | Thickness | Verdict |
|---|---|---|---|---|---|
| D280FPC930C-B, 2.8" 480×640, ~€6.49 ([AliExpress 1005007531981349](https://www.aliexpress.com/item/1005007531981349.html)) | ST7701S — official `espressif/esp_lcd_st7701` + Nicolai-Electronics P4 DSI component exist | **2 (MIPI) confirmed** from vendor pinout table — but the listing sells an RGB variant of the same glass too; **order must specify the MIPI version** | 40-pin, pitch TBC (expect 0.5 mm) — pinout below | pending sample | strong candidate; remaining: backlight Vf/If, FPC pitch, thickness, init sequence on sample |

### D280FPC930C-B MIPI variant pinout (from vendor table, 2026-07-12)

| Pin | Symbol | Function |
|---|---|---|
| 1 | LEDA | backlight anode |
| 2 | LEDK | backlight cathode |
| 3 | VDD | 2.8–3.3 V supply |
| 4 | GND | |
| 5/6 | D0N/D0P | MIPI DSI data lane 0 |
| 7 | GND | |
| 8/9 | CLKN/CLKP | MIPI DSI clock |
| 10 | GND | |
| 11/12 | D1N/D1P | MIPI DSI data lane 1 |
| 13–33 | GND | |
| 34 | RESET | panel reset (J3B gets a GPIO for this, unlike the 15-pin path) |
| 35–37 | GND | |
| 38 | VDD | 2.8–3.3 V supply |
| 39 | GND | |
| 40 | NC | |

Notes: single VDD rail — runs from `+3V3_PANEL` directly; no touch layer;
backlight is a bare LEDA/LEDK string — if Vf ≤ 3.2 V (single LED) the DNP
boost can be replaced by a FET + PWM from the panel rail; decide when the
spec/sample answers Vf/If. The matching RGB-variant pinout exists on the
same listing — do not order it.

| Pin | Net |
|---|---|
| 1 | GND |
| 2 | DSI_D1_N |
| 3 | DSI_D1_P |
| 4 | GND |
| 5 | DSI_CLK_N |
| 6 | DSI_CLK_P |
| 7 | GND |
| 8 | DSI_D0_N |
| 9 | DSI_D0_P |
| 10 | GND |
| 11 | I2C_SCL |
| 12 | I2C_SDA |
| 13 | GND |
| 14 | +3V3_PANEL |
| 15 | +3V3_PANEL |
