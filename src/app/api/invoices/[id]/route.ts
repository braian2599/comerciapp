import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { anularFactura } from "@/lib/afip";

// GET: detalle de una factura
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const { id } = await params;

  const invoice = await db.invoice.findFirst({
    where: { id, storeId },
    include: {
      sale: {
        include: {
          items: { include: { product: true } },
          customer: true,
        },
      },
      customer: true,
      user: { select: { name: true } },
      taxConfig: true,
    },
  });

  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  return NextResponse.json(invoice);
}

// DELETE: anular factura
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;
  const userId = u.id;
  const { id } = await params;

  // Verificar propiedad
  const invoice = await db.invoice.findFirst({ where: { id, storeId } });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  const resultado = await anularFactura(id, userId);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  // Desvincular de la venta si estaba asociada
  if (invoice.saleId) {
    await db.sale.update({
      where: { id: invoice.saleId },
      data: { invoice: { disconnect: true } },
    });
  }

  return NextResponse.json({ ok: true });
}
