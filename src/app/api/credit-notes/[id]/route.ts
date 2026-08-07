import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/credit-notes/[id]
 *
 * Detalle de una nota de crédito específica.
 * Incluye la factura original vinculada, el refund que la originó (si aplica),
 * la venta asociada, el cliente y el usuario que la emitió.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const storeId = (session.user as any).storeId;
  const { id } = await params;

  const creditNote = await db.invoice.findFirst({
    where: { id, storeId, comprobanteSubtipo: "NOTA_CREDITO" },
    include: {
      relatedInvoice: {
        select: {
          id: true,
          numeroCompleto: true,
          tipo: true,
          cae: true,
          caeVencimiento: true,
          fechaEmision: true,
          total: true,
          netoGravado: true,
          ivaAmount: true,
          customerName: true,
          customerCuit: true,
        },
      },
      refund: {
        select: {
          id: true,
          refundNumber: true,
          type: true,
          reason: true,
          notes: true,
          total: true,
          createdAt: true,
          items: { include: { product: { select: { name: true } } } },
        },
      },
      sale: {
        select: {
          id: true,
          total: true,
          status: true,
          createdAt: true,
          paymentMethod: true,
        },
      },
      customer: { select: { id: true, name: true, cuit: true, taxType: true } },
      user: { select: { name: true } },
      taxConfig: {
        select: {
          cuit: true,
          razonSocial: true,
          puntoVenta: true,
          condicionFiscal: true,
          direccionFiscal: true,
        },
      },
    },
  });

  if (!creditNote) {
    return NextResponse.json(
      { error: "Nota de crédito no encontrada" },
      { status: 404 }
    );
  }

  return NextResponse.json(creditNote);
}
