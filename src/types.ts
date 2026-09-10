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
  hourlyDropRatePct: number; // avg drop over last WINDOW hours
  estimatedHoursToEmpty: number | null;
  severity: AlertSeverity;
  leakDetected: boolean;
}
