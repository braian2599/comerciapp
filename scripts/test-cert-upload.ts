/**
 * Tests de regresión para:
 *  1. crypto-utils: encrypt/decrypt round-trip, backward-compat, formato
 *  2. cert-info: parseCuit, validarCuitConDigito, cuitMatches
 *  3. cert-info: extracción de info de certificado .p12 auto-firmado generado on-the-fly
 *
 * Ejecutar: npx tsx scripts/test-cert-upload.ts
 */

import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
} from "../src/lib/crypto-utils";
import {
  parseCuit,
  validarCuitConDigito,
  cuitMatches,
  extractCuitFromAttrs,
  extractCertInfoFromP12,
  extractCertInfoFromPem,
} from "../src/lib/cert-info";
import forge from "node-forge";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertThrows(fn: () => void, msg: string) {
  try {
    fn();
    failed++;
    console.error(`  ✗ Should throw: ${msg}`);
  } catch {
    passed++;
  }
}

// Helper: calcula dígito verificador de CUIT (primeros 10 dígitos)
function computeCuitVerif(cuit10: string): string {
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cuit10[i], 10) * mult[i];
  const mod = sum % 11;
  return mod === 0 ? "0" : mod === 1 ? "9" : String(11 - mod);
}

// Genera CUIT válido con prefijo dado (ej: "30" + 8 dígitos)
function genValidCuit(prefix10: string): string {
  return prefix10 + computeCuitVerif(prefix10);
}

// ====== 1. crypto-utils ======

console.log("\n--- crypto-utils: encrypt/decrypt round-trip ---");

{
  const plain = "mi-password-secreta-123";
  const ciphered = encryptSecret(plain);
  assert(ciphered !== plain, "ciphered != plain");
  assert(ciphered.startsWith("v1:"), "formato con prefix v1:");
  assert(isEncryptedSecret(ciphered), "isEncryptedSecret true");
  const decrypted = decryptSecret(ciphered);
  assert(decrypted === plain, "round-trip OK");
}

{
  const plain = "";
  const ciphered = encryptSecret(plain);
  assert(decryptSecret(ciphered) === plain, "round-trip empty string OK");
}

{
  const plain = " contraseña con ñ y acentós ";
  const ciphered = encryptSecret(plain);
  assert(decryptSecret(ciphered) === plain, "round-trip unicode OK");
}

{
  // Cada encrypt genera IV distinto → ciphered distinto
  const plain = "x";
  const c1 = encryptSecret(plain);
  const c2 = encryptSecret(plain);
  assert(c1 !== c2, "IV aleatorio → ciphered distinto para mismo plain");
  assert(decryptSecret(c1) === decryptSecret(c2), "ambos descifran a mismo plain");
}

{
  // Backward-compat: plaintext (sin prefix v1:) se retorna tal cual
  const plaintext = "password-vieja-sin-encriptar";
  assert(!isEncryptedSecret(plaintext), "plaintext no es encrypted");
  assert(decryptSecret(plaintext) === plaintext, "plaintext se retorna tal cual");
}

{
  // Datos corruptos: deben tirar error
  assertThrows(() => decryptSecret("v1:invalid"), "formato inválido throws");
  assertThrows(() => decryptSecret("v1:zz:yy:xx"), "hex inválido throws");
  assertThrows(
    () =>
      decryptSecret(
        "v1:" + "00".repeat(12) + ":" + "00".repeat(16) + ":" + "00".repeat(10)
      ),
    "auth tag inválido throws"
  );
}

// ====== 2. cert-info: parseCuit ======

console.log("\n--- cert-info: parseCuit ---");

{
  const cuit = genValidCuit("3071234567");
  assert(parseCuit(cuit) === cuit, "CUIT limpio");
  assert(
    parseCuit(cuit.slice(0, 2) + "-" + cuit.slice(2, 10) + "-" + cuit.slice(10)) === cuit,
    "CUIT con guiones"
  );
  assert(parseCuit("CUIT " + cuit) === cuit, "CUIT con prefijo");
  assert(parseCuit("CUUIT " + cuit) === cuit, "CUUIT typo");
  assert(parseCuit("") === null, "string vacío");
  assert(parseCuit("123") === null, "muy corto");
  assert(parseCuit("1234567890") === null, "10 dígitos no válido");
  assert(parseCuit("123456789012") === null, "12 dígitos no válido");
  assert(parseCuit(null as any) === null, "null");
  assert(parseCuit(undefined as any) === null, "undefined");
}

// ====== 3. cert-info: validarCuitConDigito ======

console.log("\n--- cert-info: validarCuitConDigito ---");

{
  // Generar CUITs válidos programáticamente para no inventar
  const validCuit1 = genValidCuit("3071234567");
  const validCuit2 = genValidCuit("3050001090");
  const validCuit3 = genValidCuit("2026756539");

  assert(validarCuitConDigito(validCuit1) === true, `CUIT válido 1 (${validCuit1})`);
  assert(validarCuitConDigito(validCuit2) === true, `CUIT válido 2 (${validCuit2})`);
  assert(validarCuitConDigito(validCuit3) === true, `CUIT válido 3 (${validCuit3})`);

  // CUITs inválidos
  const invalidCuit =
    validCuit1.slice(0, 10) + (validCuit1[10] === "0" ? "1" : "0");
  assert(validarCuitConDigito(invalidCuit) === false, "dígito verif incorrecto");
  assert(validarCuitConDigito("3071234567") === false, "muy corto");
  assert(validarCuitConDigito("307123456789") === false, "muy largo");
  assert(validarCuitConDigito("") === false, "vacío");
  assert(validarCuitConDigito("abcdefghijk") === false, "letras");
}

// ====== 4. cert-info: cuitMatches ======

console.log("\n--- cert-info: cuitMatches ---");

{
  const cuit = genValidCuit("3071234567");
  assert(cuitMatches(cuit, cuit) === true, "iguales");
  assert(
    cuitMatches(cuit, cuit.slice(0, 2) + "-" + cuit.slice(2, 10) + "-" + cuit.slice(10)) ===
      true,
    "uno con guiones"
  );
  assert(
    cuitMatches(
      cuit.slice(0, 2) + "-" + cuit.slice(2, 10) + "-" + cuit.slice(10),
      "CUIT " + cuit
    ) === true,
    "ambos con ruido"
  );
  assert(
    cuitMatches(cuit, cuit.slice(0, 10) + (cuit[10] === "0" ? "1" : "0")) === false,
    "distinto dígito"
  );
  assert(cuitMatches(cuit, "") === false, "uno vacío");
  assert(cuitMatches("", cuit) === false, "otro vacío");
  assert(cuitMatches("123", cuit) === false, "uno inválido");
}

// ====== 5. cert-info: extractCuitFromAttrs ======

console.log("\n--- cert-info: extractCuitFromAttrs ---");

{
  const cuit = genValidCuit("3071234567");
  const cuit2 = genValidCuit("3050001090");
  const cuit3 = genValidCuit("2026756539");

  // CN con CUIT
  const attrs1 = [
    { shortName: "CN", name: "commonName", value: "CUIT " + cuit },
    { shortName: "O", name: "organizationName", value: "Mi Comercio" },
  ];
  assert(extractCuitFromAttrs(attrs1 as any) === cuit, "CUIT en CN");

  // CN con CUIT guionado
  const attrs2 = [
    {
      shortName: "CN",
      name: "commonName",
      value:
        "CUIT " + cuit.slice(0, 2) + "-" + cuit.slice(2, 10) + "-" + cuit.slice(10),
    },
  ];
  assert(extractCuitFromAttrs(attrs2 as any) === cuit, "CUIT guionado en CN");

  // serialNumber
  const attrs3 = [
    { shortName: "CN", name: "commonName", value: "Otro Subject" },
    { name: "serialNumber", value: cuit2 },
  ];
  assert(extractCuitFromAttrs(attrs3 as any) === cuit2, "CUIT en serialNumber");

  // OU fallback
  const attrs4 = [
    { shortName: "CN", name: "commonName", value: "Sin CUIT" },
    { shortName: "OU", name: "organizationalUnitName", value: "CUUIT " + cuit3 },
  ];
  assert(extractCuitFromAttrs(attrs4 as any) === cuit3, "CUIT en OU");

  // Sin CUIT en ningún lado
  const attrs5 = [
    { shortName: "CN", name: "commonName", value: "Sin CUIT" },
    { shortName: "O", name: "organizationName", value: "Comercio" },
  ];
  assert(extractCuitFromAttrs(attrs5 as any) === null, "sin CUIT retorna null");

  // Array vacío
  assert(extractCuitFromAttrs([] as any) === null, "array vacío retorna null");
}

// ====== 6. cert-info: extracción de certificado .p12 auto-firmado ======

console.log("\n--- cert-info: extracción de .p12 auto-firmado ---");

{
  // Generar certificado auto-firmado con node-forge para testing
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // +1 año

  const cuit = genValidCuit("3050001090");
  const attrs = [
    { name: "commonName", value: "CUIT " + cuit },
    { name: "organizationName", value: "Comerciapp Test" },
    { name: "countryName", value: "AR" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const certPem = forge.pki.certificateToPem(cert);

  // Test extractCertInfoFromPem
  const infoPem = extractCertInfoFromPem(certPem);
  assert(infoPem.format === "pem", "formato pem detectado");
  assert(infoPem.cuit === cuit, "CUIT extraído del PEM");
  assert(infoPem.subject.includes("CUIT " + cuit), "subject contiene CUIT");
  assert(infoPem.subject.includes("Comerciapp Test"), "subject contiene O");
  assert(infoPem.expired === false, "no vencido");
  assert(infoPem.expiringSoon === false, "no por vencer (>30 días)");
  assert(infoPem.daysUntilExpiry > 360, "vence en >360 días");
  assert(infoPem.fingerprintSha256.length === 64, "fingerprint SHA-256 de 64 hex chars");
  assert(validarCuitConDigito(infoPem.cuit!) === true, "CUIT extraído válido");

  // Crear .p12 con password (sin options para usar defaults)
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    "test-password-123"
  );
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Buffer = Buffer.from(p12Der, "binary");

  // Test extractCertInfoFromP12
  const infoP12 = extractCertInfoFromP12(p12Buffer, "test-password-123");
  assert(infoP12.format === "p12", "formato p12 detectado");
  assert(infoP12.cuit === cuit, "CUIT extraído del .p12");
  assert(infoP12.expired === false, ".p12 no vencido");
  assert(
    infoP12.fingerprintSha256 === infoPem.fingerprintSha256,
    "mismo fingerprint PEM vs P12"
  );

  // Password incorrecta → debe tirar error
  let threw = false;
  try {
    extractCertInfoFromP12(p12Buffer, "wrong-password");
  } catch {
    threw = true;
  }
  assert(threw, "password incorrecta throws");
}

// ====== 7. cert-info: certificado vencido ======

console.log("\n--- cert-info: detección de cert vencido ---");

{
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "02";
  cert.validity.notBefore = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // -100 días
  cert.validity.notAfter = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // -10 días (vencido)

  const cuit = genValidCuit("2026756539");
  const attrs = [
    { name: "commonName", value: "CUIT " + cuit },
    { name: "countryName", value: "AR" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const certPem = forge.pki.certificateToPem(cert);
  const info = extractCertInfoFromPem(certPem);
  assert(info.expired === true, "vencido detectado");
  assert(info.daysUntilExpiry < 0, "daysUntilExpiry negativo");
  assert(info.expiringSoon === false, "no expiringSoon (ya venció)");
}

// ====== 8. cert-info: certificado por vencer (<30 días) ======

console.log("\n--- cert-info: detección de cert por vencer ---");

{
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "03";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // +15 días

  const cuit = genValidCuit("3071234567");
  const attrs = [{ name: "commonName", value: "CUIT " + cuit }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const certPem = forge.pki.certificateToPem(cert);
  const info = extractCertInfoFromPem(certPem);
  assert(info.expired === false, "no vencido");
  assert(info.expiringSoon === true, "expiringSoon detectado");
  assert(info.daysUntilExpiry > 0 && info.daysUntilExpiry <= 30, "0 < days <= 30");
}

// ====== Summary ======

console.log("\n=========================================");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log("=========================================");
process.exit(failed === 0 ? 0 : 1);
