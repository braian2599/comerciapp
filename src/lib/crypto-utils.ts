/**
 * crypto-utils.ts
 *
 * Utilidades criptográficas para datos sensibles en la DB.
 *
 * Caso de uso principal: encriptar `TaxConfig.certPassword` (la contraseña
 * del certificado .p12 de AFIP) para que no quede en plaintext si la base
 * de datos se comparte, hace backup, o se inspecciona con un cliente SQL.
 *
 * Algoritmo: AES-256-GCM (authenticated encryption).
 *  - IV: 12 bytes aleatorios por cada operación (único, no secreto).
 *  - Auth tag: 16 bytes (valida integridad + autenticidad).
 *  - Salida serializada como: `v1:${ivHex}:${tagHex}:${cipherHex}` para
 *    distinguir blobs encriptados de strings en plaintext (backward-compat
 *    con registros viejos no encriptados).
 *
 * La key se obtiene de `process.env.CERT_PASSWORD_ENCRYPTION_KEY` (hex de
 * 64 chars = 32 bytes). Si no está seteada, se deriva de
 * `process.env.NEXTAUTH_SECRET` con SHA-256 (32 bytes) para entornos dev
 * sin configuración explícita. Si tampoco hay NEXTAUTH_SECRET, se lanza
 * error: en producción debe haber una key dedicada.
 *
 * Rotación de key: si se cambia la key, los blobs viejos no se pueden
 * desencriptar. Implementar migración con doble key si hace falta.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "v1:";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Obtiene la key de encriptación (32 bytes).
 *
 * Prioridad:
 *   1. CERT_PASSWORD_ENCRYPTION_KEY (hex de 64 chars)
 *   2. SHA-256(NEXTAUTH_SECRET)
 *   3. Error en producción / fallback débil en dev
 */
function getKey(): Buffer {
  const explicit = process.env.CERT_PASSWORD_ENCRYPTION_KEY;
  if (explicit) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicit)) {
      throw new Error(
        "CERT_PASSWORD_ENCRYPTION_KEY debe ser hex de 64 caracteres (32 bytes)"
      );
    }
    return Buffer.from(explicit, "hex");
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (secret) {
    return createHash("sha256").update(secret).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Falta CERT_PASSWORD_ENCRYPTION_KEY o NEXTAUTH_SECRET para encriptar secrets en producción"
    );
  }

  // Dev fallback: key derivada de string hardcodeado. SOLO dev.
  // Esto evita romper el setup local pero NO debe usarse en prod.
  console.warn(
    "[crypto-utils] Usando key de dev fallback. Setear CERT_PASSWORD_ENCRYPTION_KEY en producción."
  );
  return createHash("sha256").update("comerciapp-dev-fallback-key").digest();
}

/**
 * Encripta un string plano.
 *
 * @returns string serializado `v1:<ivHex>:<tagHex>:<cipherHex>`
 * @throws si plain es null/undefined
 */
export function encryptSecret(plain: string): string {
  if (plain == null) {
    throw new Error("encryptSecret: plain no puede ser null/undefined");
  }
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphered = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ciphered.toString("hex")}`;
}

/**
 * Desencripta un string producido por `encryptSecret`.
 *
 * Acepta también strings en plaintext (sin prefix `v1:`) para backward-compat
 * con registros viejos: en ese caso retorna el string tal cual.
 *
 * @returns string plano
 * @throws si el formato es inválido o la key es incorrecta (auth tag mismatch)
 */
export function decryptSecret(stored: string): string {
  if (!stored) return stored;

  // Backward-compat: si no tiene prefix v1, es plaintext viejo
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }

  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("decryptSecret: formato inválido (se esperan 3 partes)");
  }
  const [ivHex, tagHex, cipherHex] = parts;

  let iv: Buffer, tag: Buffer, ciphered: Buffer;
  try {
    iv = Buffer.from(ivHex, "hex");
    tag = Buffer.from(tagHex, "hex");
    ciphered = Buffer.from(cipherHex, "hex");
  } catch {
    throw new Error("decryptSecret: hex inválido");
  }

  if (iv.length !== IV_BYTES) {
    throw new Error(
      `decryptSecret: IV debe ser ${IV_BYTES} bytes, recibido ${iv.length}`
    );
  }
  if (tag.length !== 16) {
    throw new Error(
      `decryptSecret: auth tag debe ser 16 bytes, recibido ${tag.length}`
    );
  }

  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([
      decipher.update(ciphered),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch (e: any) {
    throw new Error(
      `decryptSecret: no se pudo desencriptar (key incorrecta o dato corrupto): ${e?.message}`
    );
  }
}

/**
 * Indica si un string está encriptado con el formato v1.
 * Útil para logs/diagnóstico sin intentar desencriptar.
 */
export function isEncryptedSecret(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}
