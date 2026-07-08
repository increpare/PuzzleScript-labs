/**
 * PuzzleScript Card — spin 1 tscircuit
 * Nets from hardware/card/schematic/connectivity.json
 * Placement from hardware/card/mechanical/layout.json anchors
 */
import { TF_01A } from "./imports/TF_01A"
import { BQ24075RGTR } from "./imports/BQ24075RGTR"
import { MAX17048G_T10 } from "./imports/MAX17048G_T10"
import { TPS62135RGXR } from "./imports/TPS62135RGXR"
import { KH_FG1_0_H2_0_15PIN } from "./imports/KH_FG1_0_H2_0_15PIN"
import { DRV2605LDGSR } from "./imports/DRV2605LDGSR"
import { ESP32_P4_Module_32MB } from "./imports/ESP32_P4_Module_32MB"
import { pcbMm, PCB_W_MM, PCB_H_MM, PCB_R_MM, BODY_W_MM, BODY_H_MM, BODY_R_MM, PCB_INSET_MM } from "./layout"

const BOARD_W = `${PCB_W_MM}mm`
const BOARD_H = `${PCB_H_MM}mm`

function Tact(props: {
  name: string
  pcbX: `${number}mm`
  pcbY: `${number}mm`
  schX: number
  schY: number
}) {
  return (
    <pushbutton
      name={props.name}
      footprint="pushbutton"
      supplierPartNumbers={{ jlcpcb: ["C318884"] }}
      schSectionName="Controls"
      pcbX={props.pcbX}
      pcbY={props.pcbY}
      schX={props.schX}
      schY={props.schY}
    />
  )
}

export default () => (
  <board
    width={BOARD_W}
    height={BOARD_H}
    borderRadius={`${PCB_R_MM}mm`}
    layers={4}
    title="PuzzleScript Card spin1"
  >
    <schematicsection name="Power" displayName="Power" />
    <schematicsection name="Compute" displayName="Compute" />
    <schematicsection name="Display" displayName="Display" />
    <schematicsection name="Storage" displayName="Storage" />
    <schematicsection name="Controls" displayName="Controls" />
    <schematicsection name="Audio" displayName="Audio" />
    <schematicsection name="Haptic" displayName="Haptic" />
    <schematicsection name="CaseRGB" displayName="Case RGB" />
    <schematicsection name="Debug" displayName="Debug" />

    {/* Mechanical outlines (layout.json) — visible in pcb-svg preview */}
    <pcbnoterect
      pcbX={`${-PCB_INSET_MM}mm`}
      pcbY={`${-PCB_INSET_MM}mm`}
      width={`${BODY_W_MM}mm`}
      height={`${BODY_H_MM}mm`}
      cornerRadius={`${BODY_R_MM}mm`}
      hasStroke
      isStrokeDashed
      color="#666666"
      strokeWidth={0.12}
    />
    <pcbnoterect
      pcbX="0mm"
      pcbY="0mm"
      width={BOARD_W}
      height={BOARD_H}
      cornerRadius={`${PCB_R_MM}mm`}
      hasStroke
      color="#00ff00"
      strokeWidth={0.15}
    />
    <pcbnoterect
      pcbX={pcbMm(7.29)}
      pcbY={pcbMm(3.5)}
      width="105.42mm"
      height="67.07mm"
      hasStroke
      isStrokeDashed
      color="#ff8800"
      strokeWidth={0.1}
    />
    <pcbnoterect
      pcbX={pcbMm(37)}
      pcbY={pcbMm(73)}
      width="32mm"
      height="30mm"
      hasStroke
      isStrokeDashed
      color="#ff8800"
      strokeWidth={0.1}
    />
    <pcbnoterect
      pcbX={pcbMm(47)}
      pcbY={pcbMm(0)}
      width="26mm"
      height="72mm"
      hasStroke
      isStrokeDashed
      color="#ff8800"
      strokeWidth={0.1}
    />

    {/* Mounting holes (layout.json) */}
    <hole pcbX={pcbMm(5)} pcbY={pcbMm(5)} diameter="2.2mm" />
    <hole pcbX={pcbMm(115)} pcbY={pcbMm(5)} diameter="2.2mm" />
    <hole pcbX={pcbMm(5)} pcbY={pcbMm(105)} diameter="2.2mm" />
    <hole pcbX={pcbMm(115)} pcbY={pcbMm(105)} diameter="2.2mm" />

    {/* --- Power --- */}
    <connector
      name="J1"
      standard="usb_c"
      manufacturerPartNumber="TYPE-C-16P-CB1.6-073"
      supplierPartNumbers={{ jlcpcb: ["C2906290"] }}
      schSectionName="Power"
      pcbX={pcbMm(25)}
      pcbY={pcbMm(2)}
      schX={0}
      schY={0}
      connections={{
        VBUS1: "net.VBUS_IN",
        VBUS2: "net.VBUS_IN",
        GND1: "net.GND",
        GND2: "net.GND",
        SHELL1: "net.GND",
        DP1: "U1.USB_DP",
        DM1: "U1.USB_DM",
      }}
    />
    <connector
      name="J2"
      schSectionName="Power"
      manufacturerPartNumber="JST-PH-2"
      pinLabels={{ pin1: "BAT", pin2: "GND" }}
      footprint="jst2"
      pcbX={pcbMm(53)}
      pcbY={pcbMm(99)}
      schX={4}
      schY={0}
    />
    <BQ24075RGTR
      name="U2"
      schSectionName="Power"
      pcbX={pcbMm(72)}
      pcbY={pcbMm(100)}
      schX={8}
      schY={0}
    />
    <MAX17048G_T10
      name="U3"
      schSectionName="Power"
      pcbX={pcbMm(80)}
      pcbY={pcbMm(100)}
      schX={12}
      schY={0}
    />
    <TPS62135RGXR
      name="U4"
      schSectionName="Power"
      pcbX={pcbMm(90)}
      pcbY={pcbMm(100)}
      schX={16}
      schY={0}
    />
    <inductor
      name="L1"
      inductance="2.2uH"
      footprint="0603"
      schSectionName="Power"
      schX={18}
      schY={0}
      pcbX={pcbMm(94)}
      pcbY={pcbMm(96)}
    />
    <resistor
      name="R1"
      resistance="5.1k"
      footprint="0402"
      schSectionName="Power"
      schX={20}
      schY={0}
      pcbX={pcbMm(30)}
      pcbY={pcbMm(8)}
    />
    <resistor
      name="R2"
      resistance="5.1k"
      footprint="0402"
      schSectionName="Power"
      schX={22}
      schY={0}
      pcbX={pcbMm(33)}
      pcbY={pcbMm(8)}
    />
    <capacitor
      name="C1"
      capacitance="10uF"
      footprint="0603"
      schSectionName="Power"
      schX={24}
      schY={0}
      pcbX={pcbMm(86)}
      pcbY={pcbMm(96)}
    />
    <capacitor
      name="C2"
      capacitance="10uF"
      footprint="0603"
      schSectionName="Power"
      schX={26}
      schY={0}
      pcbX={pcbMm(89)}
      pcbY={pcbMm(96)}
    />

    {/* --- Compute (outside FPC keep-out: x>71 mm) --- */}
    <ESP32_P4_Module_32MB
      name="U1"
      schSectionName="Compute"
      pcbX={pcbMm(88)}
      pcbY={pcbMm(90)}
      schX={0}
      schY={12}
    />
    <resistor
      name="R3"
      resistance="4.7k"
      footprint="0402"
      schSectionName="Compute"
      schX={4}
      schY={12}
      pcbX={pcbMm(84)}
      pcbY={pcbMm(86)}
    />
    <resistor
      name="R4"
      resistance="4.7k"
      footprint="0402"
      schSectionName="Compute"
      schX={6}
      schY={12}
      pcbX={pcbMm(87)}
      pcbY={pcbMm(86)}
    />
    <resistor
      name="R5"
      resistance="10k"
      footprint="0402"
      schSectionName="Compute"
      schX={8}
      schY={12}
      pcbX={pcbMm(90)}
      pcbY={pcbMm(86)}
    />
    <resistor
      name="R6"
      resistance="10k"
      footprint="0402"
      schSectionName="Compute"
      schX={10}
      schY={12}
      pcbX={pcbMm(93)}
      pcbY={pcbMm(86)}
    />

    {/* --- Display (J3 DSI FFC, layout CONN_DSI_FFC) --- */}
    <KH_FG1_0_H2_0_15PIN
      name="J3"
      schSectionName="Display"
      pcbX={pcbMm(60)}
      pcbY={pcbMm(3.5)}
      schX={0}
      schY={60}
      pcbRotation={180}
    />
    <capacitor
      name="C3"
      capacitance="10uF"
      footprint="0603"
      schSectionName="Display"
      schX={4}
      schY={60}
      pcbX={pcbMm(65)}
      pcbY={pcbMm(8)}
    />

    {/* --- Storage --- */}
    <TF_01A
      name="J4"
      schSectionName="Storage"
      pcbX={pcbMm(102)}
      pcbY={pcbMm(90)}
      schX={0}
      schY={24}
    />
    <capacitor
      name="C_sd"
      capacitance="100nF"
      footprint="0402"
      supplierPartNumbers={{ jlcpcb: ["C1525"] }}
      schSectionName="Storage"
      schX={4}
      schY={24}
      pcbX={pcbMm(98)}
      pcbY={pcbMm(88)}
    />

    {/* --- Controls (layout anchors) --- */}
    <Tact name="SW1" pcbX={pcbMm(22)} pcbY={pcbMm(78.25)} schX={0} schY={36} />
    <Tact name="SW2" pcbX={pcbMm(22)} pcbY={pcbMm(95.75)} schX={2} schY={36} />
    <Tact name="SW3" pcbX={pcbMm(13.25)} pcbY={pcbMm(87)} schX={4} schY={36} />
    <Tact name="SW4" pcbX={pcbMm(30.75)} pcbY={pcbMm(87)} schX={6} schY={36} />
    <Tact name="SW5" pcbX={pcbMm(89)} pcbY={pcbMm(83)} schX={8} schY={36} />
    <Tact name="SW6" pcbX={pcbMm(75)} pcbY={pcbMm(96)} schX={10} schY={36} />
    <Tact name="SW7" pcbX={pcbMm(92)} pcbY={pcbMm(102)} schX={12} schY={36} />
    <Tact name="SW8" pcbX={pcbMm(30.5)} pcbY={pcbMm(106)} schX={14} schY={36} />
    <Tact name="SW9" pcbX={pcbMm(113)} pcbY={pcbMm(3.5)} schX={16} schY={36} />
    <Tact name="SW10A" pcbX={pcbMm(114)} pcbY={pcbMm(18)} schX={18} schY={36} />
    <Tact name="SW10B" pcbX={pcbMm(114)} pcbY={pcbMm(22)} schX={20} schY={36} />
    <resistor
      name="R10"
      resistance="10k"
      footprint="0402"
      schSectionName="Controls"
      schX={22}
      schY={36}
      pcbX={pcbMm(20)}
      pcbY={pcbMm(76)}
    />

    {/* --- Audio (piezo via NPN) --- */}
    <chip
      name="Q1"
      schSectionName="Audio"
      manufacturerPartNumber="NPN"
      footprint="sot23"
      pcbX={pcbMm(53)}
      pcbY={pcbMm(99)}
      schX={0}
      schY={72}
      pinLabels={{
        pin1: "C",
        pin2: "B",
        pin3: "E",
      }}
    />
    <connector
      name="JP1"
      schSectionName="Audio"
      manufacturerPartNumber="PiezoPads"
      pinLabels={{ pin1: "PIEZO", pin2: "GND" }}
      footprint="pinrow2"
      pcbX={pcbMm(53)}
      pcbY={pcbMm(95)}
      schX={4}
      schY={72}
    />

    {/* --- Haptic --- */}
    <DRV2605LDGSR
      name="U5"
      schSectionName="Haptic"
      pcbX={pcbMm(100)}
      pcbY={pcbMm(91)}
      schX={0}
      schY={84}
    />
    <chip
      name="B1"
      schSectionName="Haptic"
      manufacturerPartNumber="LRA"
      footprint="soic4"
      pcbX={pcbMm(106)}
      pcbY={pcbMm(91)}
      schX={4}
      schY={84}
      pinLabels={{
        pin1: "LRA_P",
        pin2: "LRA_N",
      }}
    />

    {/* --- Case RGB --- */}
    <led name="D1" color="red" footprint="0603" schSectionName="CaseRGB" schX={0} schY={96} pcbX={pcbMm(104)} pcbY={pcbMm(6)} />
    <led name="D2" color="green" footprint="0603" schSectionName="CaseRGB" schX={2} schY={96} pcbX={pcbMm(107)} pcbY={pcbMm(6)} />
    <led name="D3" color="blue" footprint="0603" schSectionName="CaseRGB" schX={4} schY={96} pcbX={pcbMm(110)} pcbY={pcbMm(6)} />

    {/* --- Debug --- */}
    <testpoint name="TP1" footprintVariant="pad" padDiameter="1mm" schSectionName="Debug" schX={0} schY={48} pcbX={pcbMm(100)} pcbY={pcbMm(70)} />
    <testpoint name="TP2" footprintVariant="pad" padDiameter="1mm" schSectionName="Debug" schX={2} schY={48} pcbX={pcbMm(103)} pcbY={pcbMm(70)} />
    <testpoint name="TP3" footprintVariant="pad" padDiameter="1mm" schSectionName="Debug" schX={4} schY={48} pcbX={pcbMm(106)} pcbY={pcbMm(70)} />
    <testpoint name="TP4" footprintVariant="pad" padDiameter="1mm" schSectionName="Debug" schX={6} schY={48} pcbX={pcbMm(109)} pcbY={pcbMm(70)} />

    {/* Power rails */}
    <trace name="VBUS_IN" from="net.VBUS_IN" to="U2.IN" />
    <trace name="J2_BAT1" from="J2.BAT" to="U2.BAT1" />
    <trace name="J2_BAT2" from="J2.BAT" to="U2.BAT2" />
    <trace name="BAT_GAUGE" from="J2.BAT" to="U3.CELL" />
    <trace name="SYS_OUT1" from="U2.OUT1" to="U4.VIN" />
    <trace name="SYS_OUT2" from="U2.OUT2" to="U4.VIN" />
    <trace name="BUCK_SW" from="U4.SW" to=".L1 > .pin1" />
    <trace name="BUCK_L" from=".L1 > .pin2" to="net.VCC_3V3" />
    <trace name="BUCK_EN" from="U4.EN" to="U4.VIN" />
    <trace name="J2_GND" from="J2.GND" to="net.GND" />
    <trace name="U2_GND" from="U2.VSS" to="net.GND" />
    <trace name="U3_GND" from="U3.GND" to="net.GND" />
    <trace name="U4_GND" from="U4.GND" to="net.GND" />
    <trace name="R1_GND" from=".R1 > .pin2" to="net.GND" />
    <trace name="R2_GND" from=".R2 > .pin2" to="net.GND" />
    <trace name="CC1_R1" from=".J1 > .CC1" to=".R1 > .pin1" />
    <trace name="CC2_R2" from=".J1 > .CC2" to=".R2 > .pin1" />
    <trace name="C1_3V3" from=".C1 > .pin1" to="net.VCC_3V3" />
    <trace name="C1_GND" from=".C1 > .pin2" to="net.GND" />
    <trace name="C2_3V3" from=".C2 > .pin1" to="net.VCC_3V3" />
    <trace name="C2_GND" from=".C2 > .pin2" to="net.GND" />
    <trace name="U3_VDD" from="U3.VDD" to="net.VCC_3V3" />
    <trace name="USB_DP" from=".J1 > .DP1" to="U1.USB_DP" />
    <trace name="USB_DP2" from=".J1 > .DP2" to="U1.USB_DP" />
    <trace name="USB_DM" from=".J1 > .DM1" to="U1.USB_DM" />
    <trace name="USB_DM2" from=".J1 > .DM2" to="U1.USB_DM" />

    {/* I2C */}
    <trace name="I2C_SDA" from="U1.GPIO26" to="U3.SDA" />
    <trace name="I2C_SCL" from="U1.GPIO27" to="U3.SCL" />
    <trace name="I2C_SDA_HAP" from="U1.GPIO26" to="U5.SDA" />
    <trace name="I2C_SCL_HAP" from="U1.GPIO27" to="U5.SCL" />
    <trace name="GAUGE_ALRT" from="U3.ALRT" to="U1.GPIO45" />
    <trace name="R3_SDA" from=".R3 > .pin2" to="U1.GPIO26" />
    <trace name="R3_3V3" from=".R3 > .pin1" to="net.VCC_3V3" />
    <trace name="R4_SCL" from=".R4 > .pin2" to="U1.GPIO27" />
    <trace name="R4_3V3" from=".R4 > .pin1" to="net.VCC_3V3" />
    <trace name="R5_EN" from=".R5 > .pin2" to="U1.ESP_EN" />
    <trace name="R5_3V3" from=".R5 > .pin1" to="net.VCC_3V3" />
    <trace name="R6_BOOT" from=".R6 > .pin2" to="U1.GPIO36" />
    <trace name="R6_3V3" from=".R6 > .pin1" to="net.VCC_3V3" />
    <trace name="ESP_EN_SW9" from="U1.ESP_EN" to=".SW9 > .pin2" />
    <trace name="ESP_EN_U2" from="U1.ESP_EN" to="U2.EN1" />
    <trace name="SW9_PWR" from="U1.GPIO38" to=".SW9 > .pin1" />

    {/* Storage SPI */}
    <trace name="SD_CS" from="U1.GPIO46" to="J4.pin2" />
    <trace name="SD_CLK" from="U1.GPIO47" to="J4.pin5" />
    <trace name="SD_MOSI" from="U1.GPIO48" to="J4.pin3" />
    <trace name="SD_MISO" from="U1.GPIO49" to="J4.pin7" />
    <trace name="J4_VDD" from="J4.VDD" to="net.VCC_3V3" />
    <trace name="J4_GND" from="J4.VSS" to="net.GND" />
    <trace name="U1_3V3_A" from="U1.ESP_3V3_A" to="net.VCC_3V3" />
    <trace name="U1_3V3_B" from="U1.ESP_3V3_B" to="net.VCC_3V3" />
    <trace name="U1_GND" from="U1.GND" to="net.GND" />
    <trace name="U1_GND2" from="U1.GND2" to="net.GND" />
    <trace name="C_sd_3V3" from=".C_sd > .pin1" to="net.VCC_3V3" />
    <trace name="C_sd_GND" from=".C_sd > .pin2" to="net.GND" />

    {/* Display DSI + panel power (Pi 15-pin FFC pinout) */}
    <trace name="DSI_D1_N" from="U1.DSI_DATAN1" to="J3.pin2" />
    <trace name="DSI_D1_P" from="U1.DSI_DATAP1" to="J3.pin3" />
    <trace name="DSI_CLK_N" from="U1.DSI_CLKN" to="J3.pin5" />
    <trace name="DSI_CLK_P" from="U1.DSI_CLKP" to="J3.pin6" />
    <trace name="DSI_D0_N" from="U1.DSI_DATAN0" to="J3.pin8" />
    <trace name="DSI_D0_P" from="U1.DSI_DATAP0" to="J3.pin9" />
    <trace name="J3_VDD" from="J3.pin14" to="net.VCC_3V3" />
    <trace name="C3_3V3" from=".C3 > .pin1" to="net.VCC_3V3" />
    <trace name="C3_GND" from=".C3 > .pin2" to="net.GND" />
    <trace name="J3_GND1" from="J3.pin1" to="net.GND" />
    <trace name="J3_GND2" from="J3.pin4" to="net.GND" />
    <trace name="J3_GND3" from="J3.pin7" to="net.GND" />
    <trace name="J3_GND4" from="J3.pin10" to="net.GND" />
    <trace name="J3_GND5" from="J3.pin13" to="net.GND" />
    <trace name="J3_GND6" from="J3.pin15" to="net.GND" />

    {/* Audio */}
    <trace name="PIEZO_PWM" from="U1.GPIO41" to="Q1.B" />
    <trace name="Q1_E" from="Q1.E" to="net.GND" />
    <trace name="PIEZO_OUT" from="Q1.C" to="JP1.PIEZO" />
    <trace name="JP1_GND" from="JP1.GND" to="net.GND" />

    {/* Haptic */}
    <trace name="U5_VDD" from="U5.VDD" to="net.VCC_3V3" />
    <trace name="U5_GND" from="U5.GND" to="net.GND" />
    <trace name="U5_EN" from="U5.EN" to="net.VCC_3V3" />
    <trace name="LRA_P" from="U5.OUT_POS" to="B1.LRA_P" />
    <trace name="LRA_N" from="U5.OUT_NEG" to="B1.LRA_N" />

    {/* Case RGB (direct GPIO drive per connectivity.json) */}
    <trace name="LED_R" from="U1.GPIO42" to=".D1 > .pin1" />
    <trace name="LED_R_GND" from=".D1 > .pin2" to="net.GND" />
    <trace name="LED_G" from="U1.GPIO43" to=".D2 > .pin1" />
    <trace name="LED_G_GND" from=".D2 > .pin2" to="net.GND" />
    <trace name="LED_B" from="U1.GPIO44" to=".D3 > .pin1" />
    <trace name="LED_B_GND" from=".D3 > .pin2" to="net.GND" />

    {/* Controls → MCU (active low to GND) */}
    <trace name="SW1_UP" from="U1.GPIO28" to=".SW1 > .pin1" />
    <trace name="SW1_GND" from=".SW1 > .pin2" to="net.GND" />
    <trace name="SW2_DN" from="U1.GPIO29" to=".SW2 > .pin1" />
    <trace name="SW2_GND" from=".SW2 > .pin2" to="net.GND" />
    <trace name="SW3_L" from="U1.GPIO30" to=".SW3 > .pin1" />
    <trace name="SW3_GND" from=".SW3 > .pin2" to="net.GND" />
    <trace name="SW4_R" from="U1.GPIO31" to=".SW4 > .pin1" />
    <trace name="SW4_GND" from=".SW4 > .pin2" to="net.GND" />
    <trace name="SW5_ACT" from="U1.GPIO32" to=".SW5 > .pin1" />
    <trace name="SW5_GND" from=".SW5 > .pin2" to="net.GND" />
    <trace name="SW6_UNDO" from="U1.GPIO33" to=".SW6 > .pin1" />
    <trace name="SW6_GND" from=".SW6 > .pin2" to="net.GND" />
    <trace name="SW7_RST" from="U1.GPIO34" to=".SW7 > .pin1" />
    <trace name="SW7_GND" from=".SW7 > .pin2" to="net.GND" />
    <trace name="SW8_MENU" from="U1.GPIO37" to=".SW8 > .pin1" />
    <trace name="SW8_GND" from=".SW8 > .pin2" to="net.GND" />
    <trace name="SW10A_UP" from="U1.GPIO39" to=".SW10A > .pin1" />
    <trace name="SW10A_GND" from=".SW10A > .pin2" to="net.GND" />
    <trace name="SW10B_DN" from="U1.GPIO40" to=".SW10B > .pin1" />
    <trace name="SW10B_GND" from=".SW10B > .pin2" to="net.GND" />
    <trace name="R10_UP" from=".R10 > .pin1" to="U1.GPIO28" />
    <trace name="R10_3V3" from=".R10 > .pin2" to="net.VCC_3V3" />

    {/* Debug UART / boot */}
    <trace name="UART_TX" from="U1.GPIO50" to=".TP1 > .pin1" />
    <trace name="UART_RX" from="U1.GPIO51" to=".TP2 > .pin1" />
    <trace name="TP3_BOOT" from="U1.GPIO35" to=".TP3 > .pin1" />
    <trace name="TP4_EN" from="U1.ESP_EN" to=".TP4 > .pin1" />
  </board>
)
