import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeTiers, parseTiers } from "@/lib/commissions";

// GET /api/commissions/rules - listar reglas
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const rules = await db.commissionRule.findMany({
    where: { storeId },
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });

  // Deserializar tiers
  const out = rules.map((r) => ({
    ...r,
    tiersParsed: parseTiers(r.tiers),
  }));

  return NextResponse.json(out);
}

// POST /api/commissions/rules - crear regla
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const body = await req.json();
  const {
    userId,
    name,
    type,
    rate,
    tiers,
    minSaleAmount,
    onlyPaid,
    startDate,
    endDate,
    active,
  } = body;

  if (!userId || !name || !type) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  // Validar vendedor pertenece a la tienda
  const user = await db.user.findFirst({ where: { id: userId, storeId: u.storeId } });
  if (!user) {
    return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 });
  }

  const rule = await db.commissionRule.create({
    data: {
      storeId: u.storeId,
      userId,
      name,
      type,
      rate: Number(rate) || 0,
      tiers: type === "ESCALONADO" ? serializeTiers(tiers || []) : null,
      minSaleAmount: Number(minSaleAmount) || 0,
      onlyPaid: onlyPaid !== false,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      active: active !== false,
    },
  });

  return NextResponse.json(rule);
}

// PUT /api/commissions/rules - actualizar regla
// Body: { id, ...campos }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const body = await req.json();
  const { id, userId, name, type, rate, tiers, minSaleAmount, onlyPaid, startDate, endDate, active } = body;

  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const existing = await db.commissionRule.findFirst({ where: { id, storeId: u.storeId } });
  if (!existing) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  const updated = await db.commissionRule.update({
    where: { id },
    data: {
      ...(userId && { userId }),
      ...(name && { name }),
      ...(type && { type }),
      ...(rate !== undefined && { rate: Number(rate) || 0 }),
      ...(type === "ESCALONADO" && { tiers: serializeTiers(tiers || []) }),
      ...(minSaleAmount !== undefined && { minSaleAmount: Number(minSaleAmount) || 0 }),
      ...(onlyPaid !== undefined && { onlyPaid }),
      ...(startDate && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      ...(active !== undefined && { active }),
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/commissions/rules?id=xxx - eliminar regla
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const existing = await db.commissionRule.findFirst({ where: { id, storeId: u.storeId } });
  if (!existing) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  // Verificar que no tenga comisiones asociadas
  const commissionsCount = await db.commission.count({ where: { ruleId: id } });
  if (commissionsCount > 0) {
    // Soft delete: desactivar en vez de eliminar
    await db.commissionRule.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ softDeleted: true, message: "Regla desactivada (tenía comisiones asociadas)" });
  }

  await db.commissionRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
