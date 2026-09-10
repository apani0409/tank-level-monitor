import { describe, expect, it } from "vitest";
import { analyzeTank, baselineDropRate, hourlyDrops, median } from "./analysis";
import { sanitizeReadings } from "./sensorHealth";
import type { Reading, Tank } from "./types";

const START = new Date("2026-01-01T00:00:00.000Z").getTime();

/** Builds an hourly series from a list of levels, starting at a fixed date. */
function series(levels: number[], skipHours: number[] = []): Reading[] {
  const readings: Reading[] = [];
  let hour = 0;
  for (const levelPct of levels) {
    while (skipHours.includes(hour)) hour++;
    readings.push({
      timestamp: new Date(START + hour * 3600_000).toISOString(),
      levelPct,
    });
    hour++;
  }
  return readings;
}

function tankOf(readings: Reading[], capacityLiters = 100_000): Tank {
  return {
    id: "t",
    name: "Test",
    location: "Test",
    capacityLiters,
    readings,
  };
}

/** Steady 1%/h decline over `hours`, starting at `from`. */
function steadyDecline(from: number, hours: number, ratePct: number): number[] {
  return Array.from({ length: hours }, (_, i) => from - i * ratePct);
}

describe("median", () => {
  it("returns 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });

  it("averages the middle pair for even-length input", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("hourlyDrops", () => {
  it("ignores refills (level going up)", () => {
    const readings = series([50, 49, 90, 89]);
    expect(hourlyDrops(readings)).toEqual([1, 1]);
  });

  it("ignores intervals broken by a data gap", () => {
    // Hour 2 is missing, so the 49 -> 40 step spans 2h and is not a
    // measured hourly drop.
    const readings = series([50, 49, 40, 39], [2]);
    expect(hourlyDrops(readings)).toEqual([1, 1]);
  });
});

describe("baselineDropRate", () => {
  it("excludes the recent window so a leak cannot inflate its own baseline", () => {
    // 100h of calm 0.5%/h, then 24h of 2%/h. If the recent window leaked into
    // the baseline, the median would drift upward.
    const calm = steadyDecline(100, 100, 0.5);
    const leaking = steadyDecline(calm[calm.length - 1], 25, 2).slice(1);
    const readings = series([...calm, ...leaking]);
    expect(baselineDropRate(readings)).toBeCloseTo(0.5, 5);
  });
});

describe("analyzeTank", () => {
  it("stays quiet when consumption matches the baseline", () => {
    const readings = series(steadyDecline(100, 130, 0.5));
    const status = analyzeTank(tankOf(readings), readings);
    expect(status.leakDetected).toBe(false);
    expect(status.severity).toBe("ok");
  });

  it("flags a leak when recent consumption far exceeds the baseline", () => {
    const calm = steadyDecline(100, 100, 0.4);
    const leaking = steadyDecline(calm[calm.length - 1], 25, 1.5).slice(1);
    const readings = series([...calm, ...leaking]);
    const status = analyzeTank(tankOf(readings), readings);
    expect(status.leakDetected).toBe(true);
    expect(status.severity).toBe("leak");
  });

  it("does not flag a leak when a refill interrupts the recent window", () => {
    // A refill mid-window leaves too few measured drops to trust the average.
    const calm = steadyDecline(100, 100, 0.4);
    const readings = series([...calm, 95, 94.6, 94.2, 93.8]);
    const status = analyzeTank(tankOf(readings), readings);
    expect(status.leakDetected).toBe(false);
  });

  it("reports low severity below the threshold without a leak", () => {
    const readings = series(steadyDecline(30, 40, 0.2));
    const status = analyzeTank(tankOf(readings), readings);
    expect(status.currentLevelPct).toBeLessThan(25);
    expect(status.leakDetected).toBe(false);
    expect(status.severity).toBe("low");
  });

  it("returns null time-to-empty when nothing is being consumed", () => {
    const readings = series(Array.from({ length: 40 }, () => 60));
    const status = analyzeTank(tankOf(readings), readings);
    expect(status.estimatedHoursToEmpty).toBeNull();
  });

  it("is not fooled by an out-of-range glitch once sanitized", () => {
    const levels = steadyDecline(100, 130, 0.5);
    levels[120] = 131.7; // impossible spike
    const readings = series(levels);
    const status = analyzeTank(tankOf(readings), sanitizeReadings(readings));
    expect(status.leakDetected).toBe(false);
  });
});
