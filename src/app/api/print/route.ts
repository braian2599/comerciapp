import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  buildSaleTicket,
  buildCommandTicket,
  buildZCloseTicket,
  ticketToBase64,
  type TicketData,
} from "@/lib/printer";

// POST /api/print - generar ticket en formato ESC/POS
// Body: {
//   type: "TICKET" | "COMANDA" | "CIERRE_Z",
//   saleId?: string,         // para TICKET
//   items?: [{ name, quantity, unit?, notes?, station }],  // para COMANDA
//   cashRegisterId?: string, // para CIERRE_Z
//   templateId?: string,     // plantilla a usar
//   returnFormat?: "base64" | "blob" | "json"
// }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { type, saleId, items, cashRegisterId, templateId, returnFormat = "base64" } = body;

  if (!type) return NextResponse.json({ error: "type requerido" }, { status: 400 });

  // Cargar plantilla
  let template: any = null;
  if (templateId) {
    template = await db.printTemplate.findFirst({
      where: { id: templateId, storeId },
    });
  }
  if (!template) {
    template = await db.printTemplate.findFirst({
      where: { storeId, isDefault: true, active: true },
    });
  }

  if (type === "TICKET") {
    if (!saleId) return NextResponse.json({ error: "saleId requerido" }, { status: 400 });

    const sale = await db.sale.findFirst({
      where: { id: saleId, storeId },
      include: {
        items: { include: { product: true } },
        user: { select: { name: true } },
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        paymentMethodRef: { select: { name: true, type: true, surcharge: true } },
        invoice: { select: { id: true, tipo: true, numeroCompleto: true, cae: true, caeVencimiento: true, qrData: true } },
      },
    });
    if (!sale) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

    const store = await db.store.findUnique({ where: { id: storeId } });
    if (!store) return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });

    const ticketData: TicketData = {
      store: {
        name: store.name,
        address: store.address,
        phone: store.phone,
        cuit: null, // CUIT está en TaxConfig
        rubro: store.rubro,
      },
      sale: {
        id: sale.id,
        createdAt: sale.createdAt,
        items: sale.items.map((it) => ({
          name: it.product.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
          unit: it.product.unit,
        })),
        subtotal: sale.subtotal,
        discount: sale.discount,
        discountReason: sale.discountReason,
        tax: sale.tax,
        surcharge: sale.surcharge,
        total: sale.total,
        paymentMethod: sale.paymentMethodRef?.name || sale.paymentMethod,
        onCredit: sale.onCredit,
        amountPaid: sale.amountPaid,
        customerName: sale.customer?.name || null,
        sellerName: sale.user?.name || null,
        branchName: sale.branch?.name || null,
        loyaltyPointsEarned: sale.loyaltyPointsEarned,
        loyaltyPointsUsed: sale.loyaltyPointsUsed,
      },
      invoice: sale.invoice
        ? {
            type: sale.invoice.tipo,
            number: sale.invoice.numeroCompleto,
            cae: sale.invoice.cae || "",
            caeExpiration: sale.invoice.caeVencimiento?.toISOString().split("T")[0] || undefined,
            qrCode: sale.invoice.qrData || undefined,
          }
        : null,
      template: template
        ? {
            paperWidth: template.paperWidth as 58 | 80,
            charset: template.charset,
            cutPaper: template.cutPaper,
            headerLines: template.headerLines,
            footerLines: template.footerLines,
            showLogo: template.showLogo,
            showCustomer: template.showCustomer,
            showSeller: template.showSeller,
            showPayment: template.showPayment,
          }
        : undefined,
    };

    // Intentar obtener CUIT de TaxConfig
    const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
    if (taxConfig?.cuit) ticketData.store.cuit = taxConfig.cuit;

    const bytes = buildSaleTicket(ticketData);
    const base64 = ticketToBase64(bytes);

    if (returnFormat === "blob") {
      // Devolver como binario
      const buffer = Buffer.from(base64, "base64");
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="ticket.bin"',
        },
      });
    }

    return NextResponse.json({
      ok: true,
      type: "TICKET",
      saleId: sale.id,
      data: base64,
      size: bytes.length,
      template: template?.name || "default",
    });
  }

  if (type === "COMANDA") {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "items requerido" }, { status: 400 });
    }

    const store = await db.store.findUnique({ where: { id: storeId } });
    if (!store) return NextResponse.json({ error: "Tienda no encontrada" }, { status: 404 });

    const bytes = buildCommandTicket({
      store: { name: store.name },
      sale: {
        id: body.saleId || "comanda",
        number: body.number,
        createdAt: new Date(),
        branchName: body.branchName,
      },
      items: items.map((it: any) => ({
        name: it.name,
        quantity: it.quantity,
        unit: it.unit,
        notes: it.notes,
        station: it.station || "COCINA",
      })),
    });

    return NextResponse.json({
      ok: true,
      type: "COMANDA",
      data: ticketToBase64(bytes),
      size: bytes.length,
    });
  }

  if (type === "CIERRE_Z") {
    if (!cashRegisterId) return NextResponse.json({ error: "cashRegisterId requerido" }, { status: 400 });

    const cashRegister = await db.cashRegister.findFirst({
      where: { id: cashRegisterId, storeId },
      include: {
        movements: true,
      },
    });
    if (!cashRegister) return NextResponse.json({ error: "Caja no encontrada" }, { status: 404 });

    const store = await db.store.findUnique({ where: { id: storeId } });

    // Calcular totales por método de pago
    const sales = await db.sale.findMany({
      where: {
        storeId,
        cashRegisterId,
        status: "COMPLETADA",
      },
      include: { paymentMethodRef: true },
    });

    const totals = {
      sales: sales.reduce((s, v) => s + v.total, 0),
      salesCount: sales.length,
      cash: 0,
      cardCredit: 0,
      cardDebit: 0,
      transfer: 0,
      onCredit: 0,
      refunds: 0,
      expenses: 0,
      expectedCash: cashRegister.openingBalance,
      actualCash: cashRegister.openingBalance,
      difference: 0,
    };
    for (const s of sales) {
      const t = s.paymentMethodRef?.type;
      if (t === "EFECTIVO") totals.cash += s.amountPaid;
      else if (t === "TARJETA_CREDITO") totals.cardCredit += s.total;
      else if (t === "TARJETA_DEBITO") totals.cardDebit += s.total;
      else if (t === "TRANSFERENCIA") totals.transfer += s.total;
      if (s.onCredit) totals.onCredit += s.total - s.amountPaid;
    }
    // Sumar movimientos de caja
    for (const m of cashRegister.movements) {
      if (m.type === "INGRESO") totals.cash += m.amount;
      else if (m.type === "EGRESO") {
        totals.cash -= m.amount;
        totals.expenses += m.amount;
      }
    }
    totals.expectedCash = cashRegister.openingBalance + totals.cash - cashRegister.openingBalance;
    totals.actualCash = totals.expectedCash;
    totals.difference = 0;

    const bytes = buildZCloseTicket({
      store: { name: store?.name || "", address: store?.address, cuit: null },
      cashRegister: {
        id: cashRegister.id,
        openedAt: cashRegister.openingDate,
        closedAt: cashRegister.closingDate || new Date(),
        openingBalance: cashRegister.openingBalance,
      },
      totals,
    });

    return NextResponse.json({
      ok: true,
      type: "CIERRE_Z",
      data: ticketToBase64(bytes),
      size: bytes.length,
    });
  }

  return NextResponse.json({ error: "Tipo no soportado" }, { status: 400 });
}
