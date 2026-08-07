import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * ENDPOINT DE DEBUG TEMPORAL.
 *
 * Devuelve información sobre la sesión actual + el usuario en la DB.
 * Esto nos permite diagnosticar por qué storeId no está llegando al
 * endpoint de products.
 *
 * ⚠️ NO dejar en producción — expone info sensible.
 * Borrar o deshabilitar después de diagnosticar.
 */
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({
      ok: false,
      message: "No hay sesión activa",
      hint: "Iniciá sesión primero.",
    });
  }

  const u = session.user as any;

  let dbUser: any = null;
  try {
    dbUser = await db.user.findUnique({
      where: { email: u.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        storeId: true,
        store: { select: { id: true, name: true, rubro: true } },
      },
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      message: "Error consultando DB",
      error: e?.message,
    });
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    session: {
      hasSession: true,
      userId: u.id ?? null,
      email: u.email ?? null,
      name: u.name ?? null,
      role: u.role ?? null,
      storeId: u.storeId ?? null,
      storeName: u.storeName ?? null,
      storeRubro: u.storeRubro ?? null,
      keys: Object.keys(u),
    },
    database: {
      userFound: !!dbUser,
      userId: dbUser?.id ?? null,
      email: dbUser?.email ?? null,
      role: dbUser?.role ?? null,
      active: dbUser?.active ?? null,
      storeId: dbUser?.storeId ?? null,
      store: dbUser?.store ?? null,
    },
    diagnosis: (() => {
      if (!dbUser) return { status: "BROKEN", message: "Usuario no encontrado en DB" };
      if (!dbUser.active) return { status: "BROKEN", message: "Usuario inactivo en DB" };
      if (!dbUser.storeId) {
        return {
          status: "BROKEN",
          message: "El usuario en la DB no tiene storeId asignado.",
          fix: "Hay que asignarle un storeId al usuario manualmente.",
        };
      }
      if (!u.storeId) {
        return {
          status: "JWT_STALE",
          message: "El usuario en la DB tiene storeId pero el JWT no. Sesión obsoleta.",
          fix: "Hacé logout COMPLETO y volvé a entrar.",
        };
      }
      return {
        status: "OK",
        message: "Todo bien, storeId está en sesión y en DB",
      };
    })(),
  });
}
