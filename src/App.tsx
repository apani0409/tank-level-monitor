import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import type { TanksData } from "./types";
import { analyzeTank } from "./analysis";
import "./App.css";

const SEVERITY_LABEL: Record<string, string> = {
  ok: "Normal",
  low: "Nivel bajo",
  leak: "Posible fuga",
};

function App() {
  const [data, setData] = useState<TanksData | null>(null);
  const [selectedTankId, setSelectedTankId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}tanks.json`)
      .then((res) => res.json())
      .then((json: TanksData) => {
        setData(json);
        setSelectedTankId(json.tanks[0]?.id ?? null);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const statuses = useMemo(() => {
    if (!data) return [];
    return data.tanks.map(analyzeTank);
  }, [data]);

  const selectedStatus = statuses.find((s) => s.tank.id === selectedTankId);

  if (loading) return <div className="status">Cargando datos de sensores...</div>;
  if (error) return <div className="status error">Error: {error}</div>;
  if (!data || !selectedStatus) return null;

  const trace = {
    x: selectedStatus.tank.readings.map((r) => r.timestamp),
    y: selectedStatus.tank.readings.map((r) => r.levelPct),
    type: "scatter" as const,
    mode: "lines" as const,
    name: "Nivel (%)",
    line: { color: "#0d6efd", width: 1.5 },
  };

  const alertCount = statuses.filter((s) => s.severity !== "ok").length;

  return (
    <div className="app">
      <header>
        <h1>Monitoreo de Tanques — Demo</h1>
        <p className="subtitle">
          4 tanques · lecturas horarias simuladas de sensor ultrasónico · 30 días
        </p>
      </header>

      {alertCount > 0 && (
        <div className="global-alert">
          ⚠ {alertCount} tanque{alertCount > 1 ? "s" : ""} con alerta activa
        </div>
      )}

      <section className="tank-grid">
        {statuses.map((s) => (
          <button
            key={s.tank.id}
            className={`tank-card severity-${s.severity} ${
              s.tank.id === selectedTankId ? "selected" : ""
            }`}
            onClick={() => setSelectedTankId(s.tank.id)}
          >
            <div className="tank-card-header">
              <strong>{s.tank.name}</strong>
              <span className={`badge badge-${s.severity}`}>
                {SEVERITY_LABEL[s.severity]}
              </span>
            </div>
            <div className="tank-level-big">{s.currentLevelPct.toFixed(1)}%</div>
            <div className="tank-meta">{s.tank.location}</div>
            <div className="tank-meta">
              {s.currentLiters.toLocaleString("es-CR")} L / {s.tank.capacityLiters.toLocaleString("es-CR")} L
            </div>
          </button>
        ))}
      </section>

      <section className="detail-section">
        <div className="detail-header">
          <h2>{selectedStatus.tank.name}</h2>
          <span className="detail-location">{selectedStatus.tank.location}</span>
        </div>

        <div className="stats-row">
          <div className="stat">
            <div className="stat-label">Nivel actual</div>
            <div className="stat-value">{selectedStatus.currentLevelPct.toFixed(1)}%</div>
          </div>
          <div className="stat">
            <div className="stat-label">Volumen</div>
            <div className="stat-value">
              {selectedStatus.currentLiters.toLocaleString("es-CR")} L
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Tasa de consumo (24h)</div>
            <div className="stat-value">
              {selectedStatus.hourlyDropRatePct.toFixed(2)}%/h
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Tiempo estimado a vacío</div>
            <div className="stat-value">
              {selectedStatus.estimatedHoursToEmpty
                ? `~${Math.round(selectedStatus.estimatedHoursToEmpty / 24)} días`
                : "—"}
            </div>
          </div>
        </div>

        {selectedStatus.leakDetected && (
          <div className="leak-warning">
            <strong>Posible fuga detectada.</strong> La tasa de consumo de las últimas 24h
            ({selectedStatus.hourlyDropRatePct.toFixed(2)}%/h) supera en más de 1.8× el
            consumo histórico normal de este tanque, de forma sostenida.
          </div>
        )}

        <Plot
          data={[trace]}
          layout={{
            autosize: true,
            height: 420,
            margin: { l: 50, r: 20, t: 20, b: 50 },
            xaxis: { title: { text: "Fecha" } },
            yaxis: { title: { text: "Nivel (%)" }, range: [0, 100] },
            shapes: [
              {
                type: "line",
                x0: 0,
                x1: 1,
                xref: "paper",
                y0: 25,
                y1: 25,
                yref: "y",
                line: { color: "#dc3545", width: 1, dash: "dash" },
              },
            ],
          }}
          useResizeHandler
          style={{ width: "100%" }}
          config={{ displayModeBar: true, displaylogo: false }}
        />
      </section>

      <footer>
        <p>
          Datos sintéticos generados para esta demo — no provienen de sensores reales.
          Simulan el patrón de monitoreo de tanques por sensor ultrasónico.{" "}
          <a
            href="https://github.com/apani0409/tank-level-monitor"
            target="_blank"
            rel="noreferrer"
          >
            Código fuente
          </a>
        </p>
      </footer>
    </div>
  );
}

export default App;
