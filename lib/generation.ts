// Physical generation models: weather → power. Deliberately transparent so consultants can explain them.

export type PvParams = {
  /** installed DC capacity, MWp */
  capacityMWp: number;
  /** performance ratio (inverter, soiling, wiring losses), typically 0.80–0.88 */
  performanceRatio: number;
  /** power temperature coefficient per K (crystalline Si ≈ -0.0037) */
  tempCoeff: number;
};

export type WindParams = {
  turbines: number;
  ratedMW: number;
  hubHeight: number;
  /** availability × wake losses */
  lossFactor: number;
};

export const DEFAULT_PV: PvParams = { capacityMWp: 10, performanceRatio: 0.85, tempCoeff: -0.0037 };
export const DEFAULT_WIND: WindParams = { turbines: 5, ratedMW: 4.2, hubHeight: 140, lossFactor: 0.9 };

/** PV output in MW from plane-of-array irradiance (W/m²) and ambient temperature (°C). */
export function pvPower(gti: number, ambient: number, p: PvParams): number {
  if (gti <= 0) return 0;
  const cellTemp = ambient + 0.03 * gti; // Ross model, k ≈ 0.03 K·m²/W
  const tempFactor = 1 + p.tempCoeff * (cellTemp - 25);
  return Math.max(0, p.capacityMWp * (gti / 1000) * p.performanceRatio * tempFactor);
}

const CUT_IN = 3;
const RATED = 12.5;
const CUT_OUT = 25;

/** Normalised power curve of a generic modern onshore turbine (0…1). */
export function powerCurve(v: number): number {
  if (v < CUT_IN || v >= CUT_OUT) return 0;
  if (v >= RATED) return 1;
  return (v ** 3 - CUT_IN ** 3) / (RATED ** 3 - CUT_IN ** 3);
}

/** Extrapolate 120 m wind speed to hub height (power law, α = 0.14 for open terrain). */
export const windAtHub = (v120: number, hub: number) => v120 * (hub / 120) ** 0.14;

export function windPower(v120: number, p: WindParams): number {
  return p.turbines * p.ratedMW * p.lossFactor * powerCurve(windAtHub(v120, p.hubHeight));
}
