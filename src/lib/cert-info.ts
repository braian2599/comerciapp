/**
 * cert-info.ts
 *
 * Utilidades para inspeccionar certificados X.509 de AFIP sin emitirlos
 * ni exponer su contenido sensible.
 *
 * Usado por:
 *  - /api/afip/cert POST: valida el certificado al subirlo (extrae CUIT,
 *    compara con TaxConfig, verifica que no esté vencido).
 *  - /api/afip/cert GET: retorna info legible del certificado actual
 *    (subject, issuer, validez, fingerprint) sin exponer la clave privada.
 *
 * CUIT en certificados AFIP:
 *  - El CUIT del contribuyente está en el campo CN del Subject, con formato
 *    `CUIT nnnnnnnnnnn` (con espacio) en la mayoría de los casos.
 *  - Algunos certificados lo tienen como `serialNumber` del Subject.
 *  - Algunos lo tienen en el OU (organizationalUnitName).
 *  - Estrategia: buscar en CN primero, luego serialNumber, luego OU.
 *
 * Nota: los certificados de AFIP suelen tener validez de 2-3 años. Es
 * responsabilidad del usuario renovarlos antes del vencimiento. Aquí
 * calculamos `daysUntilExpiry` para mostrar un warning en la UI cuando
 * falten < 30 días.
 */

import forge from "node-forge";

export interface CertInfo {
  /** Subject del certificado en formato legible (CN, OU, O, C). */
  subject: string;
  /** Issuer (entidad certificadora) del certificado. */
  issuer: string;
  /** CUIT extraído del Subject, sin guiones. null si no se encuentra. */
  cuit: string | null;
  /** Fecha de inicio de validez (notBefore). */
  validFrom: Date;
  /** Fecha de fin de validez (notAfter). */
  validTo: Date;
  /** Días hasta el vencimiento (negativo si ya venció). */
  daysUntilExpiry: number;
  /** ¿Está vencido? */
  expired: boolean;
  /** ¿Vence en los próximos 30 días? */
  expiringSoon: boolean;
  /** Fingerprint SHA-256 del certificado (para identificarlo unívocamente). */
  fingerprintSha256: string;
  /** Número de serie del certificado (hex). */
  serialNumber: string;
  /** Formato del archivo original. */
  format: "p12" | "pem";
}

/**
 * Extrae info de un certificado PEM (sin clave privada).
 *
 * @param certPem string PEM del certificado (BEGIN CERTIFICATE / END CERTIFICATE)
 */
export function extractCertInfoFromPem(certPem: string): CertInfo {
  const cert = forge.pki.certificateFromPem(certPem);
  return buildCertInfo(cert, "pem");
}

/**
 * Extrae info del primer certificado de un .p12/.pfx.
 *
 * @param p12Buffer buffer del archivo .p12 binario
 * @param password contraseña del .p12
 */
export function extractCertInfoFromP12(
  p12Buffer: Buffer,
  password: string
): CertInfo {
  const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  let cert: forge.pki.Certificate | null = null;
  // Iterar safeContents; cada uno puede tener .safeBags (node-forge moderno)
  // o .bags (formato legacy). Soportamos ambos para robustez.
  for (const safeContents of p12.safeContents) {
    const bags =
      (safeContents as any).safeBags || (safeContents as any).bags || [];
    for (const bag of bags) {
      if (bag.type === forge.pki.oids.certBag) {
        cert = (bag as any).cert;
        break;
      }
    }
    if (cert) break;
  }

  if (!cert) {
    throw new Error("No se encontró ningún certificado en el .p12");
  }
  return buildCertInfo(cert, "p12");
}

function buildCertInfo(
  cert: forge.pki.Certificate,
  format: "p12" | "pem"
): CertInfo {
  const subjectAttrs = cert.subject.attributes;
  const issuerAttrs = cert.issuer.attributes;

  const subject = formatAttrs(subjectAttrs);
  const issuer = formatAttrs(issuerAttrs);
  const cuit = extractCuitFromAttrs(subjectAttrs);

  const validFrom = cert.validity.notBefore;
  const validTo = cert.validity.notAfter;

  const now = new Date();
  const msUntilExpiry = validTo.getTime() - now.getTime();
  const daysUntilExpiry = Math.floor(msUntilExpiry / (1000 * 60 * 60 * 24));

  // Fingerprint SHA-256
  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(derBytes);
  const fingerprintSha256 = md.digest().toHex();

  return {
    subject,
    issuer,
    cuit,
    validFrom,
    validTo,
    daysUntilExpiry,
    expired: daysUntilExpiry < 0,
    expiringSoon: daysUntilExpiry >= 0 && daysUntilExpiry <= 30,
    fingerprintSha256,
    serialNumber: cert.serialNumber || "",
    format,
  };
}

/**
 * Formatea los atributos del subject/issuer como string legible.
 * Ej: "CN=CUIT 30712345678, O=MI COMERCIO SRL, C=AR"
 */
function formatAttrs(attrs: forge.pki.Attribute[]): string {
  if (!attrs || attrs.length === 0) return "(vacío)";
  const parts: string[] = [];
  for (const attr of attrs) {
    const name = attr.shortName || attr.name || attr.type;
    let value = attr.value || "";
    if (typeof value !== "string") {
      // Algunos atributos (como extensions) pueden tener valor no-string
      try {
        value = JSON.stringify(value);
      } catch {
        value = "(non-string)";
      }
    }
    parts.push(`${name}=${value}`);
  }
  return parts.join(", ");
}

/**
 * Extrae el CUIT del subject del certificado.
 *
 * Busca en este orden:
 *  1. CN (commonName) — formato típico: "CUUIT 30712345678" o "CUIT 30-71234567-8"
 *  2. serialNumber — algunos certificados lo traen aquí
 *  3. OU (organizationalUnitName) — fallback
 *
 * Limpia guiones, espacios, prefijos "CUIT"/"CUUIT" y el dígito verificador
 * se mantiene (debe ser 11 dígitos).
 */
export function extractCuitFromAttrs(
  attrs: forge.pki.Attribute[]
): string | null {
  // 1. CN
  const cn = attrs.find(
    (a) => a.shortName === "CN" || a.name === "commonName"
  )?.value as string | undefined;
  if (cn) {
    const cuit = parseCuit(cn);
    if (cuit) return cuit;
  }

  // 2. serialNumber
  const sn = attrs.find((a) => a.name === "serialNumber")?.value as
    | string
    | undefined;
  if (sn) {
    const cuit = parseCuit(sn);
    if (cuit) return cuit;
  }

  // 3. OU
  const ou = attrs.find(
    (a) => a.shortName === "OU" || a.name === "organizationalUnitName"
  )?.value as string | undefined;
  if (ou) {
    const cuit = parseCuit(ou);
    if (cuit) return cuit;
  }

  return null;
}

/**
 * Extrae un CUIT válido de un string arbitrario.
 * Acepta formatos: "30712345678", "30-71234567-8", "CUIT 30712345678",
 * "CUUIT 30-71234567-8", etc.
 *
 * @returns CUIT sin guiones (11 dígitos) o null si no encuentra un CUIT válido
 */
export function parseCuit(s: string): string | null {
  if (!s || typeof s !== "string") return null;
  // Quitar todo lo que no sea dígito
  const digits = s.replace(/\D/g, "");
  // CUIT tiene 11 dígitos
  if (digits.length === 11) return digits;
  // Algunos certificados traen solo 10 dígitos (sin el verificador) → no válido
  return null;
}

/**
 * Valida un CUIT con el algoritmo del dígito verificador (módulo 11).
 * @returns true si el CUIT es válido
 */
export function validarCuitConDigito(cuit: string): boolean {
  const clean = cuit.replace(/\D/g, "");
  if (clean.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean[i], 10) * mult[i];
  }
  const mod = sum % 11;
  const verif = mod === 0 ? 0 : mod === 1 ? 9 : 11 - mod;
  return verif === parseInt(clean[10], 10);
}

/**
 * Compara el CUIT del certificado con un CUIT esperado.
 *
 * @param certCuit CUIT extraído del certificado (11 dígitos)
 * @param expectedCuit CUIT esperado (puede tener guiones, se normaliza)
 * @returns true si coinciden (ambos válidos y mismo número)
 */
export function cuitMatches(certCuit: string, expectedCuit: string): boolean {
  const a = parseCuit(certCuit);
  const b = parseCuit(expectedCuit);
  if (!a || !b) return false;
  return a === b;
}
