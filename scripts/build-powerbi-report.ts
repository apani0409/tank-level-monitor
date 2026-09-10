// Generates powerbi/TankLevelMonitor.Report/report.json.
//
// Power BI's report format nests JSON inside JSON as escaped strings, which is
// unpleasant to write by hand and easy to get subtly wrong. Building it here
// means the escaping is always correct and the layout is reviewable as code.

type Role = "Values" | "Category" | "Y";

interface Field {
  /** Table name as defined in model.bim. */
  entity: string;
  /** Column or measure name. */
  property: string;
  kind: "measure" | "column";
  role: Role;
  /** Aggregation for column fields (0 = Sum, 1 = Avg, ...). Omit for measures. */
  aggregate?: number;
}

interface VisualSpec {
  id: string;
  visualType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fields: Field[];
  title?: string;
}

const alias = (entity: string) => entity.charAt(0).toLowerCase();

function buildSelect(field: Field) {
  const sourceRef = { Expression: { SourceRef: { Source: alias(field.entity) } } };
  const name = `${field.entity}.${field.property}`;

  if (field.kind === "measure") {
    return {
      Measure: { ...sourceRef, Property: field.property },
      Name: name,
    };
  }

  if (field.aggregate !== undefined) {
    return {
      Aggregation: {
        Expression: { Column: { ...sourceRef, Property: field.property } },
        Function: field.aggregate,
      },
      Name: `${["Sum", "Avg", "Min", "Max", "Count"][field.aggregate] ?? "Sum"}(${name})`,
    };
  }

  return {
    Column: { ...sourceRef, Property: field.property },
    Name: name,
  };
}

function buildVisualContainer(visual: VisualSpec) {
  const entities = [...new Set(visual.fields.map((f) => f.entity))];

  const prototypeQuery = {
    Version: 2,
    From: entities.map((entity) => ({
      Name: alias(entity),
      Entity: entity,
      Type: 0,
    })),
    Select: visual.fields.map(buildSelect),
  };

  const projections: Partial<Record<Role, { queryRef: string }[]>> = {};
  for (const [index, field] of visual.fields.entries()) {
    const queryRef = prototypeQuery.Select[index].Name;
    (projections[field.role] ??= []).push({ queryRef });
  }

  const config: Record<string, unknown> = {
    name: visual.id,
    layouts: [
      {
        id: 0,
        position: {
          x: visual.x,
          y: visual.y,
          z: 0,
          width: visual.width,
          height: visual.height,
        },
      },
    ],
    singleVisual: {
      visualType: visual.visualType,
      projections,
      prototypeQuery,
      drillFilterOtherVisuals: true,
      objects: visual.title
        ? {
            title: [
              {
                properties: {
                  text: { expr: { Literal: { Value: `'${visual.title}'` } } },
                  show: { expr: { Literal: { Value: "true" } } },
                },
              },
            ],
          }
        : {},
    },
  };

  return {
    x: visual.x,
    y: visual.y,
    width: visual.width,
    height: visual.height,
    z: 0,
    config: JSON.stringify(config),
    filters: "[]",
  };
}

const visuals: VisualSpec[] = [
  {
    id: "estadoFlota",
    visualType: "tableEx",
    title: "Estado de la flota",
    x: 20,
    y: 20,
    width: 760,
    height: 260,
    fields: [
      { entity: "Tanques", property: "Nombre", kind: "column", role: "Values" },
      { entity: "Lecturas", property: "Nivel actual %", kind: "measure", role: "Values" },
      { entity: "Lecturas", property: "Estado del tanque", kind: "measure", role: "Values" },
      { entity: "Lecturas", property: "Veredicto MNF", kind: "measure", role: "Values" },
      {
        entity: "Lecturas",
        property: "Flujo nocturno mínimo (L/h)",
        kind: "measure",
        role: "Values",
      },
      {
        entity: "Lecturas",
        property: "Cobertura del sensor %",
        kind: "measure",
        role: "Values",
      },
    ],
  },
  {
    id: "consumoDiario",
    visualType: "card",
    title: "Consumo diario promedio (m³)",
    x: 800,
    y: 20,
    width: 220,
    height: 120,
    fields: [
      {
        entity: "Lecturas",
        property: "Consumo diario promedio (m³)",
        kind: "measure",
        role: "Values",
      },
    ],
  },
  {
    id: "mnfCard",
    visualType: "card",
    title: "Flujo nocturno mínimo (L/h)",
    x: 800,
    y: 160,
    width: 220,
    height: 120,
    fields: [
      {
        entity: "Lecturas",
        property: "Flujo nocturno mínimo (L/h)",
        kind: "measure",
        role: "Values",
      },
    ],
  },
  {
    id: "perfilHora",
    visualType: "columnChart",
    title: "Consumo promedio por hora del día (L/h)",
    x: 20,
    y: 300,
    width: 500,
    height: 300,
    fields: [
      { entity: "Lecturas", property: "Hora", kind: "column", role: "Category" },
      // Aggregation 1 = Average
      {
        entity: "Lecturas",
        property: "ConsumoLitros",
        kind: "column",
        role: "Y",
        aggregate: 1,
      },
    ],
  },
  {
    id: "nivelHistorico",
    visualType: "lineChart",
    title: "Nivel del tanque (%)",
    x: 540,
    y: 300,
    width: 480,
    height: 300,
    fields: [
      { entity: "Lecturas", property: "Fecha", kind: "column", role: "Category" },
      {
        entity: "Lecturas",
        property: "NivelPct",
        kind: "column",
        role: "Y",
        aggregate: 1,
      },
    ],
  },
  {
    id: "selectorTanque",
    visualType: "slicer",
    title: "Tanque",
    x: 800,
    y: 300,
    width: 220,
    height: 300,
    fields: [{ entity: "Tanques", property: "Nombre", kind: "column", role: "Values" }],
  },
];

const report = {
  $schema:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/1.0.0/schema.json",
  themeCollection: { baseTheme: { name: "CY24SU10", version: "5.55", type: 2 } },
  layoutOptimization: 0,
  resourcePackages: [
    {
      resourcePackage: {
        disabled: false,
        items: [{ name: "CY24SU10", path: "BaseThemes/CY24SU10.json", type: 202 }],
        name: "SharedResources",
        type: 2,
      },
    },
  ],
  sections: [
    {
      name: "ResumenOperativo",
      displayName: "Resumen operativo",
      filters: "[]",
      ordinal: 0,
      visualContainers: visuals.map(buildVisualContainer),
      config: JSON.stringify({}),
      displayOption: 1,
      width: 1280,
      height: 720,
    },
  ],
  config: JSON.stringify({
    version: "5.55",
    themeCollection: { baseTheme: { name: "CY24SU10", version: "5.55", type: 2 } },
    activeSectionIndex: 0,
    defaultDrillFilterOtherVisuals: true,
    settings: { useStylableVisualContainerHeader: true },
  }),
  filters: "[]",
};

await Bun.write(
  "powerbi/TankLevelMonitor.Report/report.json",
  JSON.stringify(report, null, 2)
);

console.log(`Wrote report.json with ${visuals.length} visuals.`);
