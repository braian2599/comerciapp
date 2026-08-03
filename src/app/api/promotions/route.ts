import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/promotions
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const { searchParams } = new URL(req.url);
  const onlyActive = searchParams.get("active") === "true";

  const promotions = await db.promotion.findMany({
    where: {
      storeId,
      ...(onlyActive ? { active: true } : {}),
    },
    include: {
      category: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(promotions);
}

// POST /api/promotions - crear
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json();

  // Validaciones
  if (!body.name || !body.type) {
    return NextResponse.json(
      { error: "Nombre y tipo son requeridos" },
      { status: 400 }
    );
  }

  if (body.scope === "CATEGORY" && !body.categoryId) {
    return NextResponse.json(
      { error: "Para scope CATEGORY debe indicar categoryId" },
      { status: 400 }
    );
  }
  if (body.scope === "PRODUCT" && !body.productId) {
    return NextResponse.json(
      { error: "Para scope PRODUCT debe indicar productId" },
      { status: 400 }
    );
  }

  const promo = await db.promotion.create({
    data: {
      storeId: u.storeId,
      name: body.name,
      description: body.description || null,
      type: body.type,
      value: parseFloat(body.value) || 0,
      buyQuantity: parseInt(body.buyQuantity) || 0,
      getQuantity: parseInt(body.getQuantity) || 0,
      scope: body.scope || "CART",
      categoryId: body.scope === "CATEGORY" ? body.categoryId : null,
      productId: body.scope === "PRODUCT" ? body.productId : null,
      minPurchase: parseFloat(body.minPurchase) || 0,
      maxDiscount: body.maxDiscount ? parseFloat(body.maxDiscount) : null,
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      endDate: body.endDate ? new Date(body.endDate) : null,
      daysOfWeek: body.daysOfWeek || null,
      startHour: body.startHour !== undefined && body.startHour !== null && body.startHour !== "" ? parseInt(body.startHour) : null,
      endHour: body.endHour !== undefined && body.endHour !== null && body.endHour !== "" ? parseInt(body.endHour) : null,
      active: body.active ?? true,
      priority: parseInt(body.priority) || 0,
      usageLimit: body.usageLimit ? parseInt(body.usageLimit) : null,
      perCustomerLimit: body.perCustomerLimit ? parseInt(body.perCustomerLimit) : null,
    },
  });
  return NextResponse.json(promo);
}

// PUT /api/promotions - actualizar
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json();

  const promo = await db.promotion.update({
    where: { id: body.id },
    data: {
      name: body.name,
      description: body.description || null,
      type: body.type,
      value: parseFloat(body.value) || 0,
      buyQuantity: parseInt(body.buyQuantity) || 0,
      getQuantity: parseInt(body.getQuantity) || 0,
      scope: body.scope || "CART",
      categoryId: body.scope === "CATEGORY" ? body.categoryId : null,
      productId: body.scope === "PRODUCT" ? body.productId : null,
      minPurchase: parseFloat(body.minPurchase) || 0,
      maxDiscount: body.maxDiscount ? parseFloat(body.maxDiscount) : null,
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      endDate: body.endDate ? new Date(body.endDate) : null,
      daysOfWeek: body.daysOfWeek || null,
      startHour: body.startHour !== undefined && body.startHour !== null && body.startHour !== "" ? parseInt(body.startHour) : null,
      endHour: body.endHour !== undefined && body.endHour !== null && body.endHour !== "" ? parseInt(body.endHour) : null,
      active: body.active ?? true,
      priority: parseInt(body.priority) || 0,
      usageLimit: body.usageLimit ? parseInt(body.usageLimit) : null,
      perCustomerLimit: body.perCustomerLimit ? parseInt(body.perCustomerLimit) : null,
    },
  });
  return NextResponse.json(promo);
}

// DELETE /api/promotions?id=...
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

  await db.promotion.delete({ where: { id, storeId: u.storeId } });
  return NextResponse.json({ ok: true });
}
