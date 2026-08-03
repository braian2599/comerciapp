import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/print-templates - listar plantillas
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const templates = await db.printTemplate.findMany({
    where: { storeId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(templates);
}

// POST /api/print-templates - crear plantilla
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const body = await req.json();
  const {
    name,
    type = "TICKET",
    paperWidth = 58,
    charset = "UTF8",
    cutPaper = true,
    config,
    headerLines,
    footerLines,
    showLogo = false,
    showCustomer = false,
    showSeller = true,
    showPayment = true,
    active = true,
    isDefault = false,
  } = body;

  if (!name) return NextResponse.json({ error: "name requerido" }, { status: 400 });

  // Si es default, quitar default de las demás
  if (isDefault) {
    await db.printTemplate.updateMany({
      where: { storeId: u.storeId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const template = await db.printTemplate.create({
    data: {
      storeId: u.storeId,
      name,
      type,
      paperWidth: Number(paperWidth),
      charset,
      cutPaper,
      config: config ? JSON.stringify(config) : null,
      headerLines: headerLines || null,
      footerLines: footerLines || null,
      showLogo,
      showCustomer,
      showSeller,
      showPayment,
      active,
      isDefault,
    },
  });

  return NextResponse.json(template);
}

// PUT /api/print-templates - actualizar plantilla
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const existing = await db.printTemplate.findFirst({ where: { id, storeId: u.storeId } });
  if (!existing) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });

  if (updates.isDefault) {
    await db.printTemplate.updateMany({
      where: { storeId: u.storeId, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  const updated = await db.printTemplate.update({
    where: { id },
    data: {
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.type !== undefined && { type: updates.type }),
      ...(updates.paperWidth !== undefined && { paperWidth: Number(updates.paperWidth) }),
      ...(updates.charset !== undefined && { charset: updates.charset }),
      ...(updates.cutPaper !== undefined && { cutPaper: updates.cutPaper }),
      ...(updates.config !== undefined && { config: updates.config ? JSON.stringify(updates.config) : null }),
      ...(updates.headerLines !== undefined && { headerLines: updates.headerLines || null }),
      ...(updates.footerLines !== undefined && { footerLines: updates.footerLines || null }),
      ...(updates.showLogo !== undefined && { showLogo: updates.showLogo }),
      ...(updates.showCustomer !== undefined && { showCustomer: updates.showCustomer }),
      ...(updates.showSeller !== undefined && { showSeller: updates.showSeller }),
      ...(updates.showPayment !== undefined && { showPayment: updates.showPayment }),
      ...(updates.active !== undefined && { active: updates.active }),
      ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/print-templates?id=xxx
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

  const existing = await db.printTemplate.findFirst({ where: { id, storeId: u.storeId } });
  if (!existing) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
  if (existing.isDefault) {
    return NextResponse.json({ error: "No se puede eliminar la plantilla por defecto" }, { status: 400 });
  }

  await db.printTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
