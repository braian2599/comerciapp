/**
 * Parser unificado para archivos de importación.
 *
 * Soporta:
 *   - CSV  (.csv)
 *   - Excel (.xlsx, .xls)
 *   - JSON (.json, array de objetos)
 *
 * El output siempre es el mismo: { headers, rows } donde
 *   - headers: string[] con los nombres de columna (normalizados a string)
 *   - rows:    any[][] con los valores por fila (string|number|'' para vacío)
 *
 * Esto permite a los API routes mapear columnas por nombre sin tener que
 * lidiar con los detalles del formato de origen.
 */
import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: (string | number | null)[][];
}

export interface ParseError {
  error: string;
}

/**
 * Detecta el tipo de archivo por extensión y lo parsea en consecuencia.
 * Lanza Error si el formato no es soportado o el contenido es inválido.
 */
export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".json")) {
    return parseJSON(file);
  }

  if (name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseSpreadsheet(file);
  }

  throw new Error(
    `Formato no soportado: ${file.name}. Usá CSV, XLSX o JSON.`
  );
}

async function parseJSON(file: File): Promise<ParsedFile> {
  const text = await file.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("El archivo JSON no es válido");
  }

  if (!Array.isArray(data)) {
    throw new Error("El JSON debe ser un array de objetos");
  }
  if (data.length === 0) {
    return { headers: [], rows: [] };
  }

  // Recopilar todas las claves preservando el orden de primera aparición
  const headerSet = new Set<string>();
  for (const obj of data) {
    if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj)) headerSet.add(k);
    }
  }
  const headers = Array.from(headerSet);
  const rows = data.map((obj) => {
    if (!obj || typeof obj !== "object") {
      return headers.map(() => null);
    }
    return headers.map((h) => normalizeValue((obj as any)[h]));
  });

  return { headers, rows };
}

async function parseSpreadsheet(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array" });
  } catch {
    throw new Error(`No se pudo leer el archivo ${file.name}`);
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("El archivo no tiene hojas de cálculo");
  }
  const sheet = wb.Sheets[sheetName];

  // header: 1 → devuelve array de arrays (sin objetos key:value)
  // raw: false → convierte todo a strings según el formato de celda
  // defval: '' → las celdas vacías se vuelven '' en vez de undefined
  const data = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  if (!data.length) {
    return { headers: [], rows: [] };
  }

  const headerRow = (data[0] as any[]).map((h) =>
    h === null || h === undefined ? "" : String(h).trim()
  );
  const headers = headerRow;

  const rows = data.slice(1).map((r) =>
    headers.map((_, i) => {
      const v = (r as any[])[i];
      return normalizeValue(v);
    })
  );

  // Filtrar filas completamente vacías (a veces Excel/Sheets deja trailers)
  const nonEmptyRows = rows.filter((r) =>
    r.some((c) => c !== null && c !== "" && c !== undefined)
  );

  return { headers, rows: nonEmptyRows };
}

/**
 * Normaliza un valor de celda a string|number|null.
 *   - Strings vacíos → null (más fácil de mapear a campos opcionales)
 *   - Números se mantienen como number
 *   - Strings se trimean
 */
function normalizeValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Genera una plantilla CSV descargable dado un conjunto de headers.
 * Maneja correctamente comas y comillas escapando los valores.
 */
export function generateCSV(headers: string[]): string {
  const escape = (v: string) => {
    if (/[",\n\r]/.test(v)) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  return headers.map(escape).join(",") + "\n";
}

/**
 * Dispara la descarga de un archivo de texto en el navegador.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/csv;charset=utf-8;"
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
