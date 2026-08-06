import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCustomerBalance, applyCreditToCustomerAccount } from "@/lib/customer-account";

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
// body: {
//   customerId: string,
//   amount: number,
//   paymentMethod: string, // EFECTIVO | TRANSFERENCIA | TARJETA | OTRO
//   notes?: string,
//   cashRegisterId?: string,
//   allowOverpayment?: boolean  // si true, permite pagar más del saldo (adelanto)
// }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { customerId, amount, paymentMethod, notes } = body;

  // Validaciones básicas
  if (!customerId) {
    return NextResponse.json({ error: "Falta customerId" }, { status: 400 });
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json(
      { error: "El monto debe ser un número mayor a cero" },
      { status: 400 }
    );
  }

  const customer = await db.customer.findFirst({ where: { id: customerId, storeId } });
  if (!customer) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  // Validar overpayment: si el monto excede el saldo actual y el usuario
  // no confirmó con allowOverpayment=true, rechazar para evitar saldos
  // negativos accidentales (el cliente queda "a favor" pero podría ser
  // un error de tipeo del usuario).
  // allowOverpayment=true permite adelantos deliberados (ej: cliente
  // deja seña para futuras compras).
  const currentBalance = await getCustomerBalance(db, storeId, customerId);
  const allowOverpayment = body.allowOverpayment === true;
  if (amountNum > currentBalance + 0.01 && !allowOverpayment) {
    return NextResponse.json({
      error:
        `El monto a pagar ($${amountNum.toFixed(2)}) excede el saldo deudor ` +
        `actual ($${currentBalance.toFixed(2)}). ` +
        `Si querés registrar un adelanto (saldo a favor del cliente), ` +
        `confirmá con allowOverpayment=true.`,
      currentBalance,
      requestedAmount: amountNum,
    }, { status: 400 });
  }

  // Buscar caja abierta si el pago es en efectivo
  let openRegister: any = null;
  if (paymentMethod === "EFECTIVO") {
    openRegister = await db.cashRegister.findFirst({
      where: { storeId, status: "ABIERTA" },
    });
  }

  // Usar applyCreditToCustomerAccount para centralizar la creación de
  // CustomerPayment + CashMovement (mantenemos consistencia con refunds).
  const payment = await db.$transaction(async (tx) => {
    return applyCreditToCustomerAccount(tx, {
      storeId,
      customerId,
      userId: u.id,
      amount: amountNum,
      paymentMethod: paymentMethod || "EFECTIVO",
      cashRegisterId: openRegister?.id || null,
      notes: notes || null,
      refType: "CustomerPayment",
      registerCashMovement: true, // PAGO_CUENTA genera ingreso de caja si es efectivo
    });
  });

  // Devolver el pago creado + saldo actualizado (para que el frontend
  // refresque el balance sin tener que hacer otro GET).
  const newBalance = await getCustomerBalance(db, storeId, customerId);
  return NextResponse.json({
    ...payment,
    _newBalance: newBalance,
  });
}
