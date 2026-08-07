import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { increaseStock } from "@/lib/stock";

// GET: lista de órdenes de compra (con filtros)
// Query params:
//   status   - PENDIENTE | RECIBIDA | ANULADA (opcional)
//   supplier - filtrar por supplierId (opcional)
//   from     - fecha orderedAt desde (ISO date, opcional)
//   to       - fecha orderedAt hasta (ISO date, opcional)
//   limit    - cantidad máxima (default 50)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const supplier = url.searchParams.get("supplierId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Number(url.searchParams.get("limit") || 50);

  const where: any = { storeId };
  if (status) where.status = status;
  if (supplier) where.supplierId = supplier;
  if (from || to) {
    where.orderedAt = {};
    if (from) where.orderedAt.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.orderedAt.lte = toDate;
    }
  }

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

// PUT: actualizar orden de compra existente
// body: { id, supplierId?, supplierName?, notes?, items?: [{productId, quantity, unitCost}] }
//
// Reglas de negocio robustas:
//   - Solo órdenes PENDIENTE pueden editarse items/costos/cantidades.
//   - Si la orden está RECIBIDA o ANULADA, solo se permite editar `notes`.
//   - Si la orden está ANULADA, no se permite editar nada.
//   - Al editar items de una orden PENDIENTE, se reemplazan todos los items
//     (borra los anteriores y crea los nuevos en una tx).
//   - El total se recalcula automáticamente.
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const storeId = u.storeId;

  const body = await req.json();
  const { id, supplierId, supplierName, notes, items } = body;

  if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });

  const existing = await db.purchaseOrder.findFirst({
    where: { id, storeId },
    include: { items: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  // Órdenes ANULADA no se pueden editar
  if (existing.status === "ANULADA") {
    return NextResponse.json(
      { error: "No se puede editar una orden anulada" },
      { status: 400 }
    );
  }

  // Órdenes RECIBIDA solo pueden editar notas (los items ya entraron a stock)
  const canEditItems = existing.status === "PENDIENTE";

  // Si se quiere editar items pero no se puede
  if (items !== undefined && !canEditItems) {
    return NextResponse.json(
      { error: "No se pueden modificar los items de una orden ya recibida. Solo las notas." },
      { status: 400 }
    );
  }

  const updated = await db.$transaction(async (tx) => {
    let newTotal = existing.total;
    let itemsData: any[] | undefined;

    if (items !== undefined && canEditItems) {
      // Validar y calcular nuevos items
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("La orden debe tener al menos 1 ítem");
      }
      itemsData = [];
      newTotal = 0;
      for (const it of items) {
        const qty = Number(it.quantity);
        const unitCost = Number(it.unitCost);
        if (qty <= 0 || unitCost < 0) {
          throw new Error("Cantidad o costo inválido");
        }
        const sub = qty * unitCost;
        newTotal += sub;
        itemsData.push({
          productId: it.productId,
          quantity: qty,
          unitCost,
          subtotal: sub,
        });
      }

      // Borrar items anteriores y crear los nuevos
      await tx.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: id },
      });
    }

    const order = await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(supplierId !== undefined && { supplierId: supplierId || null }),
        ...(supplierName !== undefined && { supplierName: supplierName || "Sin proveedor" }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(itemsData ? { total: newTotal } : {}),
      },
      include: {
        items: { include: { product: { select: { name: true, unit: true } } } },
        supplier: { select: { name: true } },
        user: { select: { name: true } },
      },
    });

    // Crear los nuevos items si se reemplazaron
    if (itemsData) {
      await tx.purchaseOrderItem.createMany({
        data: itemsData.map((it) => ({
          purchaseOrderId: id,
          productId: it.productId,
          quantity: it.quantity,
          unitCost: it.unitCost,
          subtotal: it.subtotal,
        })),
      });

      // Refetch para devolver items actualizados
      const refetched = await tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          items: { include: { product: { select: { name: true, unit: true } } } },
          supplier: { select: { name: true } },
          user: { select: { name: true } },
        },
      });
      return refetched || order;
    }

    return order;
  });

  return NextResponse.json(updated);
}
