import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { increaseStock } from "@/lib/stock";

// GET: lista de órdenes de compra (con filtros)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Number(url.searchParams.get("limit") || 50);

  const where: any = { storeId };
  if (status) where.status = status;

  const orders = await db.purchaseOrder.findMany({
    where,
    include: {
      supplier: { select: { name: true } },
      user: { select: { name: true } },
      items: { include: { product: { select: { name: true, unit: true } } } },
    },
    orderBy: { orderedAt: "desc" },
    take: limit,
  });
  return NextResponse.json(orders);
}

// POST: crear nueva orden de compra
// body: { supplierId?, supplierName?, items: [{productId, quantity, unitCost}], notes? }
// Si receive=true, la orden se marca como RECIBIDA y se actualiza el stock
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { supplierId, supplierName, items, notes, receive } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "La orden debe tener al menos 1 ítem" }, { status: 400 });
  }

  // Calcular total
  const itemsData: any[] = [];
  let total = 0;
  for (const it of items) {
    const qty = Number(it.quantity);
    const unitCost = Number(it.unitCost);
    if (qty <= 0 || unitCost < 0) {
      return NextResponse.json({ error: "Cantidad o costo inválido" }, { status: 400 });
    }
    const sub = qty * unitCost;
    total += sub;
    itemsData.push({
      productId: it.productId,
      quantity: qty,
      unitCost,
      subtotal: sub,
    });
  }

  // Generar número de orden legible: OC-0001
  const lastOrder = await db.purchaseOrder.findFirst({
    where: { storeId },
    orderBy: { orderedAt: "desc" },
    select: { orderNumber: true },
  });
  let nextNum = 1;
  if (lastOrder?.orderNumber) {
    const m = lastOrder.orderNumber.match(/OC-(\d+)/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  const orderNumber = `OC-${String(nextNum).padStart(4, "0")}`;

  const status = receive ? "RECIBIDA" : "PENDIENTE";

  const order = await db.$transaction(async (tx) => {
    const newOrder = await tx.purchaseOrder.create({
      data: {
        storeId,
        userId: u.id,
        supplierId: supplierId || null,
        supplierName: supplierName || "Sin proveedor",
        orderNumber,
        status,
        total,
        notes: notes || null,
        receivedAt: receive ? new Date() : null,
        items: { create: itemsData },
      },
      include: {
        items: { include: { product: true } },
      },
    });

    // Si se recibe, actualizar stock y costo usando lib/stock
    if (receive) {
      for (const it of newOrder.items) {
        // increaseStock con newCostPrice actualiza ambos campos en un solo update
        // y registra el StockMovement type=COMPRA de forma consistente.
        await increaseStock(tx, {
          productId: it.productId,
          storeId,
          userId: u.id,
          quantity: it.quantity,
          reason: `Orden ${orderNumber}`,
          refType: "PurchaseOrder",
          refId: newOrder.id,
          newCostPrice: it.unitCost,
        }, "COMPRA");
      }
    }

    return newOrder;
  });

  return NextResponse.json(order);
}
