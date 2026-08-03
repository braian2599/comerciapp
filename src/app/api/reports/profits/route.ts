import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// GET /api/reports/profits?from=&to=
// Calcula: Ventas - Costo - Gastos = Ganancia Neta
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);

  // 1. Ventas completadas con items
  const sales = await db.sale.findMany({
    where: {
      storeId,
      status: "COMPLETADA",
      createdAt: { gte: start, lte: end },
    },
    include: {
      items: true,
    },
  });

  let totalVentas = 0;
  let totalCosto = 0;
  let totalDescuentos = 0;
  let totalRecargos = 0;
  for (const s of sales) {
    totalVentas += s.total;
    totalDescuentos += s.discount;
    totalRecargos += s.surcharge;
    for (const item of s.items) {
      totalCosto += item.costPrice * item.quantity;
    }
  }

  // 2. Gastos
  const expenses = await db.expense.findMany({
    where: {
      storeId,
      date: { gte: start, lte: end },
    },
    select: { amount: true, category: true, date: true },
  });

  const totalGastos = expenses.reduce((sum, e) => sum + e.amount, 0);
  const gastosPorCategoria = new Map<string, number>();
  for (const e of expenses) {
    gastosPorCategoria.set(e.category, (gastosPorCategoria.get(e.category) || 0) + e.amount);
  }

  // 3. Ganancia
  const gananciaBruta = totalVentas - totalCosto;
  const gananciaNeta = gananciaBruta - totalGastos;
  const margenBruto = totalVentas > 0 ? (gananciaBruta / totalVentas) * 100 : 0;
  const margenNeto = totalVentas > 0 ? (gananciaNeta / totalVentas) * 100 : 0;

  // 4. Series diarias de ganancia
  const grouped = new Map<string, { ventas: number; costo: number; gastos: number }>();
  for (const s of sales) {
    const key = s.createdAt.toISOString().slice(0, 10);
    const ex = grouped.get(key) || { ventas: 0, costo: 0, gastos: 0 };
    ex.ventas += s.total;
    for (const item of s.items) {
      ex.costo += item.costPrice * item.quantity;
    }
    grouped.set(key, ex);
  }
  // Sumar gastos al día correspondiente
  for (const e of expenses) {
    const key = e.date instanceof Date ? e.date.toISOString().slice(0, 10) : new Date(e.date).toISOString().slice(0, 10);
    const ex = grouped.get(key) || { ventas: 0, costo: 0, gastos: 0 };
    ex.gastos += e.amount;
    grouped.set(key, ex);
  }

  const series = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      ventas: Number(v.ventas.toFixed(2)),
      costo: Number(v.costo.toFixed(2)),
      gastos: Number(v.gastos.toFixed(2)),
      gananciaBruta: Number((v.ventas - v.costo).toFixed(2)),
      gananciaNeta: Number((v.ventas - v.costo - v.gastos).toFixed(2)),
    }));

  return NextResponse.json({
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      totalVentas: Number(totalVentas.toFixed(2)),
      totalCosto: Number(totalCosto.toFixed(2)),
      totalDescuentos: Number(totalDescuentos.toFixed(2)),
      totalRecargos: Number(totalRecargos.toFixed(2)),
      totalGastos: Number(totalGastos.toFixed(2)),
      gananciaBruta: Number(gananciaBruta.toFixed(2)),
      gananciaNeta: Number(gananciaNeta.toFixed(2)),
      margenBruto: Number(margenBruto.toFixed(2)),
      margenNeto: Number(margenNeto.toFixed(2)),
      cantidadVentas: sales.length,
      cantidadGastos: expenses.length,
    },
    expensesByCategory: Array.from(gastosPorCategoria.entries())
      .map(([category, amount]) => ({ category, amount: Number(amount.toFixed(2)) }))
      .sort((a, b) => b.amount - a.amount),
    series,
  });
}
