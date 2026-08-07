"use client";

/**
 * AfipCertificateUploader
 *
 * Componente para subir, eliminar e inspeccionar el certificado digital
 * AFIP (.p12/.pfx o .pem) desde la UI de configuración fiscal.
 *
 * Funcionalidades:
 *  - Drag & drop o click para seleccionar archivo
 *  - Soporta .p12/.pfx (con password) y .pem (con key file aparte)
 *  - Validación client-side de extensión y tamaño antes de subir
 *  - Input de password con toggle de visibilidad (solo .p12)
 *  - Upload multipart a POST /api/afip/cert
 *  - Estados: idle | uploading | success | error
 *  - Muestra info del certificado actual (subject, CUIT, vencimiento, fingerprint)
 *    con badges de estado (válido / por vencer / vencido)
 *  - Botón "Eliminar certificado" con confirmación
 *  - Re-valida el certificado después de subir/eliminar (vuelve a llamar GET)
 *
 * Robustez:
 *  - AbortController + timeout 30s en upload y delete
 *  - Manejo de errores de red, timeout, 403 (no-admin), 400 (validación server)
 *  - Mensajes user-friendly según el tipo de error
 *  - No permite subir si falta password (.p12) o key file (.pem)
 *  - Limpia el input file después de cada intento (permite re-seleccionar mismo archivo)
 *  - Refresca taxConfig después de upload/delete exitoso (callback onCertChange)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  Upload,
  FileKey,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  Calendar,
  Fingerprint,
  IdCard,
  RefreshCw,
  Lock,
  Key,
} from "lucide-react";
import { safeFetchJSON } from "@/lib/fetch";

// ===== Tipos =====

interface CertInfoResponse {
  hasCert: boolean;
  format?: "p12" | "pem" | null;
  certPath?: string | null;
  privateKeyPath?: string | null;
  subject?: string;
  issuer?: string;
  cuit?: string | null;
  validFrom?: string;
  validTo?: string;
  daysUntilExpiry?: number;
  expired?: boolean;
  expiringSoon?: boolean;
  fingerprintSha256?: string;
  serialNumber?: string;
  error?: string; // cuando hasCert=true pero no se pudo leer
}

interface UploadResponse {
  ok: boolean;
  message?: string;
  error?: string;
  cert?: CertInfoResponse;
  certCuit?: string;
  configuredCuit?: string;
}

interface AfipCertificateUploaderProps {
  /** Configuración fiscal actual. */
  taxConfig: any | null;
  /** Callback después de subir/eliminar certificado exitosamente. */
  onCertChange?: () => void;
}

// ===== Constantes =====

const MAX_CERT_SIZE = 100 * 1024; // 100KB
const ALLOWED_CERT_EXTS = [".p12", ".pfx", ".pem", ".cer"];
const ALLOWED_KEY_EXTS = [".key", ".pem"];
const UPLOAD_TIMEOUT_MS = 30000;

type UploadState = "idle" | "uploading" | "success" | "error";

// ===== Componente =====

export function AfipCertificateUploader({
  taxConfig,
  onCertChange,
}: AfipCertificateUploaderProps) {
  // Estado de UI
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Info del cert actual (cargada del server)
  const [certInfo, setCertInfo] = useState<CertInfoResponse | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);

  // Refs
  const certInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ===== Carga inicial de info del cert =====
  const loadCertInfo = useCallback(async () => {
    setLoadingInfo(true);
    setInfoError(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch("/api/afip/cert", {
        method: "GET",
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data: CertInfoResponse | null = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (data) {
        setCertInfo(data);
        if (data.error && data.hasCert) {
          setInfoError(data.error);
        }
      } else {
        setInfoError("No se pudo cargar la info del certificado");
      }
    } catch (e: any) {
      setInfoError(e?.message || "Error de red");
    } finally {
      clearTimeout(t);
      setLoadingInfo(false);
    }
  }, []);

  useEffect(() => {
    loadCertInfo();
  }, [loadCertInfo]);

  // ===== Determinar formato del archivo seleccionado =====
  const isP12Format = certFile
    ? [".p12", ".pfx"].some((ext) =>
        certFile.name.toLowerCase().endsWith(ext)
      )
    : false;

  const isPemFormat = certFile
    ? [".pem", ".cer"].some((ext) =>
        certFile.name.toLowerCase().endsWith(ext)
      )
    : false;

  // ===== Validaciones client-side =====
  function validateCertFile(file: File): string | null {
    const lower = file.name.toLowerCase();
    if (!ALLOWED_CERT_EXTS.some((ext) => lower.endsWith(ext))) {
      return `Extensión no soportada. Permitidas: ${ALLOWED_CERT_EXTS.join(", ")}`;
    }
    if (file.size === 0) return "El archivo está vacío";
    if (file.size > MAX_CERT_SIZE) {
      return `El archivo pesa ${(file.size / 1024).toFixed(1)}KB, máximo ${MAX_CERT_SIZE / 1024}KB`;
    }
    return null;
  }

  function validateKeyFile(file: File): string | null {
    const lower = file.name.toLowerCase();
    if (!ALLOWED_KEY_EXTS.some((ext) => lower.endsWith(ext))) {
      return `Extensión no soportada para la clave. Permitidas: ${ALLOWED_KEY_EXTS.join(", ")}`;
    }
    if (file.size === 0) return "El archivo de clave está vacío";
    if (file.size > MAX_CERT_SIZE) {
      return `La clave pesa demasiado, máximo ${MAX_CERT_SIZE / 1024}KB`;
    }
    return null;
  }

  // ===== Handlers de selección =====
  function handleCertSelect(file: File) {
    setUploadError(null);
    setUploadState("idle");
    const err = validateCertFile(file);
    if (err) {
      setUploadError(err);
      toast.error(err);
      return;
    }
    setCertFile(file);
    // Reset key file si cambió a .p12 (no lo necesita)
    if (file.name.toLowerCase().endsWith(".p12") || file.name.toLowerCase().endsWith(".pfx")) {
      setKeyFile(null);
    }
  }

  function handleKeySelect(file: File) {
    setUploadError(null);
    setUploadState("idle");
    const err = validateKeyFile(file);
    if (err) {
      setUploadError(err);
      toast.error(err);
      return;
    }
    setKeyFile(file);
  }

  // ===== Drag & drop =====
  function handleDrop(e: React.DragEvent, target: "cert" | "key") {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (target === "cert") handleCertSelect(file);
    else handleKeySelect(file);
  }

  // ===== Upload =====
  const handleUpload = useCallback(async () => {
    if (!certFile) return;
    if (isP12Format && !password) {
      setUploadError("Ingresá la contraseña del .p12");
      toast.error("Falta la contraseña del .p12");
      return;
    }
    if (isPemFormat && !keyFile) {
      setUploadError("Cargá también el archivo de la clave privada (.key)");
      toast.error("Falta el archivo de la clave privada");
      return;
    }

    setUploadState("uploading");
    setUploadError(null);

    const formData = new FormData();
    formData.append("cert", certFile);
    if (isPemFormat && keyFile) {
      formData.append("key", keyFile);
    }
    if (isP12Format && password) {
      formData.append("password", password);
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timeout = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);

    try {
      let res: Response;
      try {
        res = await fetch("/api/afip/cert", {
          method: "POST",
          body: formData,
          signal: ctrl.signal,
        });
      } catch (e: any) {
        setUploadState("error");
        const msg = e?.name === "AbortError"
          ? "Timeout: el servidor no respondió en 30s"
          : e?.message || "Error de red";
        setUploadError(msg);
        toast.error("Error al subir certificado", { description: msg });
        return;
      }

      const text = await res.text();
      let data: UploadResponse | null = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }

      if (!res.ok || !data?.ok) {
        setUploadState("error");
        const errMsg = data?.error || `Error del servidor (${res.status})`;
        setUploadError(errMsg);
        toast.error("No se pudo cargar el certificado", {
          description: errMsg,
          duration: 8000,
        });
        return;
      }

      setUploadState("success");
      toast.success("Certificado cargado", {
        description: data.message || "Validado correctamente",
        duration: 5000,
      });
      // Limpiar formulario
      setCertFile(null);
      setKeyFile(null);
      setPassword("");
      if (certInputRef.current) certInputRef.current.value = "";
      if (keyInputRef.current) keyInputRef.current.value = "";
      // Refrescar info del cert
      await loadCertInfo();
      onCertChange?.();
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
    }
  }, [certFile, keyFile, password, isP12Format, isPemFormat, loadCertInfo, onCertChange]);

  // ===== Delete =====
  const handleDelete = useCallback(async () => {
    setDeleting(true);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const { ok, error } = await safeFetchJSON("/api/afip/cert", {
        method: "DELETE",
        signal: ctrl.signal,
      });
      if (!ok) {
        toast.error("No se pudo eliminar el certificado", {
          description: error,
        });
        return;
      }
      toast.success("Certificado eliminado");
      setCertInfo({ hasCert: false });
      setDeleteDialogOpen(false);
      onCertChange?.();
    } finally {
      clearTimeout(timeout);
      setDeleting(false);
    }
  }, [onCertChange]);

  // ===== Reset del formulario =====
  function handleReset() {
    setCertFile(null);
    setKeyFile(null);
    setPassword("");
    setUploadState("idle");
    setUploadError(null);
    if (certInputRef.current) certInputRef.current.value = "";
    if (keyInputRef.current) keyInputRef.current.value = "";
  }

  // ===== Cancel upload en curso =====
  function handleCancelUpload() {
    abortRef.current?.abort();
    setUploadState("idle");
    setUploadError("Cancelado");
  }

  // ===== Render =====

  const hasCert = certInfo?.hasCert === true;
  const certExpired = certInfo?.expired === true;
  const certExpiringSoon = certInfo?.expiringSoon === true;
  const certValid = hasCert && !certExpired && !certExpiringSoon;

  return (
    <Card className="border-emerald-100">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileKey className="w-4 h-4 text-emerald-600" />
              Certificado Digital AFIP
            </CardTitle>
            <CardDescription className="text-xs">
              Cargá tu certificado (.p12 o .pem) obtenido en AFIP. Se valida automáticamente al subir.
            </CardDescription>
          </div>
          {hasCert && (
            <Badge
              variant={
                certValid ? "success" : certExpiringSoon ? "warning" : "destructive"
              }
              className="flex items-center gap-1"
            >
              {certValid ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : certExpiringSoon ? (
                <AlertTriangle className="w-3 h-3" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              {certValid
                ? "Vigente"
                : certExpiringSoon
                  ? "Por vencer"
                  : "Vencido"}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ===== Info del cert actual ===== */}
        {loadingInfo ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Cargando info del certificado…
          </div>
        ) : hasCert ? (
          <CertInfoBlock
            certInfo={certInfo!}
            infoError={infoError}
            onDeleteClick={() => setDeleteDialogOpen(true)}
            deleting={deleting}
          />
        ) : (
          <div className="rounded-md bg-muted/30 border border-dashed p-3 text-xs text-muted-foreground">
            No hay certificado cargado. Subí tu .p12 o .pem más abajo.
          </div>
        )}

        {/* ===== Formulario de upload ===== */}
        {!hasCert && (
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Cargar nuevo certificado
            </div>

            {/* Dropzone para cert */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                Archivo del certificado{" "}
                <span className="text-muted-foreground">
                  (.p12, .pfx, .pem o .cer)
                </span>
              </Label>
              <div
                className="border-2 border-dashed rounded-md p-4 text-center cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => certInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, "cert")}
              >
                {certFile ? (
                  <div className="flex items-center justify-center gap-2 text-xs">
                    <FileKey className="w-4 h-4 text-emerald-600" />
                    <span className="font-medium">{certFile.name}</span>
                    <span className="text-muted-foreground">
                      ({(certFile.size / 1024).toFixed(1)}KB)
                    </span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-1" />
                    <p className="text-xs font-medium">
                      Hacé click o arrastrá el certificado aquí
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      .p12, .pfx, .pem o .cer · máx 100KB
                    </p>
                  </>
                )}
                <Input
                  ref={certInputRef}
                  type="file"
                  accept=".p12,.pfx,.pem,.cer"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCertSelect(f);
                  }}
                />
              </div>
            </div>

            {/* Password input (solo .p12/.pfx) */}
            {isP12Format && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Contraseña del .p12{" "}
                  <span className="text-muted-foreground">
                    (se encripta con AES-256 antes de guardar)
                  </span>
                </Label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Contraseña del certificado"
                    className="pl-9 pr-9 text-xs h-9"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Dropzone para key (solo .pem/.cer) */}
            {isPemFormat && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Clave privada{" "}
                  <span className="text-muted-foreground">(.key o .pem)</span>
                </Label>
                <div
                  className="border-2 border-dashed rounded-md p-4 text-center cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => keyInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, "key")}
                >
                  {keyFile ? (
                    <div className="flex items-center justify-center gap-2 text-xs">
                      <Key className="w-4 h-4 text-blue-600" />
                      <span className="font-medium">{keyFile.name}</span>
                      <span className="text-muted-foreground">
                        ({(keyFile.size / 1024).toFixed(1)}KB)
                      </span>
                    </div>
                  ) : (
                    <>
                      <Key className="w-6 h-6 mx-auto text-muted-foreground mb-1" />
                      <p className="text-xs font-medium">
                        Hacé click o arrastrá la clave privada aquí
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        .key o .pem · máx 100KB
                      </p>
                    </>
                  )}
                  <Input
                    ref={keyInputRef}
                    type="file"
                    accept=".key,.pem"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleKeySelect(f);
                    }}
                  />
                </div>
              </div>
            )}

            {/* Error de upload */}
            {uploadError && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-2.5 text-xs text-red-800">
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="flex-1 break-words">{uploadError}</div>
              </div>
            )}

            {/* Acciones */}
            <div className="flex items-center gap-2">
              {uploadState === "uploading" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelUpload}
                  className="gap-2"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Subiendo… (cancelar)
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleUpload}
                  disabled={!certFile || (isP12Format && !password) || (isPemFormat && !keyFile)}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Subir y validar certificado
                </Button>
              )}
              {(certFile || keyFile || password) && uploadState !== "uploading" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-xs"
                >
                  Limpiar
                </Button>
              )}
            </div>

            {/* Nota de seguridad */}
            <div className="flex items-start gap-1.5 rounded-md bg-blue-50 border border-blue-200 p-2 text-[11px] text-blue-800">
              <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
              <div>
                La contraseña se encripta con <strong>AES-256-GCM</strong> antes
                de guardar en la base de datos. El certificado se valida al subir
                (lectura + extracción de CUIT + chequeo de vencimiento).
              </div>
            </div>
          </div>
        )}

        {/* ===== Error al cargar info ===== */}
        {infoError && hasCert && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="flex-1 break-words">{infoError}</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={loadCertInfo}
              className="h-6 px-2 text-xs"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        )}
      </CardContent>

      {/* ===== Dialog de confirmación de delete ===== */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Eliminar certificado
            </DialogTitle>
            <DialogDescription className="text-xs">
              Vas a borrar el certificado del servidor y limpiar todos los
              campos relacionados (certPath, privateKeyPath, certPassword,
              token de acceso cacheado). No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            <div className="font-medium mb-1">¿Seguro?</div>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700">
              <li>No vas a poder emitir facturas hasta cargar uno nuevo.</li>
              <li>Las facturas ya emitidas con CAE no se ven afectadas.</li>
              <li>Vas a necesitar el archivo .p12/.pem original para volver a cargarlo.</li>
            </ul>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="gap-2"
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Eliminar certificado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ===== Sub-componente: info del cert actual =====

function CertInfoBlock({
  certInfo,
  infoError,
  onDeleteClick,
  deleting,
}: {
  certInfo: CertInfoResponse;
  infoError: string | null;
  onDeleteClick: () => void;
  deleting: boolean;
}) {
  const validFrom = certInfo.validFrom ? new Date(certInfo.validFrom) : null;
  const validTo = certInfo.validTo ? new Date(certInfo.validTo) : null;

  return (
    <div className="space-y-3 rounded-md border bg-emerald-50/30 p-3">
      {/* Header con formato y CUIT */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px]">
            {certInfo.format === "p12" ? "PKCS#12 (.p12)" : "PEM (.pem)"}
          </Badge>
          {certInfo.cuit && (
            <Badge variant="outline" className="text-[11px] flex items-center gap-1">
              <IdCard className="w-3 h-3" />
              CUIT: {certInfo.cuit}
            </Badge>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDeleteClick}
          disabled={deleting}
          className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          <Trash2 className="w-3 h-3 mr-1" />
          Eliminar
        </Button>
      </div>

      {/* Si hay error de lectura, mostrarlo */}
      {infoError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-800">
          {infoError}
        </div>
      )}

      {/* Datos del certificado */}
      {certInfo.subject && (
        <InfoRow label="Subject" value={certInfo.subject} />
      )}
      {certInfo.issuer && (
        <InfoRow label="Issuer" value={certInfo.issuer} />
      )}

      {/* Fechas de validez */}
      {validFrom && validTo && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-white/60 border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Válido desde
            </div>
            <div className="text-xs font-medium mt-0.5">
              {validFrom.toLocaleDateString("es-AR")}
            </div>
          </div>
          <div
            className={`rounded-md bg-white/60 border p-2 ${
              certInfo.expired
                ? "border-red-300"
                : certInfo.expiringSoon
                  ? "border-amber-300"
                  : "border-emerald-300"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Válido hasta
            </div>
            <div className="text-xs font-medium mt-0.5">
              {validTo.toLocaleDateString("es-AR")}
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({certInfo.daysUntilExpiry ?? 0} días)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Fingerprint */}
      {certInfo.fingerprintSha256 && (
        <InfoRow
          label="Fingerprint SHA-256"
          value={certInfo.fingerprintSha256}
          mono
          truncate
          icon={<Fingerprint className="w-3 h-3" />}
        />
      )}

      {/* Path del archivo (info técnica, para debugging) */}
      {certInfo.certPath && (
        <InfoRow
          label="Archivo en servidor"
          value={certInfo.certPath}
          mono
          truncate
        />
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  truncate = false,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="text-xs">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div
        className={`mt-0.5 ${mono ? "font-mono" : ""} ${
          truncate ? "truncate" : ""
        }`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
