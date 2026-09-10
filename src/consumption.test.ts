import { describe, expect, it } from "vitest";
import { analyzeConsumption, hourlyConsumption } from "./consumption";
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

const tank: Tank = {
  id: "t",
  name: "Test",
  location: "Test",
  capacityLiters: 100_000,
  readings: [],
};

describe("hourlyConsumption", () => {
  it("converts a percentage drop into liters of capacity", () => {
    const readings = series([100, 99]); // 1% of 100,000 L
    expect(hourlyConsumption(tank, readings)[0].liters).toBeCloseTo(1000, 5);
  });

  it("excludes refills", () => {
    const readings = series([50, 49, 90]);
    expect(hourlyConsumption(tank, readings)).toHaveLength(1);
  });

  it("excludes intervals spanning a data gap rather than inventing a curve", () => {
    const readings = series([50, 49, 40], [2]);
    const consumption = hourlyConsumption(tank, readings);
    expect(consumption).toHaveLength(1);
    expect(consumption[0].liters).toBeCloseTo(1000, 5);
  });
});

describe("analyzeConsumption", () => {
  /**
   * `days` days of hourly readings starting at midnight, where `draw(hour)`
   * is the drop attributed *to* that hour. Consumption is attributed to the
   * later reading of each pair, so the drop for hour H lands on hour H.
   */
  function dailyPattern(days: number, draw: (hour: number) => number): Reading[] {
    const levels: number[] = [100];
    for (let h = 1; h < days * 24; h++) {
      levels.push(levels[levels.length - 1] - draw(h % 24));
    }
    return series(levels);
  }

  /** Realistic shape: busy daytime, near-zero overnight. */
  const diurnal = (hour: number) => (hour === 8 ? 2 : hour >= 6 && hour <= 21 ? 0.5 : 0.02);

  it("identifies the peak consumption hour", () => {
    const summary = analyzeConsumption(tank, dailyPattern(5, diurnal));
    expect(summary.peakHour).toBe(8);
  });

  it("builds a 24-point hour profile reflecting the daily shape", () => {
    const summary = analyzeConsumption(tank, dailyPattern(3, diurnal));
    expect(summary.hourProfile).toHaveLength(24);
    expect(summary.hourProfile[8].avgLitersPerHour).toBeGreaterThan(
      summary.hourProfile[3].avgLitersPerHour
    );
  });

  it("reports a normal MNF verdict when nights are genuinely quiet", () => {
    const summary = analyzeConsumption(tank, dailyPattern(5, diurnal));
    expect(summary.mnf.verdict).toBe("normal");
    expect(summary.mnf.pctOfDailyAverage).toBeLessThan(25);
  });

  it("escalates the MNF verdict when night flow rises toward daytime levels", () => {
    // Same daytime demand, but the network now leaks all night.
    const leaky = (hour: number) =>
      hour === 8 ? 2 : hour >= 6 && hour <= 21 ? 0.5 : 0.45;
    const summary = analyzeConsumption(tank, dailyPattern(5, leaky));
    expect(summary.mnf.pctOfDailyAverage).toBeGreaterThan(25);
    expect(["elevated", "high"]).toContain(summary.mnf.verdict);
  });

  it("reports a high MNF verdict when flow never drops at night", () => {
    // Perfectly flat consumption: in a real network, demand that never
    // subsides overnight is loss, not use.
    const flat = series(Array.from({ length: 24 * 5 }, (_, i) => 100 - i * 0.5));
    const summary = analyzeConsumption(tank, flat);
    expect(summary.mnf.pctOfDailyAverage).toBeCloseTo(100, 0);
    expect(summary.mnf.verdict).toBe("high");
  });

  it("averages weekdays by calendar day, not by hour count", () => {
    // 2026-01-01 is a Thursday (weekday 4). Give Mondays double demand and
    // check that survives the averaging.
    const heavyMondays = (readings: Reading[]) => readings;
    const levels: number[] = [100];
    for (let h = 1; h < 21 * 24; h++) {
      const date = new Date(START + h * 3600_000);
      const isMonday = date.getUTCDay() === 1;
      levels.push(levels[levels.length - 1] - (isMonday ? 0.4 : 0.2));
    }
    const summary = analyzeConsumption(tank, heavyMondays(series(levels)));

    expect(summary.weekdayProfile).toHaveLength(7);
    const monday = summary.weekdayProfile[1].avgLitersPerDay;
    const wednesday = summary.weekdayProfile[3].avgLitersPerDay;
    expect(monday / wednesday).toBeCloseTo(2, 1);
  });

  it("buckets consumption into weeks", () => {
    const summary = analyzeConsumption(tank, dailyPattern(14, diurnal));
    expect(summary.weekOverWeek.length).toBeGreaterThanOrEqual(2);
    expect(summary.weekOverWeek[0].label).toBe("Semana 1");
  });

  it("compares recent actuals against the tank's own hourly expectation", () => {
    const summary = analyzeConsumption(tank, dailyPattern(5, diurnal));
    expect(summary.expectedVsActual.length).toBeGreaterThan(0);
    for (const point of summary.expectedVsActual) {
      expect(point.expectedLiters).toBeGreaterThanOrEqual(0);
    }
  });
});
