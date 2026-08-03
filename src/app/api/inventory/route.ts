import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Movimientos de stock
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 100);
  const productId = url.searchParams.get("productId");

  const where: any = { storeId };
  if (productId) where.productId = productId;

  const movements = await db.stockMovement.findMany({
    where,
    include: {
      product: { select: { name: true, unit: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(movements);
}

// Registrar entrada/salida manual
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role === "CAJERO") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const body = await req.json();
  const storeId = u.storeId;
  const productId = body.productId;
  const quantity = Number(body.quantity);
  const type = body.type; // ENTRADA o SALIDA
  const reason = body.reason || (type === "ENTRADA" ? "Ingreso manual" : "Salida manual");

  if (!productId || !quantity || !type) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }
  const signedQty = type === "ENTRADA" ? Math.abs(quantity) : -Math.abs(quantity);

  const movement = await db.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: { increment: signedQty } },
    });
    if (updated.stock < 0) {
      throw new Error("Stock resultante negativo");
    }
    return tx.stockMovement.create({
      data: {
        productId,
        storeId,
        userId: u.id,
        type,
        quantity: signedQty,
        reason,
      },
    });
  });

  return NextResponse.json(movement);
}
