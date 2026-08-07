import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { decreaseStock } from "@/lib/stock";

// POST: anular una orden de compra
// body: { id, reason? }
//
// Reglas de negocio robustas:
//   - Solo se pueden anular órdenes en estado PENDIENTE o RECIBIDA.
//   - Si la orden está PENDIENTE: simplemente cambia estado a ANULADA. No hay
//     stock que revertir porque la mercadería nunca entró.
//   - Si la orden está RECIBIDA: cambia estado a ANULADA y DESCUENTA el stock
//     que se había agregado al recibirla (un movimiento de SALIDA por item,
//     con refType=PurchaseOrder y refId=id para trazabilidad).
//     Si el stock de algún producto resulta negativo (porque ya se vendió),
//     se permite con allowNegative=true para no bloquear la anulación, pero se
//     registra igual para que el usuario vea la inconsistencia en el maestro.
//   - Si la orden ya está ANULADA: retorna error 400.
//   - Solo ADMIN puede anular.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const storeId = u.storeId;

  const body = await req.json();
  const { id, reason } = body;
  if (!id) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const order = await db.purchaseOrder.findFirst({
    where: { id, storeId },
    include: { items: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  if (order.status === "ANULADA") {
    return NextResponse.json(
      { error: "La orden ya está anulada" },
      { status: 400 }
    );
  }

  const annulNote = reason
    ? `[ANULADA: ${reason}]`
    : "[ANULADA]";

  const updated = await db.$transaction(async (tx) => {
    // Si la orden fue RECIBIDA, revertir el stock ingresado.
    // Cada item genera un StockMovement de SALIDA con la misma cantidad.
    // El stock puede quedar negativo si la mercadería ya se vendió; lo permitimos
    // (allowNegative=true) para que el usuario vea la inconsistencia en el maestro
    // y pueda hacer un ajuste manual.
    if (order.status === "RECIBIDA") {
      for (const it of order.items) {
        await decreaseStock(
          tx,
          {
            productId: it.productId,
            storeId,
            userId: u.id,
            quantity: it.quantity,
            reason: `Anulación orden ${order.orderNumber}`,
            refType: "PurchaseOrder",
            refId: order.id,
            allowNegative: true, // no bloquear si ya se vendió
          },
          "SALIDA"
        );
      }
    }

    // Actualizar notas y estado
    const newNotes = order.notes
      ? `${order.notes}\n---\n${annulNote}`
      : annulNote;

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "ANULADA",
        notes: newNotes,
      },
      include: {
        items: { include: { product: { select: { name: true, unit: true } } } },
        supplier: { select: { name: true } },
        user: { select: { name: true } },
      },
    });
  });

  // Si se revirtió stock y algún producto quedó negativo, avisar al usuario.
  let warning: string | undefined;
  if (order.status === "RECIBIDA") {
    // Verificar productos con stock negativo
    const productIds = order.items.map((it) => it.productId);
    const negProducts = await db.product.findMany({
      where: { id: { in: productIds }, stock: { lt: 0 } },
      select: { name: true, stock: true },
    });
    if (negProducts.length > 0) {
      warning = `Se anuló la orden y se revirtió el stock. ${negProducts.length} producto(s) quedaron con stock negativo porque ya se vendió la mercadería: ${negProducts
        .map((p) => `${p.name} (${p.stock.toFixed(2)})`)
        .join(", ")}. Hacé un ajuste manual en Inventario si corresponde.`;
    }
  }

  return NextResponse.json({ ...updated, _warning: warning });
}
