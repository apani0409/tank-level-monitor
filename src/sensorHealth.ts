import type { Reading, SensorGap, SensorHealth, StuckRun, Tank } from "./types";

const HOUR_MS = 3600_000;
const STALE_AFTER_HOURS = 3;
const OFFLINE_AFTER_HOURS = 6;
const STUCK_MIN_HOURS = 6;

/** Physically impossible for a tank level: outside 0-100 % of capacity. */
export function isOutOfRange(reading: Reading): boolean {
  return reading.levelPct < 0 || reading.levelPct > 100;
}

/**
 * Drops readings a sensor could not physically have produced.
 * Every downstream calculation runs on sanitized data — a glitch should not
 * be able to fake a leak or hide one.
 */
export function sanitizeReadings(readings: Reading[]): Reading[] {
  return readings.filter((r) => !isOutOfRange(r));
}

function findGaps(readings: Reading[]): SensorGap[] {
  const gaps: SensorGap[] = [];
  for (let i = 1; i < readings.length; i++) {
    const prev = new Date(readings[i - 1].timestamp).getTime();
    const curr = new Date(readings[i].timestamp).getTime();
    const missing = Math.round((curr - prev) / HOUR_MS) - 1;
    if (missing > 0) {
      gaps.push({
        start: readings[i - 1].timestamp,
        end: readings[i].timestamp,
        hours: missing,
      });
    }
  }
  return gaps;
}

function findStuckRuns(readings: Reading[]): StuckRun[] {
  const runs: StuckRun[] = [];
  let runStart = 0;
  for (let i = 1; i <= readings.length; i++) {
    const same = i < readings.length && readings[i].levelPct === readings[runStart].levelPct;
    if (!same) {
      const length = i - runStart;
      if (length >= STUCK_MIN_HOURS) {
        runs.push({
          start: readings[runStart].timestamp,
          end: readings[i - 1].timestamp,
          hours: length,
          value: readings[runStart].levelPct,
        });
      }
      runStart = i;
    }
  }
  return runs;
}

/**
 * `now` is the most recent timestamp across the whole fleet, not wall-clock
 * time. The dataset is a fixed snapshot, so anchoring to the fleet keeps
 * staleness meaningful ("this sensor is behind the others") instead of every
 * tank drifting to "offline" as the demo ages.
 */
export function assessSensor(tank: Tank, fleetNowISO: string): SensorHealth {
  const readings = tank.readings;
  const lastReading = readings[readings.length - 1];
  const lastReadingAgeHours = Math.round(
    (new Date(fleetNowISO).getTime() - new Date(lastReading.timestamp).getTime()) / HOUR_MS
  );

  const firstTs = new Date(readings[0].timestamp).getTime();
  const expectedReadings =
    Math.round((new Date(fleetNowISO).getTime() - firstTs) / HOUR_MS) + 1;
  const receivedReadings = readings.length;
  const completenessPct = (receivedReadings / expectedReadings) * 100;

  const gaps = findGaps(readings);
  const stuckRuns = findStuckRuns(readings);
  const outOfRangeCount = readings.filter(isOutOfRange).length;

  const notes: string[] = [];
  if (lastReadingAgeHours >= STALE_AFTER_HOURS) {
    notes.push(`Sin reportar hace ${lastReadingAgeHours} h`);
  }
  if (gaps.length > 0) {
    const total = gaps.reduce((a, g) => a + g.hours, 0);
    notes.push(`${gaps.length} interrupción(es) de comunicación, ${total} h sin datos`);
  }
  if (stuckRuns.length > 0) {
    const longest = Math.max(...stuckRuns.map((r) => r.hours));
    notes.push(`Lectura congelada hasta ${longest} h seguidas (sensor trabado)`);
  }
  if (outOfRangeCount > 0) {
    notes.push(`${outOfRangeCount} lectura(s) fuera de rango físico, descartadas`);
  }

  let status: SensorHealth["status"] = "healthy";
  if (lastReadingAgeHours >= OFFLINE_AFTER_HOURS) status = "offline";
  else if (notes.length > 0) status = "degraded";

  return {
    status,
    lastReadingAt: lastReading.timestamp,
    lastReadingAgeHours,
    expectedReadings,
    receivedReadings,
    completenessPct,
    gaps,
    outOfRangeCount,
    stuckRuns,
    notes,
  };
}

/** Most recent timestamp across all tanks — the fleet's "now". */
export function fleetNow(tanks: Tank[]): string {
  return tanks
    .map((t) => t.readings[t.readings.length - 1].timestamp)
    .reduce((a, b) => (a > b ? a : b));
}
