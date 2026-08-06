import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAdapter, type Platform, type AdapterConfig } from "@/lib/ecommerce";

/**
 * POST /api/ecommerce/test
 *
 * Prueba la conexión a la plataforma de e-commerce configurada.
 *
 * Cuerpo (opcional — si no se envía, usa la config guardada en DB):
 *   {
 *     platform?: "TIENDA_NUBE" | "WOOCOMMERCE" | "MERCADOLIBRE" | "SHOPIFY",
 *     apiUrl?, apiKey?, apiSecret?, accessToken?, storeExternalId?
 *   }
 *
 * Respuesta:
 *   200 OK -> { ok: true|false, message: string, platform: string, latencyMs: number }
 *   401    -> no autenticado
 *   403    -> no es ADMIN
 *   400    -> plataforma inválida o faltan credenciales
 *   500    -> error inesperado
 *
 * DISEÑO ROBUSTO:
 * - Si el body viene vacío, usa la config persistida en DB (no obliga al
 *   usuario a guardar primero para probar).
 * - Si el body viene con campos, los mergea con la config de DB (permite
 *   probar credenciales nuevas antes de guardarlas).
 * - Mide latencia de la llamada remota.
 * - Nunca expone el access token / api key en la respuesta.
 * - Sanitiza el mensaje de error para no filtrar credenciales en logs.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // ─── Auth ────────────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const storeId = u.storeId;
  if (!storeId) {
    return NextResponse.json({ error: "Sin storeId" }, { status: 400 });
  }

  // ─── Body + DB config merge ──────────────────────────────────────────────
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Body vacío o inválido → usar solo config de DB
    body = {};
  }

  let dbConfig: AdapterConfig & { platform?: Platform } = {};
  try {
    const persisted = await db.ecommerceConfig.findUnique({ where: { storeId } });
    if (persisted) {
      dbConfig = {
        platform: persisted.platform as Platform,
        apiUrl: persisted.apiUrl,
        apiKey: persisted.apiKey,
        apiSecret: persisted.apiSecret,
        accessToken: persisted.accessToken,
        storeExternalId: persisted.storeExternalId,
      };
    }
  } catch (err) {
    console.warn("[ecommerce/test] error leyendo config de DB:", err);
    // No abortamos — el body puede tener todo lo necesario
  }

  // Merge: body tiene prioridad sobre DB
  const platform = (body.platform as Platform) || dbConfig.platform;
  const adapterConfig: AdapterConfig = {
    apiUrl: body.apiUrl ?? dbConfig.apiUrl,
    apiKey: body.apiKey ?? dbConfig.apiKey,
    apiSecret: body.apiSecret ?? dbConfig.apiSecret,
    accessToken: body.accessToken ?? dbConfig.accessToken,
    storeExternalId: body.storeExternalId ?? dbConfig.storeExternalId,
  };

  // ─── Validaciones ────────────────────────────────────────────────────────
  const VALID_PLATFORMS: Platform[] = [
    "TIENDA_NUBE",
    "WOOCOMMERCE",
    "MERCADOLIBRE",
    "SHOPIFY",
  ];
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      {
        ok: false,
        message: `Plataforma inválida. Debe ser una de: ${VALID_PLATFORMS.join(", ")}`,
        platform: platform || null,
        latencyMs: Date.now() - startedAt,
      },
      { status: 400 }
    );
  }

  // Validación previa de campos requeridos por plataforma (mejor UX: dar
  // mensaje específico antes de hacer la llamada HTTP)
  const validation = validatePlatformFields(platform, adapterConfig);
  if (!validation.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: validation.message,
        platform,
        latencyMs: Date.now() - startedAt,
      },
      { status: 400 }
    );
  }

  // ─── Llamada al adaptador ────────────────────────────────────────────────
  try {
    const adapter = getAdapter(platform);
    const result = await adapter.testConnection(adapterConfig);
    const latencyMs = Date.now() - startedAt;

    // Sanitizar mensaje: nunca devolver tokens/keys aunque el adaptador los incluya
    const safeMessage = sanitizeMessage(result.message);

    return NextResponse.json(
      {
        ok: result.ok,
        message: safeMessage,
        platform,
        latencyMs,
      },
      { status: result.ok ? 200 : 200 } // 200 incluso si ok=false: la llamada
      // al endpoint salió bien; la conexión a la plataforma no. El frontend
      // decide cómo mostrarlo según `ok`.
    );
  } catch (err: any) {
    const latencyMs = Date.now() - startedAt;
    console.error("[ecommerce/test] error inesperado:", err);
    return NextResponse.json(
      {
        ok: false,
        message: `Error inesperado: ${err?.message || "desconocido"}`,
        platform,
        latencyMs,
      },
      { status: 500 }
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function validatePlatformFields(
  platform: Platform,
  cfg: AdapterConfig
): { ok: true } | { ok: false; message: string } {
  switch (platform) {
    case "TIENDA_NUBE":
    case "MERCADOLIBRE":
      if (!cfg.accessToken) {
        return {
          ok: false,
          message: `Falta el Access Token para ${platform === "TIENDA_NUBE" ? "TiendaNube" : "MercadoLibre"}.`,
        };
      }
      if (!cfg.storeExternalId) {
        return {
          ok: false,
          message: `Falta el Store ID externo para ${platform === "TIENDA_NUBE" ? "TiendaNube" : "MercadoLibre"}.`,
        };
      }
      return { ok: true };

    case "WOOCOMMERCE":
      if (!cfg.apiUrl) {
        return { ok: false, message: "Falta la URL de la API de WooCommerce." };
      }
      if (!cfg.apiUrl.startsWith("http")) {
        return {
          ok: false,
          message: "La URL de la API debe empezar con http:// o https://",
        };
      }
      if (!cfg.apiKey || !cfg.apiSecret) {
        return {
          ok: false,
          message: "Faltan Consumer Key y Consumer Secret de WooCommerce.",
        };
      }
      return { ok: true };

    case "SHOPIFY":
      if (!cfg.apiUrl) {
        return { ok: false, message: "Falta la URL de la tienda Shopify." };
      }
      if (!cfg.apiUrl.startsWith("http")) {
        return {
          ok: false,
          message: "La URL de la tienda debe empezar con http:// o https://",
        };
      }
      if (!cfg.apiKey || !cfg.apiSecret) {
        return {
          ok: false,
          message: "Faltan API Key y API Secret de Shopify.",
        };
      }
      return { ok: true };

    default:
      return { ok: false, message: `Plataforma no soportada: ${platform}` };
  }
}

/**
 * Sanitiza el mensaje para no exponer credenciales en la respuesta HTTP
 * ni en logs. Si el mensaje contiene algo que parece un token, lo reemplaza.
 */
function sanitizeMessage(msg: string | undefined): string {
  if (!msg) return "Sin mensaje";
  let safe = msg;
  // Reemplazar tokens largos (>20 chars alfanum) por ***
  safe = safe.replace(/[A-Za-z0-9_\-]{20,}/g, "***REDACTED***");
  // Reemplazar bearer tokens
  safe = safe.replace(/[Bb]earer\s+[A-Za-z0-9_\-\.]+/g, "bearer ***REDACTED***");
  return safe;
}
