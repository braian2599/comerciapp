import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { emitirFactura, calcularIva, determinarTipoFactura } from "@/lib/afip";

// GET: lista de facturas (con filtros)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const tipo = url.searchParams.get("tipo");
  const status = url.searchParams.get("status");
  const limit = Number(url.searchParams.get("limit") || 100);

  const where: Prisma.InvoiceWhereInput = { storeId };
  if (tipo) where.tipo = tipo;
  if (status) where.status = status;
  if (from || to) {
    where.fechaEmision = {};
    if (from) where.fechaEmision.gte = new Date(from);
    if (to) where.fechaEmision.lte = new Date(to);
  }

  const invoices = await db.invoice.findMany({
    where,
    include: {
      sale: { select: { id: true, total: true, status: true } },
      customer: { select: { id: true, name: true } },
      user: { select: { name: true } },
    },
    orderBy: { fechaEmision: "desc" },
    take: limit,
  });

  return NextResponse.json(invoices);
}

// POST: emitir nueva factura
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;
  const userId = u.id;

  const body = await req.json();
  // body: { saleId?, customerId?, tipo?, concepto? }

  let saleData: any = null;
  let customerData: any = null;

  // Si viene de una venta, obtener datos
  if (body.saleId) {
    saleData = await db.sale.findFirst({
      where: { id: body.saleId, storeId },
      include: {
        items: { include: { product: true } },
        customer: true,
      },
    });
    if (!saleData) {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    }
    // Opción B: si la venta ya tiene una factura EMITIDA, no se puede
    // refacturar (una venta = una factura). Pero si la factura previa está
    // RECHAZADA o PENDIENTE (AFIP caído, error de TA, CUIT inválido, etc.),
    // permitimos retry: borramos la invoice fallida para que emitirFactura
    // pueda crear una nueva. Esto preserva la constraint unique saleId.
    if (saleData.invoice) {
      const prevStatus = saleData.invoice.status;
      if (prevStatus === "EMITIDA") {
        return NextResponse.json(
          { error: "La venta ya tiene factura asociada (EMITIDA)" },
          { status: 400 }
        );
      }
      if (prevStatus === "ANULADA") {
        return NextResponse.json(
          { error: "La factura anterior fue anulada. No se puede refacturar la venta." },
          { status: 400 }
        );
      }
      // RECHAZADA o PENDIENTE → borrar para permitir retry
      await db.invoice.delete({ where: { id: saleData.invoice.id } });
      saleData.invoice = null; // para que emitirFactura no la considere
    }
    if (saleData.status === "ANULADA") {
      return NextResponse.json({ error: "No se puede facturar una venta anulada" }, { status: 400 });
    }
  }

  if (body.customerId || saleData?.customerId) {
    const cid = body.customerId || saleData?.customerId;
    customerData = await db.customer.findFirst({ where: { id: cid, storeId } });
  }

  // Determinar configuración fiscal
  const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
  if (!taxConfig || !taxConfig.active) {
    return NextResponse.json({
      error: "No hay configuración fiscal activa. Configure AFIP en Configuración.",
    }, { status: 400 });
  }

  // Determinar tipo de factura
  let tipo = body.tipo || taxConfig.tipoFactura;
  if (customerData && taxConfig.condicionFiscal === "RESPONSABLE_INSCRIPTO") {
    tipo = determinarTipoFactura(
      taxConfig.condicionFiscal,
      customerData.taxType || "CONSUMIDOR_FINAL"
    );
  }

  // Calcular montos
  const total = saleData ? saleData.total : Number(body.total || 0);
  const ivaRate = taxConfig.ivaRate;
  const { netoGravado, ivaAmount } = calcularIva(total, ivaRate, tipo);

  // Datos del cliente
  const clienteNombre = customerData?.name || "Consumidor Final";
  const clienteCuit = customerData?.cuit || null;
  const clienteCondicionIva = customerData?.taxType || "CONSUMIDOR_FINAL";

  // Para factura A, validar CUIT
  if (tipo === "A" && (!clienteCuit || clienteCuit.length < 11)) {
    return NextResponse.json({
      error: "Para factura A se requiere cliente con CUIT válido",
    }, { status: 400 });
  }

  // Emitir factura
  const resultado = await emitirFactura(storeId, userId, {
    tipo,
    concepto: body.concepto || "PRODUCTOS",
    fecha: new Date(),
    clienteNombre,
    clienteCuit,
    clienteCondicionIva,
    netoGravado,
    ivaRate,
    ivaAmount,
    total,
    saleId: body.saleId,
    customerId: customerData?.id,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json(resultado);
}
