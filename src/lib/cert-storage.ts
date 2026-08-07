/**
 * cert-storage.ts
 *
 * Abstracción de storage para certificados AFIP.
 *
 * Estrategia: S3-compatible PRIMARIO (Cloudflare R2, AWS S3, Backblaze B2,
 * MinIO), con fallback automático al filesystem local para:
 *  - Dev local sin S3 configurado
 *  - Auto-migración: si un certificado existe en FS pero no en S3, se lee
 *    del FS y se sube a S3 en background, transparente para el caller
 *
 * Esto resuelve TODOS los escenarios de deploy:
 *  ✅ VPS único con FS local (dev/self-hosted sin S3 configurado)
 *  ✅ Múltiples instancias con LB (S3 compartido)
 *  ✅ Docker sin volúmenes (S3)
 *  ✅ Vercel serverless (S3)
 *  ✅ Restore de DB desde backup (los blobs viven en S3, no en el FS)
 *  ✅ Auto-migración sin downtime (certs viejos en FS se migran on-demand)
 *
 * Configuración (env vars):
 *  - S3_ENDPOINT:       https://<account>.r2.cloudflarestorage.com (R2)
 *                       https://s3.us-east-1.amazonaws.com (S3)
 *                       https://s3.us-west-004.backblazeb2.com (B2)
 *                       http://localhost:9000 (MinIO)
 *  - S3_REGION:         auto (R2), us-east-1 (S3), us-west-004 (B2)
 *  - S3_BUCKET:         commerciapp-afip-certs
 *  - S3_ACCESS_KEY_ID:  <key>
 *  - S3_SECRET_ACCESS_KEY: <secret>
 *  - S3_FORCE_PATH_STYLE: true (MinIO), false (R2/S3/B2)
 *
 * Si S3_BUCKET no está seteado, se usa FS local exclusivamente (dev mode).
 *
 * Convención de keys en S3:
 *  - Certificados:  afip-certs/{storeId}/{filename}
 *  - Claves PEM:    afip-certs/{storeId}/{filename}
 *
 * El certPath guardado en TaxConfig es la key RELATIVA sin el prefijo
 * "afip-certs/{storeId}/" (ese prefijo se agrega al leer/escribir en S3).
 * Ej: certPath = "afip-clxxxxx-1234567890.p12"
 *     key en S3 = "afip-certs/store-clxxxxx/afip-clxxxxx-1234567890.p12"
 *
 * Esto permite que el mismo certPath funcione en FS (dev) y S3 (prod)
 * sin cambiar la DB.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";

// ===== Tipos =====

export interface CertStorageConfig {
  enabled: boolean;
  endpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
}

export interface CertStorageResult {
  /** Buffer con el contenido del archivo. */
  buffer: Buffer;
  /** De dónde se leyó: "s3" o "fs". */
  source: "s3" | "fs";
  /** Si se auto-migró (leído de FS y subido a S3 en esta operación). */
  migrated: boolean;
}

// ===== Singleton S3 client =====

let s3Client: S3Client | null = null;
let s3Config: CertStorageConfig | null = null;

/**
 * Lee y cachea la config de S3 desde env vars.
 * Retorna {enabled: false} si S3_BUCKET no está seteado.
 */
export function getCertStorageConfig(): CertStorageConfig {
  if (s3Config) return s3Config;

  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    s3Config = {
      enabled: false,
      region: "auto",
      bucket: "",
      forcePathStyle: false,
    };
    return s3Config;
  }

  s3Config = {
    enabled: true,
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "auto",
    bucket,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  };
  return s3Config;
}

/**
 * Obtiene (o crea) el S3Client singleton.
 * Lanza error si S3 no está configurado.
 */
function getS3Client(): { client: S3Client; config: CertStorageConfig } {
  const config = getCertStorageConfig();
  if (!config.enabled) {
    throw new Error(
      "S3 no está configurado. Seteá S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY y S3_ENDPOINT."
    );
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }
  return { client: s3Client, config };
}

// ===== Helpers de paths y keys =====

/**
 * Resuelve el directorio base del FS local (para fallback / dev / migración).
 * Usa UPLOADS_DIR si está seteado, sino /home/z/my-project/uploads/afip-certs.
 */
function getLocalBaseDir(): string {
  return (
    process.env.UPLOADS_DIR ||
    path.join(process.cwd(), "uploads", "afip-certs")
  );
}

/**
 * Resuelve la ruta absoluta en FS para un nombre de archivo.
 */
function resolveLocalPath(filename: string): string {
  if (path.isAbsolute(filename)) return filename;
  return path.join(getLocalBaseDir(), filename);
}

/**
 * Construye la key de S3 para un storeId + filename.
 * Ej: "afip-certs/store-abc123/cert.p12"
 */
function buildS3Key(storeId: string, filename: string): string {
  const safeStore = storeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `afip-certs/${safeStore}/${filename}`;
}

// ===== API pública =====

/**
 * Sube un certificado al storage.
 *
 * Si S3 está habilitado: sube a S3 (y también escribe en FS local como cache).
 * Si S3 NO está habilitado: escribe solo en FS local.
 *
 * @param storeId ID del store (para namespace en S3)
 * @param filename Nombre del archivo (ej: "afip-clxxxxx-123.p12")
 * @param buffer Contenido binario
 */
export async function putCertFile(
  storeId: string,
  filename: string,
  buffer: Buffer
): Promise<{ source: "s3" | "fs"; s3Key?: string }> {
  // Siempre escribir en FS local (cache + dev mode + migración futura)
  const localPath = resolveLocalPath(filename);
  try {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, buffer);
  } catch (e: any) {
    throw new Error(`No se pudo escribir en FS local ${localPath}: ${e.message}`);
  }

  const config = getCertStorageConfig();
  if (config.enabled) {
    const { client } = getS3Client();
    const key = buildS3Key(storeId, filename);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: buffer,
          // No exponemos content-type para que S3 lo trate como binario
          Metadata: {
            "store-id": storeId,
            "uploaded-at": new Date().toISOString(),
          },
        })
      );
      return { source: "s3", s3Key: key };
    } catch (e: any) {
      throw new Error(
        `No se pudo subir a S3 (bucket=${config.bucket}, key=${key}): ${e.message}`
      );
    }
  }

  return { source: "fs" };
}

/**
 * Lee un certificado del storage.
 *
 * Orden de intento:
 *  1. Si S3 está habilitado, intentar leer de S3.
 *  2. Si S3 falla o no está habilitado, leer de FS local.
 *  3. Si se leyó de FS y S3 está habilitado, migrar a S3 en background.
 *
 * Esto garantiza:
 *  - Dev sin S3: lee de FS.
 *  - Prod con S3: lee de S3 (rápido).
 *  - Auto-migración: certs viejos en FS se suben a S3 on-demand.
 *  - Resiliencia: si S3 se cae, intenta FS como fallback.
 *
 * @param storeId ID del store
 * @param filename Nombre del archivo
 */
export async function getCertFile(
  storeId: string,
  filename: string
): Promise<CertStorageResult> {
  const config = getCertStorageConfig();

  // Intentar S3 primero si está habilitado
  if (config.enabled) {
    try {
      const { client } = getS3Client();
      const key = buildS3Key(storeId, filename);
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key })
      );
      if (response.Body) {
        // Convertir stream a Buffer
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.Body as any) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const buffer = Buffer.concat(chunks);
        return { buffer, source: "s3", migrated: false };
      }
      throw new Error("S3 retornó body vacío");
    } catch (e: any) {
      // Si es NotFound, intentar FS. Si es otro error (credenciales, red),
      // también intentar FS pero loguear para diagnóstico.
      if (!(e instanceof S3ServiceException && e.name === "NoSuchKey") &&
          !(e instanceof S3ServiceException && e.$metadata?.httpStatusCode === 404)) {
        console.warn(
          `[cert-storage] S3 falló leyendo ${filename}, intentando FS: ${e.message}`
        );
      }
      // Caer al FS
    }
  }

  // Fallback / dev: leer de FS local
  const localPath = resolveLocalPath(filename);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(localPath);
  } catch (e: any) {
    throw new Error(
      `No se pudo leer ${filename} ni de S3 ni de FS local (${localPath}): ${e.message}. ` +
      `Es posible que el certificado se haya cargado en otro servidor. Re-subí el certificado desde la UI.`
    );
  }

  // Auto-migración: si S3 está habilitado y se leyó de FS, subir a S3 en background
  let migrated = false;
  if (config.enabled) {
    migrated = true; // Marcamos como migrado (mejor esfuerzo)
    // No esperamos la migración para no bloquear el caller
    void migrateToS3(storeId, filename, buffer).catch((e) => {
      console.warn(
        `[cert-storage] migración background falló para ${filename}: ${e.message}`
      );
    });
  }

  return { buffer, source: "fs", migrated };
}

/**
 * Elimina un certificado del storage.
 * Borra tanto de S3 como de FS local (si existen).
 * Best-effort: no falla si alguno no existe.
 */
export async function deleteCertFile(
  storeId: string,
  filename: string
): Promise<{ deletedFromS3: boolean; deletedFromFs: boolean }> {
  const config = getCertStorageConfig();
  let deletedFromS3 = false;
  let deletedFromFs = false;

  // Borrar de S3
  if (config.enabled) {
    try {
      const { client } = getS3Client();
      const key = buildS3Key(storeId, filename);
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key })
      );
      deletedFromS3 = true;
    } catch (e: any) {
      console.warn(
        `[cert-storage] no se pudo borrar ${filename} de S3: ${e.message}`
      );
    }
  }

  // Borrar de FS local
  const localPath = resolveLocalPath(filename);
  try {
    await fs.unlink(localPath);
    deletedFromFs = true;
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      console.warn(
        `[cert-storage] no se pudo borrar ${localPath} del FS: ${e.message}`
      );
    }
  }

  return { deletedFromS3, deletedFromFs };
}

/**
 * Verifica si un certificado existe en S3.
 * Útil para diagnóstico.
 */
export async function headCertFile(
  storeId: string,
  filename: string
): Promise<{ exists: boolean; source: "s3" | "fs" | "none"; size?: number }> {
  const config = getCertStorageConfig();

  if (config.enabled) {
    try {
      const { client } = getS3Client();
      const key = buildS3Key(storeId, filename);
      const head = await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key })
      );
      return {
        exists: true,
        source: "s3",
        size: head.ContentLength,
      };
    } catch {
      // Caer al FS
    }
  }

  // Verificar FS
  const localPath = resolveLocalPath(filename);
  try {
    const stat = await fs.stat(localPath);
    return { exists: true, source: "fs", size: stat.size };
  } catch {
    return { exists: false, source: "none" };
  }
}

/**
 * Verifica la conectividad con S3 (para diagnóstico /api/afip/test).
 * Hace un HeadObject sobre una key inexistente para validar credenciales.
 */
export async function pingS3(): Promise<{
  ok: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  error?: string;
}> {
  const config = getCertStorageConfig();
  if (!config.enabled) {
    return { ok: false, error: "S3 no configurado (S3_BUCKET no seteado)" };
  }
  try {
    const { client } = getS3Client();
    // HeadObject sobre key inexistente → debe dar 404, no error de credenciales
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: "afip-certs/__ping__",
      })
    );
    // Si no tiró error, la key existe (no debería). Aún así, credenciales OK.
    return {
      ok: true,
      endpoint: config.endpoint,
      bucket: config.bucket,
      region: config.region,
    };
  } catch (e: any) {
    // 404 = credenciales OK, solo que la key no existe
    if (
      e instanceof S3ServiceException &&
      (e.$metadata?.httpStatusCode === 404 || e.name === "NotFound")
    ) {
      return {
        ok: true,
        endpoint: config.endpoint,
        bucket: config.bucket,
        region: config.region,
      };
    }
    return {
      ok: false,
      endpoint: config.endpoint,
      bucket: config.bucket,
      region: config.region,
      error: e?.message || String(e),
    };
  }
}

// ===== Internos =====

/**
 * Sube un archivo a S3 (migración background).
 * No lanza errores al caller (mejor esfuerzo).
 */
async function migrateToS3(
  storeId: string,
  filename: string,
  buffer: Buffer
): Promise<void> {
  const config = getCertStorageConfig();
  if (!config.enabled) return;

  const { client } = getS3Client();
  const key = buildS3Key(storeId, filename);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      Metadata: {
        "store-id": storeId,
        "migrated-from-fs": "true",
        "migrated-at": new Date().toISOString(),
      },
    })
  );
  console.info(
    `[cert-storage] migración background OK: ${filename} → S3 key ${key}`
  );
}
