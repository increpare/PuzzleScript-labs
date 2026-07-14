# PuzzleScript Pocket Card: ES3C28P Appliance Handheld

Date: 2026-07-12. Status: approved by owner.

## Supersession and scope

This specification is the new hardware baseline for the next PuzzleScript
handheld prototype. It supersedes the ESP32-P4, 4.3-inch, 120 x 110 mm Card
direction described in the prior handheld-card specifications, including the
2026-07-12 spin-1 simplification and the prior power-switch design. Those
documents remain useful history but are not requirements for this device.

The new direction deliberately avoids adapting the existing `hardware/card/`
design in place. Implementation should use a distinct pocket-card hardware
target so that P4/DSI assumptions, component selections, and generated files
cannot silently leak into this design.

This spec covers the product architecture, mechanical arrangement, controls,
power, audio, storage, firmware boundaries, failure behavior, and validation
gates for a reproducible batch of 5-20 units. It does not freeze decorative
artwork or final button parts before physical validation. The battery is a
protected **503450** 1S LiPo pouch; fit, connector polarity, and the four-hour
runtime gate are still confirmed on measured hardware before batch procurement.

## Product intent

The Pocket Card is a small, button-driven PuzzleScript appliance. It must feel
like dedicated game hardware rather than a phone or a general-purpose computer:

- hard physical on/off control and fast cold boot
- no visible operating system, browser, network setup, or background services
- a compact near-square body with the screen above the controls
- crisp, whole-level PuzzleScript rendering at 320 x 240
- a visually intentional object made in a reproducible handful, not a fragile
  one-off breadboard sculpture

The selected architecture trades the earlier 4.3-inch display and ESP32-P4
headroom for a far smaller, cheaper, and substantially pre-integrated module.
Abandoning the P4 is a success if the resulting product is slim, elegant, and
appliance-like.

## Product envelope and success criteria

The nominal body target is approximately 90 x 90-95 x 11.5 mm. The mechanical
acceptance envelope is no more than 92 x 100 x 12 mm after measured clearances.
Growing the height by a few millimeters is preferable to increasing thickness
if battery sourcing requires more lower-zone area.

The device is successful when:

- two complete pilot devices pass the validation gates in this spec
- a batch of 5-20 can be assembled from frozen parts and Gerbers
- a usable first game frame appears within one second of switching on
- normal play lasts at least four hours at the default brightness
- controls are reliable, mechanically protected, and pleasant for sustained
  turn-based play
- the representative PuzzleScript corpus fits the runtime with useful memory
  margin
- the finished object stays at or below the 12 mm depth ceiling

## Reference module: ES3C28P

The sole reference compute/display module is the LCDWiki/QDtech **ES3C28P**:

- ESP32-S3R8, dual core up to 240 MHz
- 8 MB OPI PSRAM and 16 MB SPI flash
- 2.8-inch IPS 240 x 320 ILI9341V display, used in landscape as 320 x 240
- bonded capacitive touch layer
- USB-C power/programming
- microSD slot
- 3.7 V LiPo connector, TP4054 charging, and battery-voltage ADC
- ES8311 audio codec, speaker amplifier/connector, and microphone
- shared I2C expansion connector and four additional exposed GPIOs

The release user interface is entirely button-driven. Touch input is disabled
in normal firmware and is not a hidden navigation path. The bonded 1.0 mm G+F
touch panel is selected because it protects the TFT and eliminates a separately
sourced clear window, adhesive alignment, and dust gap.

The module outline is 86 x 50 mm when rotated into landscape. The official
outline gives a 10.6 mm touch-module stack from the touch surface to the tallest
rear component. This makes an 11.5 mm body aspirational and 12 mm the hard
ceiling; the sample-based mechanical gate decides the exact final number.

The core hardware, flash, PSRAM, LCD, charging, audio, and storage are the same
as the touchless ES3N28P. The touch version accepts lower quoted brightness
(230 rather than 270 cd/m2) and 1.5 mm additional module depth in exchange for
the simpler and more robust screen assembly.

## Display contract

The display is landscape 320 x 240 RGB565. Rendering uses nearest-neighbor
integer scaling and centers unused borders. It never smooths pixel art.

The existing corpus report measured 2,651 board levels across 470 games:

- 2,649 of 2,651 retain at least the native 5 x 5 sprite scale
- 97.095% render at sprite scale 2 or greater, at least 10 pixels per tile
- the median sprite scale is 5, or 25 pixels per tile
- only `BIAXIAL INVASION OF SATURN` level 31 and `single screen scream` level
  0 fall below the native 5-pixel scale
- 34 x 13 text screens fit at the base pixel-font scale

Those two exceptional levels are rendered honestly at their largest fitting
integer scale. They do not justify a larger product.

The decorative front PCB forms the screen bezel. The touch surface is flush or
slightly recessed and needs no additional cover lens. The bezel must not press
on the touch/LCD stack; its opening and module shelf use measured sample
dimensions and allow assembly tolerance.

## Mechanical architecture

The device is a PCB sandwich with a simple, mostly hidden midframe:

1. **Decorative front PCB**, approximately 0.8-1.0 mm, with the display
   opening, button openings, fine artwork, labels, and mounting features.
2. **Captive button caps and guide geometry** supported by the midframe.
3. **Small controller PCB** covering the lower zone.
4. **ES3C28P** across the upper zone and the LiPo/speaker across the lower
   zone.
5. **Simple midframe** that locates the modules, protects raw FR-4 edges,
   supports the button guides, and defines the side-wall depth.
6. **Decorative rear PCB**, approximately 0.8-1.0 mm, with artwork, speaker
   grille, product marks, and rear mounting points.

The front and rear PCBs are the visible manufactured surfaces. Soldermask,
silkscreen, copper, and selective finish can provide repeatable fine-detail
artwork. Artwork follows standard-service limits: features at least 0.15 mm,
routed clearances at least 0.2 mm, and no critical alignment that assumes
better than approximately +/-0.2 mm outline tolerance.

The midframe may be printed because it is mechanically simple and minimally
visible. It forms a small proud perimeter so hands do not rest on raw routed
FR-4 edges. Four small screws may remain visible if they are incorporated into
the visual design; otherwise rear screws engage inserts or captive nuts in the
midframe.

Decorative copper must leave an antenna keepout determined from the real
ES3C28P. The battery is separated from every PCB by an insulating PET layer.
Decorative exposed metal is used for accents, not broad hand-contact areas.

### Zoning and battery volume

The display and battery occupy different XY regions of the same internal
cavity; their depths do not add:

- upper zone: 86 x 50 mm ES3C28P, landscape
- lower zone: controller PCB across roughly 80 x 36-40 mm
- behind the controller: **503450** protected 1S LiPo (~50 x 34 x 5 mm,
  typically ~900-1200 mAh depending on vendor)
- beside the battery: small speaker and connectors

All switches, the MCP23017, and controller passives face forward into the
button-guide cavity. The battery-facing rear of the controller PCB remains
component-free and flat. Mechanical CAD and the midframe must accommodate the
503450 with insulation, connector bend radius, and swelling allowance. Vendor
capacity ratings are not trusted without the four-hour runtime gate on a
completed pilot.

## Control hierarchy and layout

PuzzleScript's most important controls are movement and Undo. Action is absent
from many games, Restart must remain readily accessible, and Back/Menu is
necessary but intentionally unimportant.

The visual and ergonomic hierarchy is therefore:

1. **Primary:** four separate direction buttons and Undo
2. **Secondary:** Action, paired beside Undo as a companion control; Restart
   nearby but slightly smaller and more recessive
3. **Tertiary:** Back/Menu, small and visually recessive
4. **Edge controls:** Volume Up, Volume Down, and the physical power switch

Movement uses four independent physical buttons (Up, Down, Left, Right), not a
single five-way navigation switch. PuzzleScript play depends on rapid, discrete,
often alternating direction presses; separate contacts give cleaner actuation,
faster repeat, and no cross-axis ambiguity. The direction cluster is a compact
four-button cardinal cross with no center button.

Beside the direction cluster, Undo and Action form a companion pair: Undo leads,
Action sits immediately adjacent at comparable thumb reach. Restart stays in the
same local control group but is visually and mechanically subordinated (smaller
cap, lighter labeling, or slightly more recessed). Each button gets its own
guided cap, switch, and hard stop. The exact switch type, grouping geometry, and
cap sizes are selected by the button-coupon gate.

### Button load path

No button cap is fixed directly to an SMD switch and no switch is treated as a
structural member.

- Each cap has a hidden flange captured behind the front PCB.
- Midframe guide collars absorb lateral thumb forces.
- Mechanical hard stops absorb bottoming loads and prevent switch overtravel.
- Switches receive only short, nearly axial actuation.
- The controller PCB is replaceable without replacing the decorative face.

Switch locating bosses and solder tabs are helpful but do not replace the
guided-cap load path.

### Button mechanism gate

The final button switch mechanism is not selected from drawings. Before the
controller PCB footprint is frozen, a small coupon tests:

- at least one low-profile SMD tact option
- stainless snap domes on suitable PCB contact pads
- the four direction buttons with candidate cap geometries
- the Undo/Action companion pair and nearby Restart, with candidate cap sizes
- separate Menu cap

Custom silicone tooling is excluded for 5-20 units. An existing silicone
membrane is considered only if its geometry happens to fit without compromising
the approved layout. The winning coupon combination must be comfortable for a
continuous 30-minute play session and must not transmit destructive side load
to solder joints.

## Controller electronics

The controller PCB uses an MCP23017 16-bit I2C GPIO expander at 3.3 V, address
`0x20`. It connects to the ES3C28P through 3.3 V, ground, SDA, SCL, and one
interrupt line. The touch controller and audio codec already share this I2C
bus at different addresses, so no extra bus is required.

Provisional input allocation:

| Expander input | Function |
|---|---|
| PA0 | Up |
| PA1 | Down |
| PA2 | Left |
| PA3 | Right |
| PA4 | Action |
| PA5 | Undo |
| PA6 | Back/Menu |
| PA7 | Restart |
| PB0 | Volume Up |
| PB1 | Volume Down |
| PB2-PB7 | spare inputs/test points |

Inputs are active-low to ground with pull-ups. Interrupt-on-change drives one
ESP32-S3 GPIO. Firmware reads both ports in one transaction and applies a
5-10 ms debounce policy. Discrete contacts allow simultaneous presses without
matrix ghosting.

The physical power switch is independent of the expander and firmware.

## Power model

A slide switch in the battery lead provides zero device current from the
battery when USB is disconnected. The selected switch must be rated for at
least 1 A DC because it carries operating and charging current rather than a
logic signal. This intentionally favors simple wiring over
charge-while-off behavior:

- battery switch OFF and USB disconnected: hard off
- battery switch ON: battery powers the module and may be charged through USB
- USB connected: the module powers up regardless of battery-switch position
- battery charging requires the battery switch to be ON

This supersedes the earlier Card power design that gated a custom regulator
enable and supported charging while off. The ES3C28P's integrated charger is
retained without board modification.

The firmware reads the module's battery-voltage ADC. At the critical threshold
it warns the player, commits a save, disables audio, backlight, and ambient
LED, and enters deep sleep before the protected cell reaches its hardware
cutoff.

The selected cell is a protected **503450** 1S LiPo (~50 x 34 x 5 mm). It
must:

- fit the measured lower cavity with insulation and swelling allowance
- use the correct connector polarity for the ES3C28P (verify against the module
  schematic before wiring)
- support at least four hours at default brightness in the completed device
- remain within safe temperature during charging and play-while-charging

If a particular 503450 SKU fails fit or runtime on measured hardware, revise
the midframe or substitute another protected 503450 from ordinary distributor
stock; do not change pouch code without updating this spec.

## Audio

The ES3C28P's ES8311 codec and amplified speaker connector drive a small dynamic
speaker behind a grille in the rear decorative PCB. The speaker shares the
lower cavity beside the battery rather than stacking behind the display.

Volume Up and Volume Down are edge buttons read through the MCP23017. Firmware
stores volume in persistent settings, supports mute, and disables the amplifier
when silent. The onboard microphone is unused in release firmware.

## Ambient light

The ES3C28P's onboard RGB LED acts as a single ambient light that mirrors the
current game's background color at approximately half brightness. When the
background is black the LED is fully off, so a dark game keeps a dark device.
The LED can be disabled in persistent settings and is turned off at the
critical-battery threshold along with the backlight.

The light must read as an intentional soft glow, not a status-light leak. The
measured sample determines the light path — a small diffusing aperture or light
pipe in the rear decorative PCB, or edge diffusion through the midframe — and
the chosen treatment is validated with the plain mechanical PCBs in stage 2.

## Storage and cartridge flow

The device contains no PuzzleScript editor or source compiler. A desktop tool
compiles a game into a versioned `.pscart` cartridge. A cartridge contains:

- stable format/version identifier
- game identity and display metadata
- compiled rules/runtime data
- sprites, palette, levels, text, and sound data
- payload length and checksum

Cartridges live on microSD. Internal flash holds the appliance firmware, a
small fallback library, settings, and save records. USB-C is used for firmware
flashing and diagnostics; microSD remains the simple user-facing library path
for the first batch.

The library scans cartridge headers without loading every game. It skips
unsupported or corrupt entries and presents a compact error marker rather than
crashing. A missing or unreadable microSD falls back to the built-in library.

## Firmware architecture

Firmware is a small ESP-IDF application, not Arduino application glue, LVGL,
a browser, or a phone-like shell. Wi-Fi, Bluetooth, microphone, and touch
services are disabled by default; the onboard RGB LED is used only by the
ambient-light service. No network setup or account state exists.

Subsystem boundaries:

- **Boot coordinator:** initializes only the hardware needed for the first
  frame, restores the last game, and enables the backlight after drawing.
- **Cartridge loader:** validates version, bounds, and checksum before exposing
  immutable game data to the runtime.
- **PuzzleScript runtime:** executes one loaded game and preserves PuzzleScript
  semantics independently of the display or storage drivers.
- **Renderer:** draws nearest-neighbor RGB565 into a 320 x 240 framebuffer and
  transfers dirty rectangles directly to the ILI9341 over SPI.
- **Input service:** converts MCP23017 interrupts into debounced semantic button
  events.
- **Audio service:** synthesizes/plays game effects through the onboard codec
  and applies stored volume.
- **Ambient-light service:** drives the onboard RGB LED with the current game's
  background color at half brightness, off for black backgrounds and when
  disabled in settings.
- **Persistence service:** owns settings, progress, save integrity, and
  cartridge IDs.
- **Library UI:** lists valid cartridges and built-in games without exposing a
  general operating environment.

One game is loaded at a time. Large immutable rule/level data and the RGB565
framebuffer may use PSRAM; latency-sensitive bitsets, stacks, and the active
turn state stay in internal SRAM. Representative hardware profiling, not the
nominal 8 MB figure alone, is the memory gate.

Normal cold boot restores the last game. Back/Menu opens the library. The
target is a usable first frame within one second, with the screen held dark
until meaningful pixels are ready.

## Saves and abrupt power loss

The hard switch offers no shutdown handshake. Persistence therefore assumes
power may disappear at any time.

Per-game saves use two alternating records with cartridge ID, monotonically
increasing sequence number, payload length, and checksum. The newest valid
record wins; an incomplete newest record falls back to the previous one.
Records use ESP-IDF's wear-leveled persistent storage.

The runtime queues a save:

- when a level is completed or changed
- when leaving a game for the library
- after a short input-idle interval when state changed
- before critical-battery deep sleep

The in-session Undo history may be lost after hard power-off. Corrupt or
incompatible save data never prevents a game from starting; it is quarantined
and the game starts from its last valid progress point.

## Error behavior

- Missing microSD: boot the built-in fallback library.
- Corrupt cartridge: skip it, show a concise library error, and emit details
  over USB diagnostics.
- Unsupported cartridge version: identify it as incompatible without trying
  to interpret the payload.
- Out-of-memory load: unload the cartridge cleanly and return to the library
  with a diagnostic code.
- Corrupt newest save: load the older valid slot.
- I2C input fault: show a service error rather than entering uncontrolled play.
- Critical battery: save, darken, mute, and deep-sleep.

## Prototype and validation sequence

### Stage 1: bench feasibility

Acquire two ES3C28P modules. On the bench:

- confirm measured board, touch-stack, connector, and rear-component envelopes
- run the vendor display example before custom firmware
- validate microSD, speaker, charging, battery ADC, USB, backlight PWM, and
  the onboard RGB LED
- validate MCP23017 coexistence with the touch controller and audio codec
- run the native runtime against representative small and large cartridges
- record internal SRAM and PSRAM high-water marks

### Stage 2: controls and mechanical proof

- build the button coupon before freezing final footprints
- play representative games for 30 continuous minutes on each candidate
- make plain front/rear PCBs and a midframe before committing final artwork
- verify captive cap retention, guide fit, hard stops, and service access
- verify battery, speaker, wiring, USB-C, microSD, slide switch, and volume
  access in the measured cavity
- verify both display and lower-zone Z-stacks at or below 12 mm

### Stage 3: two complete pilots

Build two visually finished devices and require:

- usable first frame within one second of power-on
- no ghost inputs, cross-axis direction errors, or accidental Action events
- button-edge to first visible acknowledgement below 50 ms in representative
  games
- representative large games with at least 25% PSRAM headroom, at least 64 KiB
  free internal SRAM, and a largest free internal block of at least 32 KiB
- at least four hours of play at default brightness and volume with the
  ambient LED active
- stable temperature during extended play and play-while-charging
- repeated hard-power cuts without loss of the last valid save
- graceful missing/corrupt SD and cartridge behavior
- no switch, cap, pad, faceplate, or midframe damage under hard normal thumb use
- touch input absent from the release user experience

Only after both pilots pass are the remaining modules ordered.

## Procurement and revision freeze

The two initial ES3C28P modules should be bought before detailed mechanical
CAD. Once the pilot revision passes, purchase all display modules for the
5-20-unit run plus several spares in one batch and freeze the observed module
revision.

The controller expander, standard passives, connectors, switches, protected
503450 LiPo, speaker, and PCB fabrication must be available from ordinary
manufacturer/distributor channels. No custom silicone tooling, chip-down ESP32
assembly, fine-pitch BGA/QFN bring-up, or custom display bonding is allowed.

Deferred selections are resolved by explicit gates:

- direction and secondary switch parts: button-coupon winner
- battery (503450): measured fit plus four-hour runtime and temperature tests
  before batch LiPo purchase
- exact body depth: measured ES3C28P and pilot stack, maximum 12 mm
- final art and finish: after plain mechanical PCB validation

## Explicit exclusions

- ESP32-P4 and DSI display hardware
- phone/SBC hardware or phone operating systems
- touch-driven release navigation
- on-device PuzzleScript source compilation or editing
- Wi-Fi/Bluetooth accounts, OTA, or cloud library services
- haptics and camera/microphone features
- decorative lighting beyond the single onboard ambient LED
- custom molded silicone controls
- a custom charger, regulator, audio codec, or chip-down ESP32 board
- a separate protective display window on the ES3C28P

## Primary references

- [LCDWiki 2.8-inch ESP32-S3 display overview](https://www.lcdwiki.com/2.8inch_ESP32-S3_Display)
- [ES3C28P/ES3N28P specification and outline drawings](https://www.lcdwiki.com/res/ES3C28P/ES3C28P_ES2N28P_Specification_V1.0.pdf)
- [ES3C28P/ES3N28P schematic](https://www.lcdwiki.com/res/ES3C28P/2.8inch_ESP32-S3_Display_Schematic.pdf)
- [Microchip MCP23017 product documentation](https://www.microchip.com/en-us/product/mcp23017)
- [JLCPCB standard fabrication capabilities](https://jlcpcb.com/capabilities/pcb-capabilities/)
