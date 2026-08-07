import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { emitirNotaDeCredito } from "@/lib/afip";

/**
 * GET /api/credit-notes
 *
 * Lista notas de crédito emitidas (Invoices con comprobanteSubtipo='NOTA_CREDITO').
 *
 * Query params:
 *   - from:        fecha desde (ISO) — filtra por fechaEmision
 *   - to:          fecha hasta (ISO)
 *   - customerId:  filtra por cliente
 *   - status:      EMITIDA | ANULADA | RECHAZADA | PENDIENTE
 *   - tipo:        A | B | C | M | E
 *   - limit:       default 100
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const customerId = url.searchParams.get("customerId");
  const status = url.searchParams.get("status");
  const tipo = url.searchParams.get("tipo");
  const limit = Number(url.searchParams.get("limit") || 100);

  const where: Prisma.InvoiceWhereInput = {
    storeId,
    comprobanteSubtipo: "NOTA_CREDITO",
  };
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (tipo) where.tipo = tipo;
  if (from || to) {
    where.fechaEmision = {};
    if (from) where.fechaEmision.gte = new Date(from);
    if (to) where.fechaEmision.lte = new Date(to);
  }

  const creditNotes = await db.invoice.findMany({
    where,
    include: {
      // Factura original vinculada (NC → Factura)
      relatedInvoice: {
        select: {
          id: true,
          numeroCompleto: true,
          tipo: true,
          cae: true,
          fechaEmision: true,
          total: true,
        },
      },
      // Refund que originó esta NC (back-link 1:1)
      refund: {
        select: {
          id: true,
          refundNumber: true,
          type: true,
          reason: true,
        },
      },
      sale: { select: { id: true, total: true, status: true } },
      customer: { select: { id: true, name: true } },
      user: { select: { name: true } },
    },
    orderBy: { fechaEmision: "desc" },
    take: limit,
  });

  return NextResponse.json(creditNotes);
}

/**
 * POST /api/credit-notes
 *
 * Emite una nota de crédito electrónica vinculada a una factura existente.
 *
 * Body:
 *   {
 *     originalInvoiceId: string,  // Invoice.id de la factura a la que se vincula
 *     total: number,              // monto total de la NC (positivo)
 *     motivo?: string,            // se guarda en observation
 *     refundId?: string,          // opcional: refund que originó esta NC
 *   }
 *
 * El tipo, concepto, cliente e IVA se heredan de la factura original.
 *
 * Respuesta:
 *   200 OK → { ...ResultadoNotaCredito }
 *   400    → error de validación
 *   401    → no auth
 *   404    → factura original no encontrada
 *
 * Casos de uso:
 *   1. Reintento: un refund se procesó pero la NC falló → el usuario puede
 *      reemitir la NC desde este endpoint pasando refundId.
 *   2. NC manual: una NC no vinculada a un refund (ej: ajuste por error
 *      de facturación) → pasar solo originalInvoiceId + total + motivo.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const u = session.user as any;
  const storeId = u.storeId;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { originalInvoiceId, total, motivo, refundId } = body;

  if (!originalInvoiceId) {
    return NextResponse.json(
      { error: "Falta originalInvoiceId (factura a vincular)" },
      { status: 400 }
    );
  }
  if (!total || Number(total) <= 0) {
    return NextResponse.json(
      { error: "total debe ser un número positivo" },
      { status: 400 }
    );
  }

  // Cargar factura original para heredar tipo, concepto, cliente, IVA
  const originalInvoice = await db.invoice.findFirst({
    where: { id: originalInvoiceId, storeId },
  });
  if (!originalInvoice) {
    return NextResponse.json(
      { error: "Factura original no encontrada" },
      { status: 404 }
    );
  }
  if (originalInvoice.comprobanteSubtipo !== "FACTURA") {
    return NextResponse.json(
      {
        error: `El comprobante ${originalInvoice.numeroCompleto} no es una factura (es ${originalInvoice.comprobanteSubtipo}). Solo se puede emitir NC sobre una factura.`,
      },
      { status: 400 }
    );
  }

  // Si vino refundId, validar que pertenezca a la misma venta que la factura
  if (refundId) {
    const refund = await db.refund.findFirst({
      where: { id: refundId, storeId },
    });
    if (!refund) {
      return NextResponse.json(
        { error: "Refund no encontrado" },
        { status: 404 }
      );
    }
    if (refund.creditNoteInvoiceId) {
      return NextResponse.json(
        {
          error: `El refund ${refund.refundNumber} ya tiene una nota de crédito asociada.`,
        },
        { status: 400 }
      );
    }
  }

  // Prorratear IVA sobre el total
  const ivaRate = originalInvoice.ivaRate;
  const netoGravado = Number((total / (1 + ivaRate / 100)).toFixed(2));
  const ivaAmount = Number((total - netoGravado).toFixed(2));

  const resultado = await emitirNotaDeCredito(storeId, u.id, {
    originalInvoiceId,
    tipo: originalInvoice.tipo as any,
    concepto: originalInvoice.concepto as any,
    fecha: new Date(),
    clienteNombre: originalInvoice.customerName,
    clienteCuit: originalInvoice.customerCuit,
    clienteCondicionIva: originalInvoice.customerTaxType,
    netoGravado,
    ivaRate,
    ivaAmount,
    total: Number(Number(total).toFixed(2)),
    customerId: originalInvoice.customerId,
    refundId,
    motivo,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json(resultado);
}
