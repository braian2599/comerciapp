import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  leerCertificadoYClave,
  obtenerTokenAcceso,
} from "@/lib/afip-prod";
import { validarCuit } from "@/lib/afip";

/**
 * POST /api/afip/test
 *
 * Diagnóstico de conexión AFIP en modo producción.
 *
 * Ejecuta los 3 pasos críticos sin emitir comprobante:
 *  1. Validar configuración fiscal (CUIT, certPath, environment).
 *  2. Leer certificado (.p12 o .pem) y extraer PEM + clave privada.
 *  3. Solicitar Token de Acceso al WSAA (cachea en DB si OK).
 *
 * Solo ADMIN puede ejecutarlo (no queremos que cualquier usuario pruebe
 * conectividad con AFIP y exponga info sensible en logs).
 *
 * Respuesta 200: { ok: true, steps: [...], tokenExpiresAt }
 * Respuesta 400: { ok: false, error: "...", steps }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const u = session.user as any;
  const storeId = u.storeId;
  if (u.role !== "ADMIN" && u.role !== "OWNER") {
    return NextResponse.json(
      { error: "Solo ADMIN puede ejecutar el diagnóstico AFIP" },
      { status: 403 }
    );
  }

  const steps: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // ---- Step 1: validar TaxConfig ----
  const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
  if (!taxConfig || !taxConfig.active) {
    steps.push({
      name: "config",
      ok: false,
      detail: "No hay configuración fiscal activa",
    });
    return NextResponse.json(
      { ok: false, error: "Configuración fiscal inactiva", steps },
      { status: 400 }
    );
  }
  if (!taxConfig.cuit || !validarCuit(taxConfig.cuit)) {
    steps.push({
      name: "config",
      ok: false,
      detail: "CUIT inválido en configuración",
    });
    return NextResponse.json(
      { ok: false, error: "CUIT inválido", steps },
      { status: 400 }
    );
  }
  if (taxConfig.environment !== "produccion") {
    steps.push({
      name: "config",
      ok: false,
      detail: `environment=${taxConfig.environment} (debe ser 'produccion')`,
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          "El diagnóstico AFIP producción requiere environment='produccion'. Cambie la configuración fiscal.",
        steps,
      },
      { status: 400 }
    );
  }
  if (!taxConfig.certPath) {
    steps.push({
      name: "config",
      ok: false,
      detail: "Falta certPath en configuración",
    });
    return NextResponse.json(
      { ok: false, error: "Falta certPath en la configuración", steps },
      { status: 400 }
    );
  }
  steps.push({
    name: "config",
    ok: true,
    detail: `CUIT=${taxConfig.cuit}, ptoVta=${taxConfig.puntoVenta}, env=${taxConfig.environment}`,
  });

  // ---- Step 2: leer certificado ----
  let certMaterial: { certPem: string; keyPem: string };
  try {
    certMaterial = await leerCertificadoYClave(taxConfig);
    const certLen = certMaterial.certPem.length;
    const keyLen = certMaterial.keyPem.length;
    if (certLen < 200 || keyLen < 200) {
      throw new Error(
        `PEM extraído demasiado corto (cert=${certLen}, key=${keyLen}) — posible corrupción`
      );
    }
    steps.push({
      name: "certificado",
      ok: true,
      detail: `Certificado PEM (${certLen} bytes) + clave privada (${keyLen} bytes) extraídos OK`,
    });
  } catch (e: any) {
    steps.push({
      name: "certificado",
      ok: false,
      detail: e?.message || "Error al leer certificado",
    });
    return NextResponse.json(
      {
        ok: false,
        error: `Fallo al leer certificado: ${e?.message}`,
        steps,
      },
      { status: 400 }
    );
  }

  // ---- Step 3: obtener TA del WSAA ----
  try {
    const ta = await obtenerTokenAcceso(taxConfig, "wsfe");
    steps.push({
      name: "wsaa",
      ok: true,
      detail: `Token obtenido (expira ${ta.expiresAt.toISOString()})`,
    });

    // Verificar cache en DB
    const refreshed = await db.taxConfig.findUnique({
      where: { id: taxConfig.id },
      select: { authTokenExpires: true },
    });
    if (refreshed?.authTokenExpires) {
      steps.push({
        name: "wsaa_cache",
        ok: true,
        detail: `Token cacheado en DB hasta ${refreshed.authTokenExpires.toISOString()}`,
      });
    }

    return NextResponse.json({
      ok: true,
      steps,
      tokenExpiresAt: ta.expiresAt,
      cuit: taxConfig.cuit,
      puntoVenta: taxConfig.puntoVenta,
      environment: taxConfig.environment,
    });
  } catch (e: any) {
    steps.push({
      name: "wsaa",
      ok: false,
      detail: e?.message || "Error al contactar WSAA",
    });
    return NextResponse.json(
      {
        ok: false,
        error: `Fallo al obtener Token de Acceso: ${e?.message}`,
        steps,
      },
      { status: 400 }
    );
  }
}
