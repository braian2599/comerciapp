import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  getCommissionSummary,
  commissionTypeLabel,
} from "@/lib/commissions";

// GET /api/commissions - listar comisiones con filtros
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;
  const url = new URL(req.url);

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status");
  const userId = url.searchParams.get("userId");
  const summary = url.searchParams.get("summary") === "true";
  const limit = Number(url.searchParams.get("limit") || 200);

  // Modo resumen: totales por vendedor
  if (summary) {
    const startDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = to ? new Date(to) : new Date();
    const summary = await getCommissionSummary(storeId, startDate, endDate);
    return NextResponse.json(summary);
  }

  const where: Prisma.CommissionWhereInput = { storeId };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  if (status) where.status = status;
  if (userId) where.userId = userId;

  const commissions = await db.commission.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, role: true } },
      sale: {
        select: {
          id: true,
          total: true,
          paymentMethod: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
      },
      rule: { select: { id: true, name: true, type: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const out = commissions.map((c) => ({
    ...c,
    ruleTypeLabel: c.rule ? commissionTypeLabel(c.rule.type) : null,
  }));

  return NextResponse.json(out);
}

// PATCH /api/commissions - marcar como pagada / anular
// Body: { ids: string[], action: "PAY" | "ANNUL" | "REOPEN", notes?: string }
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const body = await req.json();
  const { ids, action, notes } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids requerido" }, { status: 400 });
  }
  if (action === "PAY") {
    await db.commission.updateMany({
      where: { id: { in: ids }, storeId: u.storeId },
      data: { status: "PAGADA", paidAt: new Date(), notes: notes || null },
    });
    return NextResponse.json({ updated: ids.length });
  } else if (action === "ANNUL") {
    await db.commission.updateMany({
      where: { id: { in: ids }, storeId: u.storeId },
      data: { status: "ANULADA", notes: notes || "Anulada por admin" },
    });
    return NextResponse.json({ updated: ids.length });
  } else if (action === "REOPEN") {
    await db.commission.updateMany({
      where: { id: { in: ids }, storeId: u.storeId },
      data: { status: "PENDIENTE", paidAt: null },
    });
    return NextResponse.json({ updated: ids.length });
  }
  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
