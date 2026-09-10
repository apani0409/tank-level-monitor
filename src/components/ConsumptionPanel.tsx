import Plot from "react-plotly.js";
import type { ConsumptionSummary } from "../types";

const MNF_LABEL: Record<string, string> = {
  normal: "Normal",
  elevated: "Elevado",
  high: "Alto",
};

const MNF_EXPLANATION: Record<string, string> = {
  normal: "El flujo nocturno es bajo respecto al consumo promedio, como se espera de una red sana.",
  elevated:
    "El flujo nocturno está por encima de lo esperado. Entre las 02:00 y 04:00 casi no debería haber demanda legítima, así que un consumo sostenido a esa hora suele ser pérdida.",
  high: "El flujo nocturno es comparable al diurno. En una red real esto indica pérdida significativa, no demanda.",
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString("es-CR");
}

export function ConsumptionPanel({ summary }: { summary: ConsumptionSummary }) {
  const hours = summary.hourProfile.map((p) => p.hour);
  const hourValues = summary.hourProfile.map((p) => p.avgLitersPerHour);
  const nightMask = summary.hourProfile.map((p) =>
    p.hour >= 2 && p.hour < 4 ? "#dc3545" : "#0d6efd"
  );

  return (
    <div className="consumption">
      <h3>Patrones de consumo</h3>

      <div className="stats-row">
        <div className="stat">
          <div className="stat-label">Consumo promedio</div>
          <div className="stat-value">{fmt(summary.avgLitersPerDay / 1000)} m³/día</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total del periodo</div>
          <div className="stat-value">{fmt(summary.totalLitersConsumed / 1000)} m³</div>
        </div>
        <div className="stat">
          <div className="stat-label">Hora pico</div>
          <div className="stat-value">
            {String(summary.peakHour).padStart(2, "0")}:00
          </div>
        </div>
        <div className={`stat mnf-${summary.mnf.verdict}`}>
          <div className="stat-label">Flujo nocturno mínimo ({summary.mnf.windowLabel})</div>
          <div className="stat-value">
            {fmt(summary.mnf.litersPerHour)} L/h
            <span className={`badge badge-mnf-${summary.mnf.verdict}`}>
              {MNF_LABEL[summary.mnf.verdict]}
            </span>
          </div>
          <div className="stat-sub">
            {summary.mnf.pctOfDailyAverage.toFixed(1)}% del consumo promedio por hora
          </div>
        </div>
      </div>

      <p className="mnf-note">
        <strong>Flujo nocturno mínimo (MNF):</strong> {MNF_EXPLANATION[summary.mnf.verdict]}{" "}
        Se mide como la caída neta de nivel entre las {summary.mnf.windowLabel}, promediada
        sobre las últimas 7 noches — no sumando caídas hora a hora, porque de noche el
        consumo real es menor que el ruido del sensor y sumar solo las bajadas inflaría la
        cifra.
      </p>

      <div className="chart-pair">
        <div>
          <h4>Perfil por hora del día</h4>
          <Plot
            data={[
              {
                x: hours,
                y: hourValues,
                type: "bar",
                marker: { color: nightMask },
                hovertemplate: "%{x}:00 — %{y:.0f} L/h<extra></extra>",
              },
            ]}
            layout={{
              autosize: true,
              height: 260,
              margin: { l: 55, r: 10, t: 10, b: 40 },
              xaxis: { title: { text: "Hora" }, dtick: 3 },
              yaxis: { title: { text: "L/h promedio" } },
              showlegend: false,
            }}
            useResizeHandler
            style={{ width: "100%" }}
            config={{ displayModeBar: false }}
          />
          <p className="chart-caption">
            En rojo, la ventana nocturna usada para el MNF.
          </p>
        </div>

        <div>
          <h4>Consumo por día de la semana</h4>
          <Plot
            data={[
              {
                x: summary.weekdayProfile.map((w) => w.label),
                y: summary.weekdayProfile.map((w) => w.avgLitersPerDay / 1000),
                type: "bar",
                marker: { color: "#198754" },
                hovertemplate: "%{x} — %{y:.1f} m³/día<extra></extra>",
              },
            ]}
            layout={{
              autosize: true,
              height: 260,
              margin: { l: 55, r: 10, t: 10, b: 40 },
              yaxis: { title: { text: "m³/día promedio" } },
              showlegend: false,
            }}
            useResizeHandler
            style={{ width: "100%" }}
            config={{ displayModeBar: false }}
          />
          <p className="chart-caption">
            Promediado por día calendario, no por número de lecturas.
          </p>
        </div>
      </div>

      <h4>Consumo esperado vs. real (últimas 72 h)</h4>
      <Plot
        data={[
          {
            x: summary.expectedVsActual.map((p) => p.timestamp),
            y: summary.expectedVsActual.map((p) => p.expectedLiters),
            type: "scatter",
            mode: "lines",
            name: "Esperado",
            line: { color: "#8c9bab", width: 2, dash: "dash" },
          },
          {
            x: summary.expectedVsActual.map((p) => p.timestamp),
            y: summary.expectedVsActual.map((p) => p.actualLiters),
            type: "scatter",
            mode: "lines",
            name: "Real",
            line: { color: "#0d6efd", width: 2 },
          },
        ]}
        layout={{
          autosize: true,
          height: 280,
          margin: { l: 55, r: 10, t: 10, b: 40 },
          yaxis: { title: { text: "L/h" } },
          legend: { orientation: "h", y: -0.25 },
          hovermode: "x unified",
        }}
        useResizeHandler
        style={{ width: "100%" }}
        config={{ displayModeBar: false }}
      />
      <p className="chart-caption">
        "Esperado" es el propio perfil histórico de este tanque para cada hora del día. Una
        fuga se ve como la línea real montada de forma sostenida sobre la esperada.
      </p>

      <h4>Tendencia semanal</h4>
      <Plot
        data={[
          {
            x: summary.weekOverWeek.map((w) => w.label),
            y: summary.weekOverWeek.map((w) => w.liters / 1000),
            type: "bar",
            marker: { color: "#6f42c1" },
            hovertemplate: "%{x} — %{y:.1f} m³<extra></extra>",
          },
        ]}
        layout={{
          autosize: true,
          height: 220,
          margin: { l: 55, r: 10, t: 10, b: 40 },
          yaxis: { title: { text: "m³ consumidos" } },
          showlegend: false,
        }}
        useResizeHandler
        style={{ width: "100%" }}
        config={{ displayModeBar: false }}
      />
    </div>
  );
}
