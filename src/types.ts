export interface Reading {
  timestamp: string;
  levelPct: number;
}

export interface Tank {
  id: string;
  name: string;
  location: string;
  capacityLiters: number;
  readings: Reading[];
}

export interface TanksData {
  generatedAt: string;
  tanks: Tank[];
}

export type AlertSeverity = "ok" | "low" | "leak";

export interface TankStatus {
  tank: Tank;
  currentLevelPct: number;
  currentLiters: number;
  hourlyDropRatePct: number;
  estimatedHoursToEmpty: number | null;
  severity: AlertSeverity;
  leakDetected: boolean;
}

// --- Sensor health -------------------------------------------------------

export type SensorStatus = "healthy" | "degraded" | "offline";

export interface SensorGap {
  start: string;
  end: string;
  hours: number;
}

export interface StuckRun {
  start: string;
  end: string;
  hours: number;
  value: number;
}

export interface SensorHealth {
  status: SensorStatus;
  lastReadingAt: string;
  lastReadingAgeHours: number;
  expectedReadings: number;
  receivedReadings: number;
  completenessPct: number;
  gaps: SensorGap[];
  outOfRangeCount: number;
  stuckRuns: StuckRun[];
  notes: string[];
}

// --- Consumption analytics ----------------------------------------------

export interface HourProfilePoint {
  hour: number;
  avgLitersPerHour: number;
  samples: number;
}

export interface WeekdayProfilePoint {
  weekday: number;
  label: string;
  avgLitersPerDay: number;
}

export type MnfVerdict = "normal" | "elevated" | "high";

/**
 * Minimum night flow: the standard technique water utilities use to spot
 * leakage. Between roughly 02:00 and 04:00 legitimate demand is near zero,
 * so whatever is still flowing is mostly loss.
 */
export interface MinimumNightFlow {
  litersPerHour: number;
  pctOfDailyAverage: number;
  verdict: MnfVerdict;
  windowLabel: string;
}

export interface WeekPoint {
  label: string;
  liters: number;
}

export interface ExpectedVsActualPoint {
  timestamp: string;
  expectedLiters: number;
  actualLiters: number;
}

export interface ConsumptionSummary {
  totalLitersConsumed: number;
  avgLitersPerDay: number;
  avgLitersPerHour: number;
  hourProfile: HourProfilePoint[];
  weekdayProfile: WeekdayProfilePoint[];
  mnf: MinimumNightFlow;
  weekOverWeek: WeekPoint[];
  expectedVsActual: ExpectedVsActualPoint[];
  peakHour: number;
}

// --- Events --------------------------------------------------------------

export type EventKind =
  | "refill"
  | "low_threshold"
  | "leak_suspected"
  | "sensor_gap"
  | "sensor_stuck"
  | "out_of_range";

export interface TankEvent {
  timestamp: string;
  kind: EventKind;
  tankId: string;
  tankName: string;
  message: string;
  severity: "info" | "warning" | "critical";
}
