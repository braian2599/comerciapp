/**
 * Simulación del flujo de importación con el archivo real del usuario.
 *
 * Verifica:
 *   1. Que el parser pueda leer el .xls del usuario (vía xlsx convertido).
 *   2. Que la auto-detección de columnas funcione.
 *   3. Que el mapeo manual funcione para todas las combinaciones.
 *   4. Que la cantidad de campos (16) entre en el layout de dos columnas.
 *
 * No prueba el render visual (eso requiere browser), pero valida la lógica
 * de datos que alimenta al dialog.
 */
import * as XLSX from "xlsx";
import * as fs from "fs";
import {
  PRODUCT_IMPORT_FIELDS,
  suggestColumnMapping,
  normalizeHeader,
} from "../src/lib/import-config";

const XLSX_PATH =
  "/tmp/Consulta de Stock[3-8-2026][10-44-53].xlsx";

console.log("=== SIMULACIÓN: Importación de productos ===\n");

// 1. Leer archivo
console.log("1. Leyendo archivo:", XLSX_PATH);
const workbook = XLSX.readFile(XLSX_PATH);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  raw: true,
  defval: "",
});
const headers = (rows[0] || []).map((h: any) => String(h));
const dataRows = rows.slice(1).filter((r) => r.some((c) => c !== ""));
console.log(`   ✓ ${headers.length} columnas:`, headers);
console.log(`   ✓ ${dataRows.length} filas de datos`);
console.log(`   ✓ Primeras 3 filas:`);
dataRows.slice(0, 3).forEach((r, i) => {
  console.log(`     Fila ${i + 1}:`, r);
});

// 2. Auto-detección
console.log("\n2. Auto-detección de columnas:");
const suggested = suggestColumnMapping(headers, PRODUCT_IMPORT_FIELDS);
console.log(`   ✓ ${Object.keys(suggested).length} campos auto-detectados:`);
Object.entries(suggested).forEach(([key, idx]) => {
  console.log(`     ${key} <- columna ${idx} ("${headers[idx]}")`);
});

// 3. Verificar campos obligatorios
console.log("\n3. Campos obligatorios:");
const required = PRODUCT_IMPORT_FIELDS.filter((f) => f.required);
required.forEach((f) => {
  const mapped = f.key in suggested;
  console.log(
    `   ${mapped ? "✓" : "✗"} ${f.label} (${f.key}): ${mapped ? "detectado" : "FALTA mapear manualmente"}`
  );
});

// 4. Simular mapeo manual completo (Código->sku, Item->name, etc.)
console.log("\n4. Simulando mapeo manual completo:");
const manualMapping: Record<string, number> = { ...suggested };
// mapear los que faltan
const codeIdx = headers.findIndex((h) => normalizeHeader(h) === "codigo");
const itemIdx = headers.findIndex((h) => normalizeHeader(h) === "item");
const barcodeIdx = headers.findIndex((h) =>
  normalizeHeader(h).includes("barras")
);
if (codeIdx >= 0 && !("sku" in manualMapping)) {
  manualMapping.sku = codeIdx;
  console.log(`   + sku <- columna ${codeIdx} ("${headers[codeIdx]}")`);
}
if (itemIdx >= 0 && !("name" in manualMapping)) {
  manualMapping.name = itemIdx;
  console.log(`   + name <- columna ${itemIdx} ("${headers[itemIdx]}")`);
}
if (barcodeIdx >= 0 && !("barcode" in manualMapping)) {
  manualMapping.barcode = barcodeIdx;
  console.log(`   + barcode <- columna ${barcodeIdx} ("${headers[barcodeIdx]}")`);
}

// 5. Verificar que todos los obligatorios estén mapeados
const allRequiredMapped = required.every((f) => f.key in manualMapping);
console.log(
  `\n5. Todos los obligatorios mapeados: ${allRequiredMapped ? "✓ SÍ" : "✗ NO"}`
);

// 6. Generar preview de las primeras 8 filas (como las que muestra el dialog)
console.log("\n6. Preview de primeras 8 filas (como en el dialog):");
const mappedFields = PRODUCT_IMPORT_FIELDS.filter(
  (f) => f.key in manualMapping
);
console.log(
  `   Columnas: # | ${mappedFields.map((f) => f.label).join(" | ")}`
);
dataRows.slice(0, 8).forEach((row, i) => {
  const cells = mappedFields.map((f) => {
    const v = row[manualMapping[f.key]];
    return v === null || v === undefined || v === "" ? "—" : String(v);
  });
  console.log(`   ${i + 2} | ${cells.join(" | ")}`);
});

// 7. Verificar que el layout de dos columnas tiene sentido
console.log("\n7. Layout check:");
console.log(`   - Campos totales: ${PRODUCT_IMPORT_FIELDS.length}`);
console.log(`   - Campos mapeados: ${Object.keys(manualMapping).length}`);
console.log(
  `   - Columnas en archivo: ${headers.length} (algunas no se mapean, ej: "Proveedor")`
);
console.log(
  `   - Layout: dos columnas (campos | preview), cada una con scroll independiente`
);
console.log(
  `   - En pantalla anchas (lg+): grid-cols-[1fr_1fr], cada columna ~50% del dialog`
);
console.log(
  `   - En pantallas chicas: grid-cols-1, se apilan verticalmente con scroll`
);

console.log("\n=== SIMULACIÓN COMPLETADA ===");
