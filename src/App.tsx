import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import type { Reading, TankEvent, TanksData } from "./types";
import { analyzeTank, baselineDropRate, LOW_LEVEL_THRESHOLD_PCT } from "./analysis";
import { analyzeConsumption } from "./consumption";
import { assessSensor, fleetNow, sanitizeReadings } from "./sensorHealth";
import { addLeakEvent, deriveEvents, sortEventsNewestFirst } from "./events";
import { ConsumptionPanel } from "./components/ConsumptionPanel";
import { EventLog } from "./components/EventLog";
import { SensorHealthPanel } from "./components/SensorHealthPanel";
import "./App.css";

const SEVERITY_LABEL: Record<string, string> = {
  ok: "Normal",
  low: "Nivel bajo",
  leak: "Posible fuga",
};

type TabKey = "nivel" | "consumo" | "eventos";

function App() {
  const [data, setData] = useState<TanksData | null>(null);
  const [selectedTankId, setSelectedTankId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("nivel");
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

  const analysis = useMemo(() => {
    if (!data) return null;
    const now = fleetNow(data.tanks);

    const perTank = data.tanks.map((tank) => {
      const sanitized: Reading[] = sanitizeReadings(tank.readings);
      const status = analyzeTank(tank, sanitized);
      const health = assessSensor(tank, now);
      const consumption = analyzeConsumption(tank, sanitized);

      let events = deriveEvents(tank, sanitized, health);
      if (status.leakDetected) {
        events = addLeakEvent(
          events,
          tank,
          sanitized[sanitized.length - 1].timestamp,
          status.hourlyDropRatePct,
          baselineDropRate(sanitized)
        );
      }

      return { tank, sanitized, status, health, consumption, events };
    });

    const allEvents: TankEvent[] = sortEventsNewestFirst(
      perTank.flatMap((t) => t.events)
    );

    return { now, perTank, allEvents };
  }, [data]);

  if (loading) return <div className="status">Cargando datos de sensores...</div>;
  if (error) return <div className="status error">Error: {error}</div>;
  if (!analysis) return null;

  const selected =
    analysis.perTank.find((t) => t.tank.id === selectedTankId) ?? analysis.perTank[0];

  const levelTrace = {
    x: selected.sanitized.map((r) => r.timestamp),
    y: selected.sanitized.map((r) => r.levelPct),
    type: "scatter" as const,
    mode: "lines" as const,
    name: "Nivel (%)",
    line: { color: "#0d6efd", width: 1.5 },
  };

  const alerts = analysis.perTank.filter(
    (t) => t.status.severity !== "ok" || t.health.status !== "healthy"
  );

  return (
    <div className="app">
      <header>
        <h1>Monitoreo de Tanques — Demo</h1>
        <p className="subtitle">
          4 tanques · lecturas horarias simuladas de sensor ultrasónico · 30 días ·
          detección de fugas y salud del sensor
        </p>
      </header>

      {alerts.length > 0 && (
        <div className="global-alert">
          ⚠ {alerts.length} tanque{alerts.length > 1 ? "s" : ""} requiere
          {alerts.length > 1 ? "n" : ""} atención
        </div>
      )}

      <section className="tank-grid">
        {analysis.perTank.map(({ tank, status, health, consumption }) => (
          <button
            key={tank.id}
            className={`tank-card severity-${status.severity} ${
              tank.id === selected.tank.id ? "selected" : ""
            }`}
            onClick={() => setSelectedTankId(tank.id)}
          >
            <div className="tank-card-header">
              <strong>{tank.name}</strong>
              <span className={`badge badge-${status.severity}`}>
                {SEVERITY_LABEL[status.severity]}
              </span>
            </div>
            <div className="tank-level-big">{status.currentLevelPct.toFixed(1)}%</div>
            <div className="tank-meta">{tank.location}</div>
            <div className="tank-meta">
              {status.currentLiters.toLocaleString("es-CR")} L /{" "}
              {tank.capacityLiters.toLocaleString("es-CR")} L
            </div>
            <div className="tank-flags">
              {health.status !== "healthy" && (
                <span className={`flag flag-sensor-${health.status}`}>
                  {health.status === "offline" ? "sin señal" : "sensor degradado"}
                </span>
              )}
              {consumption.mnf.verdict !== "normal" && (
                <span className="flag flag-mnf">flujo nocturno alto</span>
              )}
            </div>
          </button>
        ))}
      </section>

      <section className="detail-section">
        <div className="detail-header">
          <h2>{selected.tank.name}</h2>
          <span className="detail-location">{selected.tank.location}</span>
        </div>

        <SensorHealthPanel health={selected.health} />

        <nav className="tabs">
          {(
            [
              ["nivel", "Nivel"],
              ["consumo", "Consumo"],
              ["eventos", "Eventos"],
            ] as [TabKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "nivel" && (
          <>
            <div className="stats-row">
              <div className="stat">
                <div className="stat-label">Nivel actual</div>
                <div className="stat-value">
                  {selected.status.currentLevelPct.toFixed(1)}%
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Volumen</div>
                <div className="stat-value">
                  {selected.status.currentLiters.toLocaleString("es-CR")} L
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Tasa de consumo (24h)</div>
                <div className="stat-value">
                  {selected.status.hourlyDropRatePct.toFixed(2)}%/h
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Tiempo estimado a vacío</div>
                <div className="stat-value">
                  {selected.status.estimatedHoursToEmpty
                    ? `~${Math.round(selected.status.estimatedHoursToEmpty / 24)} días`
                    : "—"}
                </div>
              </div>
            </div>

            {selected.status.leakDetected && (
              <div className="leak-warning">
                <strong>Posible fuga detectada.</strong> El consumo de las últimas 24 h
                ({selected.status.hourlyDropRatePct.toFixed(2)}%/h) supera en más de 1.8× la
                línea base histórica de este tanque, de forma sostenida. Esta regla detecta
                fugas <em>súbitas</em>; las pérdidas lentas se ven en la pestaña de consumo.
              </div>
            )}

            <Plot
              data={[levelTrace]}
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
                    y0: LOW_LEVEL_THRESHOLD_PCT,
                    y1: LOW_LEVEL_THRESHOLD_PCT,
                    yref: "y",
                    line: { color: "#dc3545", width: 1, dash: "dash" },
                  },
                ],
              }}
              useResizeHandler
              style={{ width: "100%" }}
              config={{ displayModeBar: true, displaylogo: false }}
            />
          </>
        )}

        {tab === "consumo" && <ConsumptionPanel summary={selected.consumption} />}

        {tab === "eventos" && (
          <EventLog events={sortEventsNewestFirst(selected.events)} />
        )}
      </section>

      <section className="detail-section">
        <h2>Todos los eventos</h2>
        <EventLog events={analysis.allEvents} />
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
