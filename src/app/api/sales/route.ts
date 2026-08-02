import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// GET: lista de ventas (con filtros)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status");
  const limit = Number(url.searchParams.get("limit") || 100);

  const where: Prisma.SaleWhereInput = { storeId };
  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const sales = await db.sale.findMany({
    where,
    include: {
      items: { include: { product: true } },
      user: { select: { name: true } },
      customer: { select: { name: true } },
      paymentMethodRef: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(sales);
}

// POST: registrar nueva venta
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  // body: { items: [{productId, quantity}], customerId?, discount?, paymentMethodId, notes?, taxRate? }

  // Validar stock y obtener precios actuales
  const productIds = body.items.map((i: any) => i.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds }, storeId, active: true },
  });

  // Obtener método de pago seleccionado
  const paymentMethodId = body.paymentMethodId;
  const method = paymentMethodId
    ? await db.paymentMethod.findFirst({ where: { id: paymentMethodId, storeId } })
    : null;

  const items: any[] = [];
  let subtotal = 0;
  for (const item of body.items) {
    const prod = products.find((p) => p.id === item.productId);
    if (!prod) {
      return NextResponse.json({ error: `Producto no encontrado: ${item.productId}` }, { status: 400 });
    }
    const qty = Number(item.quantity);
    if (qty <= 0) {
      return NextResponse.json({ error: `Cantidad inválida para ${prod.name}` }, { status: 400 });
    }
    const lineSub = prod.salePrice * qty;
    items.push({
      productId: prod.id,
      quantity: qty,
      unitPrice: prod.salePrice,
      costPrice: prod.costPrice,
      subtotal: lineSub,
    });
    subtotal += lineSub;
  }

  const discount = Number(body.discount) || 0;
  const taxable = subtotal - discount;
  const taxRate = Number(body.taxRate) || 0;
  const tax = taxable * (taxRate / 100);
  // Recargo del método de pago (se aplica sobre (subtotal - descuento + impuesto))
  const surchargeRate = method?.surcharge || 0;
  const baseForSurcharge = taxable + tax;
  const surcharge = baseForSurcharge * (surchargeRate / 100);
  const total = baseForSurcharge + surcharge;

  // Detectar si es venta en cuenta corriente
  const isCredit = method?.type === "CUENTA";
  const amountPaid = isCredit ? 0 : total;
  const onCredit = isCredit;

  // Buscar caja abierta para asociar venta y movimientos de efectivo
  const openRegister = await db.cashRegister.findFirst({
    where: { storeId, status: "ABIERTA" },
  });

  // Crear venta en transacción
  const sale = await db.$transaction(async (tx) => {
    const newSale = await tx.sale.create({
      data: {
        storeId,
        userId: u.id,
        customerId: body.customerId || null,
        cashRegisterId: openRegister?.id || null,
        subtotal,
        discount,
        tax,
        surcharge,
        total,
        paymentMethod: method?.name || "EFECTIVO",
        paymentMethodId: method?.id || null,
        onCredit,
        amountPaid,
        status: "COMPLETADA",
        notes: body.notes || null,
        items: { create: items },
      },
      include: { items: true },
    });

    // Descontar stock y registrar movimientos
    for (const item of items) {
      const updated = await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
      if (updated.stock < 0) {
        throw new Error(`Stock insuficiente para ${updated.name}`);
      }
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          storeId,
          userId: u.id,
          type: "VENTA",
          quantity: -item.quantity,
          reason: `Venta ${newSale.id.slice(-6)}`,
          refType: "Sale",
          refId: newSale.id,
        },
      });
    }

    // Si es venta en efectivo y hay caja abierta, registrar movimiento de caja
    if (openRegister && !isCredit && method?.type === "EFECTIVO") {
      await tx.cashMovement.create({
        data: {
          cashRegisterId: openRegister.id,
          storeId,
          userId: u.id,
          type: "VENTA",
          amount: total,
          concept: `Venta ${newSale.id.slice(-6)}`,
          paymentMethod: "EFECTIVO",
          refType: "Sale",
          refId: newSale.id,
        },
      });
    }

    return newSale;
  });

  return NextResponse.json(sale);
}
