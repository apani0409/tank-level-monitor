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
  // higher draw 6am-9pm (household/industrial use), near-zero overnight
  if (hour >= 6 && hour <= 21) return 0.55;
  return 0.12;
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
      // Leak injected 18h before the end of the simulation: recent enough
      // that it shows up in the "last 24h" window without having had time
      // to contaminate the tank's own long-run baseline drop rate.
      leakStartHour: 30 * 24 - 18,
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

await Bun.write(
  "public/tanks.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), tanks }, null, 2)
);

console.log(`Generated ${tanks.length} tanks, ${tanks[0].readings.length} readings each.`);
