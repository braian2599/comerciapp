/**
 * Migración one-shot: sube todos los certificados AFIP existentes en el FS
 * local al storage S3-compatible configurado.
 *
 * Uso:
 *   1. Configurar env vars: S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *      S3_ENDPOINT, S3_REGION, S3_FORCE_PATH_STYLE
 *   2. Ejecutar: npx tsx scripts/migrate-certs-to-s3.ts
 *
 * El script:
 *   - Lee todos los TaxConfig con certPath no null
 *   - Para cada uno, verifica si el archivo ya está en S3 (headCertFile)
 *   - Si NO está en S3 pero está en FS, lo sube a S3 (putCertFile)
 *   - Reporta al final: cuántos migrados, cuántos ya estaban, cuántos fallaron
 *
 * Es idempotente: si se ejecuta múltiples veces, solo sube lo que falta.
 * No modifica la DB (el certPath se mantiene igual, solo cambia el backend).
 */

import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  putCertFile,
  headCertFile,
  getCertStorageConfig,
} from "../src/lib/cert-storage";

const db = new PrismaClient();

async function main() {
  console.log("=== Migración de certificados AFIP a S3 ===\n");

  // Verificar que S3 esté configurado
  const config = getCertStorageConfig();
  if (!config.enabled) {
    console.error(
      "❌ S3 no está configurado. Seteá S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT."
    );
    process.exit(1);
  }
  console.log(`Bucket: ${config.bucket}`);
  console.log(`Endpoint: ${config.endpoint || "(default AWS)"}`);
  console.log(`Region: ${config.region}`);
  console.log(`Force path style: ${config.forcePathStyle}`);
  console.log("");

  // Leer todos los TaxConfig con certPath
  const configs = await db.taxConfig.findMany({
    where: { NOT: { certPath: null } },
    select: {
      id: true,
      storeId: true,
      cuit: true,
      certPath: true,
      privateKeyPath: true,
    },
  });

  console.log(`Encontrados ${configs.length} TaxConfig con certPath\n`);

  let migrated = 0;
  let alreadyInS3 = 0;
  let notInFs = 0;
  let failed = 0;

  for (const tc of configs) {
    console.log(`--- Store ${tc.storeId} (CUIT=${tc.cuit}) ---`);
    console.log(`  certPath: ${tc.certPath}`);
    if (tc.privateKeyPath) console.log(`  privateKeyPath: ${tc.privateKeyPath}`);

    // Procesar cert
    const certResult = await migrateOne(tc.storeId, tc.certPath);
    if (certResult === "migrated") migrated++;
    else if (certResult === "already") alreadyInS3++;
    else if (certResult === "not-in-fs") notInFs++;
    else if (certResult === "failed") failed++;

    // Procesar key (si PEM)
    if (tc.privateKeyPath) {
      const keyResult = await migrateOne(tc.storeId, tc.privateKeyPath);
      if (keyResult === "migrated") migrated++;
      else if (keyResult === "already") alreadyInS3++;
      else if (keyResult === "not-in-fs") notInFs++;
      else if (keyResult === "failed") failed++;
    }
    console.log("");
  }

  console.log("=== Resumen ===");
  console.log(`Migrados a S3: ${migrated}`);
  console.log(`Ya estaban en S3: ${alreadyInS3}`);
  console.log(`No encontrados en FS: ${notInFs}`);
  console.log(`Fallidos: ${failed}`);
  console.log("");
  if (failed > 0 || notInFs > 0) {
    console.log("⚠️  Hubo errores. Revisá los logs arriba.");
    process.exit(1);
  }
  console.log("✅ Migración completada OK.");
}

async function migrateOne(
  storeId: string,
  filename: string
): Promise<"migrated" | "already" | "not-in-fs" | "failed"> {
  // 1. ¿Ya está en S3?
  const head = await headCertFile(storeId, filename);
  if (head.source === "s3") {
    console.log(`  ✓ ${filename} ya está en S3 (${head.size} bytes)`);
    return "already";
  }

  // 2. ¿Está en FS?
  const localPath =
    process.env.UPLOADS_DIR ||
    path.join(process.cwd(), "uploads", "afip-certs");
  const abs = path.isAbsolute(filename) ? filename : path.join(localPath, filename);
  try {
    const buffer = await fs.readFile(abs);
    // 3. Subir a S3
    await putCertFile(storeId, filename, buffer);
    console.log(`  ↑ ${filename} migrado a S3 (${buffer.length} bytes)`);
    return "migrated";
  } catch (e: any) {
    if (e.code === "ENOENT") {
      console.warn(`  ✗ ${filename} no está ni en S3 ni en FS (${abs})`);
      return "not-in-fs";
    }
    console.error(`  ✗ Error migrando ${filename}: ${e.message}`);
    return "failed";
  }
}

main()
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
