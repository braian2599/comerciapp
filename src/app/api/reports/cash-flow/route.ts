import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// GET /api/reports/cash-flow?from=&to=
// Flujo de caja: ingresos por ventas + pagos de cuentas - gastos - egresos de caja
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

  // 1. Ventas en efectivo del período (ingresos de caja)
  const sales = await db.sale.findMany({
    where: {
      storeId,
      status: "COMPLETADA",
      createdAt: { gte: start, lte: end },
    },
    select: { createdAt: true, total: true, paymentMethod: true, onCredit: true, amountPaid: true },
  });

  // Incluimos solo ventas no fiadas completas como ingreso de caja
  // (las fiadas se cuentan cuando se cobran)
  let ventasEfectivo = 0;
  let ventasOtroMedio = 0;
  let ventasFiadas = 0;
  let cobrosCuenta = 0;

  for (const s of sales) {
    if (s.onCredit) {
      ventasFiadas += s.total - s.amountPaid;
      if (s.amountPaid > 0) {
        // Pago parcial al momento de la venta
        if (s.paymentMethod === "EFECTIVO") ventasEfectivo += s.amountPaid;
        else ventasOtroMedio += s.amountPaid;
      }
    } else {
      if (s.paymentMethod === "EFECTIVO") ventasEfectivo += s.total;
      else ventasOtroMedio += s.total;
    }
  }

  // 2. Pagos de cuentas corrientes
  const customerPayments = await db.customerPayment.findMany({
    where: {
      storeId,
      date: { gte: start, lte: end },
    },
    select: { amount: true, paymentMethod: true, date: true },
  });

  for (const p of customerPayments) {
    if (p.paymentMethod === "EFECTIVO") cobrosCuenta += p.amount;
  }

  // 3. Gastos
  const expenses = await db.expense.findMany({
    where: {
      storeId,
      date: { gte: start, lte: end },
    },
    select: { amount: true, paymentMethod: true, date: true, category: true, description: true },
  });

  let gastosEfectivo = 0;
  let gastosOtroMedio = 0;
  for (const e of expenses) {
    if (e.paymentMethod === "EFECTIVO") gastosEfectivo += e.amount;
    else gastosOtroMedio += e.amount;
  }

  // 4. Movimientos de caja manuales (ingresos/egresos)
  const cashMovements = await db.cashMovement.findMany({
    where: {
      storeId,
      createdAt: { gte: start, lte: end },
      type: { in: ["INGRESO", "EGRESO"] },
    },
    select: { amount: true, type: true, concept: true, createdAt: true },
  });

  let ingresosManuales = 0;
  let egresosManuales = 0;
  for (const m of cashMovements) {
    if (m.type === "INGRESO") ingresosManuales += m.amount;
    else egresosManuales += m.amount;
  }

  // 5. Total
  const totalIngresosEfectivo = ventasEfectivo + cobrosCuenta + ingresosManuales;
  const totalEgresosEfectivo = gastosEfectivo + egresosManuales;
  const flujoNetoEfectivo = totalIngresosEfectivo - totalEgresosEfectivo;

  // 6. Serie diaria
  const dailyMap = new Map<string, {
    ventasEfectivo: number;
    cobrosCuenta: number;
    ingresosManuales: number;
    gastosEfectivo: number;
    egresosManuales: number;
  }>();

  function addToDay(date: Date, key: string, field: string, amount: number) {
    const d = date instanceof Date ? date : new Date(date);
    const k = d.toISOString().slice(0, 10);
    const ex = dailyMap.get(k) || {
      ventasEfectivo: 0,
      cobrosCuenta: 0,
      ingresosManuales: 0,
      gastosEfectivo: 0,
      egresosManuales: 0,
    };
    (ex as any)[field] += amount;
    dailyMap.set(k, ex);
  }

  for (const s of sales) {
    if (!s.onCredit && s.paymentMethod === "EFECTIVO") {
      addToDay(s.createdAt, "ef", "ventasEfectivo", s.total);
    } else if (s.onCredit && s.amountPaid > 0 && s.paymentMethod === "EFECTIVO") {
      addToDay(s.createdAt, "ef", "ventasEfectivo", s.amountPaid);
    }
  }
  for (const p of customerPayments) {
    if (p.paymentMethod === "EFECTIVO") addToDay(p.date, "co", "cobrosCuenta", p.amount);
  }
  for (const e of expenses) {
    if (e.paymentMethod === "EFECTIVO") addToDay(e.date, "ga", "gastosEfectivo", e.amount);
  }
  for (const m of cashMovements) {
    if (m.type === "INGRESO") addToDay(m.createdAt, "im", "ingresosManuales", m.amount);
    else if (m.type === "EGRESO") addToDay(m.createdAt, "em", "egresosManuales", m.amount);
  }

  const series = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      ...v,
      totalIngresos: Number((v.ventasEfectivo + v.cobrosCuenta + v.ingresosManuales).toFixed(2)),
      totalEgresos: Number((v.gastosEfectivo + v.egresosManuales).toFixed(2)),
      flujoNeto: Number((v.ventasEfectivo + v.cobrosCuenta + v.ingresosManuales - v.gastosEfectivo - v.egresosManuales).toFixed(2)),
    }));

  return NextResponse.json({
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      ventasEfectivo: Number(ventasEfectivo.toFixed(2)),
      ventasOtroMedio: Number(ventasOtroMedio.toFixed(2)),
      ventasFiadas: Number(ventasFiadas.toFixed(2)),
      cobrosCuenta: Number(cobrosCuenta.toFixed(2)),
      ingresosManuales: Number(ingresosManuales.toFixed(2)),
      gastosEfectivo: Number(gastosEfectivo.toFixed(2)),
      gastosOtroMedio: Number(gastosOtroMedio.toFixed(2)),
      egresosManuales: Number(egresosManuales.toFixed(2)),
      totalIngresosEfectivo: Number(totalIngresosEfectivo.toFixed(2)),
      totalEgresosEfectivo: Number(totalEgresosEfectivo.toFixed(2)),
      flujoNetoEfectivo: Number(flujoNetoEfectivo.toFixed(2)),
    },
    series,
  });
}
