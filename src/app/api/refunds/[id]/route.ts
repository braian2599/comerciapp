import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/refunds/[id] - detalle de una devolución
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const { id } = await params;

  const refund = await db.refund.findFirst({
    where: { id, storeId },
    include: {
      items: { include: { product: true } },
      sale: {
        include: {
          items: true,
          customer: { select: { id: true, name: true } },
        },
      },
      customer: { select: { id: true, name: true } },
      user: { select: { name: true } },
      branch: { select: { id: true, name: true, code: true } },
      cashRegister: { select: { id: true, openingDate: true } },
    },
  });

  if (!refund) {
    return NextResponse.json({ error: "Devolución no encontrada" }, { status: 404 });
  }

  return NextResponse.json(refund);
}
