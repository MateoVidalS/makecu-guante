import type { Quint } from '../../contracts/glove';

export const SUPPLY_LIMIT_MA = 2500;
export const ELECTRONICS_IDLE_MA = 30;
export interface SimPower {
  /** Servo demand before supply saturation, in wire finger order. */
  perServoMa: Quint;
  demandMa: number;
  /** Total seen by the INA219 model, before its firmware filter. */
  totalMa: number;
  saturated: boolean;
}

export function supplyPower(perServoMa: Quint): SimPower {
  const demandMa =
    ELECTRONICS_IDLE_MA + perServoMa.reduce((sum, ma) => sum + ma, 0);
  return {
    perServoMa: [...perServoMa],
    demandMa,
    totalMa: Math.min(SUPPLY_LIMIT_MA, demandMa),
    saturated: demandMa >= SUPPLY_LIMIT_MA,
  };
}
