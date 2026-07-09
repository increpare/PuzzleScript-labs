#pragma once

/**
 * PuzzleScript Card — GPIO map (spin 1).
 * Frozen in hardware/card/schematic/connectivity.json and PIN_BUDGET.md.
 */
namespace ps_probe::board::card_pins {

// I2C (fuel gauge + DRV2605)
inline constexpr int kI2cSda = 26;
inline constexpr int kI2cScl = 27;

// Wake-capable controls on LP GPIOs (active-low, 10k pull-up).
// GPIO8 is spare: power is a physical slide switch gating the 3V3 regulator
// (hard off), not a GPIO. See
// docs/superpowers/specs/2026-07-09-handheld-card-power-switch-design.md.
inline constexpr int kSwDpadDown = 9;
inline constexpr int kSwAction = 10;
inline constexpr int kPanelEn = 11;

// D-pad + face buttons (active-low, 10k pull-up)
inline constexpr int kSwDpadUp = 28;
inline constexpr int kSwDpadLeft = 30;
inline constexpr int kSwDpadRight = 31;
inline constexpr int kSwUndo = 33;
inline constexpr int kSwRestart = 34;
inline constexpr int kSwMenu = 37;

// Volume rocker
inline constexpr int kVolUp = 39;
inline constexpr int kVolDown = 40;

// Module control
inline constexpr int kBoot = 35;      // GPIO35 / module pin 62
inline constexpr int kBootEn = 36;    // GPIO36 / module pin 63
inline constexpr int kEspEn = -1;     // ESP_EN is module pin 87 (not HP GPIO)

// Piezo + case RGB + gauge alert
inline constexpr int kPiezoPwm = 41;
inline constexpr int kLedR = 42;
inline constexpr int kLedG = 43;
inline constexpr int kLedB = 44;
inline constexpr int kGaugeAlert = 45;

// microSD SPI (service-only)
inline constexpr int kSdCs = 46;
inline constexpr int kSdClk = 47;
inline constexpr int kSdMosi = 48;
inline constexpr int kSdMiso = 49;

// Debug UART test pads
inline constexpr int kUartTx = 50;
inline constexpr int kUartRx = 51;

// USB (module pins 48–49 per PIN_BUDGET; native USB PHY)
inline constexpr int kUsbDm = 48;
inline constexpr int kUsbDp = 49;

// WS24773 4.3″ panel (800×480 target; DSI 2-lane)
inline constexpr int kTargetWidth = 800;
inline constexpr int kTargetHeight = 480;
inline constexpr int kMipiDsiLaneCount = 2;

} // namespace ps_probe::board::card_pins
