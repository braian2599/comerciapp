import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Anular venta
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role === "CAJERO") {
    return NextResponse.json({ error: "Sin permisos para anular" }, { status: 403 });
  }
  const body = await req.json();
  const storeId = u.storeId;

  const sale = await db.sale.findFirst({
    where: { id: body.id, storeId },
    include: { items: true },
  });
  if (!sale) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  if (sale.status === "ANULADA") {
    return NextResponse.json({ error: "La venta ya está anulada" }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    await tx.sale.update({
      where: { id: sale.id },
      data: { status: "ANULADA" },
    });
    // Reintegrar stock
    for (const item of sale.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          storeId,
          userId: u.id,
          type: "ENTRADA",
          quantity: item.quantity,
          reason: `Anulación venta ${sale.id.slice(-6)}`,
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
