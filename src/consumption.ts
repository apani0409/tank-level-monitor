import type {
  ConsumptionSummary,
  ExpectedVsActualPoint,
  HourProfilePoint,
  MinimumNightFlow,
  Reading,
  Tank,
  WeekPoint,
  WeekdayProfilePoint,
} from "./types";

const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Minimum night flow window. Legitimate demand between 02:00 and 04:00 is
// close to zero, so most of what still moves in that window is loss.
const NIGHT_START_HOUR = 2;
const NIGHT_END_HOUR = 4;

const MNF_ELEVATED_PCT = 25;
const MNF_HIGH_PCT = 45;
const MNF_WINDOW_NIGHTS = 7;

const EXPECTED_VS_ACTUAL_HOURS = 72;

interface HourlyConsumption {
  timestamp: string;
  hour: number;
  weekday: number;
  liters: number;
}

/**
 * Hour-over-hour consumption in liters.
 *
 * Two things are deliberately excluded:
 *  - refills (level going up) — that is water arriving, not being used
 *  - hours on either side of a data gap — we cannot attribute consumption to
 *    an hour we never observed, and dividing a multi-hour drop across a gap
 *    would invent a consumption curve that was never measured.
 */
export function hourlyConsumption(tank: Tank, readings: Reading[]): HourlyConsumption[] {
  const out: HourlyConsumption[] = [];
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const curr = readings[i];

    const hoursApart = Math.round(
      (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 3600_000
    );
    if (hoursApart !== 1) continue;

    const dropPct = prev.levelPct - curr.levelPct;
    if (dropPct <= 0) continue;

    const date = new Date(curr.timestamp);
    out.push({
      timestamp: curr.timestamp,
      hour: date.getUTCHours(),
      weekday: date.getUTCDay(),
      liters: (dropPct / 100) * tank.capacityLiters,
    });
  }
  return out;
}

function averageBy<T>(items: T[], key: (t: T) => number, value: (t: T) => number) {
  const sums = new Map<number, { total: number; count: number }>();
  for (const item of items) {
    const k = key(item);
    const entry = sums.get(k) ?? { total: 0, count: 0 };
    entry.total += value(item);
    entry.count += 1;
    sums.set(k, entry);
  }
  return sums;
}

function buildHourProfile(consumption: HourlyConsumption[]): HourProfilePoint[] {
  const sums = averageBy(consumption, (c) => c.hour, (c) => c.liters);
  const profile: HourProfilePoint[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const entry = sums.get(hour);
    profile.push({
      hour,
      avgLitersPerHour: entry ? entry.total / entry.count : 0,
      samples: entry?.count ?? 0,
    });
  }
  return profile;
}

function buildWeekdayProfile(consumption: HourlyConsumption[]): WeekdayProfilePoint[] {
  // Total liters per calendar day, then averaged by weekday, so a weekday
  // that appears 5 times in the window is not counted 5x heavier.
  const perDay = new Map<string, { weekday: number; liters: number }>();
  for (const c of consumption) {
    const day = c.timestamp.slice(0, 10);
    const entry = perDay.get(day) ?? { weekday: c.weekday, liters: 0 };
    entry.liters += c.liters;
    perDay.set(day, entry);
  }

  const sums = averageBy([...perDay.values()], (d) => d.weekday, (d) => d.liters);
  const profile: WeekdayProfilePoint[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const entry = sums.get(weekday);
    profile.push({
      weekday,
      label: WEEKDAY_LABELS[weekday],
      avgLitersPerDay: entry ? entry.total / entry.count : 0,
    });
  }
  return profile;
}

function computeMnf(
  tank: Tank,
  readings: Reading[],
  consumption: HourlyConsumption[]
): MinimumNightFlow {
  // Measured as the *net* level change across the night window, not as a sum
  // of hourly drops.
  //
  // This matters more than it looks. Overnight demand is near zero, so it
  // sits below the sensor's own noise. Summing hour-to-hour decreases counts
  // every upward noise blip as "no flow" while counting every downward blip
  // as consumption, which biases night flow upward and would flag healthy
  // tanks as leaking. Taking the endpoints of the window lets symmetric noise
  // cancel — and it is also how utilities actually measure it: the volume
  // that disappeared between 02:00 and 04:00.
  const byDate = new Map<string, Map<number, Reading>>();
  for (const reading of readings) {
    const date = reading.timestamp.slice(0, 10);
    const hour = new Date(reading.timestamp).getUTCHours();
    if (hour !== NIGHT_START_HOUR && hour !== NIGHT_END_HOUR) continue;
    if (!byDate.has(date)) byDate.set(date, new Map());
    byDate.get(date)!.set(hour, reading);
  }

  const windowHours = NIGHT_END_HOUR - NIGHT_START_HOUR;
  const nightlyRates: number[] = [];
  for (const hours of [...byDate.values()]) {
    const start = hours.get(NIGHT_START_HOUR);
    const end = hours.get(NIGHT_END_HOUR);
    if (!start || !end) continue; // night interrupted by a data gap

    const netDropPct = start.levelPct - end.levelPct;
    if (netDropPct < 0) continue; // refilled overnight; not a demand measurement

    nightlyRates.push((netDropPct / 100) * tank.capacityLiters / windowHours);
  }

  // MNF is a monitoring metric, not a historical summary: what matters is
  // what night flow looks like *lately*. Averaging over the full record would
  // dilute a leak that started last week into thirty days of healthy nights.
  const recentNights = nightlyRates.slice(-MNF_WINDOW_NIGHTS);
  const litersPerHour =
    recentNights.length > 0
      ? recentNights.reduce((a, r) => a + r, 0) / recentNights.length
      : 0;

  const recentConsumption = consumption.slice(-MNF_WINDOW_NIGHTS * 24);
  const avgLitersPerHour =
    recentConsumption.length > 0
      ? recentConsumption.reduce((a, c) => a + c.liters, 0) / recentConsumption.length
      : 0;

  const pctOfDailyAverage =
    avgLitersPerHour > 0 ? (litersPerHour / avgLitersPerHour) * 100 : 0;

  let verdict: MinimumNightFlow["verdict"] = "normal";
  if (pctOfDailyAverage >= MNF_HIGH_PCT) verdict = "high";
  else if (pctOfDailyAverage >= MNF_ELEVATED_PCT) verdict = "elevated";

  return {
    litersPerHour,
    pctOfDailyAverage,
    verdict,
    windowLabel: `${String(NIGHT_START_HOUR).padStart(2, "0")}:00–${String(
      NIGHT_END_HOUR
    ).padStart(2, "0")}:00`,
  };
}

function buildWeekOverWeek(consumption: HourlyConsumption[]): WeekPoint[] {
  if (consumption.length === 0) return [];
  const start = new Date(consumption[0].timestamp).getTime();
  const buckets = new Map<number, number>();
  for (const c of consumption) {
    const weekIndex = Math.floor(
      (new Date(c.timestamp).getTime() - start) / (7 * 24 * 3600_000)
    );
    buckets.set(weekIndex, (buckets.get(weekIndex) ?? 0) + c.liters);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, liters]) => ({ label: `Semana ${index + 1}`, liters }));
}

/**
 * Compares the most recent hours against what this tank's own historical
 * hour-of-day profile predicts. A leak shows up here as actual consistently
 * riding above expected — which is what makes the leak alert legible instead
 * of just a number crossing a threshold.
 */
function buildExpectedVsActual(
  consumption: HourlyConsumption[],
  hourProfile: HourProfilePoint[]
): ExpectedVsActualPoint[] {
  return consumption.slice(-EXPECTED_VS_ACTUAL_HOURS).map((c) => ({
    timestamp: c.timestamp,
    expectedLiters: hourProfile[c.hour].avgLitersPerHour,
    actualLiters: c.liters,
  }));
}

export function analyzeConsumption(tank: Tank, readings: Reading[]): ConsumptionSummary {
  const consumption = hourlyConsumption(tank, readings);

  const totalLitersConsumed = consumption.reduce((a, c) => a + c.liters, 0);
  const avgLitersPerHour =
    consumption.length > 0 ? totalLitersConsumed / consumption.length : 0;

  const distinctDays = new Set(consumption.map((c) => c.timestamp.slice(0, 10))).size;
  const avgLitersPerDay = distinctDays > 0 ? totalLitersConsumed / distinctDays : 0;

  const hourProfile = buildHourProfile(consumption);
  const peakHour = hourProfile.reduce(
    (best, p) => (p.avgLitersPerHour > hourProfile[best].avgLitersPerHour ? p.hour : best),
    0
  );

  return {
    totalLitersConsumed,
    avgLitersPerDay,
    avgLitersPerHour,
    hourProfile,
    weekdayProfile: buildWeekdayProfile(consumption),
    mnf: computeMnf(tank, readings, consumption),
    weekOverWeek: buildWeekOverWeek(consumption),
    expectedVsActual: buildExpectedVsActual(consumption, hourProfile),
    peakHour,
  };
}
