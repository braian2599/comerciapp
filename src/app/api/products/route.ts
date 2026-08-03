import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const products = await db.product.findMany({
    where: { storeId },
    include: { category: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(products);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role === "CAJERO") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const body = await req.json();
  const storeId = u.storeId;

  const product = await db.product.create({
    data: {
      name: body.name,
      description: body.description || null,
      barcode: body.barcode || null,
      sku: body.sku || null,
      categoryId: body.categoryId || null,
      storeId,
      costPrice: Number(body.costPrice) || 0,
      salePrice: Number(body.salePrice) || 0,
      stock: Number(body.stock) || 0,
      minStock: Number(body.minStock) ?? 5,
      unit: body.unit || "UNIDAD",
      active: body.active ?? true,
      brand: body.brand || null,
      labels: body.labels || null,
      ingredients: body.ingredients || null,
      allergens: body.allergens || null,
      imageUrl: body.imageUrl || null,
    },
  });

  // Si hay stock inicial, registrar movimiento
  if (product.stock > 0) {
    await db.stockMovement.create({
      data: {
        productId: product.id,
        storeId,
        userId: u.id,
        type: "ENTRADA",
        quantity: product.stock,
        reason: "Stock inicial",
      },
    });
  }

  return NextResponse.json(product);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role === "CAJERO") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const body = await req.json();
  const storeId = u.storeId;

  const existing = await db.product.findFirst({
    where: { id: body.id, storeId },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const prevStock = existing.stock;
  const newStock = Number(body.stock) ?? prevStock;

  const updated = await db.product.update({
    where: { id: body.id },
    data: {
      name: body.name,
      description: body.description || null,
      barcode: body.barcode || null,
      sku: body.sku || null,
      categoryId: body.categoryId || null,
      costPrice: Number(body.costPrice) || 0,
      salePrice: Number(body.salePrice) || 0,
      stock: newStock,
      minStock: Number(body.minStock) ?? 5,
      unit: body.unit || "UNIDAD",
      active: body.active ?? true,
      brand: body.brand || null,
      labels: body.labels || null,
      ingredients: body.ingredients || null,
      allergens: body.allergens || null,
      imageUrl: body.imageUrl || null,
    },
  });

  // Si el stock cambió manualmente, registrar ajuste
  if (Math.abs(newStock - prevStock) > 0.001) {
    await db.stockMovement.create({
      data: {
        productId: body.id,
        storeId,
        userId: u.id,
        type: "AJUSTE",
        quantity: newStock - prevStock,
        reason: body.adjustReason || "Ajuste manual",
      },
    });
  }

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

  const existing = await db.product.findFirst({
    where: { id, storeId: u.storeId },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Soft delete: marcar como inactivo en lugar de borrar para preservar ventas históricas
  await db.product.update({
    where: { id },
    data: { active: false },
  });

  return NextResponse.json({ ok: true });
}
