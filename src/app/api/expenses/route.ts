import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// GET: lista de gastos (con filtros)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const category = url.searchParams.get("category");
  const paymentMethod = url.searchParams.get("paymentMethod");
  const limit = Number(url.searchParams.get("limit") || 200);

  const where: Prisma.ExpenseWhereInput = { storeId };
  if (category) where.category = category;
  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.date.lte = toDate;
    }
  }

  const expenses = await db.expense.findMany({
    where,
    include: { user: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });

  // Totales por categoría
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const porCategoria: Record<string, number> = {};
  for (const e of expenses) {
    porCategoria[e.category] = (porCategoria[e.category] || 0) + e.amount;
  }

  return NextResponse.json({ expenses, total, porCategoria });
}

// POST: crear gasto
// body: { category, description, amount, paymentMethod, date? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { category, description, amount, paymentMethod, date } = body;

  if (!category || !description || !amount || amount <= 0) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  // Si es efectivo, asociar a caja abierta y registrar movimiento
  let openRegister: any = null;
  if ((paymentMethod || "EFECTIVO") === "EFECTIVO") {
    openRegister = await db.cashRegister.findFirst({
      where: { storeId, status: "ABIERTA" },
    });
  }

  const expense = await db.$transaction(async (tx) => {
    const newExpense = await tx.expense.create({
      data: {
        storeId,
        userId: u.id,
        category,
        description,
        amount: Number(amount),
        paymentMethod: paymentMethod || "EFECTIVO",
        date: date ? new Date(date) : new Date(),
      },
      include: { user: { select: { name: true } } },
    });

    if (openRegister && (paymentMethod || "EFECTIVO") === "EFECTIVO") {
      await tx.cashMovement.create({
        data: {
          cashRegisterId: openRegister.id,
          storeId,
          userId: u.id,
          type: "EGRESO",
          amount: Number(amount),
          concept: `Gasto: ${description} (${category})`,
          paymentMethod: "EFECTIVO",
          refType: "Expense",
          refId: newExpense.id,
        },
      });
    }

    return newExpense;
  });

  return NextResponse.json(expense);
}

// PUT: actualizar gasto existente
// body: { id, category, description, amount, paymentMethod, date }
// Maneja correctamente la transición entre métodos de pago:
//   - Si era EFECTIVO y tenía movimiento de caja asociado → se elimina y recrea si sigue siendo EFECTIVO
//   - Si pasa a no-EFECTIVO → se elimina el movimiento anterior
//   - Si pasa a EFECTIVO → se crea nuevo movimiento (si hay caja abierta)
// Solo ADMIN puede editar.
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const storeId = u.storeId;

  const body = await req.json();
  const { id, category, description, amount, paymentMethod, date } = body;

  if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  if (!category || !description || !amount || amount <= 0) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  // Buscar gasto existente
  const existing = await db.expense.findFirst({ where: { id, storeId } });
  if (!existing) {
    return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  }

  const newPaymentMethod = paymentMethod || "EFECTIVO";

  // Verificar si hay caja abierta (en caso de necesitar crear movimiento nuevo)
  let openRegister: any = null;
  if (newPaymentMethod === "EFECTIVO") {
    openRegister = await db.cashRegister.findFirst({
      where: { storeId, status: "ABIERTA" },
    });
  }

  const updated = await db.$transaction(async (tx) => {
    // 1) Eliminar el movimiento de caja anterior si existía (refType="Expense", refId=id)
    await tx.cashMovement.deleteMany({
      where: { refType: "Expense", refId: id, storeId },
    });

    // 2) Actualizar el gasto
    const exp = await tx.expense.update({
      where: { id },
      data: {
        category,
        description,
        amount: Number(amount),
        paymentMethod: newPaymentMethod,
        date: date ? new Date(date) : existing.date,
      },
      include: { user: { select: { name: true } } },
    });

    // 3) Crear nuevo movimiento si es EFECTIVO y hay caja abierta
    if (openRegister && newPaymentMethod === "EFECTIVO") {
      await tx.cashMovement.create({
        data: {
          cashRegisterId: openRegister.id,
          storeId,
          userId: u.id,
          type: "EGRESO",
          amount: Number(amount),
          concept: `Gasto: ${description} (${category})`,
          paymentMethod: "EFECTIVO",
          refType: "Expense",
          refId: id,
        },
      });
    }

    return exp;
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });

  // Si el gasto generó movimiento de caja, eliminarlo también
  const expense = await db.expense.findFirst({ where: { id, storeId: u.storeId } });
  if (!expense) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  await db.$transaction(async (tx) => {
    await tx.cashMovement.deleteMany({
      where: { refType: "Expense", refId: id, storeId: u.storeId },
    });
    await tx.expense.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
