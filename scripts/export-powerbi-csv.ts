// Flattens the nested tanks.json into two flat CSVs for the Power BI model.
// Power Query reads these straight from the public GitHub raw URLs, so the
// PBIP project refreshes on any machine with no local path configuration.

interface Reading {
  timestamp: string;
  levelPct: number;
}

interface Tank {
  id: string;
  name: string;
  location: string;
  capacityLiters: number;
  readings: Reading[];
}

const data: { tanks: Tank[] } = await Bun.file("public/tanks.json").json();

/** "2026-08-10T00:00:00.000Z" -> "2026-08-10 00:00:00" (locale-proof for Power Query). */
function toPlainDateTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

const tankRows = ["TankId,Nombre,Ubicacion,CapacidadLitros"];
const readingRows = ["TankId,Timestamp,NivelPct"];

for (const tank of data.tanks) {
  tankRows.push(
    [tank.id, `"${tank.name}"`, `"${tank.location}"`, tank.capacityLiters].join(",")
  );
  for (const reading of tank.readings) {
    readingRows.push(
      [tank.id, toPlainDateTime(reading.timestamp), reading.levelPct].join(",")
    );
  }
}

await Bun.write("powerbi/data/tanks.csv", tankRows.join("\n") + "\n");
await Bun.write("powerbi/data/readings.csv", readingRows.join("\n") + "\n");

console.log(
  `Wrote ${tankRows.length - 1} tanks and ${readingRows.length - 1} readings to powerbi/data/`
);
