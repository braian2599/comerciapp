/**
 * POST /api/afip/cert        — Subir certificado (.p12/.pfx o .pem)
 * DELETE /api/afip/cert      — Eliminar certificado
 * GET /api/afip/cert         — Info del certificado actual (sin exponer sensible)
 *
 * Storage: S3-compatible (R2/S3/B2/MinIO) con fallback a FS local.
 * Ver lib/cert-storage.ts para detalles de la estrategia.
 *
 * ROBUSTEZ:
 *  - Solo ADMIN/OWNER puede ejecutar cualquiera de los 3 verbos.
 *  - POST acepta multipart/form-data (Web API FormData en Next 16).
 *  - Validación de extensión (.p12, .pfx, .pem) y MIME type.
 *  - Límite de tamaño: 100KB (certificados AFIP son chicos, <50KB típicamente).
 *  - Validación inmediata: el certificado se lee/extrae con node-forge ANTES de
 *    persistir en storage, para detectar password incorrecta o archivo corrupto.
 *  - Matching de CUIT: si TaxConfig.cuit está seteado, el CUIT del certificado
 *    debe coincidir. Si no coincide, se rechaza con error user-friendly.
 *    Si TaxConfig.cuit NO está seteado, se autocompleta con el del certificado.
 *  - La password del .p12 se encripta con AES-256-GCM (lib/crypto-utils.ts)
 *    ANTES de persistir en TaxConfig.certPassword.
 *  - Cuando se reemplaza el certificado, se borra el archivo anterior del
 *    storage (S3 + FS) y se invalida el TA cacheado.
 *  - Nombre de archivo seguro: `afip-${storeId}-${timestamp}.${ext}`.
 *    Nunca se usa el nombre original del archivo (previene path traversal y
 *    colisiones con otros stores).
 *  - DELETE borra el archivo físico (S3 + FS) + limpia todos los campos.
 *  - GET retorna info legible (subject, issuer, validez, fingerprint) pero
 *    NUNCA el contenido PEM ni la password.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import path from "node:path";
import {
  extractCertInfoFromP12,
  extractCertInfoFromPem,
  cuitMatches,
  validarCuitConDigito,
  type CertInfo,
} from "@/lib/cert-info";
import { encryptSecret, decryptSecret } from "@/lib/crypto-utils";
import {
  putCertFile,
  getCertFile,
  deleteCertFile,
  headCertFile,
  getCertStorageConfig,
} from "@/lib/cert-storage";

// ===== Constantes =====

const MAX_CERT_SIZE = 100 * 1024; // 100KB
const ALLOWED_EXTS = [".p12", ".pfx", ".pem", ".cer"];
const ALLOWED_MIMES = [
  "application/x-pkcs12",
  "application/pkcs12",
  "application/x-pem-file",
  "application/x-x509-ca-cert",
  "application/pkix-cert",
  "text/plain",
  "application/octet-stream", // algunos navegadores mandan este para .p12
];

// ===== Helpers =====

function getExt(filename: string): string {
  const lower = filename.toLowerCase();
  for (const ext of ALLOWED_EXTS) {
    if (lower.endsWith(ext)) return ext;
  }
  return path.extname(lower);
}

/**
 * Sanitiza el nombre del archivo de destino.
 * Formato: afip-${storeId}-${timestamp}.${ext}
 * Esto evita path traversal, colisiones entre stores, y permite
 * identificar de qué store es cada certificado.
 */
function buildDestFilename(storeId: string, ext: string): string {
  const ts = Date.now();
  const safeStore = storeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `afip-${safeStore}-${ts}${ext}`;
}

/**
 * Construye la respuesta de info del certificado para el frontend.
 * No expone contenido PEM ni password.
 */
function buildCertInfoResponse(
  info: CertInfo,
  certPath: string,
  privateKeyPath: string | null,
  storageInfo?: { source: "s3" | "fs" | "none"; s3Enabled: boolean }
) {
  return {
    hasCert: true,
    format: info.format,
    certPath,
    privateKeyPath,
    subject: info.subject,
    issuer: info.issuer,
    cuit: info.cuit,
    validFrom: info.validFrom.toISOString(),
    validTo: info.validTo.toISOString(),
    daysUntilExpiry: info.daysUntilExpiry,
    expired: info.expired,
    expiringSoon: info.expiringSoon,
    fingerprintSha256: info.fingerprintSha256,
    serialNumber: info.serialNumber,
    storage: storageInfo,
  };
}

// ===== POST: subir certificado =====

export async function POST(req: NextRequest) {
  // ---- Auth ----
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const u = session.user as any;
  if (u.role !== "ADMIN" && u.role !== "OWNER") {
    return NextResponse.json(
      { error: "Solo ADMIN puede gestionar certificados AFIP" },
      { status: 403 }
    );
  }
  const storeId = u.storeId;

  // ---- Leer TaxConfig actual ----
  const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
  if (!taxConfig) {
    return NextResponse.json(
      {
        error:
          "No hay configuración fiscal. Guardá primero CUIT y datos básicos antes de subir el certificado.",
      },
      { status: 400 }
    );
  }

  // ---- Parse multipart/form-data ----
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e: any) {
    return NextResponse.json(
      { error: `No se pudo leer multipart/form-data: ${e?.message}` },
      { status: 400 }
    );
  }

  const certFile = formData.get("cert") as File | null;
  const keyFile = formData.get("key") as File | null;
  const password = formData.get("password") as string | null;

  if (!certFile) {
    return NextResponse.json(
      { error: "Falta el archivo del certificado (campo 'cert')" },
      { status: 400 }
    );
  }

  // ---- Validar archivo ----
  if (certFile.size === 0) {
    return NextResponse.json(
      { error: "El archivo del certificado está vacío" },
      { status: 400 }
    );
  }
  if (certFile.size > MAX_CERT_SIZE) {
    return NextResponse.json(
      {
        error: `El certificado pesa ${(certFile.size / 1024).toFixed(
          1
        )}KB, máximo ${MAX_CERT_SIZE / 1024}KB`,
      },
      { status: 400 }
    );
  }

  const ext = getExt(certFile.name);
  if (!ALLOWED_EXTS.includes(ext)) {
    return NextResponse.json(
      {
        error: `Extensión no soportada: ${ext}. Permitidas: ${ALLOWED_EXTS.join(
          ", "
        )}`,
      },
      { status: 400 }
    );
  }

  // MIME check (algunos browsers mandan octet-stream, lo permitimos)
  if (certFile.type && !ALLOWED_MIMES.includes(certFile.type)) {
    return NextResponse.json(
      { error: `MIME type no soportado: ${certFile.type}` },
      { status: 400 }
    );
  }

  // ---- Leer bytes del certificado ----
  const certBuffer = Buffer.from(await certFile.arrayBuffer());

  // ---- Validar certificado según formato ----
  let certInfo: CertInfo;

  try {
    if (ext === ".p12" || ext === ".pfx") {
      // PKCS#12: requiere password
      if (!password) {
        return NextResponse.json(
          { error: "El certificado .p12 requiere contraseña" },
          { status: 400 }
        );
      }
      try {
        certInfo = extractCertInfoFromP12(certBuffer, password);
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (
          msg.includes("password") ||
          msg.includes("PKCS#12") ||
          msg.includes("MAC") ||
          msg.includes("padding")
        ) {
          return NextResponse.json(
            {
              error:
                "No se pudo abrir el .p12 con esa contraseña. Verificá la password del certificado.",
            },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: `Certificado .p12 inválido: ${msg}` },
          { status: 400 }
        );
      }
    } else {
      // PEM (.pem o .cer): requiere key file aparte
      if (!keyFile) {
        return NextResponse.json(
          {
            error:
              "Para certificados .pem/.cer, debés cargar también la clave privada (campo 'key')",
          },
          { status: 400 }
        );
      }
      if (keyFile.size === 0) {
        return NextResponse.json(
          { error: "El archivo de la clave privada está vacío" },
          { status: 400 }
        );
      }
      if (keyFile.size > MAX_CERT_SIZE) {
        return NextResponse.json(
          { error: `La clave privada pesa demasiado, máximo ${MAX_CERT_SIZE / 1024}KB` },
          { status: 400 }
        );
      }
      const certPemStr = certBuffer.toString("utf-8");

      // Validar que sea PEM válido
      if (
        !certPemStr.includes("BEGIN CERTIFICATE") ||
        !certPemStr.includes("END CERTIFICATE")
      ) {
        return NextResponse.json(
          { error: "El archivo .pem no contiene un certificado válido (falta BEGIN CERTIFICATE)" },
          { status: 400 }
        );
      }

      const keyPemStr = Buffer.from(await keyFile.arrayBuffer()).toString("utf-8");
      if (
        !keyPemStr.includes("PRIVATE KEY") ||
        (!keyPemStr.includes("END PRIVATE KEY") &&
          !keyPemStr.includes("END RSA PRIVATE KEY"))
      ) {
        return NextResponse.json(
          { error: "El archivo de clave privada no es válido (falta PRIVATE KEY)" },
          { status: 400 }
        );
      }

      try {
        certInfo = extractCertInfoFromPem(certPemStr);
      } catch (e: any) {
        return NextResponse.json(
          { error: `No se pudo parsear el certificado PEM: ${e?.message}` },
          { status: 400 }
        );
      }
    }
  } catch (e: any) {
    // Catch-all por si quedó algo sin manejar
    return NextResponse.json(
      { error: `Error validando certificado: ${e?.message || e}` },
      { status: 400 }
    );
  }

  // ---- Validar que el certificado no esté vencido ----
  if (certInfo.expired) {
    return NextResponse.json(
      {
        error: `El certificado está vencido desde el ${certInfo.validTo.toLocaleDateString(
          "es-AR"
        )}. Renová el certificado en AFIP antes de cargarlo.`,
      },
      { status: 400 }
    );
  }

  // ---- Matching de CUIT ----
  if (!certInfo.cuit) {
    return NextResponse.json(
      {
        error:
          "No se pudo extraer el CUIT del certificado. El certificado puede no ser de AFIP o tener un formato no estándar.",
      },
      { status: 400 }
    );
  }
  if (!validarCuitConDigito(certInfo.cuit)) {
    return NextResponse.json(
      { error: `El CUIT extraído del certificado (${certInfo.cuit}) no es válido (falla dígito verificador)` },
      { status: 400 }
    );
  }

  // Si TaxConfig.cuit está seteado, validar coincidencia
  if (taxConfig.cuit && !cuitMatches(certInfo.cuit, taxConfig.cuit)) {
    return NextResponse.json(
      {
        error: `El CUIT del certificado (${certInfo.cuit}) no coincide con el CUIT configurado (${taxConfig.cuit}). Actualizá el CUIT en la configuración fiscal o cargá el certificado correcto.`,
        certCuit: certInfo.cuit,
        configuredCuit: taxConfig.cuit,
      },
      { status: 400 }
    );
  }

  // ---- Generar nombres de archivo ----
  const certFilename = buildDestFilename(storeId, ext);
  const keyFilename = ext === ".p12" || ext === ".pfx" ? null : buildDestFilename(storeId, ".key");

  // ---- Persistir archivo(s) en storage (S3 + FS local) ----
  try {
    await putCertFile(storeId, certFilename, certBuffer);
    if (keyFilename && keyFile) {
      const keyBuffer = Buffer.from(await keyFile.arrayBuffer());
      await putCertFile(storeId, keyFilename, keyBuffer);
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: `No se pudo guardar el certificado en storage: ${e?.message}` },
      { status: 500 }
    );
  }

  // ---- Borrar certificado anterior del storage ----
  if (taxConfig.certPath && taxConfig.certPath !== certFilename) {
    await deleteCertFile(storeId, taxConfig.certPath).catch((e) => {
      console.warn(`[afip/cert] no se pudo borrar cert anterior: ${e.message}`);
    });
  }
  if (taxConfig.privateKeyPath && taxConfig.privateKeyPath !== keyFilename) {
    await deleteCertFile(storeId, taxConfig.privateKeyPath).catch((e) => {
      console.warn(`[afip/cert] no se pudo borrar key anterior: ${e.message}`);
    });
  }

  // ---- Actualizar TaxConfig ----
  // Encriptar password si es .p12
  const encryptedPassword = password ? encryptSecret(password) : null;

  try {
    await db.taxConfig.update({
      where: { storeId },
      data: {
        certPath: certFilename,
        privateKeyPath: keyFilename,
        certPassword: encryptedPassword,
        // Autocompletar CUIT si no estaba seteado
        cuit: taxConfig.cuit || certInfo.cuit,
        // Invalidar TA cacheado (cambió el cert, el TA viejo ya no sirve)
        authToken: null,
        authTokenExpires: null,
      },
    });
  } catch (e: any) {
    // Si falla la DB, borrar los archivos nuevos para no dejar basura
    await deleteCertFile(storeId, certFilename).catch(() => {});
    if (keyFilename) {
      await deleteCertFile(storeId, keyFilename).catch(() => {});
    }
    return NextResponse.json(
      { error: `No se pudo actualizar la configuración fiscal: ${e?.message}` },
      { status: 500 }
    );
  }

  // ---- Respuesta ----
  const storageConfig = getCertStorageConfig();
  return NextResponse.json({
    ok: true,
    message: "Certificado cargado y validado correctamente",
    cert: buildCertInfoResponse(certInfo, certFilename, keyFilename, {
      source: storageConfig.enabled ? "s3" : "fs",
      s3Enabled: storageConfig.enabled,
    }),
  });
}

// ===== DELETE: eliminar certificado =====

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const u = session.user as any;
  if (u.role !== "ADMIN" && u.role !== "OWNER") {
    return NextResponse.json(
      { error: "Solo ADMIN puede eliminar certificados AFIP" },
      { status: 403 }
    );
  }
  const storeId = u.storeId;

  const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
  if (!taxConfig || !taxConfig.certPath) {
    return NextResponse.json(
      { error: "No hay certificado cargado" },
      { status: 404 }
    );
  }

  // Borrar archivos físicos (S3 + FS)
  const certDelete = await deleteCertFile(storeId, taxConfig.certPath);
  if (taxConfig.privateKeyPath) {
    const keyDelete = await deleteCertFile(storeId, taxConfig.privateKeyPath);
    certDelete.deletedFromS3 = certDelete.deletedFromS3 || keyDelete.deletedFromS3;
    certDelete.deletedFromFs = certDelete.deletedFromFs || keyDelete.deletedFromFs;
  }

  // Limpiar campos en TaxConfig
  await db.taxConfig.update({
    where: { storeId },
    data: {
      certPath: null,
      privateKeyPath: null,
      certPassword: null,
      authToken: null,
      authTokenExpires: null,
    },
  });

  return NextResponse.json({
    ok: true,
    message: "Certificado eliminado",
    storage: certDelete,
  });
}

// ===== GET: info del certificado actual =====

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const u = session.user as any;
  if (u.role !== "ADMIN" && u.role !== "OWNER") {
    return NextResponse.json(
      { error: "Solo ADMIN puede ver info del certificado" },
      { status: 403 }
    );
  }
  const storeId = u.storeId;

  const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
  if (!taxConfig || !taxConfig.certPath) {
    return NextResponse.json({
      hasCert: false,
      format: null,
      certPath: null,
      privateKeyPath: null,
    });
  }

  // Verificar existencia en storage
  const head = await headCertFile(storeId, taxConfig.certPath);
  if (!head.exists) {
    return NextResponse.json(
      {
        hasCert: true,
        format: null,
        certPath: taxConfig.certPath,
        privateKeyPath: taxConfig.privateKeyPath,
        error:
          "El certificado no se encuentra en el storage (S3 ni FS). Es posible que se haya perdido o que se haya cargado en otro servidor. Cargá el certificado nuevamente.",
      },
      { status: 200 }
    );
  }

  // Leer archivo desde storage
  let certBuffer: Buffer;
  try {
    const result = await getCertFile(storeId, taxConfig.certPath);
    certBuffer = result.buffer;
  } catch (e: any) {
    return NextResponse.json(
      {
        hasCert: true,
        format: null,
        certPath: taxConfig.certPath,
        privateKeyPath: taxConfig.privateKeyPath,
        error: `No se pudo leer el certificado desde storage: ${e?.message}`,
      },
      { status: 200 }
    );
  }

  const ext = getExt(taxConfig.certPath);
  let certInfo: CertInfo;
  try {
    if (ext === ".p12" || ext === ".pfx") {
      if (!taxConfig.certPassword) {
        return NextResponse.json(
          {
            hasCert: true,
            format: "p12",
            certPath: taxConfig.certPath,
            privateKeyPath: null,
            error: "Hay un .p12 cargado pero falta la contraseña. Cargá el certificado nuevamente.",
          },
          { status: 200 }
        );
      }
      // Desencriptar password para leer el .p12
      let plainPassword: string;
      try {
        plainPassword = decryptSecret(taxConfig.certPassword);
      } catch (e: any) {
        return NextResponse.json(
          {
            hasCert: true,
            format: "p12",
            certPath: taxConfig.certPath,
            privateKeyPath: null,
            error: `No se pudo desencriptar la contraseña del .p12: ${e.message}. Cargá el certificado nuevamente.`,
          },
          { status: 200 }
        );
      }
      certInfo = extractCertInfoFromP12(certBuffer, plainPassword);
    } else {
      const certPem = certBuffer.toString("utf-8");
      certInfo = extractCertInfoFromPem(certPem);
    }
  } catch (e: any) {
    return NextResponse.json(
      {
        hasCert: true,
        format: ext === ".p12" || ext === ".pfx" ? "p12" : "pem",
        certPath: taxConfig.certPath,
        privateKeyPath: taxConfig.privateKeyPath,
        error: `No se pudo leer el certificado: ${e?.message}`,
      },
      { status: 200 }
    );
  }

  const storageConfig = getCertStorageConfig();
  return NextResponse.json(
    buildCertInfoResponse(
      certInfo,
      taxConfig.certPath,
      taxConfig.privateKeyPath,
      {
        source: head.source === "s3" ? "s3" : "fs",
        s3Enabled: storageConfig.enabled,
      }
    )
  );
}
