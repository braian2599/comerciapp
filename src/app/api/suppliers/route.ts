import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const suppliers = await db.supplier.findMany({
    where: { storeId },
    include: { _count: { select: { purchaseOrders: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(suppliers);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const body = await req.json();
  const s = await db.supplier.create({
    data: {
      name: body.name,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      contactName: body.contactName || null,
      notes: body.notes || null,
      storeId: u.storeId,
    },
  });
  return NextResponse.json(s);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const body = await req.json();
  const s = await db.supplier.update({
    where: { id: body.id },
    data: {
      name: body.name,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      contactName: body.contactName || null,
      notes: body.notes || null,
      active: body.active ?? true,
    },
  });
  return NextResponse.json(s);
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
  await db.supplier.delete({ where: { id, storeId: u.storeId } });
  return NextResponse.json({ ok: true });
}
