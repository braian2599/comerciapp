import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { decreaseStock, increaseStock } from "@/lib/stock";

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
  if (type !== "ENTRADA" && type !== "SALIDA") {
    return NextResponse.json({ error: "Tipo inválido (debe ser ENTRADA o SALIDA)" }, { status: 400 });
  }

  // Usar lib/stock para garantizar validación de stock<0 y registro consistente.
  // ANTES: usaba increment(signedQty) que podía dejar stock negativo en SALIDA
  // si el usuario mandaba un número mayor al stock actual.
  // AHORA: decreaseStock valida stockResultante>=0 y lanza error descriptivo.
  let movement;
  try {
    if (type === "ENTRADA") {
      await db.$transaction(async (tx) => {
        await increaseStock(tx, {
          productId,
          storeId,
          userId: u.id,
          quantity: Math.abs(quantity),
          reason,
          refType: "InventoryAdjustment",
        }, "ENTRADA");
      });
    } else {
      await db.$transaction(async (tx) => {
        await decreaseStock(tx, {
          productId,
          storeId,
          userId: u.id,
          quantity: Math.abs(quantity),
          reason,
          refType: "InventoryAdjustment",
        }, "SALIDA");
      });
    }
    // Buscar el último movimiento creado para devolverlo al frontend
    movement = await db.stockMovement.findFirst({
      where: { productId, userId: u.id, reason, type },
      orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true, unit: true } }, user: { select: { name: true } } },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error al registrar movimiento" }, { status: 400 });
  }

  return NextResponse.json(movement);
}
