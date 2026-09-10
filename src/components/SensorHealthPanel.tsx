import type { SensorHealth } from "../types";

const STATUS_LABEL: Record<string, string> = {
  healthy: "Sensor OK",
  degraded: "Sensor degradado",
  offline: "Sensor sin reportar",
};

export function SensorHealthPanel({ health }: { health: SensorHealth }) {
  return (
    <div className={`sensor-panel sensor-${health.status}`}>
      <div className="sensor-header">
        <strong>{STATUS_LABEL[health.status]}</strong>
        <span className="sensor-meta">
          Última lectura hace {health.lastReadingAgeHours} h · {" "}
          {health.completenessPct.toFixed(1)}% de cobertura ({health.receivedReadings} de{" "}
          {health.expectedReadings} lecturas esperadas)
        </span>
      </div>
      {health.notes.length > 0 && (
        <ul className="sensor-notes">
          {health.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
