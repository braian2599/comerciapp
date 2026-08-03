import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// GET /api/reports/products?from=&to=&limit=20
// Ranking de productos más vendidos
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Number(url.searchParams.get("limit") || 20);

  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);

  // Obtener items de venta del período
  const items = await db.saleItem.findMany({
    where: {
      sale: {
        storeId,
        status: "COMPLETADA",
        createdAt: { gte: start, lte: end },
      },
    },
    include: {
      product: {
        select: { id: true, name: true, barcode: true, sku: true, salePrice: true, costPrice: true, stock: true, active: true },
      },
    },
  });

  // Agrupar por producto
  const map = new Map<string, {
    productId: string;
    productName: string;
    barcode?: string | null;
    sku?: string | null;
    quantitySold: number;
    revenue: number;
    cost: number;
    profit: number;
    salePrice: number;
    costPrice: number;
    currentStock: number;
    active: boolean;
  }>();

  for (const it of items) {
    const pid = it.productId;
    const ex = map.get(pid) || {
      productId: pid,
      productName: it.product.name,
      barcode: it.product.barcode,
      sku: it.product.sku,
      quantitySold: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      salePrice: it.product.salePrice,
      costPrice: it.product.costPrice,
      currentStock: it.product.stock,
      active: it.product.active,
    };
    ex.quantitySold += it.quantity;
    ex.revenue += it.subtotal;
    ex.cost += it.costPrice * it.quantity;
    ex.profit += (it.unitPrice - it.costPrice) * it.quantity;
    map.set(pid, ex);
  }

  const ranking = Array.from(map.values())
    .map((p) => ({
      ...p,
      revenue: Number(p.revenue.toFixed(2)),
      cost: Number(p.cost.toFixed(2)),
      profit: Number(p.profit.toFixed(2)),
      margin: p.revenue > 0 ? Number(((p.profit / p.revenue) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);

  // Top por cantidad
  const topByQuantity = Array.from(map.values())
    .map((p) => ({
      productId: p.productId,
      productName: p.productName,
      quantitySold: p.quantitySold,
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, 10);

  // Top por ganancia
  const topByProfit = Array.from(map.values())
    .map((p) => ({
      productId: p.productId,
      productName: p.productName,
      profit: Number(p.profit.toFixed(2)),
    }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 10);

  // Total de productos distintos vendidos
  const totalProductosVendidos = map.size;

  return NextResponse.json({
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      totalProductosVendidos,
      totalItemsVendidos: items.reduce((s, i) => s + i.quantity, 0),
      revenue: Number(ranking.reduce((s, r) => s + r.revenue, 0).toFixed(2)),
      cost: Number(ranking.reduce((s, r) => s + r.cost, 0).toFixed(2)),
      profit: Number(ranking.reduce((s, r) => s + r.profit, 0).toFixed(2)),
    },
    ranking,
    topByQuantity,
    topByProfit,
  });
}
