import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleEcommerceWebhook } from "@/lib/ecommerce";

// POST /api/ecommerce/webhook - recibir notificaciones de la plataforma
// Header: X-ComerciApp-Store-ID o ?storeId=xxx
// Body: { event: string, payload: any }
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const storeId = url.searchParams.get("storeId") || req.headers.get("x-comerciapp-store-id");

  if (!storeId) {
    return NextResponse.json({ error: "storeId requerido" }, { status: 400 });
  }

  // Validar webhook secret si está configurado
  const config = await db.ecommerceConfig.findUnique({ where: { storeId } });
  if (!config || !config.enabled) {
    return NextResponse.json({ error: "E-commerce no habilitado" }, { status: 403 });
  }

  const webhookSecret = req.headers.get("x-webhook-secret") || url.searchParams.get("secret");
  if (config.webhookSecret && webhookSecret !== config.webhookSecret) {
    return NextResponse.json({ error: "Secreto inválido" }, { status: 401 });
  }

  const body = await req.json();
  const { event, payload } = body;

  if (!event) {
    return NextResponse.json({ error: "event requerido" }, { status: 400 });
  }

  const result = await handleEcommerceWebhook(storeId, event, payload);

  return NextResponse.json({ ok: result.ok, message: result.message });
}
