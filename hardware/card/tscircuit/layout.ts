/** Body-top-left coords from hardware/card/mechanical/layout.json → PCB origin (2 mm inset). */
export const PCB_INSET_MM = 2
export const PCB_W_MM = 116
export const PCB_H_MM = 106
export const PCB_R_MM = 7
export const BODY_W_MM = 120
export const BODY_H_MM = 110
export const BODY_R_MM = 9

export function pcbMm(bodyCoord: number): `${number}mm` {
  return `${bodyCoord - PCB_INSET_MM}mm`
}

/** PCB-local mm value (number only). */
export function pcbLocal(bodyCoord: number): number {
  return bodyCoord - PCB_INSET_MM
}
