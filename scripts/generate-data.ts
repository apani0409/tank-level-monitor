// Generates synthetic ultrasonic tank-sensor readings for the demo.
// Honest by design: this is NOT real sensor data. It simulates the exact
// pattern Element System's real products measure (tank level via ultrasonic
// sensor), so the dashboard and leak-detection logic have something
// realistic to work with.

interface Reading {
  timestamp: string; // ISO
  levelPct: number; // 0-100
}

interface Tank {
  id: string;
  name: string;
  location: string;
  capacityLiters: number;
  readings: Reading[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Simulates one tank over `days` days of hourly readings.
// - baseline daily consumption curve (more draw during daytime hours)
// - small sensor noise
// - periodic refills when level crosses a low threshold
// - optional injected leak: an extra constant drain rate starting at `leakStartHour`
function simulateTank(opts: {
  days: number;
  startLevel: number;
  hourlyConsumption: (hour: number) => number; // % per hour, daytime-weighted
  refillThresholdPct: number;
  refillToPct: number;
  leakStartHour?: number;
  leakRatePctPerHour?: number;
  seed: number;
}): Reading[] {
  const readings: Reading[] = [];
  let level = opts.startLevel;
  let rngState = opts.seed;
  const rng = () => {
    // simple deterministic PRNG (mulberry32) so the demo is reproducible
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const totalHours = opts.days * 24;
  const start = new Date("2026-08-10T00:00:00Z");

  for (let h = 0; h < totalHours; h++) {
    const ts = new Date(start.getTime() + h * 3600_000);
    const hourOfDay = ts.getUTCHours();

    const consumption = opts.hourlyConsumption(hourOfDay);
    const noise = (rng() - 0.5) * 0.4;
    let drop = consumption + noise;

    if (
      opts.leakStartHour !== undefined &&
      h >= opts.leakStartHour &&
      opts.leakRatePctPerHour
    ) {
      drop += opts.leakRatePctPerHour;
    }

    level -= drop;

    if (level <= opts.refillThresholdPct) {
      level = opts.refillToPct;
    }

    level = Math.max(0, Math.min(100, level));
    readings.push({ timestamp: ts.toISOString(), levelPct: round1(level) });
  }

  return readings;
}

const daytimeConsumption = (hour: number) => {
  // Higher draw 6am-9pm (household/industrial use). Overnight demand is set
  // deliberately close to zero, which is how a healthy distribution network
  // actually behaves — that is the entire premise of minimum-night-flow
  // analysis, and an unrealistically busy night would make the metric
  // flag healthy tanks.
  if (hour >= 6 && hour <= 21) return 0.55;
  return 0.04;
};

const tanks: Tank[] = [
  {
    id: "tank-01",
    name: "Tanque Norte",
    location: "Acueducto Norte, Guanacaste",
    capacityLiters: 50000,
    readings: simulateTank({
      days: 30,
      startLevel: 92,
      hourlyConsumption: daytimeConsumption,
      refillThresholdPct: 25,
      refillToPct: 95,
      seed: 1,
    }),
  },
  {
    id: "tank-02",
    name: "Tanque Industrial A",
    location: "Zona Franca, Heredia",
    capacityLiters: 120000,
    readings: simulateTank({
      days: 30,
      startLevel: 88,
      hourlyConsumption: (h) => daytimeConsumption(h) * 1.6,
      refillThresholdPct: 20,
      refillToPct: 90,
      // Leak injected 40h before the end of the simulation. Recent enough
      // that it has not contaminated the tank's long-run baseline, but long
      // enough to span a couple of overnight windows — otherwise the leak
      // would be invisible to minimum-night-flow analysis purely by accident
      // of when it started.
      leakStartHour: 30 * 24 - 40,
      leakRatePctPerHour: 1.1,
      seed: 2,
    }),
  },
  {
    id: "tank-03",
    name: "Tanque Comunal Sur",
    location: "Nandayure, Guanacaste",
    capacityLiters: 30000,
    readings: simulateTank({
      days: 30,
      startLevel: 95,
      hourlyConsumption: (h) => daytimeConsumption(h) * 0.8,
      refillThresholdPct: 30,
      refillToPct: 98,
      // Slow seepage starting 12 days out. Deliberately too gradual for the
      // 24h rate rule to ever fire — it barely moves the daily average — but
      // it roughly triples overnight flow, which is exactly the loss that
      // minimum-night-flow analysis exists to catch. The two detectors cover
      // different failure regimes: bursts vs. persistent seepage.
      leakStartHour: 30 * 24 - 12 * 24,
      leakRatePctPerHour: 0.1,
      seed: 3,
    }),
  },
  {
    id: "tank-04",
    name: "Tanque Reserva",
    location: "Planta Central, San José",
    capacityLiters: 80000,
    readings: simulateTank({
      days: 30,
      startLevel: 70,
      hourlyConsumption: (h) => daytimeConsumption(h) * 0.4,
      refillThresholdPct: 15,
      refillToPct: 85,
      seed: 4,
    }),
  },
];

// ---------------------------------------------------------------------------
// Sensor faults
//
// Real field sensors fail in specific, recognizable ways. Each fault below is
// injected into a different tank so the sensor-health layer has genuine
// material to detect, and so the leak tank (tank-02) stays sensor-clean —
// otherwise a data-quality problem and a real leak would be confounded.
// ---------------------------------------------------------------------------

/** Frozen sensor: keeps reporting, but the same value over and over. */
function injectStuckRun(readings: Reading[], startHour: number, hours: number): Reading[] {
  const frozenValue = readings[startHour].levelPct;
  return readings.map((r, i) =>
    i >= startHour && i < startHour + hours ? { ...r, levelPct: frozenValue } : r
  );
}

/** Comms dropout: readings simply never arrive for a stretch, then resume. */
function injectGap(readings: Reading[], startHour: number, hours: number): Reading[] {
  return readings.filter((_, i) => i < startHour || i >= startHour + hours);
}

/** Glitch: physically impossible values (below empty / above full). */
function injectOutOfRange(readings: Reading[], hours: number[]): Reading[] {
  const bad = [118.4, -2.1, 131.7];
  return readings.map((r, i) => {
    const idx = hours.indexOf(i);
    return idx === -1 ? r : { ...r, levelPct: bad[idx % bad.length] };
  });
}

/** Sensor goes silent and never comes back within the window. */
function injectSilentTail(readings: Reading[], hours: number): Reading[] {
  return readings.slice(0, readings.length - hours);
}

// tank-01: frozen sensor for 10h on day ~12
tanks[0].readings = injectStuckRun(tanks[0].readings, 12 * 24 + 3, 10);

// tank-03: 14h comms dropout on day ~22, then recovers
tanks[2].readings = injectGap(tanks[2].readings, 22 * 24 + 6, 14);

// tank-04: three impossible readings, then goes silent for the last 9h
tanks[3].readings = injectOutOfRange(tanks[3].readings, [9 * 24 + 2, 17 * 24 + 15, 25 * 24 + 8]);
tanks[3].readings = injectSilentTail(tanks[3].readings, 9);

await Bun.write(
  "public/tanks.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), tanks }, null, 2)
);

console.log(`Generated ${tanks.length} tanks, ${tanks[0].readings.length} readings each.`);
