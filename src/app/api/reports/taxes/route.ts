import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// GET /api/reports/taxes?from=&to=
// Reporte fiscal: IVA, facturas emitidas por tipo
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

  // 1. Facturas emitidas en el período
  const invoices = await db.invoice.findMany({
    where: {
      storeId,
      status: "EMITIDA",
      fechaEmision: { gte: start, lte: end },
    },
    select: {
      tipo: true,
      total: true,
      netoGravado: true,
      ivaAmount: true,
      noGravado: true,
      exento: true,
    },
  });

  // 2. Agrupar por tipo
  const byTipoMap = new Map<string, {
    count: number;
    total: number;
    netoGravado: number;
    iva: number;
    noGravado: number;
    exento: number;
  }>();

  for (const inv of invoices) {
    const ex = byTipoMap.get(inv.tipo) || {
      count: 0,
      total: 0,
      netoGravado: 0,
      iva: 0,
      noGravado: 0,
      exento: 0,
    };
    ex.count += 1;
    ex.total += inv.total;
    ex.netoGravado += inv.netoGravado;
    ex.iva += inv.ivaAmount;
    ex.noGravado += inv.noGravado;
    ex.exento += inv.exento;
    byTipoMap.set(inv.tipo, ex);
  }

  const byTipo = Array.from(byTipoMap.entries()).map(([tipo, v]) => ({
    tipo,
    ...v,
    total: Number(v.total.toFixed(2)),
    netoGravado: Number(v.netoGravado.toFixed(2)),
    iva: Number(v.iva.toFixed(2)),
    noGravado: Number(v.noGravado.toFixed(2)),
    exento: Number(v.exento.toFixed(2)),
  }));

  // 3. Totales generales
  const totalFacturado = invoices.reduce((s, i) => s + i.total, 0);
  const totalNeto = invoices.reduce((s, i) => s + i.netoGravado, 0);
  const totalIva = invoices.reduce((s, i) => s + i.ivaAmount, 0);
  const totalNoGravado = invoices.reduce((s, i) => s + i.noGravado, 0);
  const totalExento = invoices.reduce((s, i) => s + i.exento, 0);

  // 4. Ventas sin facturar
  const ventasSinFactura = await db.sale.count({
    where: {
      storeId,
      status: "COMPLETADA",
      createdAt: { gte: start, lte: end },
      invoice: null,
    },
  });

  const montoSinFacturar = await db.sale.aggregate({
    where: {
      storeId,
      status: "COMPLETADA",
      createdAt: { gte: start, lte: end },
      invoice: null,
    },
    _sum: { total: true },
  });

  return NextResponse.json({
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      cantidadFacturas: invoices.length,
      totalFacturado: Number(totalFacturado.toFixed(2)),
      totalNetoGravado: Number(totalNeto.toFixed(2)),
      totalIva: Number(totalIva.toFixed(2)),
      totalNoGravado: Number(totalNoGravado.toFixed(2)),
      totalExento: Number(totalExento.toFixed(2)),
      ventasSinFactura,
      montoSinFacturar: Number((montoSinFacturar._sum.total || 0).toFixed(2)),
    },
    byTipo,
  });
}
