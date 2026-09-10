import type { Tank, TankStatus } from "./types";

const RECENT_WINDOW_HOURS = 24;
// If the recent sustained drop rate is this many times the tank's own
// historical baseline, flag it as a possible leak. This is a simple,
// explainable rule on purpose — not a black box.
const LEAK_MULTIPLIER = 1.8;
const LOW_LEVEL_THRESHOLD_PCT = 25;

/** Hour-over-hour drops, ignoring refill events (level going up). */
function hourlyDrops(readings: Tank["readings"]): number[] {
  const drops: number[] = [];
  for (let i = 1; i < readings.length; i++) {
    const delta = readings[i - 1].levelPct - readings[i].levelPct;
    if (delta > 0) drops.push(delta);
  }
  return drops;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function analyzeTank(tank: Tank): TankStatus {
  const readings = tank.readings;
  const current = readings[readings.length - 1];
  const currentLevelPct = current.levelPct;
  const currentLiters = Math.round((currentLevelPct / 100) * tank.capacityLiters);

  const allDrops = hourlyDrops(readings);
  const baselineDropRate = median(allDrops);

  const recentReadings = readings.slice(-RECENT_WINDOW_HOURS);
  const recentDrops = hourlyDrops(recentReadings);
  const hourlyDropRatePct = average(recentDrops);

  const leakDetected =
    baselineDropRate > 0 &&
    hourlyDropRatePct > baselineDropRate * LEAK_MULTIPLIER &&
    recentDrops.length >= RECENT_WINDOW_HOURS - 2; // no refill interrupted the window

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
