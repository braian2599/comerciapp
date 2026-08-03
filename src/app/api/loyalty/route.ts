import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/loyalty - devuelve configuración de la tienda (o crea por defecto)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  let program = await db.loyaltyProgram.findUnique({ where: { storeId } });
  if (!program) {
    program = await db.loyaltyProgram.create({ data: { storeId } });
  }
  return NextResponse.json(program);
}

// PUT /api/loyalty - actualizar configuración
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const storeId = u.storeId;
  const body = await req.json();

  let program = await db.loyaltyProgram.findUnique({ where: { storeId } });
  if (!program) {
    program = await db.loyaltyProgram.create({ data: { storeId } });
  }

  const updated = await db.loyaltyProgram.update({
    where: { storeId },
    data: {
      enabled: body.enabled ?? false,
      name: body.name || "Programa de Puntos",
      pointsPerWeight: parseFloat(body.pointsPerWeight) ?? 1,
      roundMode: body.roundMode || "FLOOR",
      minPurchase: parseFloat(body.minPurchase) ?? 0,
      pointsToCurrency: parseFloat(body.pointsToCurrency) ?? 0.01,
      minRedeemPoints: parseFloat(body.minRedeemPoints) ?? 0,
      maxRedeemPercent: parseFloat(body.maxRedeemPercent) ?? 100,
      tierBronceMin: parseFloat(body.tierBronceMin) ?? 0,
      tierBronceBonus: parseFloat(body.tierBronceBonus) ?? 0,
      tierPlataMin: parseFloat(body.tierPlataMin) ?? 50000,
      tierPlataBonus: parseFloat(body.tierPlataBonus) ?? 0.2,
      tierOroMin: parseFloat(body.tierOroMin) ?? 200000,
      tierOroBonus: parseFloat(body.tierOroBonus) ?? 0.5,
      tierPlatinoMin: parseFloat(body.tierPlatinoMin) ?? 500000,
      tierPlatinoBonus: parseFloat(body.tierPlatinoBonus) ?? 1,
    },
  });

  return NextResponse.json(updated);
}
