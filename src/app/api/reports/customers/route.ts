import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// GET /api/reports/customers?from=&to=&limit=20
// Top clientes y estado de cuentas corrientes
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

  // 1. Top clientes por monto de compras en el período
  const sales = await db.sale.findMany({
    where: {
      storeId,
      status: "COMPLETADA",
      customerId: { not: null },
      createdAt: { gte: start, lte: end },
    },
    select: {
      customerId: true,
      total: true,
      amountPaid: true,
      onCredit: true,
    },
  });

  const map = new Map<string, {
    customerId: string;
    totalCompras: number;
    cantidadVentas: number;
    totalFiado: number;
    totalPagado: number;
  }>();

  for (const s of sales) {
    const cid = s.customerId!;
    const ex = map.get(cid) || {
      customerId: cid,
      totalCompras: 0,
      cantidadVentas: 0,
      totalFiado: 0,
      totalPagado: 0,
    };
    ex.totalCompras += s.total;
    ex.cantidadVentas += 1;
    if (s.onCredit) ex.totalFiado += s.total - s.amountPaid;
    ex.totalPagado += s.amountPaid;
    map.set(cid, ex);
  }

  const customerIds = Array.from(map.keys());
  const customers = await db.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, name: true, phone: true, cuit: true },
  });

  const topClientes = Array.from(map.values())
    .map((c) => ({
      ...c,
      customerName: customers.find((x) => x.id === c.customerId)?.name || "Desconocido",
      phone: customers.find((x) => x.id === c.customerId)?.phone || null,
      totalCompras: Number(c.totalCompras.toFixed(2)),
      totalFiado: Number(c.totalFiado.toFixed(2)),
      totalPagado: Number(c.totalPagado.toFixed(2)),
    }))
    .sort((a, b) => b.totalCompras - a.totalCompras)
    .slice(0, limit);

  // 2. Estado actual de cuentas corrientes (saldo deudor)
  const allCustomerSales = await db.sale.findMany({
    where: {
      storeId,
      status: "COMPLETADA",
      onCredit: true,
      customerId: { not: null },
    },
    select: { customerId: true, total: true, amountPaid: true },
  });

  const allPayments = await db.customerPayment.findMany({
    where: { storeId },
    select: { customerId: true, amount: true },
  });

  const saldoMap = new Map<string, number>();
  for (const s of allCustomerSales) {
    const cid = s.customerId!;
    const saldo = saldoMap.get(cid) || 0;
    saldoMap.set(cid, saldo + (s.total - s.amountPaid));
  }
  for (const p of allPayments) {
    const saldo = saldoMap.get(p.customerId) || 0;
    saldoMap.set(p.customerId, saldo - p.amount);
  }

  const clientesConSaldo = Array.from(saldoMap.entries())
    .filter(([_, saldo]) => saldo > 0.01)
    .map(([cid, saldo]) => ({
      customerId: cid,
      customerName: customers.find((x) => x.id === cid)?.name || null,
      saldo: Number(saldo.toFixed(2)),
    }))
    .sort((a, b) => b.saldo - a.saldo);

  return NextResponse.json({
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      clientesActivos: map.size,
      clientesConSaldoDeudor: clientesConSaldo.length,
      totalSaldoDeudor: Number(clientesConSaldo.reduce((s, c) => s + c.saldo, 0).toFixed(2)),
      totalVentasPeriodo: Number(topClientes.reduce((s, c) => s + c.totalCompras, 0).toFixed(2)),
    },
    topClientes,
    clientesConSaldo,
  });
}
