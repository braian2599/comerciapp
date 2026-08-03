import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  syncProductsOutbound,
  syncStockOutbound,
  syncOrdersInbound,
} from "@/lib/ecommerce";

// POST /api/ecommerce/sync - ejecutar sincronización
// Body: { direction: "OUTBOUND" | "INBOUND", entity: "PRODUCT" | "STOCK" | "PRICE" | "ORDER", limit?, onlyDirty? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const storeId = u.storeId;
  const body = await req.json();
  const { direction = "OUTBOUND", entity = "PRODUCT", limit, onlyDirty } = body;

  const config = await db.ecommerceConfig.findUnique({ where: { storeId } });
  if (!config || !config.enabled) {
    return NextResponse.json({ error: "E-commerce no configurado o deshabilitado" }, { status: 400 });
  }

  let result;
  if (direction === "OUTBOUND") {
    if (entity === "PRODUCT") {
      result = await syncProductsOutbound(storeId, { onlyDirty, limit });
    } else if (entity === "STOCK") {
      result = await syncStockOutbound(storeId);
    } else if (entity === "PRICE") {
      // Actualizar precios (similar a stock)
      const products = await db.product.findMany({
        where: { storeId, ecommerceProductId: { not: null } },
        take: limit || 100,
      });
      // Reutilizar adapter
      const { getAdapter } = await import("@/lib/ecommerce");
      const adapter = getAdapter(config.platform as any);
      const adapterCfg: any = {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        accessToken: config.accessToken,
        storeExternalId: config.storeExternalId,
      };
      let success = 0, error = 0;
      for (const p of products) {
        const r = await adapter.updatePrice(adapterCfg, p.ecommerceProductId!, p.salePrice);
        if (r.ok) success++;
        else error++;
      }
      result = { total: products.length, success, error, logs: [] };
    } else {
      return NextResponse.json({ error: "Entidad no soportada para OUTBOUND" }, { status: 400 });
    }
  } else if (direction === "INBOUND") {
    if (entity === "ORDER") {
      result = await syncOrdersInbound(storeId);
    } else {
      return NextResponse.json({ error: "Entidad no soportada para INBOUND" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Direction inválida" }, { status: 400 });
  }

  return NextResponse.json(result);
}

// GET /api/ecommerce/sync - listar logs de sincronización
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 50);

  const logs = await db.ecommerceSyncLog.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(logs);
}
