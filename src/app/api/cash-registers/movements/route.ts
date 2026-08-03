import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: movimientos de una caja
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const cashRegisterId = url.searchParams.get("cashRegisterId");

  if (!cashRegisterId) {
    return NextResponse.json({ error: "Falta cashRegisterId" }, { status: 400 });
  }

  const movements = await db.cashMovement.findMany({
    where: { cashRegisterId, storeId },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(movements);
}

// POST: registrar movimiento manual (ingreso/egreso)
// body: { cashRegisterId, type: "INGRESO" | "EGRESO", amount, concept, paymentMethod? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { cashRegisterId, type, amount, concept, paymentMethod } = body;

  if (!cashRegisterId || !type || !amount || !concept) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }
  if (!["INGRESO", "EGRESO"].includes(type)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }
  if (Number(amount) <= 0) {
    return NextResponse.json({ error: "Monto debe ser positivo" }, { status: 400 });
  }

  const register = await db.cashRegister.findFirst({
    where: { id: cashRegisterId, storeId, status: "ABIERTA" },
  });
  if (!register) {
    return NextResponse.json({ error: "Caja no encontrada o cerrada" }, { status: 404 });
  }

  const movement = await db.cashMovement.create({
    data: {
      cashRegisterId,
      storeId,
      userId: u.id,
      type,
      amount: Number(amount),
      concept,
      paymentMethod: paymentMethod || "EFECTIVO",
    },
    include: { user: { select: { name: true } } },
  });

  return NextResponse.json(movement);
}
