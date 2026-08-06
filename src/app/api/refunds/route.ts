import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { calculateRefundTotals } from "@/lib/refund-calc";
import { emitirNotaDeCredito } from "@/lib/afip";

// GET /api/refunds - listar devoluciones
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Number(url.searchParams.get("limit") || 100);

  const where: Prisma.RefundWhereInput = { storeId };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const refunds = await db.refund.findMany({
    where,
    include: {
      items: { include: { product: true } },
      sale: {
        select: {
          id: true,
          createdAt: true,
          total: true,
          paymentMethod: true,
          invoice: { select: { id: true, numeroCompleto: true, tipo: true } },
        },
      },
      customer: { select: { id: true, name: true } },
      user: { select: { name: true } },
      branch: { select: { id: true, name: true, code: true } },
      creditNoteInvoice: {
        select: {
          id: true,
          numeroCompleto: true,
          cae: true,
          fechaEmision: true,
          total: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(refunds);
}

// POST /api/refunds - crear devolución (total o parcial)
// Body: {
//   saleId: string,
//   items: [{ saleItemId, quantity }], // vacío o todos = total
//   refundMethod: EFECTIVO | TRANSFERENCIA | CREDITO_CUENTA,
//   reason?: string,
//   notes?: string,
//   emitCreditNote?: boolean (generar nota de crédito AFIP)
// }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();

  // 1. Validar venta
  const sale = await db.sale.findFirst({
    where: { id: body.saleId, storeId, status: "COMPLETADA" },
    include: { items: true, customer: true, invoice: true },
  });
  if (!sale) {
    return NextResponse.json({ error: "Venta no encontrada o ya anulada" }, { status: 404 });
  }

  // Verificar que no tenga devolución previa
  const existingRefund = await db.refund.findUnique({
    where: { saleId: sale.id },
  });
  if (existingRefund) {
    return NextResponse.json(
      { error: "Esta venta ya tiene una devolución registrada" },
      { status: 400 }
    );
  }

  // 1b. Si el usuario pidió emitir NC, validar que la venta tenga factura
  //     electrónica con CAE (no se puede emitir NC sobre una venta sin factura).
  const wantsCreditNote = body.emitCreditNote === true;
  if (wantsCreditNote) {
    if (!sale.invoice) {
      return NextResponse.json({
        error: "No se puede emitir nota de crédito: la venta no tiene factura electrónica asociada. Genere la factura primero desde el módulo Facturación.",
      }, { status: 400 });
    }
    if (sale.invoice.status === "ANULADA") {
      return NextResponse.json({
        error: `La factura ${sale.invoice.numeroCompleto} está anulada; no se puede emitir NC sobre una factura anulada.`,
      }, { status: 400 });
    }
    if (!sale.invoice.cae) {
      return NextResponse.json({
        error: `La factura ${sale.invoice.numeroCompleto} no tiene CAE; no se puede emitir NC.`,
      }, { status: 400 });
    }
  }

  // 2. Determinar items a devolver y montos (cálculo delegado a lib/refund-calc)
  const requestedItems: Array<{ saleItemId: string; quantity: number }> = body.items || [];

  let refundCalc;
  try {
    refundCalc = calculateRefundTotals(
      {
        id: sale.id,
        subtotal: sale.subtotal,
        discount: sale.discount,
        tax: sale.tax,
        surcharge: sale.surcharge,
        total: sale.total,
        items: sale.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          costPrice: i.costPrice,
          subtotal: i.subtotal,
        })),
      },
      requestedItems
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error al calcular montos de devolución" },
      { status: 400 }
    );
  }

  const {
    isTotal,
    items: refundItems,
    refundSubtotal,
    refundDiscount,
    refundTax,
    refundSurcharge,
    refundTotal,
  } = refundCalc;

  // 4. Generar número de devolución
  const lastRefund = await db.refund.findFirst({
    where: { storeId },
    orderBy: { refundNumber: "desc" },
  });
  let nextNum = 1;
  if (lastRefund && lastRefund.refundNumber) {
    const m = lastRefund.refundNumber.match(/DEV-(\d+)/);
    if (m) nextNum = parseInt(m[1]) + 1;
  }
  const refundNumber = `DEV-${String(nextNum).padStart(4, "0")}`;

  // 5. Buscar caja abierta
  const openRegister = await db.cashRegister.findFirst({
    where: { storeId, status: "ABIERTA" },
  });

  // 6. Crear devolución en transacción
  const refund = await db.$transaction(async (tx) => {
    // Crear registro de devolución
    const newRefund = await tx.refund.create({
      data: {
        storeId,
        saleId: sale.id,
        userId: u.id,
        customerId: sale.customerId || null,
        branchId: sale.branchId || null,
        cashRegisterId: openRegister?.id || null,
        refundNumber,
        type: isTotal ? "TOTAL" : "PARCIAL",
        subtotal: refundSubtotal,
        discount: refundDiscount,
        tax: refundTax,
        total: refundTotal,
        refundMethod: body.refundMethod || "EFECTIVO",
        reason: body.reason || null,
        notes: body.notes || null,
        status: "COMPLETADA",
        items: {
          create: refundItems.map((ri) => ({
            saleItemId: ri.saleItemId,
            productId: ri.productId,
            quantity: ri.quantity,
            unitPrice: ri.unitPrice,
            costPrice: ri.costPrice,
            subtotal: ri.subtotal,
          })),
        },
      },
      include: { items: true },
    });

    // Restituir stock
    for (const item of refundItems) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          storeId,
          userId: u.id,
          type: "AJUSTE",
          quantity: item.quantity,
          reason: `Devolución ${refundNumber}`,
          refType: "Refund",
          refId: newRefund.id,
        },
      });
    }

    // Si fue pago en efectivo y hay caja abierta, registrar EGRESO
    if (
      openRegister &&
      body.refundMethod === "EFECTIVO" &&
      sale.paymentMethod === "EFECTIVO"
    ) {
      await tx.cashMovement.create({
        data: {
          cashRegisterId: openRegister.id,
          storeId,
          userId: u.id,
          type: "EGRESO",
          amount: refundTotal,
          concept: `Devolución ${refundNumber} (Venta ${sale.id.slice(-6)})`,
          paymentMethod: "EFECTIVO",
          refType: "Refund",
          refId: newRefund.id,
        },
      });
    }

    // Si fue CREDITO_CUENTA, registrar pago a cuenta del cliente (resta saldo)
    if (body.refundMethod === "CREDITO_CUENTA" && sale.customerId) {
      await tx.customerPayment.create({
        data: {
          storeId,
          customerId: sale.customerId,
          userId: u.id,
          amount: refundTotal,
          paymentMethod: "NOTA_CREDITO",
          cashRegisterId: openRegister?.id || null,
          notes: `Devolución ${refundNumber} de venta ${sale.id.slice(-6)}`,
        },
      });
    }

    // Si es devolución total, marcar venta como ANULADA
    if (isTotal) {
      await tx.sale.update({
        where: { id: sale.id },
        data: { status: "ANULADA" },
      });
    } else {
      // Devolución parcial: la venta sigue COMPLETADA pero con marca (no se anula)
      // Podría agregarse un campo hasPartialRefund pero lo manejamos vía relación refund
    }

    // Descontar puntos al cliente si ganó puntos en la venta original
    if (sale.customerId && sale.loyaltyPointsEarned > 0) {
      const program = await tx.loyaltyProgram.findUnique({ where: { storeId } });
      if (program && program.enabled) {
        const customer = await tx.customer.findUnique({
          where: { id: sale.customerId },
        });
        if (customer) {
          // Devolver puntos proporcionalmente al monto devuelto
          const proportionToRevert = refundTotal / sale.total;
          const pointsToRevert = Math.floor(sale.loyaltyPointsEarned * proportionToRevert);
          // Devolver puntos canjeados si los hubo
          const pointsToReturn = Math.floor(sale.loyaltyPointsUsed * proportionToRevert);
          const newBalance = Math.max(0, customer.loyaltyPoints - pointsToRevert + pointsToReturn);

          await tx.customer.update({
            where: { id: customer.id },
            data: {
              loyaltyPoints: newBalance,
              totalSpent: { decrement: refundTotal },
              totalSales: isTotal ? { decrement: 1 } : undefined,
            },
          });

          if (pointsToRevert > 0) {
            await tx.loyaltyPoint.create({
              data: {
                storeId,
                customerId: customer.id,
                programId: program.id,
                type: "ADJUST",
                points: -pointsToRevert + pointsToReturn,
                balance: newBalance,
                description: `Reversa por devolución ${refundNumber}`,
                refType: "Refund",
                refId: newRefund.id,
              },
            });
          }
        }
      }
    }

    return newRefund;
  });

  // 7. (Opcional) Emitir nota de crédito AFIP
  //     Se hace FUERA de la transacción principal porque llama a AFIP (latencia)
  //     y no queremos hacer hold de locks de DB mientras AFIP responde.
  //     Si AFIP falla, el refund YA está persistido con sus efectos (stock,
  //     caja, cuenta corriente) — el usuario puede reintentar la NC desde
  //     el módulo Notas de Crédito sin perder la devolución.
  let creditNoteResult: any = null;
  if (wantsCreditNote && sale.invoice) {
    // Recalcular neto/IVA prorrateado para la NC, usando la misma tasa
    // de IVA que tenía la factura original (snapshot).
    const ivaRate = sale.invoice.ivaRate;
    // El total de la NC es refundTotal (positivo). Para NC tipo A se
    // discrimina IVA; para B/C va incluido.
    let netoGravado: number;
    let ivaAmount: number;
    if (sale.invoice.tipo === "A") {
      netoGravado = refundTotal / (1 + ivaRate / 100);
      ivaAmount = refundTotal - netoGravado;
    } else {
      netoGravado = refundTotal / (1 + ivaRate / 100);
      ivaAmount = refundTotal - netoGravado;
    }

    creditNoteResult = await emitirNotaDeCredito(storeId, u.id, {
      originalInvoiceId: sale.invoice.id,
      tipo: sale.invoice.tipo as any,
      concepto: sale.invoice.concepto as any,
      fecha: new Date(),
      clienteNombre: sale.invoice.customerName,
      clienteCuit: sale.invoice.customerCuit,
      clienteCondicionIva: sale.invoice.customerTaxType,
      netoGravado: Number(netoGravado.toFixed(2)),
      ivaRate,
      ivaAmount: Number(ivaAmount.toFixed(2)),
      total: Number(refundTotal.toFixed(2)),
      customerId: sale.customerId,
      refundId: refund.id,
      motivo: `Devolución ${refundNumber}${body.reason ? ` - ${body.reason}` : ""}${body.notes ? ` - ${body.notes}` : ""}`,
    });

    if (!creditNoteResult.ok) {
      // La NC falló pero el refund quedó persistido. Devolver warning al
      // frontend para que el usuario sepa que debe reintentar la NC.
      return NextResponse.json({
        ...refund,
        _warning: `La devolución se registró correctamente, pero la nota de crédito no se pudo emitir: ${creditNoteResult.error}. Puede reintentar desde el módulo Notas de Crédito.`,
      });
    }
  }

  // Devolver refund + NC si se emitió
  const response: any = { ...refund };
  if (creditNoteResult?.ok && creditNoteResult.creditNote) {
    response.creditNote = {
      id: creditNoteResult.creditNote.id,
      numeroCompleto: creditNoteResult.numeroCompleto,
      cae: creditNoteResult.cae,
      caeVencimiento: creditNoteResult.caeVencimiento,
      qrData: creditNoteResult.qrData,
      total: creditNoteResult.creditNote.total,
    };
  }
  return NextResponse.json(response);
}
