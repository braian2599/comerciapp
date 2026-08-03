import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") || 7);

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);

  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days);

  // Ventas del período (solo completadas)
  const sales = await db.sale.findMany({
    where: {
      storeId,
      status: "COMPLETADA",
      createdAt: { gte: start },
    },
    include: { items: { include: { product: true } } },
  });

  const prevSales = await db.sale.findMany({
    where: {
      storeId,
      status: "COMPLETADA",
      createdAt: { gte: prevStart, lt: start },
    },
  });

  const totalVentas = sales.reduce((s, v) => s + v.total, 0);
  const prevTotalVentas = prevSales.reduce((s, v) => s + v.total, 0);
  const numVentas = sales.length;
  const ticketPromedio = numVentas > 0 ? totalVentas / numVentas : 0;
  const prevTicketPromedio = prevSales.length > 0 ? prevTotalVentas / prevSales.length : 0;

  // Ganancia estimada
  const ganancia = sales.reduce(
    (s, v) => s + v.items.reduce((ss, it) => ss + (it.unitPrice - it.costPrice) * it.quantity, 0) - v.discount,
    0
  );

  // Variación porcentual
  const variacion = prevTotalVentas > 0
    ? ((totalVentas - prevTotalVentas) / prevTotalVentas) * 100
    : 100;
  const variacionTicket = prevTicketPromedio > 0
    ? ((ticketPromedio - prevTicketPromedio) / prevTicketPromedio) * 100
    : 0;

  // Ventas por día
  const ventasPorDia: { date: string; total: number; count: number }[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - d);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const daySales = sales.filter(
      (s) => s.createdAt >= dayStart && s.createdAt < dayEnd
    );
    ventasPorDia.push({
      date: dayStart.toISOString().slice(0, 10),
      total: daySales.reduce((s, v) => s + v.total, 0),
      count: daySales.length,
    });
  }

  // Top productos por cantidad
  const productAgg: Record<string, { name: string; qty: number; total: number }> = {};
  for (const s of sales) {
    for (const it of s.items) {
      const key = it.productId;
      if (!productAgg[key]) {
        productAgg[key] = { name: it.product?.name || "(eliminado)", qty: 0, total: 0 };
      }
      productAgg[key].qty += it.quantity;
      productAgg[key].total += it.subtotal;
    }
  }
  const topProductos = Object.values(productAgg)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // Productos con stock bajo
  const productosBajoStock = await db.product.findMany({
    where: {
      storeId,
      active: true,
      stock: { lte: db.product.fields.minStock },
    },
    include: { category: true },
    orderBy: { stock: "asc" },
    take: 10,
  });

  // Ventas por método de pago
  const ventasPorMetodo: Record<string, number> = {};
  for (const s of sales) {
    ventasPorMetodo[s.paymentMethod] = (ventasPorMetodo[s.paymentMethod] || 0) + s.total;
  }

  // Gastos del período
  const expenses = await db.expense.findMany({
    where: { storeId, date: { gte: start } },
  });
  const totalGastos = expenses.reduce((s, e) => s + e.amount, 0);
  const gastosPorCategoria: Record<string, number> = {};
  for (const e of expenses) {
    gastosPorCategoria[e.category] = (gastosPorCategoria[e.category] || 0) + e.amount;
  }

  // Saldo en cuentas corrientes (deuda de clientes)
  const creditSales = await db.sale.findMany({
    where: { storeId, onCredit: true, status: "COMPLETADA" },
    select: { total: true },
  });
  const creditPayments = await db.customerPayment.findMany({
    where: { storeId },
    select: { amount: true },
  });
  const saldoCuentas =
    creditSales.reduce((s, v) => s + v.total, 0) -
    creditPayments.reduce((s, p) => s + p.amount, 0);

  const gananciaNeta = ganancia - totalGastos;

  return NextResponse.json({
    totalVentas,
    numVentas,
    ticketPromedio,
    ganancia,
    gananciaNeta,
    totalGastos,
    gastosPorCategoria,
    saldoCuentas,
    variacion,
    variacionTicket,
    ventasPorDia,
    topProductos,
    productosBajoStock,
    ventasPorMetodo,
  });
}
