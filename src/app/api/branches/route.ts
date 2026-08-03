import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/branches - listar sucursales de la tienda
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const branches = await db.branch.findMany({
    where: { storeId },
    include: {
      _count: {
        select: { sales: true, cashRegisters: true },
      },
    },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(branches);
}

// POST /api/branches - crear sucursal
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json();

  if (body.code) {
    const existing = await db.branch.findFirst({
      where: { storeId: u.storeId, code: body.code.toUpperCase() },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Ya existe una sucursal con ese código" },
        { status: 400 }
      );
    }
  }

  if (body.isMain) {
    await db.branch.updateMany({
      where: { storeId: u.storeId, isMain: true },
      data: { isMain: false },
    });
  }

  const branch = await db.branch.create({
    data: {
      storeId: u.storeId,
      name: body.name,
      code: (body.code || "").toUpperCase(),
      address: body.address || null,
      phone: body.phone || null,
      manager: body.manager || null,
      isMain: body.isMain ?? false,
      active: body.active ?? true,
    },
  });
  return NextResponse.json(branch);
}

// PUT /api/branches - actualizar
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json();

  if (body.isMain) {
    await db.branch.updateMany({
      where: { storeId: u.storeId, isMain: true, id: { not: body.id } },
      data: { isMain: false },
    });
  }

  const branch = await db.branch.update({
    where: { id: body.id },
    data: {
      name: body.name,
      code: (body.code || "").toUpperCase(),
      address: body.address || null,
      phone: body.phone || null,
      manager: body.manager || null,
      isMain: body.isMain ?? false,
      active: body.active ?? true,
    },
  });
  return NextResponse.json(branch);
}

// DELETE /api/branches?id=...
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

  const branch = await db.branch.findFirst({ where: { id, storeId: u.storeId } });
  if (!branch) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (branch.isMain) {
    return NextResponse.json(
      { error: "No se puede eliminar la sucursal principal" },
      { status: 400 }
    );
  }

  await db.branch.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
