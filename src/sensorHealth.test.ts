import { describe, expect, it } from "vitest";
import { assessSensor, fleetNow, isOutOfRange, sanitizeReadings } from "./sensorHealth";
import type { Reading, Tank } from "./types";

const START = new Date("2026-01-01T00:00:00.000Z").getTime();

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

function tankOf(readings: Reading[]): Tank {
  return { id: "t", name: "Test", location: "Test", capacityLiters: 100_000, readings };
}

/** The fleet "now" for a clean N-hour series starting at START. */
function nowAfter(hours: number): string {
  return new Date(START + hours * 3600_000).toISOString();
}

describe("isOutOfRange / sanitizeReadings", () => {
  it("rejects levels outside 0-100%", () => {
    expect(isOutOfRange({ timestamp: "", levelPct: -0.1 })).toBe(true);
    expect(isOutOfRange({ timestamp: "", levelPct: 100.1 })).toBe(true);
    expect(isOutOfRange({ timestamp: "", levelPct: 0 })).toBe(false);
    expect(isOutOfRange({ timestamp: "", levelPct: 100 })).toBe(false);
  });

  it("drops impossible readings and keeps the rest", () => {
    const readings = series([50, 131.7, 49, -2.1, 48]);
    expect(sanitizeReadings(readings).map((r) => r.levelPct)).toEqual([50, 49, 48]);
  });
});

describe("assessSensor", () => {
  it("reports healthy for a complete, current, varying series", () => {
    const readings = series([60, 59.5, 59, 58.5, 58, 57.5]);
    const health = assessSensor(tankOf(readings), nowAfter(5));
    expect(health.status).toBe("healthy");
    expect(health.lastReadingAgeHours).toBe(0);
    expect(health.completenessPct).toBeCloseTo(100, 5);
    expect(health.notes).toEqual([]);
  });

  it("detects a communications gap and counts the missing hours", () => {
    const readings = series([60, 59, 58, 57], [2, 3, 4]);
    const health = assessSensor(tankOf(readings), nowAfter(6));
    expect(health.gaps).toHaveLength(1);
    expect(health.gaps[0].hours).toBe(3);
    expect(health.status).toBe("degraded");
  });

  it("detects a frozen sensor reporting the same value", () => {
    const readings = series([60, 59, 59, 59, 59, 59, 59, 59, 58]);
    const health = assessSensor(tankOf(readings), nowAfter(8));
    expect(health.stuckRuns).toHaveLength(1);
    expect(health.stuckRuns[0].hours).toBe(7);
    expect(health.stuckRuns[0].value).toBe(59);
    expect(health.status).toBe("degraded");
  });

  it("marks a sensor offline once it stops reporting", () => {
    const readings = series([60, 59, 58]);
    const health = assessSensor(tankOf(readings), nowAfter(12));
    expect(health.lastReadingAgeHours).toBe(10);
    expect(health.status).toBe("offline");
  });

  it("counts out-of-range readings without dropping the tank offline", () => {
    const readings = series([60, 131.7, 58, 57]);
    const health = assessSensor(tankOf(readings), nowAfter(3));
    expect(health.outOfRangeCount).toBe(1);
    expect(health.status).toBe("degraded");
  });
});

describe("fleetNow", () => {
  it("takes the most recent timestamp across all tanks", () => {
    const a = tankOf(series([50, 49, 48]));
    const b = tankOf(series([50, 49]));
    expect(fleetNow([b, a])).toBe(a.readings[2].timestamp);
  });
});
