import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: obtener configuración MP
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const config = await db.mercadoPagoConfig.findUnique({ where: { storeId } });

  // Ocultar tokens sensibles en GET (solo indicar si están configurados)
  if (!config) return NextResponse.json(null);

  return NextResponse.json({
    ...config,
    accessToken: config.accessToken ? "***CONFIGURADO***" : null,
    sandboxAccessToken: config.sandboxAccessToken ? "***CONFIGURADO***" : null,
  });
}

// PUT: actualizar o crear configuración MP
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const storeId = u.storeId;

  const body = await req.json();

  const existing = await db.mercadoPagoConfig.findUnique({ where: { storeId } });

  const data: any = {
    environment: body.environment ?? existing?.environment ?? "sandbox",
    userId: body.userId ?? existing?.userId ?? null,
    collectorId: body.collectorId ?? existing?.collectorId ?? null,
    qrEnabled: body.qrEnabled ?? existing?.qrEnabled ?? true,
    defaultDescription: body.defaultDescription ?? existing?.defaultDescription ?? null,
    active: body.active ?? existing?.active ?? true,
  };

  // Solo actualizar tokens si vienen valores reales (no "***CONFIGURADO***")
  if (body.accessToken && !body.accessToken.startsWith("***")) {
    data.accessToken = body.accessToken;
  }
  if (body.publicKey && !body.publicKey.startsWith("***")) {
    data.publicKey = body.publicKey;
  }
  if (body.sandboxAccessToken && !body.sandboxAccessToken.startsWith("***")) {
    data.sandboxAccessToken = body.sandboxAccessToken;
  }
  if (body.sandboxPublicKey && !body.sandboxPublicKey.startsWith("***")) {
    data.sandboxPublicKey = body.sandboxPublicKey;
  }

  let result;
  if (existing) {
    result = await db.mercadoPagoConfig.update({
      where: { storeId },
      data,
    });
  } else {
    result = await db.mercadoPagoConfig.create({
      data: { storeId, ...data },
    });
  }

  return NextResponse.json({
    ...result,
    accessToken: result.accessToken ? "***CONFIGURADO***" : null,
    sandboxAccessToken: result.sandboxAccessToken ? "***CONFIGURADO***" : null,
  });
}
