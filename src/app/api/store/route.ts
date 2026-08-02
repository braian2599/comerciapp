import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }
  const body = await req.json();
  const store = await db.store.update({
    where: { id: u.storeId },
    data: {
      name: body.name,
      rubro: body.rubro,
      currency: body.currency,
      currencySymbol: body.currencySymbol,
      taxEnabled: body.taxEnabled,
      taxRate: Number(body.taxRate) || 0,
      address: body.address || null,
      phone: body.phone || null,
      lowStockThreshold: Number(body.lowStockThreshold) ?? 5,
    },
  });
  return NextResponse.json(store);
}
