import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// GET /api/reports/sales?from=&to=&groupBy=day|week|month
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const groupBy = url.searchParams.get("groupBy") || "day"; // day | week | month

  // Defaults: últimos 30 días
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);

  const where: Prisma.SaleWhereInput = {
    storeId,
    status: "COMPLETADA",
    createdAt: { gte: start, lte: end },
  };

  // 1. Resumen general
  const [totalSales, totalAmountAgg, totalDiscountAgg, totalSurchargeAgg] = await Promise.all([
    db.sale.count({ where }),
    db.sale.aggregate({ where, _sum: { total: true } }),
    db.sale.aggregate({ where, _sum: { discount: true } }),
    db.sale.aggregate({ where, _sum: { surcharge: true } }),
  ]);

  // 2. Ventas agrupadas por día/semana/mes
  const sales = await db.sale.findMany({
    where,
    select: { createdAt: true, total: true, discount: true, surcharge: true, paymentMethod: true },
    orderBy: { createdAt: "asc" },
  });

  const grouped = new Map<string, { count: number; total: number; discount: number; surcharge: number }>();
  for (const s of sales) {
    const d = s.createdAt;
    let key: string;
    if (groupBy === "month") {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } else if (groupBy === "week") {
      const onejan = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
      key = `${d.getFullYear()}-S${String(week).padStart(2, "0")}`;
    } else {
      key = d.toISOString().slice(0, 10);
    }
    const existing = grouped.get(key) || { count: 0, total: 0, discount: 0, surcharge: 0 };
    existing.count += 1;
    existing.total += s.total;
    existing.discount += s.discount;
    existing.surcharge += s.surcharge;
    grouped.set(key, existing);
  }

  const series = Array.from(grouped.entries()).map(([key, v]) => ({
    period: key,
    count: v.count,
    total: Number(v.total.toFixed(2)),
    discount: Number(v.discount.toFixed(2)),
    surcharge: Number(v.surcharge.toFixed(2)),
  }));

  // 3. Ventas por método de pago
  const byMethodMap = new Map<string, { count: number; total: number }>();
  for (const s of sales) {
    const m = s.paymentMethod || "OTRO";
    const existing = byMethodMap.get(m) || { count: 0, total: 0 };
    existing.count += 1;
    existing.total += s.total;
    byMethodMap.set(m, existing);
  }
  const byPaymentMethod = Array.from(byMethodMap.entries()).map(([method, v]) => ({
    method,
    count: v.count,
    total: Number(v.total.toFixed(2)),
  })).sort((a, b) => b.total - a.total);

  // 4. Ventas por usuario (vendedor)
  const byUser = await db.sale.groupBy({
    by: ["userId"],
    where,
    _count: { id: true },
    _sum: { total: true },
  });
  const userIds = byUser.map((u) => u.userId);
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const byUserResult = byUser.map((u) => ({
    userId: u.userId,
    userName: users.find((x) => x.id === u.userId)?.name || "Desconocido",
    count: u._count.id,
    total: Number((u._sum.total || 0).toFixed(2)),
  })).sort((a, b) => b.total - a.total);

  return NextResponse.json({
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      totalSales,
      totalAmount: Number((totalAmountAgg._sum.total || 0).toFixed(2)),
      totalDiscount: Number((totalDiscountAgg._sum.discount || 0).toFixed(2)),
      totalSurcharge: Number((totalSurchargeAgg._sum.surcharge || 0).toFixed(2)),
      averageTicket: totalSales > 0
        ? Number(((totalAmountAgg._sum.total || 0) / totalSales).toFixed(2))
        : 0,
    },
    series,
    byPaymentMethod,
    byUser: byUserResult,
  });
}
