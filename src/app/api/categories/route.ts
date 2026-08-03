import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  try {
    const categories = await db.category.findMany({
      where: { storeId },
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(categories);
  } catch (e: any) {
    console.error("[GET /api/categories] error:", e);
    return NextResponse.json(
      { error: "Error al obtener categorías" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role === "CAJERO") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de la petición inválido" },
      { status: 400 }
    );
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "El nombre de la categoría es obligatorio" },
      { status: 400 }
    );
  }

  try {
    const cat = await db.category.create({
      data: { name, storeId: u.storeId },
    });
    return NextResponse.json(cat, { status: 201 });
  } catch (e: any) {
    console.error("[POST /api/categories] error:", e);
    return NextResponse.json(
      { error: "No se pudo crear la categoría" },
      { status: 500 }
    );
  }
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

  try {
    // Soft handling: si la categoría tiene productos asociados, Prisma fallará
    // porque el schema usa onDelete: SetNull, pero podría haber restricciones.
    // Igual intentamos el delete directo y dejamos que el schema decida.
    await db.category.delete({ where: { id, storeId: u.storeId } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[DELETE /api/categories] error:", e);
    const message = e?.code === "P2025"
      ? "La categoría no existe o ya fue eliminada"
      : "No se pudo eliminar la categoría (puede tener productos asociados)";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
