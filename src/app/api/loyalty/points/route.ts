import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/loyalty/points?customerId=...
// Devuelve el historial de puntos del cliente + info actual
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  if (!customerId) {
    return NextResponse.json({ error: "customerId requerido" }, { status: 400 });
  }

  const customer = await db.customer.findFirst({
    where: { id: customerId, storeId },
    select: {
      id: true,
      name: true,
      loyaltyPoints: true,
      loyaltyTier: true,
      totalSpent: true,
      totalSales: true,
    },
  });

  if (!customer) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  const pointsLog = await db.loyaltyPoint.findMany({
    where: { customerId, storeId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ customer, pointsLog });
}

// POST /api/loyalty/points - ajuste manual de puntos
// Body: { customerId, points (positivo o negativo), description? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const storeId = u.storeId;
  const body = await req.json();

  const customer = await db.customer.findFirst({
    where: { id: body.customerId, storeId },
  });
  if (!customer) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  let program = await db.loyaltyProgram.findUnique({ where: { storeId } });
  if (!program) {
    program = await db.loyaltyProgram.create({ data: { storeId } });
  }

  const pointsDelta = parseFloat(body.points);
  if (isNaN(pointsDelta) || pointsDelta === 0) {
    return NextResponse.json({ error: "Puntos inválidos" }, { status: 400 });
  }

  const newBalance = Math.max(0, customer.loyaltyPoints + pointsDelta);

  const [updated, log] = await db.$transaction([
    db.customer.update({
      where: { id: customer.id },
      data: { loyaltyPoints: newBalance },
    }),
    db.loyaltyPoint.create({
      data: {
        storeId,
        customerId: customer.id,
        programId: program.id,
        type: "ADJUST",
        points: pointsDelta,
        balance: newBalance,
        description: body.description || "Ajuste manual",
        refType: "Manual",
        refId: u.id,
      },
    }),
  ]);

  return NextResponse.json({ customer: updated, log });
}
