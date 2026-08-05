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
import { ScrollArea } from "@/components/ui/scroll-area";
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
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            Importar {entityLabelPlural}
          </DialogTitle>
          <DialogDescription>
            {phase === "idle" && "Subí un archivo CSV, Excel o JSON para comenzar."}
            {phase === "mapping" &&
              "Asigná cada columna del archivo a un campo del sistema. Podés dejar columnas sin mapear."}
            {phase === "preview" &&
              "Revisá el resultado del mapeo y elegí qué items importar."}
            {phase === "done" && "Resultado de la importación."}
          </DialogDescription>
        </DialogHeader>

        {/* Indicador de pasos */}
        {(phase === "mapping" || phase === "preview" || phase === "previewing") && (
          <div className="flex items-center gap-1 text-xs shrink-0">
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
        )}

        {/* ════════════════════════════════════════════════════════════════════════
                PASO 1: SUBIR ARCHIVO                                                   */}
        {phase === "idle" && (
          <div className="space-y-4 py-2">
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

        {/* ════════════════════════════════════════════════════════════════════════
                PASO 2: MAPEAR COLUMNAS                                                 */}
        {(phase === "mapping" || phase === "previewing") && parsed && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
              <div className="flex items-center gap-2 text-xs">
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

            {/* Alert si faltan obligatorios */}
            {!requiredSatisfied && (
              <Alert variant="destructive" className="shrink-0">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Faltan mapear campos obligatorios. No podés continuar hasta
                  asignarlos.
                </AlertDescription>
              </Alert>
            )}

            {/* Lista de campos a mapear */}
            <ScrollArea className="flex-1 border rounded-md min-h-0">
              <div className="p-3 space-y-2">
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
                      className={`rounded-md border p-3 transition-colors ${
                        isMapped
                          ? "border-indigo-200 bg-indigo-50/30"
                          : field.required
                          ? "border-amber-200 bg-amber-50/30"
                          : "border-border bg-background"
                      }`}
                    >
                      {/* Fila 1: label + tipo + estado (sin truncate, permite wrap) */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {field.required && (
                            <span className="text-amber-600 text-sm font-bold">*</span>
                          )}
                          <Label className="text-sm font-medium">
                            {field.label}
                          </Label>
                          {field.type !== "text" && (
                            <Badge variant="outline" className="text-[9px] py-0 px-1 h-4">
                              {field.type}
                            </Badge>
                          )}
                        </div>
                        {isMapped ? (
                          <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs shrink-0"
                          >
                            <CheckCircle2 className="w-3 h-3 mr-0.5" />
                            {columnLabel(idx)}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic shrink-0">
                            sin mapear
                          </span>
                        )}
                      </div>
                      {/* Hint (siempre visible, no truncado) */}
                      {field.hint && (
                        <p className="text-[10px] text-muted-foreground mb-2">
                          {field.hint}
                        </p>
                      )}
                      {/* Fila 2: Select ancho */}
                      <Select
                        value={isMapped ? String(idx) : "none"}
                        onValueChange={(v) =>
                          setFieldMapping(
                            field.key,
                            v === "none" ? -1 : Number(v)
                          )
                        }
                      >
                        <SelectTrigger className="h-9 w-full text-sm">
                          <SelectValue placeholder="Elegir columna del archivo…" />
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
                      {/* Sample values preview */}
                      {isMapped && samples.length > 0 && (
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                          <span className="shrink-0">Ejemplos:</span>
                          {samples.map((s, i) => (
                            <code
                              key={i}
                              className="px-1.5 py-0.5 bg-muted rounded truncate max-w-[200px]"
                            >
                              {s}
                            </code>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Preview de primeras filas con el mapeo actual */}
            <div className="shrink-0 border rounded-md overflow-hidden">
              <div className="bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <Eye className="w-3 h-3" />
                Vista previa (primeras 3 filas)
              </div>
              <ScrollArea className="h-24">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-7 text-[10px]">#</TableHead>
                      {fields
                        .filter((f) => columnMapping[f.key] !== undefined)
                        .map((f) => (
                          <TableHead key={f.key} className="h-7 text-[10px]">
                            {f.label}
                          </TableHead>
                        ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.slice(0, 3).map((row, rowIdx) => (
                      <TableRow key={rowIdx}>
                        <TableCell className="text-[10px] py-1 text-muted-foreground">
                          {rowIdx + 2}
                        </TableCell>
                        {fields
                          .filter((f) => columnMapping[f.key] !== undefined)
                          .map((f) => {
                            const v = row[columnMapping[f.key]];
                            return (
                              <TableCell key={f.key} className="text-[10px] py-1 truncate max-w-[120px]">
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
              </ScrollArea>
            </div>

            {errorMsg && (
              <Alert variant="destructive" className="shrink-0">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════════
                PASO 2.5: loading preview                                               */}
        {phase === "previewing" && (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
            <p className="text-sm text-muted-foreground">
              Analizando {parsed?.rows.length || 0} filas con el mapeo elegido…
            </p>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════════
                PASO 3: PREVIEW DE ITEMS                                                 */}
        {phase === "preview" && preview && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
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

            <ScrollArea className="flex-1 border rounded-md min-h-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="text-muted-foreground">
                      Detalle
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.items.slice(0, 200).map((item) => {
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
              {preview.items.length > 200 && (
                <div className="p-2 text-center text-xs text-muted-foreground">
                  Mostrando primeros 200 de {preview.items.length} items
                </div>
              )}
            </ScrollArea>

            <div className="text-xs text-muted-foreground shrink-0">
              {selectedRowIndices.size} de{" "}
              {preview.summary.create + preview.summary.update} {entityLabelPlural}{" "}
              seleccionados
            </div>

            {errorMsg && (
              <Alert variant="destructive" className="shrink-0">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════════
                Fase committing                                                        */}
        {phase === "committing" && (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
            <p className="text-sm text-muted-foreground">
              Guardando {selectedRowIndices.size} {entityLabelPlural}…
            </p>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════════
                PASO 4: RESULTADO                                                       */}
        {phase === "done" && commitResult && (
          <div className="space-y-4 py-2">
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
              <ScrollArea className="h-32 border rounded-md">
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
              </ScrollArea>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════════
                FOOTER con acciones según fase                                          */}
        <DialogFooter>
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
