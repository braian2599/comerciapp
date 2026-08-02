import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

// Información del usuario autenticado + tienda
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const u = session.user as any;
  const store = await db.store.findUnique({
    where: { id: u.storeId },
    select: {
      id: true,
      name: true,
      rubro: true,
      currency: true,
      currencySymbol: true,
      taxEnabled: true,
      taxRate: true,
      lowStockThreshold: true,
      address: true,
      phone: true,
    },
  });
  return NextResponse.json({
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
    },
    store,
  });
}
