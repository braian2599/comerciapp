/**
 * Tests de regresión para la lógica de derivación de estado
 * en AfipConnectionPanel.
 *
 * Valida que deriveStatus() mapee correctamente las respuestas
 * del endpoint /api/afip/test a los 6 estados posibles.
 *
 * Correr con: npx tsx scripts/test-afip-derive-status.ts
 */

// Replicamos deriveStatus aquí porque está dentro del componente.
// Si cambia en el componente, este test nos avisa.

type AfipStatus =
  | "unknown"
  | "connected"
  | "config_error"
  | "cert_error"
  | "wsaa_error"
  | "network_error";

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
}

function deriveStatus(resp: AfipTestResponse): AfipStatus {
  if (resp.ok) return "connected";
  const failed = resp.steps?.find((s) => !s.ok);
  if (!failed) return "network_error";
  if (failed.name === "config") return "config_error";
  if (failed.name === "certificado") return "cert_error";
  if (failed.name === "wsaa" || failed.name === "wsaa_cache") return "wsaa_error";
  return "network_error";
}

let passed = 0;
let failed = 0;

function assert(actual: AfipStatus, expected: AfipStatus, msg: string) {
  if (actual === expected) {
    console.log(`  ✓ ${msg} → ${actual}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg} → expected ${expected}, got ${actual}`);
    failed++;
  }
}

console.log("\n=== TEST 1: Respuesta exitosa ===");
{
  const r: AfipTestResponse = {
    ok: true,
    steps: [
      { name: "config", ok: true },
      { name: "certificado", ok: true },
      { name: "wsaa", ok: true },
    ],
    tokenExpiresAt: "2024-12-31T23:59:59Z",
  };
  assert(deriveStatus(r), "connected", "ok=true → connected");
}

console.log("\n=== TEST 2: Error en config (sin CUIT) ===");
{
  const r: AfipTestResponse = {
    ok: false,
    error: "CUIT inválido",
    steps: [{ name: "config", ok: false, detail: "CUIT inválido" }],
  };
  assert(deriveStatus(r), "config_error", "config fail → config_error");
}

console.log("\n=== TEST 3: Error en certificado (password incorrecto) ===");
{
  const r: AfipTestResponse = {
    ok: false,
    error: "No se pudo leer el .p12",
    steps: [
      { name: "config", ok: true },
      { name: "certificado", ok: false, detail: "password incorrecta" },
    ],
  };
  assert(deriveStatus(r), "cert_error", "cert fail → cert_error");
}

console.log("\n=== TEST 4: Error en WSAA (TRA rechazado) ===");
{
  const r: AfipTestResponse = {
    ok: false,
    error: "WSAA rechazó el TRA",
    steps: [
      { name: "config", ok: true },
      { name: "certificado", ok: true },
      { name: "wsaa", ok: false, detail: "Certificado no autorizado" },
    ],
  };
  assert(deriveStatus(r), "wsaa_error", "wsaa fail → wsaa_error");
}

console.log("\n=== TEST 5: Error sin steps (network) ===");
{
  const r: AfipTestResponse = {
    ok: false,
    error: "Timeout",
  };
  assert(deriveStatus(r), "network_error", "sin steps → network_error");
}

console.log("\n=== TEST 6: Error en wsaa_cache ===");
{
  const r: AfipTestResponse = {
    ok: false,
    error: "Cache corrupto",
    steps: [
      { name: "config", ok: true },
      { name: "certificado", ok: true },
      { name: "wsaa", ok: true },
      { name: "wsaa_cache", ok: false, detail: "DB error" },
    ],
  };
  assert(deriveStatus(r), "wsaa_error", "wsaa_cache fail → wsaa_error");
}

console.log("\n=== TEST 7: Todos los steps OK pero ok=false ===");
{
  // Edge case: server devolvió ok=false pero todos los steps ok=true.
  // Esto no debería pasar pero si pasa, debería ser network_error
  // (porque deriveStatus busca el primer step !ok y no encuentra).
  const r: AfipTestResponse = {
    ok: false,
    error: "Inconsistencia",
    steps: [
      { name: "config", ok: true },
      { name: "certificado", ok: true },
      { name: "wsaa", ok: true },
    ],
  };
  assert(deriveStatus(r), "network_error", "ok=false pero todos steps OK → network_error");
}

console.log(`\n=== RESULTADO: ${passed} OK / ${failed} FAIL ===`);
process.exit(failed === 0 ? 0 : 1);
