import type { Reading, SensorHealth, Tank, TankEvent } from "./types";
import { isOutOfRange } from "./sensorHealth";

const REFILL_MIN_JUMP_PCT = 5;
const LOW_THRESHOLD_PCT = 25;

function fmtLiters(liters: number): string {
  return `${Math.round(liters).toLocaleString("es-CR")} L`;
}

/**
 * Turns a level series into the discrete events an operations team acts on.
 * A chart shows what happened; a log tells you when, which is what gets
 * pasted into a ticket.
 */
export function deriveEvents(
  tank: Tank,
  sanitized: Reading[],
  health: SensorHealth
): TankEvent[] {
  const events: TankEvent[] = [];

  for (let i = 1; i < sanitized.length; i++) {
    const prev = sanitized[i - 1];
    const curr = sanitized[i];
    const delta = curr.levelPct - prev.levelPct;

    if (delta >= REFILL_MIN_JUMP_PCT) {
      events.push({
        timestamp: curr.timestamp,
        kind: "refill",
        tankId: tank.id,
        tankName: tank.name,
        message: `Recarga detectada: ${prev.levelPct.toFixed(1)}% → ${curr.levelPct.toFixed(
          1
        )}% (${fmtLiters((delta / 100) * tank.capacityLiters)})`,
        severity: "info",
      });
    }

    if (prev.levelPct > LOW_THRESHOLD_PCT && curr.levelPct <= LOW_THRESHOLD_PCT) {
      events.push({
        timestamp: curr.timestamp,
        kind: "low_threshold",
        tankId: tank.id,
        tankName: tank.name,
        message: `Nivel bajo: cruzó el umbral de ${LOW_THRESHOLD_PCT}% (${curr.levelPct.toFixed(
          1
        )}%)`,
        severity: "warning",
      });
    }
  }

  for (const gap of health.gaps) {
    events.push({
      timestamp: gap.start,
      kind: "sensor_gap",
      tankId: tank.id,
      tankName: tank.name,
      message: `Sin comunicación durante ${gap.hours} h`,
      severity: "warning",
    });
  }

  for (const run of health.stuckRuns) {
    events.push({
      timestamp: run.start,
      kind: "sensor_stuck",
      tankId: tank.id,
      tankName: tank.name,
      message: `Sensor trabado: ${run.hours} h reportando ${run.value.toFixed(1)}%`,
      severity: "warning",
    });
  }

  for (const reading of tank.readings.filter(isOutOfRange)) {
    events.push({
      timestamp: reading.timestamp,
      kind: "out_of_range",
      tankId: tank.id,
      tankName: tank.name,
      message: `Lectura fuera de rango descartada: ${reading.levelPct.toFixed(1)}%`,
      severity: "warning",
    });
  }

  return events;
}

export function addLeakEvent(
  events: TankEvent[],
  tank: Tank,
  timestamp: string,
  ratePct: number,
  baselinePct: number
): TankEvent[] {
  return [
    ...events,
    {
      timestamp,
      kind: "leak_suspected",
      tankId: tank.id,
      tankName: tank.name,
      message: `Posible fuga: consumo de ${ratePct.toFixed(
        2
      )}%/h sostenido, contra una línea base de ${baselinePct.toFixed(2)}%/h`,
      severity: "critical",
    },
  ];
}

export function sortEventsNewestFirst(events: TankEvent[]): TankEvent[] {
  return [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
