import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: lista de cajas (con filtros) o caja abierta actual
// Query params:
//   status   - ABIERTA | CERRADA (opcional)
//   branchId - filtrar por sucursal (opcional; "null" → sin sucursal)
//   from     - fecha apertura desde (ISO date, opcional)
//   to       - fecha apertura hasta (ISO date, opcional)
//   limit    - cantidad máxima (default 30)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // ABIERTA | CERRADA
  const branchId = url.searchParams.get("branchId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Number(url.searchParams.get("limit") || 30);

  const where: any = { storeId };
  if (status) where.status = status;
  if (branchId) {
    if (branchId === "null" || branchId === "none") {
      where.branchId = null;
    } else {
      where.branchId = branchId;
    }
  }
  if (from || to) {
    where.openingDate = {};
    if (from) where.openingDate.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      // incluir todo el día "to"
      toDate.setHours(23, 59, 59, 999);
      where.openingDate.lte = toDate;
    }
  }

  const registers = await db.cashRegister.findMany({
    where,
    include: {
      user: { select: { name: true } },
      branch: { select: { id: true, name: true, code: true } },
      movements: { orderBy: { createdAt: "asc" } },
      _count: { select: { sales: true } },
    },
    orderBy: { openingDate: "desc" },
    take: limit,
  });

  return NextResponse.json(registers);
}

// POST: abrir nueva caja
// body: { openingBalance, notes?, branchId? }
// Si branchId no se envía o es null, la caja queda sin sucursal (null = principal/global).
// Si se envía branchId, valida que la sucursal pertenezca al store y esté activa.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  // Verificar que no haya otra caja abierta
  // (a nivel store: solo puede haber una caja ABIERTA por tienda)
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
  const branchId = body.branchId || null;

  // Validar branchId si se envía
  if (branchId) {
    const branch = await db.branch.findFirst({
      where: { id: branchId, storeId, active: true },
      select: { id: true, name: true },
    });
    if (!branch) {
      return NextResponse.json(
        { error: "Sucursal no encontrada o inactiva" },
        { status: 400 }
      );
    }
  }

  const register = await db.cashRegister.create({
    data: {
      storeId,
      userId: u.id,
      branchId,
      openingBalance,
      status: "ABIERTA",
      notes,
    },
    include: {
      user: { select: { name: true } },
      branch: { select: { id: true, name: true, code: true } },
    },
  });

  return NextResponse.json(register);
}
