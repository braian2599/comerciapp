"use client";

/**
 * Dialog de importación masiva reutilizable para productos y clientes.
 *
 * Flujo:
 *   1. Usuario hace click en "Importar"
 *   2. El dialog abre con: botón "Descargar plantilla", file input,
 *      instrucciones y formato esperado.
 *   3. Usuario elige un archivo CSV/XLSX/JSON.
 *   4. Se parsea en cliente y se envía al API endpoint (mode=preview).
 *   5. El API responde con items clasificados: create | update | error.
 *   6. Usuario puede des/seleccionar items (especialmente los updates).
 *   7. Usuario confirma → se envía mode=commit → resultado final.
 *
 * Props:
 *   - endpoint:  URL del API route ("/api/products/import" | "/api/customers/import")
 *   - templateHeaders: columnas sugeridas para la plantilla descargable
 *   - templateName: nombre del archivo de plantilla
 *   - entityLabel: "producto" | "cliente" (para textos)
 *   - onImported: callback al terminar (para que el view recargue la lista)
 */
import { useState, useRef, useCallback } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Upload,
  Download,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileJson,
} from "lucide-react";
import {
  parseFile,
  generateCSV,
  downloadTextFile,
} from "@/lib/file-parser";

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
  templateHeaders: string[];
  templateName: string;
  entityLabel: string; // "producto" | "cliente"
  entityLabelPlural: string; // "productos" | "clientes"
  onImported?: () => void;
}

type Phase = "idle" | "parsing" | "preview" | "committing" | "done";

export function ImportDialog({
  open,
  onOpenChange,
  endpoint,
  templateHeaders,
  templateName,
  entityLabel,
  entityLabelPlural,
  onImported,
}: ImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
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

  async function handleFile(file: File) {
    setPhase("parsing");
    setErrorMsg("");
    setFileName(file.name);

    let parsed;
    try {
      parsed = await parseFile(file);
    } catch (e: any) {
      setErrorMsg(e?.message || "No se pudo leer el archivo");
      setPhase("idle");
      return;
    }

    if (!parsed.rows.length) {
      setErrorMsg("El archivo está vacío o no tiene filas de datos");
      setPhase("idle");
      return;
    }

    // Llamar al API en modo preview
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          headers: parsed.headers,
          rows: parsed.rows,
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
      setPhase("idle");
    }
  }

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
      if (result.errors.length)
        parts.push(`${result.errors.length} con error`);
      toast.success(`Importación completa`, {
        description: parts.join(" · ") || "Sin cambios",
      });
    } catch (e: any) {
      setErrorMsg(e?.message || "Error al importar");
      setPhase("preview");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            Importar {entityLabelPlural}
          </DialogTitle>
          <DialogDescription>
            Subí un archivo CSV, Excel o JSON. Primero analizaremos el contenido
            y te mostraremos un preview antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        {/* Fase idle: input + plantilla */}
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
                  <p className="font-medium">Formato esperado</p>
                  <p className="text-xs text-muted-foreground">
                    Primera fila: nombres de columnas. Filas siguientes: datos.
                    Aceptamos también <code>.xlsx</code> y <code>.json</code>{" "}
                    (array de objetos).
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Columnas reconocidas:{" "}
                    <code className="text-[10px]">
                      {templateHeaders.join(", ")}
                    </code>
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

        {/* Fase parsing: spinner */}
        {phase === "parsing" && (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
            <p className="text-sm text-muted-foreground">
              Analizando <span className="font-medium">{fileName}</span>...
            </p>
          </div>
        )}

        {/* Fase preview: tabla de items */}
        {phase === "preview" && preview && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            {/* Resumen + filtros rápidos */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
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

            {/* Tabla */}
            <ScrollArea className="flex-1 border rounded-md">
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
                  {preview.items.map((item) => {
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
            </ScrollArea>

            <div className="text-xs text-muted-foreground">
              {selectedRowIndices.size} de{" "}
              {preview.summary.create + preview.summary.update}{" "}
              {entityLabelPlural} seleccionados
            </div>

            {errorMsg && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Fase committing: spinner */}
        {phase === "committing" && (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
            <p className="text-sm text-muted-foreground">
              Guardando {selectedRowIndices.size} {entityLabelPlural}...
            </p>
          </div>
        )}

        {/* Fase done: resultado */}
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
                      ...y {commitResult.errors.length - 50} errores más
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === "idle" && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
          )}
          {phase === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>
                <FileJson className="w-4 h-4 mr-2" />
                Elegir otro archivo
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
