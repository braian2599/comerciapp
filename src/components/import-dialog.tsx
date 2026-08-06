"use client";

/**
 * Dialog de importación masiva reutilizable con mapeo manual de columnas.
 *
 * Flujo (wizard de 4 pasos):
 *   1. SUBIR: usuario elige un archivo CSV/XLSX/JSON.
 *   2. MAPEAR: el sistema detecta automáticamente las columnas y sugiere
 *      un mapeo. El usuario puede cambiar qué columna va a cada campo.
 *      Una columna del archivo puede no estar mapeada; un campo puede
 *      quedar sin mapear (salvo los obligatorios).
 *   3. PREVIEW: el servidor procesa con el mapeo elegido y muestra la
 *      lista de items a crear / actualizar / con error. El usuario
 *      selecciona qué items confirmar.
 *   4. RESULTADO: estadísticas finales (creados, actualizados, errores).
 *
 * Props:
 *   - endpoint:       URL del API route ("/api/products/import" | "/api/customers/import")
 *   - fields:         lista de ImportField (de @/lib/import-config) que definen
 *                     qué campos puede mapear el usuario.
 *   - templateHeaders: columnas sugeridas para la plantilla descargable
 *   - templateName:    nombre del archivo de plantilla
 *   - entityLabel:     "producto" | "cliente"
 *   - entityLabelPlural: "productos" | "clientes"
 *   - onImported:      callback al terminar (para que el view recargue la lista)
 */
import { useState, useRef, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Upload,
  Download,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Columns3,
  Sparkles,
  Eye,
} from "lucide-react";
import {
  parseFile,
  generateCSV,
  downloadTextFile,
  type ParsedFile,
} from "@/lib/file-parser";
import {
  suggestColumnMapping,
  normalizeHeader,
  type ImportField,
} from "@/lib/import-config";

export interface ImportPreviewItem {
  action: "create" | "update" | "error";
  rowIndex: number;
  name: string;
  existingId?: string;
  existingName?: string;
  matchBy?: string;
  error?: string;
  data?: any;
}

export interface ImportPreviewResponse {
  items: ImportPreviewItem[];
  summary: {
    create: number;
    update: number;
    error: number;
  };
  columnMapping?: Record<string, number>;
}

export interface ImportCommitResponse {
  created: number;
  updated: number;
  errors: { rowIndex: number; name: string; error: string }[];
  total: number;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  fields: ImportField[];
  templateHeaders: string[];
  templateName: string;
  entityLabel: string;
  entityLabelPlural: string;
  onImported?: () => void;
}

type Phase = "idle" | "parsing" | "mapping" | "previewing" | "committing" | "done";

export function ImportDialog({
  open,
  onOpenChange,
  endpoint,
  fields,
  templateHeaders,
  templateName,
  entityLabel,
  entityLabelPlural,
  onImported,
}: ImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  // columnMapping: { fieldKey: columnIndex }
  // columnIndex = -1 significa "no mapeado" (lo usamos internamente para
  // distinguir de un campo que todavía no fue tocado por el usuario).
  const [columnMapping, setColumnMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(
    new Set()
  );
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setFileName("");
    setParsed(null);
    setColumnMapping({});
    setPreview(null);
    setSelectedRowIndices(new Set());
    setCommitResult(null);
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleTemplate() {
    const csv = generateCSV(templateHeaders);
    downloadTextFile(templateName, csv);
    toast.success("Plantilla descargada", {
      description: `Abrí ${templateName} en Excel o Google Sheets`,
    });
  }

  // ─── Paso 1 → 2: parsear archivo y saltar a mapeo ───────────────────────────
  async function handleFile(file: File) {
    setPhase("parsing");
    setErrorMsg("");
    setFileName(file.name);

    let result: ParsedFile;
    try {
      result = await parseFile(file);
    } catch (e: any) {
      setErrorMsg(e?.message || "No se pudo leer el archivo");
      setPhase("idle");
      return;
    }

    if (!result.headers.length || !result.rows.length) {
      setErrorMsg("El archivo está vacío o no tiene filas de datos");
      setPhase("idle");
      return;
    }

    setParsed(result);
    // Sugerir mapeo automático
    const suggested = suggestColumnMapping(result.headers, fields);
    setColumnMapping(suggested);
    setPhase("mapping");
  }

  // ─── Helpers de mapeo ────────────────────────────────────────────────────────
  function setFieldMapping(fieldKey: string, columnIndex: number) {
    setColumnMapping((prev) => {
      const next = { ...prev };
      if (columnIndex < 0) {
        delete next[fieldKey];
      } else {
        next[fieldKey] = columnIndex;
      }
      return next;
    });
  }

  function autoDetectAll() {
    if (!parsed) return;
    const suggested = suggestColumnMapping(parsed.headers, fields);
    setColumnMapping(suggested);
    toast.success("Mapeo automático aplicado", {
      description: "Revisá que las columnas estén bien asignadas",
    });
  }

  function clearAllMappings() {
    setColumnMapping({});
  }

  // Stats del mapeo para mostrar en la UI
  const mappingStats = useMemo(() => {
    const mapped = Object.keys(columnMapping).length;
    const required = fields.filter((f) => f.required);
    const requiredMapped = required.filter((r) => r.key in columnMapping).length;
    const totalRequired = required.length;
    return { mapped, requiredMapped, totalRequired };
  }, [columnMapping, fields]);

  const requiredSatisfied = mappingStats.requiredMapped === mappingStats.totalRequired;

  // ─── Paso 2 → 3: enviar mapeo al servidor para preview ──────────────────────
  async function handlePreview() {
    if (!parsed) return;
    if (!requiredSatisfied) {
      toast.error("Faltan campos obligatorios por mapear");
      return;
    }

    setPhase("previewing");
    setErrorMsg("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          headers: parsed.headers,
          rows: parsed.rows,
          columnMapping,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error en el servidor");

      const previewData = data as ImportPreviewResponse;
      setPreview(previewData);

      // Por defecto: seleccionar todos los create y update, excluir errors
      const selected = new Set<number>();
      previewData.items.forEach((item) => {
        if (item.action === "create" || item.action === "update") {
          selected.add(item.rowIndex);
        }
      });
      setSelectedRowIndices(selected);
      setPhase("preview");
    } catch (e: any) {
      setErrorMsg(e?.message || "Error al analizar el archivo");
      setPhase("mapping");
    }
  }

  // ─── Selección de items en el preview ───────────────────────────────────────
  function toggleRow(rowIndex: number) {
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }
  function selectAll() {
    if (!preview) return;
    const next = new Set<number>();
    preview.items.forEach((item) => {
      if (item.action === "create" || item.action === "update") {
        next.add(item.rowIndex);
      }
    });
    setSelectedRowIndices(next);
  }
  function selectNone() {
    setSelectedRowIndices(new Set());
  }
  function selectOnlyCreates() {
    if (!preview) return;
    const next = new Set<number>();
    preview.items.forEach((item) => {
      if (item.action === "create") next.add(item.rowIndex);
    });
    setSelectedRowIndices(next);
  }

  // ─── Paso 3 → 4: confirmar y commitear ──────────────────────────────────────
  async function handleCommit() {
    if (!preview) return;
    const itemsToCommit = preview.items.filter((i) =>
      selectedRowIndices.has(i.rowIndex)
    );
    if (itemsToCommit.length === 0) {
      toast.error("No seleccionaste ningún item para importar");
      return;
    }

    setPhase("committing");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "commit",
          items: itemsToCommit,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error en el servidor");

      const result = data as ImportCommitResponse;
      setCommitResult(result);
      setPhase("done");
      onImported?.();

      const parts: string[] = [];
      if (result.created) parts.push(`${result.created} creados`);
      if (result.updated) parts.push(`${result.updated} actualizados`);
      if (result.errors.length) parts.push(`${result.errors.length} con error`);
      toast.success(`Importación completa`, {
        description: parts.join(" · ") || "Sin cambios",
      });
    } catch (e: any) {
      setErrorMsg(e?.message || "Error al importar");
      setPhase("preview");
    }
  }

  // ─── Helpers de render del mapeo ─────────────────────────────────────────────
  function columnLabel(idx: number): string {
    if (!parsed) return "";
    return parsed.headers[idx] || `(columna ${idx + 1})`;
  }
  function sampleValues(idx: number): string[] {
    if (!parsed) return [];
    return parsed.rows.slice(0, 3).map((r) => {
      const v = r[idx];
      if (v === null || v === undefined || v === "") return "—";
      return String(v).slice(0, 20);
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  //
  // Layout strategy (versión 3, apilado verticalmente):
  //
  // Estructura del dialog (fija, altura explícita h-[88vh]):
  //   ┌─────────────────────────────────────────────────┐
  //   │ HEADER (título + descripción + archivo)         │ shrink-0
  //   ├─────────────────────────────────────────────────┤
  //   │ STEPPER (1 Mapear → 2 Revisar → 3 Confirmar)    │ shrink-0
  //   ├─────────────────────────────────────────────────┤
  //   │ BODY (flex-1, contenido variable según fase)    │
  //   │   ↳ En mapping:                                  │
  //   │     ┌───────────────────────────────────────┐   │
  //   │     │ TOOLBAR (stats + acciones)            │   │ shrink-0
  //   │     ├───────────────────────────────────────┤   │
  //   │     │ CAMPOS DEL SISTEMA (grid 3 cols)      │   │
  //   │     │   ↳ cada card = label + select        │   │ flex-1, scroll-y
  //   │     │   ↳ 16 campos en 6 filas de 3         │   │
  //   │     ├───────────────────────────────────────┤   │
  //   │     │ VISTA PREVIA (tabla, scroll-x+y)      │   │ shrink-0, h-40
  //   │     └───────────────────────────────────────┘   │
  //   ├─────────────────────────────────────────────────┤
  //   │ FOOTER (Atrás / Continuar)                     │ shrink-0
  //   └─────────────────────────────────────────────────┘
  //
  // Reglas anti-overlap (lecciones aprendidas):
  //   1. Altura EXPLÍCITA en DialogContent (h-[88vh]) — sin esto, los hijos
  //      flex no saben cuánto espacio tienen y se desbordan.
  //   2. `!flex flex-col` para pisar el `grid` default de DialogContent.
  //   3. `p-0 gap-0` en DialogContent — el padding lo maneja cada sección
  //      individualmente, así los bordes (border-t/border-b) van de lado a
  //      lado sin recortes.
  //   4. NO usar Radix ScrollArea dentro de flex contexts — usar div nativo
  //      con overflow-y-auto. Radix tiene issues de herencia de altura.
  //   5. En la lista de campos, NO usar sticky headers dentro de overflow-y-auto
  //      porque el z-index choca con otros elementos. En su lugar, el header
  //      "CAMPOS DEL SISTEMA" vive FUERA del contenedor scrollable (arriba),
  //      como shrink-0, así nunca se solapa con el contenido que scrollea.
  //
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="!max-w-[95vw] w-[95vw] sm:!max-w-[95vw] md:!max-w-[95vw] lg:!max-w-[95vw] xl:!max-w-[95vw] 2xl:!max-w-[95rem] h-[92vh] !flex flex-col overflow-hidden p-0 gap-0"
      >
        {/* ═══ HEADER (fijo) ═══ */}
        <DialogHeader className="shrink-0 px-6 pt-5 pb-3 border-b gap-2">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Upload className="w-5 h-5 text-indigo-600" />
            Importar {entityLabelPlural}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {phase === "idle" && "Subí un archivo CSV, Excel o JSON para comenzar."}
            {phase === "mapping" &&
              "Asigná cada columna del archivo a un campo del sistema. Podés dejar columnas sin mapear."}
            {phase === "preview" &&
              "Revisá el resultado del mapeo y elegí qué items importar."}
            {phase === "done" && "Resultado de la importación."}
          </DialogDescription>
          {fileName && phase !== "idle" && phase !== "done" && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span className="font-medium text-foreground truncate max-w-[400px]">
                {fileName}
              </span>
              <span>·</span>
              <span>{parsed?.rows.length || 0} filas</span>
              <span>·</span>
              <span>{parsed?.headers.length || 0} columnas</span>
            </div>
          )}
        </DialogHeader>

        {/* ═══ STEPPER (fijo) ═══ */}
        {(phase === "mapping" || phase === "preview" || phase === "previewing") && (
          <div className="shrink-0 px-6 py-2 border-b bg-muted/30">
            <div className="flex items-center gap-1 text-xs">
              <StepBadge n={1} active={phase === "mapping"} done={phase !== "mapping"}>
                Mapear
              </StepBadge>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <StepBadge n={2} active={phase === "preview"} done={false}>
                Revisar
              </StepBadge>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <StepBadge n={3} active={false} done={false}>
                Confirmar
              </StepBadge>
            </div>
          </div>
        )}

        {/* ═══ BODY (flex-1, contenido variable según fase) ═══ */}
        <div className="flex-1 min-h-0 overflow-hidden">

          {/* ─── PASO 1: SUBIR ARCHIVO ──────────────────────────────────────── */}
          {phase === "idle" && (
            <div className="h-full overflow-y-auto p-6 space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTemplate}
                  className="border-dashed"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Descargar plantilla CSV
                </Button>
              </div>

              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <p className="font-medium">Cómo funciona</p>
                    <p className="text-xs text-muted-foreground">
                      Subí tu archivo. En el próximo paso vas a poder mapear las
                      columnas de tu planilla a los campos del sistema, sin
                      importar cómo se llamen. Aceptamos <code>.csv</code>,{" "}
                      <code>.xlsx</code> y <code>.json</code>.
                    </p>
                  </div>
                </AlertDescription>
              </Alert>

              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFile(file);
                }}
              >
                <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">
                  Hacé click o arrastrá un archivo aquí
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  CSV, XLSX o JSON · máx ~5MB recomendado
                </p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </div>

              {errorMsg && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* ─── PASO 1.5: PARSING ──────────────────────────────────────────── */}
          {phase === "parsing" && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Leyendo el archivo…
                </p>
              </div>
            </div>
          )}

          {/* ─── PASO 2: MAPEAR COLUMNAS (layout sidebar + main) ──────────── */}
          {(phase === "mapping" || phase === "previewing") && parsed && (
            <div className="h-full flex flex-col">
              {/* ─── Toolbar de stats + acciones (fijo arriba) ─── */}
              <div className="shrink-0 px-6 py-2.5 border-b bg-background flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <Badge variant="outline" className="bg-muted/50">
                    <Columns3 className="w-3 h-3 mr-1" />
                    {parsed.headers.length} columnas en el archivo
                  </Badge>
                  <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                    {mappingStats.mapped} mapeadas
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      requiredSatisfied
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }
                  >
                    {mappingStats.requiredMapped}/{mappingStats.totalRequired} obligatorias
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={autoDetectAll}
                    className="h-7 text-xs"
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    Auto-detectar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllMappings}
                    className="h-7 text-xs"
                  >
                    Limpiar
                  </Button>
                </div>
              </div>

              {/* ─── Alert si faltan obligatorios (fija, debajo de toolbar) ─── */}
              {!requiredSatisfied && (
                <div className="shrink-0 px-6 pt-2">
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Faltan mapear campos obligatorios. No podés continuar hasta
                      asignarlos.
                    </AlertDescription>
                  </Alert>
                </div>
              )}

              {/* ─── Cuerpo principal: sidebar izq (cols archivo) + main (campos) ─ */}
              <div className="flex-1 min-h-0 flex">
                {/* ═══ Sidebar: Columnas en archivo ═══ */}
                <aside className="w-56 shrink-0 border-r bg-muted/20 flex flex-col min-h-0 hidden md:flex">
                  <div className="shrink-0 px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Columnas en archivo
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {parsed.headers.length}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
                    {parsed.headers.map((h, i) => {
                      const isUsed = Object.values(columnMapping).includes(i);
                      return (
                        <div
                          key={i}
                          className={`rounded border px-2 py-1.5 text-[11px] flex items-center gap-1.5 ${
                            isUsed
                              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                              : "bg-background border-border text-foreground"
                          }`}
                        >
                          {isUsed ? (
                            <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-600" />
                          ) : (
                            <span className="w-3 h-3 shrink-0 rounded-full border border-muted-foreground/30" />
                          )}
                          <span className="truncate flex-1">{h || `(col ${i + 1})`}</span>
                          <span className="text-[9px] text-muted-foreground shrink-0">
                            #{i + 1}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </aside>

                {/* ═══ Main: Campos del sistema + Vista previa ═══ */}
                <div className="flex-1 min-h-0 flex flex-col">
                  {/* Columnas del archivo (visible solo en pantallas chicas, md:hidden) */}
                  <div className="shrink-0 md:hidden px-6 py-1.5 border-b bg-muted/20 flex items-center gap-1.5 flex-wrap text-[10px]">
                    <span className="text-muted-foreground font-medium shrink-0">
                      Columnas en archivo:
                    </span>
                    {parsed.headers.map((h, i) => {
                      const isUsed = Object.values(columnMapping).includes(i);
                      return (
                        <Badge
                          key={i}
                          variant="outline"
                          className={`text-[10px] py-0 h-4 ${
                            isUsed
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {isUsed && <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />}
                          {h || `(col ${i + 1})`}
                        </Badge>
                      );
                    })}
                  </div>

                  {/* Header "Campos del sistema" */}
                  <div className="shrink-0 px-6 pt-3 pb-1.5 flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Campos del sistema ({fields.length})
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Mapeados: {mappingStats.mapped}/{fields.length}
                    </div>
                  </div>

                  {/* Grid de campos (scrollable, flex-1) */}
                  <div
                    className="flex-1 min-h-0 overflow-y-auto px-6 pb-3"
                    style={{ contain: "strict" }}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2">
                      {fields.map((field) => {
                        const idx = columnMapping[field.key];
                        const isMapped = idx !== undefined && idx >= 0;
                        const samples = isMapped ? sampleValues(idx) : [];
                        const usedColumnIndices = Object.values(columnMapping).filter(
                          (i) => i !== idx
                        );

                        return (
                          <div
                            key={field.key}
                            className={`rounded-md border p-2.5 transition-colors ${
                              isMapped
                                ? "border-indigo-200 bg-indigo-50/30"
                                : field.required
                                ? "border-amber-200 bg-amber-50/30"
                                : "border-border bg-background"
                            }`}
                          >
                            {/* Label + estado */}
                            <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                              {field.required && (
                                <span className="text-amber-600 text-xs font-bold shrink-0">*</span>
                              )}
                              <Label className="text-xs font-medium truncate flex-1 min-w-0">
                                {field.label}
                              </Label>
                              {field.type !== "text" && (
                                <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 shrink-0">
                                  {field.type}
                                </Badge>
                              )}
                              {isMapped ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              ) : (
                                <span className="text-[10px] text-muted-foreground italic shrink-0">
                                  sin mapear
                                </span>
                              )}
                            </div>
                            {/* Hint */}
                            {field.hint && (
                              <p className="text-[10px] text-muted-foreground mb-1.5 leading-tight">
                                {field.hint}
                              </p>
                            )}
                            {/* Select */}
                            <Select
                              value={isMapped ? String(idx) : "none"}
                              onValueChange={(v) =>
                                setFieldMapping(
                                  field.key,
                                  v === "none" ? -1 : Number(v)
                                )
                              }
                            >
                              <SelectTrigger className="h-8 w-full text-xs">
                                <SelectValue placeholder="Elegir columna…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">
                                  <span className="text-muted-foreground italic">
                                    — No mapear —
                                  </span>
                                </SelectItem>
                                {parsed.headers.map((h, i) => (
                                  <SelectItem
                                    key={i}
                                    value={String(i)}
                                    disabled={usedColumnIndices.includes(i)}
                                  >
                                    <span className={usedColumnIndices.includes(i) ? "opacity-50" : ""}>
                                      {h || `(columna ${i + 1})`}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {/* Mapped column badge */}
                            {isMapped && (
                              <div className="mt-1.5 flex items-center gap-1 text-[10px]">
                                <Badge
                                  variant="outline"
                                  className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] py-0 h-4 truncate max-w-full"
                                >
                                  {columnLabel(idx)}
                                </Badge>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ─── Vista previa (header fuera del scroll) ─── */}
                  <div className="shrink-0 px-6 pt-2 pb-1 border-t bg-muted/30">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      Vista previa (primeras 8 filas con el mapeo actual)
                    </div>
                  </div>

                  {/* Tabla preview (h-32 fija, scroll-x+y interno) */}
                  <div className="shrink-0 h-32 border-t bg-background overflow-auto">
                    {Object.keys(columnMapping).length === 0 ? (
                      <div className="h-full flex items-center justify-center text-center p-4">
                        <div className="text-xs text-muted-foreground space-y-1">
                          <Eye className="w-6 h-6 mx-auto opacity-30" />
                          <p>Mapeá al menos un campo para ver la vista previa.</p>
                        </div>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader className="sticky top-0 bg-muted/60 z-10">
                          <TableRow>
                            <TableHead className="h-7 text-[10px] w-10">#</TableHead>
                            {fields
                              .filter((f) => columnMapping[f.key] !== undefined)
                              .map((f) => (
                                <TableHead key={f.key} className="h-7 text-[10px] whitespace-nowrap">
                                  {f.label}
                                </TableHead>
                              ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsed.rows.slice(0, 8).map((row, rowIdx) => (
                            <TableRow key={rowIdx}>
                              <TableCell className="text-[10px] py-1 text-muted-foreground">
                                {rowIdx + 2}
                              </TableCell>
                              {fields
                                .filter((f) => columnMapping[f.key] !== undefined)
                                .map((f) => {
                                  const v = row[columnMapping[f.key]];
                                  return (
                                    <TableCell key={f.key} className="text-[10px] py-1 whitespace-nowrap">
                                      {v === null || v === undefined || v === ""
                                        ? "—"
                                        : String(v)}
                                    </TableCell>
                                  );
                                })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </div>
              </div>

              {/* Error msg (fija abajo) */}
              {errorMsg && (
                <div className="shrink-0 px-6 py-2 border-t">
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{errorMsg}</AlertDescription>
                  </Alert>
                </div>
              )}
            </div>
          )}

          {/* ─── PASO 2.5: loading preview ─────────────────────────────────── */}
          {phase === "previewing" && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Analizando {parsed?.rows.length || 0} filas con el mapeo elegido…
                </p>
              </div>
            </div>
          )}

          {/* ─── PASO 3: PREVIEW DE ITEMS ──────────────────────────────────── */}
          {phase === "preview" && preview && (
            <div className="h-full flex flex-col">
              {/* Stats bar (fija arriba) */}
              <div className="shrink-0 px-6 py-2.5 border-b bg-background flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {preview.summary.create} a crear
                  </Badge>
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {preview.summary.update} a actualizar
                  </Badge>
                  {preview.summary.error > 0 && (
                    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                      <XCircle className="w-3 h-3 mr-1" />
                      {preview.summary.error} con error
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <Button variant="ghost" size="sm" onClick={selectAll}>
                    Todos
                  </Button>
                  <Button variant="ghost" size="sm" onClick={selectOnlyCreates}>
                    Solo nuevos
                  </Button>
                  <Button variant="ghost" size="sm" onClick={selectNone}>
                    Ninguno
                  </Button>
                </div>
              </div>

              {/* Tabla (scrollable) */}
              <div className="flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-24">Acción</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="text-muted-foreground">
                        Detalle
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.items.slice(0, 500).map((item) => {
                      const selectable =
                        item.action === "create" || item.action === "update";
                      const checked = selectedRowIndices.has(item.rowIndex);
                      return (
                        <TableRow
                          key={item.rowIndex}
                          className={
                            !selectable
                              ? "opacity-50"
                              : checked
                              ? "bg-indigo-50/50"
                              : ""
                          }
                        >
                          <TableCell>
                            {selectable && (
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleRow(item.rowIndex)}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.rowIndex}
                          </TableCell>
                          <TableCell>
                            {item.action === "create" && (
                              <Badge
                                variant="outline"
                                className="bg-emerald-50 text-emerald-700 border-emerald-200"
                              >
                                Crear
                              </Badge>
                            )}
                            {item.action === "update" && (
                              <Badge
                                variant="outline"
                                className="bg-amber-50 text-amber-700 border-amber-200"
                              >
                                Actualizar
                              </Badge>
                            )}
                            {item.action === "error" && (
                              <Badge
                                variant="outline"
                                className="bg-red-50 text-red-700 border-red-200"
                              >
                                Error
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {item.name || (
                              <span className="text-muted-foreground italic">
                                sin nombre
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.action === "update" && (
                              <span>
                                Ya existe como{" "}
                                <span className="font-medium">
                                  {item.existingName}
                                </span>{" "}
                                (coincidencia por{" "}
                                <span className="font-mono">{item.matchBy}</span>)
                              </span>
                            )}
                            {item.action === "error" && (
                              <span className="text-red-600">{item.error}</span>
                            )}
                            {item.action === "create" &&
                              item.data?.barcode &&
                              `Código: ${item.data.barcode}`}
                            {item.action === "create" &&
                              !item.data?.barcode &&
                              item.data?.cuit &&
                              `CUIT: ${item.data.cuit}`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {preview.items.length > 500 && (
                  <div className="p-2 text-center text-xs text-muted-foreground">
                    Mostrando primeros 500 de {preview.items.length} items
                  </div>
                )}
              </div>

              {/* Selection count (fijo abajo) */}
              <div className="shrink-0 px-6 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
                {selectedRowIndices.size} de{" "}
                {preview.summary.create + preview.summary.update} {entityLabelPlural}{" "}
                seleccionados
              </div>

              {errorMsg && (
                <div className="shrink-0 px-6 py-2 border-t">
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{errorMsg}</AlertDescription>
                  </Alert>
                </div>
              )}
            </div>
          )}

          {/* ─── COMMITTING ──────────────────────────────────────────────── */}
          {phase === "committing" && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Guardando {selectedRowIndices.size} {entityLabelPlural}…
                </p>
              </div>
            </div>
          )}

          {/* ─── PASO 4: RESULTADO ───────────────────────────────────────── */}
          {phase === "done" && commitResult && (
            <div className="h-full overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-emerald-50/50 p-4 text-center">
                  <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-600 mb-1" />
                  <div className="text-2xl font-bold text-emerald-700">
                    {commitResult.created}
                  </div>
                  <div className="text-xs text-muted-foreground">creados</div>
                </div>
                <div className="rounded-lg border bg-amber-50/50 p-4 text-center">
                  <AlertTriangle className="w-6 h-6 mx-auto text-amber-600 mb-1" />
                  <div className="text-2xl font-bold text-amber-700">
                    {commitResult.updated}
                  </div>
                  <div className="text-xs text-muted-foreground">actualizados</div>
                </div>
                <div className="rounded-lg border bg-red-50/50 p-4 text-center">
                  <XCircle className="w-6 h-6 mx-auto text-red-600 mb-1" />
                  <div className="text-2xl font-bold text-red-700">
                    {commitResult.errors.length}
                  </div>
                  <div className="text-xs text-muted-foreground">errores</div>
                </div>
              </div>

              {commitResult.errors.length > 0 && (
                <div className="border rounded-md max-h-64 overflow-y-auto">
                  <div className="p-3 space-y-1 text-xs">
                    {commitResult.errors.slice(0, 50).map((e, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-muted-foreground">#{e.rowIndex}</span>
                        <span className="font-medium">{e.name}</span>
                        <span className="text-red-600">{e.error}</span>
                      </div>
                    ))}
                    {commitResult.errors.length > 50 && (
                      <div className="text-muted-foreground italic">
                        …y {commitResult.errors.length - 50} errores más
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ FOOTER (fijo) ═══ */}
        <DialogFooter className="shrink-0 px-6 py-3 border-t bg-background gap-2">
          {phase === "idle" && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
          )}

          {phase === "mapping" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setPhase("idle");
                  setParsed(null);
                  setColumnMapping({});
                  setErrorMsg("");
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Atrás
              </Button>
              <Button
                onClick={handlePreview}
                disabled={!requiredSatisfied}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                Continuar a revisión
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </>
          )}

          {phase === "preview" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setPhase("mapping");
                  setPreview(null);
                  setErrorMsg("");
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Volver al mapeo
              </Button>
              <Button
                onClick={handleCommit}
                disabled={selectedRowIndices.size === 0}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                Importar {selectedRowIndices.size} {entityLabelPlural}
              </Button>
            </>
          )}

          {phase === "done" && (
            <Button
              onClick={() => handleOpenChange(false)}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-componente: badge de paso del wizard ──────────────────────────────────

function StepBadge({
  n,
  active,
  done,
  children,
}: {
  n: number;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${
        active
          ? "bg-indigo-100 text-indigo-700"
          : done
          ? "bg-emerald-50 text-emerald-700"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
          active
            ? "bg-indigo-600 text-white"
            : done
            ? "bg-emerald-600 text-white"
            : "bg-muted-foreground/30 text-white"
        }`}
      >
        {done ? "✓" : n}
      </span>
      {children}
    </div>
  );
}
