import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Helpers de validación y parsing seguro.
 *
 * El cliente puede enviar strings (desde inputs HTML) o numbers.
 * Sanitizamos todo antes de llegar a Prisma para evitar errores
 * de tipo o de constraint que terminen en un 500 sin cuerpo JSON.
 */
function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringOrFallback(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return fallback;
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return fallback;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  try {
    const products = await db.product.findMany({
      where: { storeId },
      include: { category: true, supplier: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return NextResponse.json(products);
  } catch (e: any) {
    console.error("[GET /api/products] error:", e);
    return NextResponse.json(
      { error: "Error al obtener productos" },
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
      { error: "Cuerpo de la petición inválido (JSON malformado)" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Cuerpo de la petición inválido" },
      { status: 400 }
    );
  }

  // Validación de campos obligatorios
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "El nombre del producto es obligatorio" },
      { status: 400 }
    );
  }
  const salePrice = toNumber(body.salePrice);
  if (salePrice < 0) {
    return NextResponse.json(
      { error: "El precio de venta no puede ser negativo" },
      { status: 400 }
    );
  }

  const storeId = u.storeId;

  try {
    const product = await db.product.create({
      data: {
        name,
        description: toOptionalString(body.description),
        barcode: toOptionalString(body.barcode),
        sku: toOptionalString(body.sku),
        categoryId: body.categoryId || null,
        supplierId: body.supplierId || null,
        storeId,
        costPrice: Math.max(0, toNumber(body.costPrice)),
        salePrice,
        stock: Math.max(0, toNumber(body.stock)),
        minStock: Math.max(0, toNumber(body.minStock, 5)),
        unit: toStringOrFallback(body.unit, "UNIDAD"),
        active: toBool(body.active, true),
        brand: toOptionalString(body.brand),
        labels: toOptionalString(body.labels),
        ingredients: toOptionalString(body.ingredients),
        allergens: toOptionalString(body.allergens),
        imageUrl: toOptionalString(body.imageUrl),
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

    return NextResponse.json(product, { status: 201 });
  } catch (e: any) {
    console.error("[POST /api/products] error:", e);
    // Prisma suele devolver messages útiles; los exponemos con un prefijo.
    const message = e?.message?.includes("Unique constraint")
      ? "Ya existe un producto con ese código de barras o SKU"
      : "No se pudo crear el producto. Verificá los datos e intentá nuevamente.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
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
      { error: "Cuerpo de la petición inválido (JSON malformado)" },
      { status: 400 }
    );
  }

  if (!body?.id) {
    return NextResponse.json(
      { error: "ID de producto requerido" },
      { status: 400 }
    );
  }

  const storeId = u.storeId;

  try {
    const existing = await db.product.findFirst({
      where: { id: body.id, storeId },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    const prevStock = existing.stock;
    const newStock = Math.max(0, toNumber(body.stock, prevStock));

    const updated = await db.product.update({
      where: { id: body.id },
      data: {
        name: typeof body.name === "string" ? body.name.trim() : existing.name,
        description: toOptionalString(body.description),
        barcode: toOptionalString(body.barcode),
        sku: toOptionalString(body.sku),
        categoryId: body.categoryId || null,
        supplierId: body.supplierId || null,
        costPrice: Math.max(0, toNumber(body.costPrice)),
        salePrice: Math.max(0, toNumber(body.salePrice)),
        stock: newStock,
        minStock: Math.max(0, toNumber(body.minStock, 5)),
        unit: toStringOrFallback(body.unit, existing.unit),
        active: toBool(body.active, existing.active),
        brand: toOptionalString(body.brand),
        labels: toOptionalString(body.labels),
        ingredients: toOptionalString(body.ingredients),
        allergens: toOptionalString(body.allergens),
        imageUrl: toOptionalString(body.imageUrl),
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
          reason:
            typeof body.adjustReason === "string" && body.adjustReason.trim()
              ? body.adjustReason.trim()
              : "Ajuste manual",
        },
      });
    }

    return NextResponse.json(updated);
  } catch (e: any) {
    console.error("[PUT /api/products] error:", e);
    const message = e?.message?.includes("Unique constraint")
      ? "Ya existe un producto con ese código de barras o SKU"
      : "No se pudo actualizar el producto. Verificá los datos e intentá nuevamente.";
    return NextResponse.json({ error: message }, { status: 500 });
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
    const existing = await db.product.findFirst({
      where: { id, storeId: u.storeId },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "No encontrado" },
        { status: 404 }
      );
    }

    // Soft delete: marcar como inactivo en lugar de borrar para preservar ventas históricas
    await db.product.update({
      where: { id },
      data: { active: false },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[DELETE /api/products] error:", e);
    return NextResponse.json(
      { error: "No se pudo eliminar el producto" },
      { status: 500 }
    );
  }
}
