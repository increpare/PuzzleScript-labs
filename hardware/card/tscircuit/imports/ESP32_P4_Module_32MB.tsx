/**
 * Waveshare ESP32-P4-Module-32MB — 25×25 mm castellated module (spin 1).
 * Footprint: module outline + castellated pads on four edges at 1 mm pitch.
 * Pin labels match hardware/card/schematic/connectivity.json (logical nets).
 */
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: "GPIO46",
  pin2: "GPIO47",
  pin3: "GPIO48",
  pin4: "GPIO49",
  pin5: "USB_DM",
  pin6: "USB_DP",
  pin7: "ESP_3V3_A",
  pin8: "ESP_3V3_B",
  pin9: "GND",
  pin10: "GND2",
  pin11: "GPIO26",
  pin12: "GPIO27",
  pin13: "GPIO28",
  pin14: "GPIO29",
  pin15: "GPIO30",
  pin16: "GPIO31",
  pin17: "GPIO32",
  pin18: "GPIO33",
  pin19: "GPIO34",
  pin20: "GPIO37",
  pin21: "GPIO38",
  pin22: "GPIO39",
  pin23: "GPIO40",
  pin24: "GPIO35",
  pin25: "GPIO36",
  pin26: "GPIO50",
  pin27: "GPIO51",
  pin28: "ESP_EN",
  pin29: "DSI_DATAN1",
  pin30: "DSI_DATAP1",
  pin31: "DSI_CLKN",
  pin32: "DSI_CLKP",
  pin33: "DSI_DATAN0",
  pin34: "DSI_DATAP0",
  pin35: "GPIO41",
  pin36: "GPIO42",
  pin37: "GPIO43",
  pin38: "GPIO44",
  pin39: "GPIO45",
} as const

const HALF = 12.5
const PAD_W = 0.8
const PAD_H = 1.2

function edgePad(pin: number, x: number, y: number) {
  return (
    <smtpad
      key={pin}
      portHints={[`pin${pin}`]}
      pcbX={`${x}mm`}
      pcbY={`${y}mm`}
      width={`${PAD_W}mm`}
      height={`${PAD_H}mm`}
      shape="rect"
    />
  )
}

export const ESP32_P4_Module_32MB = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      manufacturerPartNumber="ESP32-P4-Module-32MB"
      supplierPartNumbers={{}}
      footprint={
        <footprint>
          {/* Bottom edge — SD + USB */}
          {edgePad(1, -10, HALF)}
          {edgePad(2, -9, HALF)}
          {edgePad(3, -8, HALF)}
          {edgePad(4, -7, HALF)}
          {edgePad(5, -6, HALF)}
          {edgePad(6, -5, HALF)}
          {/* Right edge — power + I2C + D-pad */}
          {edgePad(7, HALF, 10)}
          {edgePad(8, HALF, 9)}
          {edgePad(9, HALF, 8)}
          {edgePad(10, HALF, 7)}
          {edgePad(11, HALF, 6)}
          {edgePad(12, HALF, 5)}
          {edgePad(13, HALF, 4)}
          {edgePad(14, HALF, 3)}
          {edgePad(15, HALF, 2)}
          {edgePad(16, HALF, 1)}
          {edgePad(17, HALF, 0)}
          {edgePad(18, HALF, -1)}
          {edgePad(19, HALF, -2)}
          {/* Top edge — DSI + controls */}
          {edgePad(29, -5, -HALF)}
          {edgePad(30, -4, -HALF)}
          {edgePad(31, -3, -HALF)}
          {edgePad(32, -2, -HALF)}
          {edgePad(33, -1, -HALF)}
          {edgePad(34, 0, -HALF)}
          {edgePad(20, 1, -HALF)}
          {edgePad(21, 2, -HALF)}
          {edgePad(22, 3, -HALF)}
          {edgePad(23, 4, -HALF)}
          {/* Left edge — boot / UART / EN / GPIO */}
          {edgePad(24, -HALF, -4)}
          {edgePad(25, -HALF, -3)}
          {edgePad(26, -HALF, -2)}
          {edgePad(27, -HALF, -1)}
          {edgePad(28, -HALF, 0)}
          {edgePad(35, -HALF, 1)}
          {edgePad(36, -HALF, 2)}
          {edgePad(37, -HALF, 3)}
          {edgePad(38, -HALF, 4)}
          {edgePad(39, -HALF, 5)}
          <silkscreenpath
            route={[
              { x: -HALF, y: -HALF },
              { x: HALF, y: -HALF },
              { x: HALF, y: HALF },
              { x: -HALF, y: HALF },
              { x: -HALF, y: -HALF },
            ]}
          />
          <silkscreentext text="{NAME}" pcbX="0mm" pcbY="14mm" anchorAlignment="center" fontSize="1.2mm" />
          <courtyardoutline
            outline={[
              { x: -HALF - 0.5, y: -HALF - 0.5 },
              { x: HALF + 0.5, y: -HALF - 0.5 },
              { x: HALF + 0.5, y: HALF + 0.5 },
              { x: -HALF - 0.5, y: HALF + 0.5 },
              { x: -HALF - 0.5, y: -HALF - 0.5 },
            ]}
          />
        </footprint>
      }
      {...props}
    />
  )
}
