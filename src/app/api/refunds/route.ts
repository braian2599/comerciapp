import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { calculateRefundTotals } from "@/lib/refund-calc";
import { emitirNotaDeCredito } from "@/lib/afip";
import {
  getNextRefundNumber,
  normalizeRefundMethod,
  applyCreditToCustomerAccount,
} from "@/lib/customer-account";

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

  // 4. Buscar caja abierta (antes de la transacción para no hacer IO
  //    innecesario dentro de la tx, pero la validación de unicidad de
  //    refundNumber se hace DENTRO de la tx para evitar races).
  const openRegister = await db.cashRegister.findFirst({
    where: { storeId, status: "ABIERTA" },
  });

  // 4b. Normalizar método de devolución considerando contexto de la venta.
  //     Esto resuelve:
  //      - Venta fiada + EFECTIVO/TRANSFERENCIA → automáticamente CREDITO_CUENTA
  //        (con warning para que el usuario sepa) salvo que confirme con
  //        forceCashRefundOnCreditSale=true.
  //      - CREDITO_CUENTA sin cliente en la venta → cae a EFECTIVO (con warning).
  const { method: normalizedRefundMethod, warning: methodWarning } =
    normalizeRefundMethod(
      {
        onCredit: sale.onCredit,
        customerId: sale.customerId,
        paymentMethod: sale.paymentMethod,
      },
      body.refundMethod,
      {
        forceCashRefundOnCreditSale:
          body.forceCashRefundOnCreditSale === true,
      }
    );

  // 6. Crear devolución en transacción
  //    Todas las escrituras (refund, stock, customer_payment, cash_movement,
  //    sale.status, customer stats) van adentro para garantizar atomicidad.
  const refund = await db.$transaction(async (tx) => {
    // 6.1 Generar refundNumber DENTRO de la transacción para evitar race
    //     conditions. Antes esto se hacía afuera y dos usuarios concurrentes
    //     podían generar el mismo número.
    const refundNumber = await getNextRefundNumber(tx, storeId);

    // 6.2 Crear registro de devolución
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
        refundMethod: normalizedRefundMethod,
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

    // 6.3 Restituir stock + registrar movimiento
    //     Usamos tipo "ENTRADA" (no "AJUSTE") para distinguir devoluciones de
    //     ajustes manuales en reportes de stock. Esto permite filtrar
    //     "entradas por devolución" sin ambigüedad.
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
          type: "ENTRADA",
          quantity: item.quantity,
          reason: `Devolución ${refundNumber}`,
          refType: "Refund",
          refId: newRefund.id,
        },
      });
    }

    // 6.4 Registrar movimiento de caja si se entregó efectivo al cliente.
    //     ANTES: solo se registraba si sale.paymentMethod === "EFECTIVO",
    //     lo cual rompía si el cliente pagó con TARJETA pero devuelve en
    //     EFECTIVO (no quedaba registro del egreso de caja).
    //     AHORA: registramos egreso siempre que se entregue efectivo al
    //     cliente en la devolución, independientemente de cómo pagó originalmente.
    if (
      openRegister &&
      normalizedRefundMethod === "EFECTIVO" &&
      refundTotal > 0
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

    // 6.5 Si refundMethod=CREDITO_CUENTA, acreditar a la cuenta del cliente.
    //     normalizeRefundMethod() ya garantizó que hay customerId.
    //     Usamos applyCreditToCustomerAccount() para centralizar la lógica.
    if (normalizedRefundMethod === "CREDITO_CUENTA" && sale.customerId) {
      await applyCreditToCustomerAccount(tx, {
        storeId,
        customerId: sale.customerId,
        userId: u.id,
        amount: refundTotal,
        paymentMethod: "NOTA_CREDITO",
        cashRegisterId: openRegister?.id || null,
        notes: `Devolución ${refundNumber} de venta ${sale.id.slice(-6)}`,
        refType: "Refund",
        refId: newRefund.id,
        // NC no genera movimiento de caja física (el dinero no entra/sale de la caja)
        registerCashMovement: false,
      });
    }

    // 6.6 Si es devolución total, marcar venta como ANULADA.
    //     ANTES: esto dejaba deuda fantasma si la venta era fiada y el
    //     refundMethod era CREDITO_CUENTA, porque el saldo se calcula con
    //     Sale(onCredit=true, status=COMPLETADA) y al cambiar status a
    //     ANULADA la deuda desaparecía "por arte de magia" (sin registro
    //     contable de la reversión).
    //     AHORA: si la venta era fiada, NO la marcamos como ANULADA — la
    //     deuda queda visible en cuenta corriente hasta que el
    //     CustomerPayment (NOTA_CREDITO) la compense explícitamente.
    //     Solo anulamos ventas CONTADO.
    if (isTotal) {
      if (sale.onCredit) {
        // Venta fiada: NO marcar como ANULADA. La deuda se cancela vía
        // CustomerPayment (creado en 6.5 si method=CREDITO_CUENTA).
        // Si method=EFECTIVO (con forceCashRefundOnCreditSale=true), la
        // deuda queda activa y debe cancelarse manualmente.
        // Nota: dejamos status=COMPLETADA para que siga apareciendo en el
        // ledger de cuenta corriente.
      } else {
        // Venta contado: anular la venta.
        await tx.sale.update({
          where: { id: sale.id },
          data: { status: "ANULADA" },
        });
      }
    }

    // 6.7 Actualizar stats del cliente (totalSpent, totalSales, loyaltyPoints).
    //     ANTES: esto estaba DENTRO del bloque `if (sale.loyaltyPointsEarned > 0)`,
    //     lo cual hacía que totalSpent/totalSales no se actualizaran si la
    //     venta no había ganado puntos (programa desactivado, compra chica, etc.).
    //     AHORA: el bloque de stats es independiente del bloque de puntos.
    if (sale.customerId) {
      const customer = await tx.customer.findUnique({
        where: { id: sale.customerId },
      });
      if (customer) {
        // Calcular proporción para prorratear puntos
        const proportionToRevert = sale.total > 0 ? refundTotal / sale.total : 0;
        const pointsToRevert = Math.floor(
          sale.loyaltyPointsEarned * proportionToRevert
        );
        const pointsToReturn = Math.floor(
          sale.loyaltyPointsUsed * proportionToRevert
        );
        const newBalance = Math.max(
          0,
          customer.loyaltyPoints - pointsToRevert + pointsToReturn
        );

        await tx.customer.update({
          where: { id: customer.id },
          data: {
            loyaltyPoints: newBalance,
            totalSpent: { decrement: refundTotal },
            // Solo decrementar totalSales si fue devolución total de venta contado.
            // Para venta fiada dejamos el contador (porque la venta sigue existiendo).
            totalSales:
              isTotal && !sale.onCredit ? { decrement: 1 } : undefined,
          },
        });

        // Registrar movimiento de puntos si hubo reversa
        if (pointsToRevert > 0 || pointsToReturn > 0) {
          const program = await tx.loyaltyProgram.findUnique({
            where: { storeId },
          });
          if (program) {
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
      motivo: `Devolución ${refund.refundNumber}${body.reason ? ` - ${body.reason}` : ""}${body.notes ? ` - ${body.notes}` : ""}`,
    });

    if (!creditNoteResult.ok) {
      // La NC falló pero el refund quedó persistido. Devolver warning al
      // frontend para que el usuario sepa que debe reintentar la NC.
      return NextResponse.json({
        ...refund,
        refundMethod: normalizedRefundMethod,
        _warning: `La devolución se registró correctamente, pero la nota de crédito no se pudo emitir: ${creditNoteResult.error}. Puede reintentar desde el módulo Notas de Crédito.`,
      });
    }
  }

  // Devolver refund + NC si se emitió + propagar warnings de normalización
  const response: any = {
    ...refund,
    refundMethod: normalizedRefundMethod,
  };
  if (methodWarning) {
    response._warning = methodWarning;
  }
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
