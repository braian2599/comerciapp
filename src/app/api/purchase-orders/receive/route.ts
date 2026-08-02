import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// POST: recibir una orden de compra pendiente → actualiza stock
// body: { id }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const order = await db.purchaseOrder.findFirst({
    where: { id, storeId, status: "PENDIENTE" },
    include: { items: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada o ya recibida" }, { status: 404 });
  }

  const updated = await db.$transaction(async (tx) => {
    for (const it of order.items) {
      await tx.product.update({
        where: { id: it.productId },
        data: {
          stock: { increment: it.quantity },
          costPrice: it.unitCost, // actualizamos al último costo
        },
      });
      await tx.stockMovement.create({
        data: {
          productId: it.productId,
          storeId,
          userId: u.id,
          type: "COMPRA",
          quantity: it.quantity,
          reason: `Orden ${order.orderNumber} recibida`,
          refType: "PurchaseOrder",
          refId: order.id,
        },
      });
    }
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "RECIBIDA",
        receivedAt: new Date(),
      },
      include: {
        items: { include: { product: { select: { name: true, unit: true } } } },
        supplier: { select: { name: true } },
        user: { select: { name: true } },
      },
    });
  });

  return NextResponse.json(updated);
}
