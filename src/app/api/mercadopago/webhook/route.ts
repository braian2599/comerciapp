import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { procesarWebhookMP } from "@/lib/mercado-pago";

// POST: webhook de Mercado Pago
// MP envía: { type: "payment", data: { id: "123456" } }
// También: ?type=payment&data.id=123456 en query (IPN)
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const queryType = url.searchParams.get("type");
    const queryDataId = url.searchParams.get("data.id");

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Si no hay body JSON, usar query params (IPN)
      body = {
        type: queryType,
        data: { id: queryDataId },
      };
    }

    // MP puede enviar webhook sin storeId directo.
    // Buscar por el preference_id del pago para determinar el storeId.
    if (!body.data?.id) {
      return NextResponse.json({ ok: true });
    }

    const mpPaymentId = String(body.data.id);

    // Buscar el pago local por mpPaymentId
    let storeId: string | null = null;
    const local = await db.mercadoPagoPayment.findFirst({
      where: { mpPaymentId },
    });
    if (local) {
      storeId = local.storeId;
    } else {
      // Si no encontramos por mpPaymentId, puede ser que no tenemos el pago local todavía
      // Buscar por preferenceId en el body (a veces MP lo manda)
      const prefId = body.preference_id || body.data?.preference_id;
      if (prefId) {
        const byPref = await db.mercadoPagoPayment.findFirst({
          where: { mpPreferenceId: prefId },
        });
        if (byPref) storeId = byPref.storeId;
      }
    }

    if (!storeId) {
      // No podemos procesar sin saber el storeId
      // Aceptamos igual para que MP no reintente
      return NextResponse.json({ ok: true, message: "no store found" });
    }

    await procesarWebhookMP(storeId, body);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Webhook MP error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
