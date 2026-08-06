import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: estado de cuenta de un cliente (ventas fiadas + pagos)
// ?customerId=xxx
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId");

  if (!customerId) {
    return NextResponse.json({ error: "Falta customerId" }, { status: 400 });
  }

  // Ventas en cuenta corriente (fiadas)
  const creditSales = await db.sale.findMany({
    where: { storeId, customerId, onCredit: true, status: "COMPLETADA" },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Pagos realizados
  const payments = await db.customerPayment.findMany({
    where: { storeId, customerId },
    include: { user: { select: { name: true } } },
    orderBy: { date: "asc" },
  });

  // Construir ledger unificado
  type LedgerItem = {
    id: string;
    date: string;
    type: "DEBE" | "HABER";
    description: string;
    amount: number;
    user?: string;
    balanceAfter: number;
  };
  const ledger: LedgerItem[] = [];
  let balance = 0;
  const allItems: { date: Date; fn: () => void }[] = [];

  for (const s of creditSales) {
    allItems.push({
      date: new Date(s.createdAt),
      fn: () => {
        balance += s.total;
        ledger.push({
          id: s.id,
          date: s.createdAt.toISOString(),
          type: "DEBE",
          description: `Venta ${s.id.slice(-6)}${s.notes ? ` - ${s.notes}` : ""}`,
          amount: s.total,
          user: s.user?.name,
          balanceAfter: balance,
        });
      },
    });
  }
  for (const p of payments) {
    allItems.push({
      date: new Date(p.date),
      fn: () => {
        balance -= p.amount;
        // Distinguir tipo de pago para mostrar etiqueta clara en el ledger
        let label = "Pago";
        if (p.paymentMethod === "NOTA_CREDITO") {
          label = "Nota de crédito";
        } else if (p.paymentMethod === "TRANSFERENCIA") {
          label = "Pago por transferencia";
        } else if (p.paymentMethod === "TARJETA") {
          label = "Pago con tarjeta";
        }
        ledger.push({
          id: p.id,
          date: p.date.toISOString(),
          type: "HABER",
          description: `${label}${p.notes ? ` - ${p.notes}` : ""}`,
          amount: p.amount,
          user: p.user?.name,
          balanceAfter: balance,
        });
      },
    });
  }

  allItems.sort((a, b) => a.date.getTime() - b.date.getTime());
  ledger.length = 0;
  balance = 0;
  for (const it of allItems) {
    it.fn();
  }

  const customer = await db.customer.findFirst({
    where: { id: customerId, storeId },
    select: { id: true, name: true, phone: true, creditLimit: true },
  });

  return NextResponse.json({
    customer,
    saldo: balance,
    creditLimit: customer?.creditLimit || 0,
    disponible: customer?.creditLimit ? customer.creditLimit - balance : 0,
    movimientos: ledger.reverse(), // más reciente primero
    totalVentas: creditSales.length,
    totalPagos: payments.length,
  });
}

// POST: registrar pago de cuenta corriente
// body: { customerId, amount, paymentMethod, notes?, cashRegisterId? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { customerId, amount, paymentMethod, notes } = body;

  if (!customerId || !amount || amount <= 0) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const customer = await db.customer.findFirst({ where: { id: customerId, storeId } });
  if (!customer) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  // Buscar caja abierta si el pago es en efectivo
  let openRegister: any = null;
  if (paymentMethod === "EFECTIVO") {
    openRegister = await db.cashRegister.findFirst({
      where: { storeId, status: "ABIERTA" },
    });
  }

  const payment = await db.$transaction(async (tx) => {
    const newPayment = await tx.customerPayment.create({
      data: {
        storeId,
        customerId,
        userId: u.id,
        amount: Number(amount),
        paymentMethod: paymentMethod || "EFECTIVO",
        cashRegisterId: openRegister?.id || null,
        notes,
      },
      include: { user: { select: { name: true } } },
    });

    // Si es efectivo, registrar movimiento de caja
    if (openRegister && paymentMethod === "EFECTIVO") {
      await tx.cashMovement.create({
        data: {
          cashRegisterId: openRegister.id,
          storeId,
          userId: u.id,
          type: "PAGO_CUENTA",
          amount: Number(amount),
          concept: `Pago cta. ${customer.name}`,
          paymentMethod: "EFECTIVO",
          refType: "CustomerPayment",
          refId: newPayment.id,
        },
      });
    }

    return newPayment;
  });

  return NextResponse.json(payment);
}
