import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: lista de cajas (con filtros) o caja abierta actual
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // ABIERTA | CERRADA
  const limit = Number(url.searchParams.get("limit") || 30);

  const where: any = { storeId };
  if (status) where.status = status;

  const registers = await db.cashRegister.findMany({
    where,
    include: {
      user: { select: { name: true } },
      movements: { orderBy: { createdAt: "asc" } },
      _count: { select: { sales: true } },
    },
    orderBy: { openingDate: "desc" },
    take: limit,
  });

  return NextResponse.json(registers);
}

// POST: abrir nueva caja
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  // Verificar que no haya otra caja abierta
  const openRegister = await db.cashRegister.findFirst({
    where: { storeId, status: "ABIERTA" },
  });
  if (openRegister) {
    return NextResponse.json(
      { error: "Ya hay una caja abierta. Cerrala antes de abrir una nueva." },
      { status: 400 }
    );
  }

  const body = await req.json();
  const openingBalance = Number(body.openingBalance) || 0;
  const notes = body.notes || null;

  const register = await db.cashRegister.create({
    data: {
      storeId,
      userId: u.id,
      openingBalance,
      status: "ABIERTA",
      notes,
    },
    include: { user: { select: { name: true } } },
  });

  return NextResponse.json(register);
}
