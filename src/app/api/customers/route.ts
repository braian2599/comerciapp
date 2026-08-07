import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// ===== Helpers de normalización (compartidos con /api/customers/import) =====

const VALID_TAX_TYPES = [
  "CONSUMIDOR_FINAL",
  "MONOTRIBUTO",
  "RESPONSABLE_INSCRIPTO",
  "EXENTO",
];

const TAX_TYPE_ALIASES: Record<string, string> = {
  consumidor_final: "CONSUMIDOR_FINAL",
  "consumidor final": "CONSUMIDOR_FINAL",
  cf: "CONSUMIDOR_FINAL",
  monotributo: "MONOTRIBUTO",
  mono: "MONOTRIBUTO",
  mt: "MONOTRIBUTO",
  responsable_inscripto: "RESPONSABLE_INSCRIPTO",
  "responsable inscripto": "RESPONSABLE_INSCRIPTO",
  ri: "RESPONSABLE_INSCRIPTO",
  responsable: "RESPONSABLE_INSCRIPTO",
  exento: "EXENTO",
  exenta: "EXENTO",
};

function normalizeCuit(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.replace(/[^0-9]/g, "");
}

function normalizeTaxType(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (VALID_TAX_TYPES.includes(s.toUpperCase())) return s.toUpperCase();
  const lower = s.toLowerCase().trim();
  if (TAX_TYPE_ALIASES[lower]) return TAX_TYPE_ALIASES[lower];
  if (TAX_TYPE_ALIASES[lower.replace(/\s+/g, "_")]) {
    return TAX_TYPE_ALIASES[lower.replace(/\s+/g, "_")];
  }
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const customers = await db.customer.findMany({
    where: { storeId },
    include: {
      _count: { select: { sales: true } },
      sales: {
        where: { onCredit: true, status: "COMPLETADA" },
        select: { total: true },
      },
      payments: { select: { amount: true } },
    },
    orderBy: { name: "asc" },
  });
  // Calcular saldo de cuenta corriente
  const withSaldo = customers.map((c) => {
    const debe = c.sales.reduce((s, v) => s + v.total, 0);
    const haber = c.payments.reduce((s, p) => s + p.amount, 0);
    const saldo = debe - haber;
    // @ts-ignore
    delete c.sales;
    // @ts-ignore
    delete c.payments;
    return { ...c, saldo };
  });
  return NextResponse.json(withSaldo);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const body = await req.json();
  const c = await db.customer.create({
    data: {
      name: body.name,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      city: body.city || null,
      notes: body.notes || null,
      cuit: normalizeCuit(body.cuit),
      taxType: normalizeTaxType(body.taxType) || "CONSUMIDOR_FINAL",
      creditLimit: Number(body.creditLimit) || 0,
      storeId: u.storeId,
    },
  });
  return NextResponse.json(c);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const body = await req.json();
  const c = await db.customer.update({
    where: { id: body.id },
    data: {
      name: body.name,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      city: body.city || null,
      notes: body.notes || null,
      cuit: normalizeCuit(body.cuit),
      taxType: normalizeTaxType(body.taxType) || "CONSUMIDOR_FINAL",
      creditLimit: Number(body.creditLimit) || 0,
    },
  });
  return NextResponse.json(c);
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
  await db.customer.delete({ where: { id, storeId: u.storeId } });
  return NextResponse.json({ ok: true });
}
