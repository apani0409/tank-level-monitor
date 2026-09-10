import { useState } from "react";
import type { TankEvent } from "../types";

const KIND_LABEL: Record<string, string> = {
  refill: "Recarga",
  low_threshold: "Nivel bajo",
  leak_suspected: "Posible fuga",
  sensor_gap: "Sin comunicación",
  sensor_stuck: "Sensor trabado",
  out_of_range: "Fuera de rango",
};

const PAGE_SIZE = 12;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-CR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function EventLog({ events }: { events: TankEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, PAGE_SIZE);

  if (events.length === 0) {
    return <p className="empty">Sin eventos registrados en el periodo.</p>;
  }

  return (
    <div className="event-log">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tanque</th>
            <th>Evento</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((e, i) => (
            <tr key={`${e.tankId}-${e.timestamp}-${e.kind}-${i}`}>
              <td className="nowrap">{formatTimestamp(e.timestamp)}</td>
              <td className="nowrap">{e.tankName}</td>
              <td>
                <span className={`badge badge-ev-${e.severity}`}>{KIND_LABEL[e.kind]}</span>
              </td>
              <td>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length > PAGE_SIZE && (
        <button className="link-btn" onClick={() => setExpanded(!expanded)}>
          {expanded
            ? "Ver menos"
            : `Ver los ${events.length - PAGE_SIZE} eventos restantes`}
        </button>
      )}
    </div>
  );
}
