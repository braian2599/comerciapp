import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { evaluateAllPromotions, AppliedDiscount } from "@/lib/promotions";

// POST /api/promotions/evaluate
// Body: { items: CartItem[], customerId?: string }
// Devuelve: { applicable: AppliedDiscount[], best: AppliedDiscount | null }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const body = await req.json();
  const items = body.items as Array<{
    productId: string;
    categoryId?: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ applicable: [], best: null });
  }

  // Buscar promociones activas de la tienda
  const promotions = await db.promotion.findMany({
    where: { storeId, active: true },
    include: { category: { select: { id: true } }, product: { select: { id: true } } },
  });

  const applicable = evaluateAllPromotions(
    promotions.map((p) => ({
      ...p,
      scope: p.scope as any,
      type: p.type as any,
    })),
    items
  );

  return NextResponse.json({
    applicable,
    best: applicable.length > 0 ? applicable[0] : null,
  });
}
