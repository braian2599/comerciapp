import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/ecommerce/config - obtener configuración
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  let config = await db.ecommerceConfig.findUnique({ where: { storeId } });
  if (!config) {
    // Crear config por defecto
    config = await db.ecommerceConfig.create({
      data: { storeId },
    });
  }

  return NextResponse.json(config);
}

// PUT /api/ecommerce/config - actualizar configuración
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const storeId = u.storeId;
  const body = await req.json();

  const data: any = {};
  const fields = [
    "platform", "enabled", "apiUrl", "apiKey", "apiSecret",
    "accessToken", "storeExternalId",
    "syncProducts", "syncStock", "syncPrices", "syncOrders", "autoFulfill",
    "webhookSecret",
  ];
  for (const f of fields) {
    if (body[f] !== undefined) data[f] = body[f];
  }

  let config = await db.ecommerceConfig.findUnique({ where: { storeId } });
  if (!config) {
    config = await db.ecommerceConfig.create({
      data: { storeId, ...data },
    });
  } else {
    config = await db.ecommerceConfig.update({
      where: { storeId },
      data,
    });
  }

  return NextResponse.json(config);
}
