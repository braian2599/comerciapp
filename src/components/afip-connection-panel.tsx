"use client";

import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Loader2,
  Plug,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Wifi,
  ShieldCheck,
  FileKey,
  Server,
  HardDrive,
  Clock,
  RotateCw,
} from "lucide-react";
import { safeFetchJSON } from "@/lib/fetch";

/**
 * Tipos de respuesta del endpoint /api/afip/test.
 * Mantenidos en sync con src/app/api/afip/test/route.ts.
 */
interface AfipTestStep {
  name: string;
  ok: boolean;
  detail?: string;
}

interface AfipTestResponse {
  ok: boolean;
  error?: string;
  steps?: AfipTestStep[];
  tokenExpiresAt?: string;
  cuit?: string;
  puntoVenta?: number;
  environment?: string;
  // Para 4xx con body
  failedStep?: string;
}

/**
 * Estado de conexión AFIP derivado del test.
 * - "unknown": no se ha probado todavía
 * - "connected": último test OK (TA válido)
 * - "config_error": falta config (CUIT, environment, certPath)
 * - "cert_error": certificado ilegible o password incorrecta
 * - "wsaa_error": WSAA rechazó el TRA o no responde
 * - "network_error": timeout o sin conectividad
 */
type AfipStatus =
  | "unknown"
  | "connected"
  | "config_error"
  | "storage_error"
  | "cert_error"
  | "wsaa_error"
  | "network_error";

const STATUS_META: Record<
  AfipStatus,
  { label: string; color: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"; icon: typeof CheckCircle2 }
> = {
  unknown: { label: "Sin verificar", color: "secondary", icon: AlertTriangle },
  connected: { label: "Conectado", color: "success", icon: CheckCircle2 },
  config_error: { label: "Config incompleta", color: "warning", icon: AlertTriangle },
  storage_error: { label: "Storage inaccesible", color: "destructive", icon: XCircle },
  cert_error: { label: "Certificado inválido", color: "destructive", icon: XCircle },
  wsaa_error: { label: "WSAA rechazó", color: "destructive", icon: XCircle },
  network_error: { label: "Sin conexión", color: "destructive", icon: XCircle },
};

/**
 * Mappea una respuesta de /api/afip/test a un estado derivado.
 * El estado se calcula a partir del `failedStep` (si vino) o del último
 * step fallido en el array `steps`.
 */
function deriveStatus(resp: AfipTestResponse): AfipStatus {
  if (resp.ok) return "connected";

  // Buscar el step que falló
  const failed = resp.steps?.find((s) => !s.ok);
  if (!failed) {
    // Sin steps pero ok=false → network o AFIP caído
    return "network_error";
  }

  if (failed.name === "config") return "config_error";
  if (failed.name === "storage") return "storage_error";
  if (failed.name === "certificado") return "cert_error";
  if (failed.name === "wsaa" || failed.name === "wsaa_cache") return "wsaa_error";

  return "network_error";
}

interface AfipConnectionPanelProps {
  /** Configuración fiscal actual (para mostrar info contextual). */
  taxConfig: any | null;
  /** Callback opcional después de un test exitoso (ej. para refrescar UI). */
  onTestSuccess?: () => void;
}

/**
 * Panel de conexión AFIP.
 *
 * Muestra:
 *  - Badge de estado (conectado / error / sin verificar)
 *  - Botón "Probar conexión" que llama a /api/afip/test
 *  - Modal de diagnóstico con tabla detallada de steps
 *  - Info del TA (token de acceso) si está cacheado
 *  - Reintentos con backoff (máx 2) en caso de network_error
 *
 * Robustez:
 *  - Timeout cliente de 35s (el server usa 30s)
 *  - AbortController para cancelar si el usuario cierra el modal
 *  - Distingue 5 tipos de error para mensajes user-friendly
 *  - No retry si el error es de config o cert (no va a mejorar solo)
 *  - Retry solo si wsaa o network (AFIP a veces tiene microcortes)
 */
export function AfipConnectionPanel({
  taxConfig,
  onTestSuccess,
}: AfipConnectionPanelProps) {
  const [status, setStatus] = useState<AfipStatus>("unknown");
  const [testing, setTesting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [steps, setSteps] = useState<AfipTestStep[]>([]);
  const [testError, setTestError] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<Date | null>(null);
  const [lastTestAt, setLastTestAt] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const isProduction = taxConfig?.environment === "produccion";
  const hasCert = !!taxConfig?.certPath;
  const hasCuit = !!taxConfig?.cuit;

  /**
   * Ejecuta el test de conexión contra /api/afip/test.
   * Maneja 3 niveles de error:
   *  - 4xx con body JSON (config/cert/wsaa rechazado) → estado derivado
   *  - 5xx sin body o timeout → network_error
   *  - Fetch exception → network_error
   *
   * Backoff: si falla por wsaa o network, reintenta hasta 2 veces con
   * 1s + 2s de espera. No reintenta config_error ni cert_error.
   */
  const runTest = useCallback(
    async (attempt: number = 0): Promise<void> => {
      setTesting(true);
      setTestError(null);

      // AbortController para cancelar si pasa el timeout.
      // safeFetchJSON captura AbortError internamente y lo devuelve
      // como { ok: false, error: "Aborted" } (status 0), así que
      // lo detectamos por el mensaje.
      const ctrl = new AbortController();
      const timeoutMs = 35000; // 35s (server usa 30s)
      const t = setTimeout(() => ctrl.abort(), timeoutMs);

      // Flag para saber si vamos a reintentar (en cuyo caso NO bajamos
      // el flag `testing` todavía).
      let willRetry = false;

      try {
        let result;
        try {
          result = await safeFetchJSON<AfipTestResponse>("/api/afip/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            signal: ctrl.signal,
          });
        } catch (e: any) {
          // Excepción inesperada fuera de safeFetchJSON
          setStatus("network_error");
          setTestError(e?.message || "Error inesperado");
          setLastTestAt(new Date());
          toast.error("Error inesperado", { description: e?.message });
          return;
        }

        const { ok, data, error, status: httpStatus } = result;

        // Caso 1: éxito
        if (ok && data?.ok) {
          setStatus("connected");
          setSteps(data.steps || []);
          setTokenExpiresAt(
            data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null
          );
          setLastTestAt(new Date());
          setRetryCount(0);
          toast.success("Conexión AFIP verificada", {
            description: data.tokenExpiresAt
              ? `Token válido hasta ${new Date(data.tokenExpiresAt).toLocaleString("es-AR")}`
              : undefined,
            duration: 5000,
          });
          onTestSuccess?.();
          return;
        }

        // Detectar abort por timeout
        const isTimeout =
          error === "Aborted" ||
          (typeof error === "string" && error.includes("Aborted")) ||
          (httpStatus === 0 && !data);

        // Caso 2: error con body JSON estructurado (4xx usualmente)
        if (data && typeof data === "object" && (data.steps || data.error)) {
          const derived = deriveStatus(data);
          setStatus(derived);
          setSteps(data.steps || []);
          setTestError(data.error || error || "Error desconocido");
          setLastTestAt(new Date());

          // Reintentar solo wsaa o network (no config ni cert)
          const shouldRetry =
            attempt < 2 &&
            (derived === "wsaa_error" || derived === "network_error");

          if (shouldRetry) {
            willRetry = true;
            setRetryCount(attempt + 1);
            const backoffMs = 1000 * (attempt + 1); // 1s, 2s
            toast.warning(
              `Reintentando en ${backoffMs / 1000}s (intento ${attempt + 1}/2)...`,
              {
                description:
                  derived === "wsaa_error"
                    ? "AFIP rechazó el TRA"
                    : "Sin respuesta de AFIP",
              }
            );
            await new Promise((r) => setTimeout(r, backoffMs));
            return runTest(attempt + 1);
          }

          toast.error(
            derived === "config_error"
              ? "Configuración AFIP incompleta"
              : derived === "cert_error"
                ? "No se pudo leer el certificado"
                : derived === "wsaa_error"
                  ? "AFIP rechazó la autenticación"
                  : "Sin conexión con AFIP",
            { description: data.error, duration: 8000 }
          );
          return;
        }

        // Caso 3: error sin body claro (5xx, timeout, fetch exception)
        setStatus("network_error");
        setTestError(
          isTimeout
            ? "Timeout: AFIP no respondió en 35s"
            : error || `HTTP ${httpStatus}`
        );
        setLastTestAt(new Date());

        if (attempt < 2 && !isTimeout) {
          willRetry = true;
          setRetryCount(attempt + 1);
          const backoffMs = 1000 * (attempt + 1);
          toast.warning(
            `Reintentando en ${backoffMs / 1000}s (intento ${attempt + 1}/2)...`
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          return runTest(attempt + 1);
        }

        toast.error(
          isTimeout ? "Timeout contactando AFIP" : "Sin conexión con AFIP",
          { description: error || `HTTP ${httpStatus}`, duration: 8000 }
        );
      } finally {
        clearTimeout(t);
        if (!willRetry) {
          setTesting(false);
        }
      }
    },
    [onTestSuccess]
  );

  const handleTestClick = useCallback(() => {
    setModalOpen(true);
    setSteps([]);
    setTestError(null);
    setRetryCount(0);
    void runTest(0);
  }, [runTest]);

  const handleManualRetry = useCallback(() => {
    setSteps([]);
    setTestError(null);
    setRetryCount(0);
    void runTest(0);
  }, [runTest]);

  // ----- Render -----
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;

  // Pre-condición: si no hay config, mostrar aviso y deshabilitar
  if (!taxConfig) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-500" />
          Guardá la configuración fiscal primero para poder probar la conexión con AFIP.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-blue-100">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Wifi className="w-4 h-4 text-blue-600" />
                Conexión AFIP Producción
              </CardTitle>
              <CardDescription className="text-xs">
                Verifica certificado + WSAA sin emitir comprobantes.
              </CardDescription>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Badge
                      variant={meta.color as any}
                      className="flex items-center gap-1 cursor-help"
                    >
                      <StatusIcon className="w-3 h-3" />
                      {meta.label}
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs max-w-[280px]">
                  {status === "unknown" && "Todavía no probaste la conexión."}
                  {status === "connected" && tokenExpiresAt && (
                    <>
                      Último test: {lastTestAt?.toLocaleString("es-AR")}
                      <br />
                      Token válido hasta: {tokenExpiresAt.toLocaleString("es-AR")}
                    </>
                  )}
                  {status === "config_error" && "Falta CUIT, environment o certPath."}
                  {status === "storage_error" && "S3 o FS local inaccesible. Verificá credenciales y permisos."}
                  {status === "cert_error" && "El certificado .p12 no se pudo leer (password incorrecta o archivo corrupto)."}
                  {status === "wsaa_error" && "AFIP rechazó el TRA firmado. Revisá CUIT emisor vs certificado."}
                  {status === "network_error" && "Timeout o sin respuesta de AFIP. Reintentá más tarde."}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Pre-condiciones */}
          {!isProduction && (
            <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <strong>Modo homologación activo.</strong> El test de conexión
                requiere <code className="bg-blue-100 px-1 rounded">environment=produccion</code>.
                Cambialo más arriba y guardá antes de probar.
              </div>
            </div>
          )}
          {isProduction && !hasCert && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              <FileKey className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <strong>Falta certificado.</strong> Cargá el archivo .p12 en el
                servidor y configurá <code className="bg-amber-100 px-1 rounded">certPath</code>.
              </div>
            </div>
          )}
          {isProduction && !hasCuit && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <strong>Falta CUIT del emisor.</strong> Completá el CUIT más arriba.
              </div>
            </div>
          )}

          {/* Info del TA cacheado */}
          {status === "connected" && tokenExpiresAt && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <div className="flex-1">
                <div>
                  <strong>Token de acceso activo.</strong> Renovación automática 1h antes del vencimiento.
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Expira: {tokenExpiresAt.toLocaleString("es-AR")}
                </div>
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestClick}
              disabled={testing || !isProduction || !hasCert || !hasCuit}
              className="gap-2"
            >
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Probando{retryCount > 0 ? ` (intento ${retryCount}/2)` : "…"}
                </>
              ) : (
                <>
                  <Plug className="w-3.5 h-3.5" />
                  Probar conexión
                </>
              )}
            </Button>

            {status !== "unknown" && !testing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleManualRetry}
                className="gap-2 text-muted-foreground"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Reintentar
              </Button>
            )}

            {lastTestAt && !testing && (
              <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {lastTestAt.toLocaleTimeString("es-AR")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Modal de diagnóstico */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              ) : status === "connected" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
              Diagnóstico AFIP
            </DialogTitle>
            <DialogDescription className="text-xs">
              Verificación de conexión con AFIP producción. No se emiten comprobantes.
            </DialogDescription>
          </DialogHeader>

          {/* Resumen */}
          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-3">
              <Badge variant={meta.color as any} className="flex items-center gap-1">
                <StatusIcon className="w-3 h-3" />
                {meta.label}
              </Badge>
              {tokenExpiresAt && status === "connected" && (
                <span className="text-xs text-muted-foreground">
                  Token válido hasta:{" "}
                  <span className="font-medium text-emerald-700">
                    {tokenExpiresAt.toLocaleString("es-AR")}
                  </span>
                </span>
              )}
            </div>
            {lastTestAt && (
              <span className="text-xs text-muted-foreground">
                {lastTestAt.toLocaleTimeString("es-AR")}
              </span>
            )}
          </div>

          {/* Error global */}
          {testError && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">No se pudo completar el diagnóstico</div>
                <div className="mt-1 text-red-700 break-words">{testError}</div>
              </div>
            </div>
          )}

          {/* Tabla de steps */}
          {steps.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead className="text-xs">Paso</TableHead>
                    <TableHead className="text-xs">Detalle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {steps.map((step, idx) => {
                    const stepMeta = STEP_META[step.name] || {
                      label: step.name,
                      icon: Server,
                    };
                    const StepIcon = stepMeta.icon;
                    return (
                      <TableRow key={`${step.name}-${idx}`}>
                        <TableCell>
                          {step.ok ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-medium align-top">
                          <div className="flex items-center gap-2">
                            <StepIcon className="w-3.5 h-3.5 text-muted-foreground" />
                            {stepMeta.label}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground break-words align-top">
                          {step.detail || (step.ok ? "OK" : "—")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Estado vacío mientras carga */}
          {testing && steps.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-blue-600" />
              Contactando AFIP…
              <div className="text-xs mt-1">
                Esto puede tardar hasta 30s (WSAA es lento).
              </div>
            </div>
          )}

          {/* Sugerencias según estado */}
          {status === "config_error" && (
            <SuggestionBox
              title="Configuración incompleta"
              items={[
                "Verificá que CUIT, environment=produccion y certPath estén seteados.",
                "Guardá la configuración fiscal antes de probar.",
                "El CUIT debe coincidir con el del certificado.",
              ]}
            />
          )}
          {status === "cert_error" && (
            <SuggestionBox
              title="Certificado inválido"
              items={[
                "Si es .p12: verificá que certPassword sea correcto.",
                "El .p12 debe estar exportado con clave privada incluida.",
                "Si es .pem: verificá que privateKeyPath apunte al key PEM.",
                "El certificado no debe estar vencido (validez 2-3 años).",
              ]}
            />
          )}
          {status === "wsaa_error" && (
            <SuggestionBox
              title="WSAA rechazó el TRA"
              items={[
                "Verificá que el CUIT del TaxConfig coincida con el del certificado.",
                "El certificado debe estar autorizado para wsfe (servicio de facturación).",
                "Si usaste el certificado en otro servidor, podría estar revocado.",
                "AFIP a veces tiene microcortes; esperá 5min y reintentá.",
              ]}
            />
          )}
          {status === "storage_error" && (
            <SuggestionBox
              title="Storage inaccesible"
              items={[
                "Si usás S3/R2/B2/MinIO: verificá S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT.",
                "Verificá que las credenciales tengan permisos de lectura/escritura sobre el bucket.",
                "Si usás FS local: verificá que UPLOADS_DIR exista y sea escribible.",
                "Si migraste de FS a S3, los certs viejos se migran automáticamente al leerlos.",
              ]}
            />
          )}
          {status === "network_error" && (
            <SuggestionBox
              title="Sin conexión con AFIP"
              items={[
                "AFIP puede tardar hasta 30s en responder; esperá y reintentá.",
                "Verificá que el servidor tenga salida a internet (https://wsaa.afip.gov.ar).",
                "Si el problema persiste, revisá el estado de AFIP en arca.afip.gob.ar.",
              ]}
            />
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualRetry}
              disabled={testing}
              className="gap-2"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Reintentar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setModalOpen(false)}
              className="gap-2"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ----- Helpers de UI -----

const STEP_META: Record<string, { label: string; icon: typeof Server }> = {
  config: { label: "Configuración fiscal", icon: Server },
  storage: { label: "Storage (S3/FS)", icon: HardDrive },
  certificado: { label: "Certificado digital", icon: FileKey },
  wsaa: { label: "WSAA (autenticación)", icon: ShieldCheck },
  wsaa_cache: { label: "Cache de token", icon: Clock },
};

function SuggestionBox({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
      <div className="font-medium mb-1.5 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" />
        {title}
      </div>
      <ul className="space-y-1 list-disc list-inside text-amber-800">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
