import type { Reading, Tank, TankStatus } from "./types";

const RECENT_WINDOW_HOURS = 24;
// If the recent sustained drop rate is this many times the tank's own
// historical baseline, flag it as a possible leak. This is a simple,
// explainable rule on purpose — an ops team has to trust why an alert fired.
export const LEAK_MULTIPLIER = 1.8;
export const LOW_LEVEL_THRESHOLD_PCT = 25;

/** Hour-over-hour drops, ignoring refills and any interval broken by a gap. */
export function hourlyDrops(readings: Reading[]): number[] {
  const drops: number[] = [];
  for (let i = 1; i < readings.length; i++) {
    const hoursApart = Math.round(
      (new Date(readings[i].timestamp).getTime() -
        new Date(readings[i - 1].timestamp).getTime()) /
        3600_000
    );
    if (hoursApart !== 1) continue;

    const delta = readings[i - 1].levelPct - readings[i].levelPct;
    if (delta > 0) drops.push(delta);
  }
  return drops;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Baseline drop rate, computed on history that excludes the recent window. */
export function baselineDropRate(readings: Reading[]): number {
  const historical = readings.slice(0, Math.max(2, readings.length - RECENT_WINDOW_HOURS));
  return median(hourlyDrops(historical));
}

export function analyzeTank(tank: Tank, sanitized: Reading[]): TankStatus {
  const readings = sanitized;
  const current = readings[readings.length - 1];
  const currentLevelPct = current.levelPct;
  const currentLiters = Math.round((currentLevelPct / 100) * tank.capacityLiters);

  const baseline = baselineDropRate(readings);

  const recentReadings = readings.slice(-RECENT_WINDOW_HOURS);
  const recentDrops = hourlyDrops(recentReadings);
  const hourlyDropRatePct = average(recentDrops);

  const leakDetected =
    baseline > 0 &&
    hourlyDropRatePct > baseline * LEAK_MULTIPLIER &&
    // Require a mostly-intact window: a refill or a data gap inside it makes
    // the average unreliable, and a false leak alert costs an ops team a truck.
    recentDrops.length >= RECENT_WINDOW_HOURS - 2;

  const estimatedHoursToEmpty =
    hourlyDropRatePct > 0.01 ? currentLevelPct / hourlyDropRatePct : null;

  let severity: TankStatus["severity"] = "ok";
  if (leakDetected) severity = "leak";
  else if (currentLevelPct <= LOW_LEVEL_THRESHOLD_PCT) severity = "low";

  return {
    tank,
    currentLevelPct,
    currentLiters,
    hourlyDropRatePct,
    estimatedHoursToEmpty,
    severity,
    leakDetected,
  };
}
