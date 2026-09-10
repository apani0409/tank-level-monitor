/**
 * Regression tests over the actual generated dataset.
 *
 * The unit tests elsewhere prove the rules behave correctly on hand-built
 * fixtures. These prove the shipped demo genuinely shows what the README
 * claims it shows — that the leak fires on exactly one tank, and that each
 * injected sensor fault is actually detected.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeTank } from "./analysis";
import { analyzeConsumption } from "./consumption";
import { assessSensor, fleetNow, sanitizeReadings } from "./sensorHealth";
import type { TanksData } from "./types";

const data: TanksData = JSON.parse(
  readFileSync(new URL("../public/tanks.json", import.meta.url), "utf-8")
);

const byId = Object.fromEntries(data.tanks.map((t) => [t.id, t]));
const now = fleetNow(data.tanks);

describe("generated dataset", () => {
  it("has four tanks with 30 days of hourly readings", () => {
    expect(data.tanks).toHaveLength(4);
    for (const tank of data.tanks) {
      expect(tank.readings.length).toBeGreaterThan(700);
    }
  });
});

describe("leak detection on the shipped data", () => {
  it("fires on the industrial tank, which has the injected leak", () => {
    const tank = byId["tank-02"];
    const status = analyzeTank(tank, sanitizeReadings(tank.readings));
    expect(status.leakDetected).toBe(true);
  });

  it("stays quiet on the other three tanks", () => {
    for (const id of ["tank-01", "tank-03", "tank-04"]) {
      const tank = byId[id];
      const status = analyzeTank(tank, sanitizeReadings(tank.readings));
      expect(status.leakDetected, `${id} should not report a leak`).toBe(false);
    }
  });
});

describe("sensor faults on the shipped data", () => {
  it("finds the frozen sensor on tank-01", () => {
    const health = assessSensor(byId["tank-01"], now);
    expect(health.stuckRuns.length).toBeGreaterThan(0);
    expect(health.status).toBe("degraded");
  });

  it("leaves the leak tank sensor-clean, so the two concerns stay separable", () => {
    const health = assessSensor(byId["tank-02"], now);
    expect(health.status).toBe("healthy");
  });

  it("finds the communications dropout on tank-03", () => {
    const health = assessSensor(byId["tank-03"], now);
    expect(health.gaps).toHaveLength(1);
    expect(health.gaps[0].hours).toBe(14);
  });

  it("finds the glitches and the silence on tank-04", () => {
    const health = assessSensor(byId["tank-04"], now);
    expect(health.outOfRangeCount).toBe(3);
    expect(health.lastReadingAgeHours).toBe(9);
    expect(health.status).toBe("offline");
  });
});

describe("consumption analytics on the shipped data", () => {
  it("puts every tank's peak draw inside daytime hours", () => {
    for (const tank of data.tanks) {
      const summary = analyzeConsumption(tank, sanitizeReadings(tank.readings));
      expect(summary.peakHour, `${tank.id} peak hour`).toBeGreaterThanOrEqual(6);
      expect(summary.peakHour, `${tank.id} peak hour`).toBeLessThanOrEqual(21);
    }
  });

  it("keeps minimum night flow normal on the two genuinely healthy tanks", () => {
    for (const id of ["tank-01", "tank-04"]) {
      const summary = analyzeConsumption(byId[id], sanitizeReadings(byId[id].readings));
      expect(summary.mnf.verdict, `${id} MNF verdict`).toBe("normal");
    }
  });

  /**
   * The two detectors are meant to cover different failure regimes, and the
   * dataset is built to prove it: a burst the rate rule catches, and a slow
   * seepage only night-flow analysis catches. If either detector ever covered
   * both cases, one of them would be redundant.
   */
  it("catches the burst with the rate rule, while night flow has not yet caught up", () => {
    const tank = byId["tank-02"];
    const readings = sanitizeReadings(tank.readings);
    expect(analyzeTank(tank, readings).leakDetected).toBe(true);
    expect(analyzeConsumption(tank, readings).mnf.verdict).toBe("normal");
  });

  it("catches the slow seepage with night flow, which the rate rule misses", () => {
    const tank = byId["tank-03"];
    const readings = sanitizeReadings(tank.readings);
    expect(analyzeTank(tank, readings).leakDetected).toBe(false);
    expect(analyzeConsumption(tank, readings).mnf.verdict).not.toBe("normal");
  });

  it("accounts for consumption in liters bounded by what the tank can hold", () => {
    for (const tank of data.tanks) {
      const summary = analyzeConsumption(tank, sanitizeReadings(tank.readings));
      expect(summary.totalLitersConsumed).toBeGreaterThan(0);
      expect(summary.avgLitersPerDay).toBeLessThan(tank.capacityLiters * 2);
    }
  });
});
