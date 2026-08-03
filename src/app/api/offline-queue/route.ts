import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/offline-queue - listar operaciones pendientes de sync (solo lectura, server-side)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const queue = await db.offlineSyncQueue.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(queue);
}

// POST /api/offline-queue - registrar operación sincronizada desde el cliente
// Body: { entity, action, payload, endpoint, method, tempId, syncedId, status }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { entity, action, payload, endpoint, method, tempId, syncedId, status } = body;

  if (!entity || !action || !endpoint) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const record = await db.offlineSyncQueue.create({
    data: {
      storeId,
      userId: u.id,
      entity,
      action,
      payload: typeof payload === "string" ? payload : JSON.stringify(payload || {}),
      endpoint,
      method: method || "POST",
      tempId: tempId || null,
      syncedId: syncedId || null,
      status: status || "SYNCED",
      syncedAt: status === "SYNCED" ? new Date() : null,
    },
  });

  return NextResponse.json(record);
}

// DELETE /api/offline-queue?status=SYNCED - limpiar registros ya sincronizados
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const url = new URL(req.url);
  const beforeDays = Number(url.searchParams.get("beforeDays") || 7);

  const cutoff = new Date(Date.now() - beforeDays * 24 * 60 * 60 * 1000);
  const result = await db.offlineSyncQueue.deleteMany({
    where: {
      storeId: u.storeId,
      status: "SYNCED",
      createdAt: { lt: cutoff },
    },
  });

  return NextResponse.json({ deleted: result.count });
}
