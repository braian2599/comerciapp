import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const methods = await db.paymentMethod.findMany({
    where: { storeId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(methods);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json();
  const storeId = u.storeId;

  // Si está marcando como default, quitar el default de los otros
  if (body.isDefault) {
    await db.paymentMethod.updateMany({
      where: { storeId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const method = await db.paymentMethod.create({
    data: {
      name: body.name,
      type: body.type,
      surcharge: Number(body.surcharge) || 0,
      active: body.active ?? true,
      isDefault: body.isDefault ?? false,
      storeId,
    },
  });
  return NextResponse.json(method);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json();
  const storeId = u.storeId;

  const existing = await db.paymentMethod.findFirst({
    where: { id: body.id, storeId },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (body.isDefault && !existing.isDefault) {
    await db.paymentMethod.updateMany({
      where: { storeId, isDefault: true, id: { not: body.id } },
      data: { isDefault: false },
    });
  }

  const updated = await db.paymentMethod.update({
    where: { id: body.id },
    data: {
      name: body.name,
      type: body.type,
      surcharge: Number(body.surcharge) || 0,
      active: body.active ?? true,
      isDefault: body.isDefault ?? false,
    },
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

  const existing = await db.paymentMethod.findFirst({
    where: { id, storeId: u.storeId },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Verificar que no tenga ventas asociadas
  const salesCount = await db.sale.count({
    where: { paymentMethodId: id },
  });
  if (salesCount > 0) {
    // En lugar de borrar, desactivar
    await db.paymentMethod.update({
      where: { id },
      data: { active: false, isDefault: false },
    });
    return NextResponse.json({ ok: true, deactivated: true });
  }

  await db.paymentMethod.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
