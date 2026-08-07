import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { calculatePointsEarned, determineTier, pointsToCurrency, calculateMaxRedeemablePoints } from "@/lib/loyalty";
import { assertCreditAvailable } from "@/lib/customer-account";
import { decreaseStock } from "@/lib/stock";

// GET: lista de ventas (con filtros)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status");
  const branchId = url.searchParams.get("branchId");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);

  const where: Prisma.SaleWhereInput = { storeId };
  if (status) where.status = status;
  if (branchId) where.branchId = branchId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  try {
    const sales = await db.sale.findMany({
      where,
      include: {
        items: { include: { product: true } },
        user: { select: { name: true } },
        customer: { select: { name: true } },
        paymentMethodRef: true,
        branch: { select: { id: true, name: true, code: true } },
        promotion: { select: { id: true, name: true } },
        // Incluimos la factura para que refunds-view pueda decidir si ofrecer
        // emitir NC al procesar una devolución (solo se ofrece si la venta
        // tiene factura con CAE).
        invoice: {
          select: {
            id: true,
            numeroCompleto: true,
            tipo: true,
            cae: true,
            status: true,
            comprobanteSubtipo: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json(sales);
  } catch (e: any) {
    console.error("[GET /api/sales] error:", e);
    return NextResponse.json(
      { error: "Error al obtener ventas" },
      { status: 500 }
    );
  }
}

// POST: registrar nueva venta
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de la petición inválido (JSON malformado)" },
      { status: 400 }
    );
  }
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "La venta debe incluir al menos un producto" },
      { status: 400 }
    );
  }
  // body: {
  //   items: [{productId, quantity}],
  //   customerId?, discount?, discountReason?,
  //   paymentMethodId, notes?, taxRate?,
  //   branchId?, promotionId?, loyaltyPointsUsed?
  // }

  try {
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
    if (!Number.isFinite(qty) || qty <= 0) {
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

  // Promoción (validar si fue indicada)
  let promotionId: string | null = null;
  let promotionDiscount = 0;
  if (body.promotionId) {
    const promo = await db.promotion.findFirst({
      where: { id: body.promotionId, storeId, active: true },
    });
    if (promo) {
      promotionId = promo.id;
      // El monto de la promoción viene pre-calculado desde el POS
      promotionDiscount = Number(body.promotionDiscount) || 0;
    }
  }

  // Descuento total = manual + promoción + puntos
  const manualDiscount = Number(body.discount) || 0;
  const totalDiscount = manualDiscount + promotionDiscount;

  // Puntos de fidelización canjeados (descuento extra)
  let loyaltyPointsUsed = 0;
  let loyaltyCurrencyDiscount = 0;
  let program: any = null;
  let customer: any = null;
  if (body.customerId && body.loyaltyPointsUsed && body.loyaltyPointsUsed > 0) {
    program = await db.loyaltyProgram.findUnique({ where: { storeId } });
    if (program && program.enabled) {
      customer = await db.customer.findFirst({
        where: { id: body.customerId, storeId },
      });
      if (customer) {
        loyaltyPointsUsed = Math.min(
          Number(body.loyaltyPointsUsed),
          customer.loyaltyPoints
        );
        // Validar que no exceda el % máximo del total
        const maxPts = calculateMaxRedeemablePoints(
          customer.loyaltyPoints,
          subtotal - totalDiscount,
          {
            ...program,
            enabled: true,
            roundMode: program.roundMode as any,
          }
        );
        loyaltyPointsUsed = Math.min(loyaltyPointsUsed, maxPts);
        loyaltyCurrencyDiscount = pointsToCurrency(loyaltyPointsUsed, {
          ...program,
          enabled: true,
          roundMode: program.roundMode as any,
        });
      }
    }
  }

  const effectiveDiscount = totalDiscount + loyaltyCurrencyDiscount;
  const taxable = Math.max(0, subtotal - effectiveDiscount);
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

  // Si es venta fiada, validar que el cliente tenga crédito disponible.
  // ANTES: no había validación, se podía fiar cualquier monto sin importar
  //        el creditLimit configurado en el cliente.
  // AHORA: si el cliente tiene creditLimit > 0, se valida que el saldo
  //        actual + monto nuevo no exceda el límite. Si lo excede, se
  //        rechaza la venta con error 400 y mensaje claro.
  //        Si creditLimit = 0, se asume "sin límite" (cliente ilimitado).
  if (isCredit) {
    if (!body.customerId) {
      return NextResponse.json(
        {
          error:
            "Las ventas en cuenta corriente requieren un cliente asociado. " +
            "Seleccioná un cliente antes de cobrar con el método CUENTA.",
        },
        { status: 400 }
      );
    }
    try {
      await assertCreditAvailable(db, storeId, body.customerId, total);
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Crédito insuficiente" },
        { status: 400 }
      );
    }
  }

  // Buscar caja abierta para asociar venta y movimientos de efectivo
  const openRegister = await db.cashRegister.findFirst({
    where: { storeId, status: "ABIERTA" },
  });

  // Validar branchId si viene
  let branchId: string | null = null;
  if (body.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: body.branchId, storeId, active: true },
    });
    if (branch) branchId = branch.id;
  }

  // Calcular puntos a ganar (si hay customer y programa)
  let loyaltyPointsEarned = 0;
  if (customer && program && program.enabled) {
    const tier = determineTier(customer.totalSpent, {
      ...program,
      enabled: true,
      roundMode: program.roundMode as any,
    }) as any;
    loyaltyPointsEarned = calculatePointsEarned(total, tier, {
      ...program,
      enabled: true,
      roundMode: program.roundMode as any,
    });
  }

  // Crear venta en transacción
  const sale = await db.$transaction(async (tx) => {
    const newSale = await tx.sale.create({
      data: {
        storeId,
        userId: u.id,
        customerId: body.customerId || null,
        cashRegisterId: openRegister?.id || null,
        branchId,
        subtotal,
        discount: effectiveDiscount,
        discountReason: loyaltyPointsUsed > 0
          ? (promotionId ? "PROMOCION+PUNTOS" : "PUNTOS")
          : (promotionId ? "PROMOCION" : (manualDiscount > 0 ? "MANUAL" : null)),
        tax,
        surcharge,
        total,
        paymentMethod: method?.name || "EFECTIVO",
        paymentMethodId: method?.id || null,
        promotionId,
        promotionDiscount,
        loyaltyPointsEarned,
        loyaltyPointsUsed,
        onCredit,
        amountPaid,
        status: "COMPLETADA",
        notes: body.notes || null,
        items: { create: items },
      },
      include: { items: true },
    });

    // Descontar stock y registrar movimientos usando lib/stock
    // (unificado con refunds, anulación, OC, etc. para garantizar
    // consistencia en signo, refType, validación de stock < 0, etc.)
    for (const item of items) {
      await decreaseStock(tx, {
        productId: item.productId,
        storeId,
        userId: u.id,
        quantity: item.quantity,
        reason: `Venta ${newSale.id.slice(-6)}`,
        refType: "Sale",
        refId: newSale.id,
      }, "VENTA");
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

    // Actualizar cliente (puntos, total gastado, contador de ventas)
    if (customer) {
      const newBalance = customer.loyaltyPoints - loyaltyPointsUsed + loyaltyPointsEarned;
      const newTotalSpent = customer.totalSpent + total;
      const newTotalSales = customer.totalSales + 1;

      // Recalcular tier
      const tierProgram = program;
      const newTier = tierProgram ? determineTier(newTotalSpent, {
        ...tierProgram,
        enabled: true,
        roundMode: tierProgram.roundMode as any,
      }) : "BRONCE";

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          loyaltyPoints: newBalance,
          totalSpent: newTotalSpent,
          totalSales: newTotalSales,
          loyaltyTier: newTier,
        },
      });

      // Registrar movimientos de puntos en el log
      if (program) {
        if (loyaltyPointsUsed > 0) {
          await tx.loyaltyPoint.create({
            data: {
              storeId,
              customerId: customer.id,
              programId: program.id,
              type: "REDEEM",
              points: -loyaltyPointsUsed,
              balance: customer.loyaltyPoints - loyaltyPointsUsed,
              description: `Canje en venta ${newSale.id.slice(-6)}`,
              refType: "Sale",
              refId: newSale.id,
            },
          });
        }
        if (loyaltyPointsEarned > 0) {
          await tx.loyaltyPoint.create({
            data: {
              storeId,
              customerId: customer.id,
              programId: program.id,
              type: "EARN",
              points: loyaltyPointsEarned,
              balance: customer.loyaltyPoints - loyaltyPointsUsed + loyaltyPointsEarned,
              description: `Compra por $${total.toFixed(2)} - Venta ${newSale.id.slice(-6)}`,
              refType: "Sale",
              refId: newSale.id,
            },
          });
        }
      }
    }

    // Incrementar contador de uso de la promoción
    if (promotionId) {
      await tx.promotion.update({
        where: { id: promotionId },
        data: { usageCount: { increment: 1 } },
      });
    }

    return newSale;
  });

  // Crear comisión para el vendedor (Fase 4)
  try {
    const profit = items.reduce(
      (sum, it) => sum + (it.unitPrice - it.costPrice) * it.quantity,
      0
    );
    const { createCommissionForSale } = await import("@/lib/commissions");
    await createCommissionForSale(sale.id, storeId, u.id, {
      total: sale.total,
      profit,
      onCredit: sale.onCredit,
      amountPaid: sale.amountPaid,
    });
  } catch (e) {
    console.error("Error creando comisión:", e);
  }

  return NextResponse.json(sale);
  } catch (e: any) {
    // Capturamos cualquier error que no haya sido manejado arriba (stock
    // insuficiente, error de constraint, etc.) para que el cliente siempre
    // reciba JSON en lugar de un HTML de error 500 que rompería con
    // "Unexpected end of JSON input".
    console.error("[POST /api/sales] error:", e);
    const message =
      e?.message?.startsWith("Stock insuficiente")
        ? e.message
        : "No se pudo registrar la venta. Verificá los datos e intentá nuevamente.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
