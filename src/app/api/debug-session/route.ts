import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getAuthOptions } from "@/lib/auth";
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
  // Probamos AMBAS formas:
  // 1. authOptions (proxy lazy) — la que usan todos los endpoints
  // 2. getAuthOptions() directo — bypass del proxy
  // Si la #2 funciona y la #1 no, el proxy está roto.
  const sessionViaProxy = await getServerSession(authOptions);
  const sessionViaDirect = await getServerSession(getAuthOptions());

  const uProxy = sessionViaProxy?.user as any;
  const uDirect = sessionViaDirect?.user as any;

  // Buscar el usuario en la DB
  const email = uProxy?.email || uDirect?.email;
  let dbUser: any = null;
  if (email) {
    try {
      dbUser = await db.user.findUnique({
        where: { email: email.toLowerCase() },
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
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    test: {
      // Comparamos las dos formas
      viaProxy: {
        hasSession: !!uProxy,
        storeId: uProxy?.storeId ?? null,
        role: uProxy?.role ?? null,
        keys: uProxy ? Object.keys(uProxy) : [],
      },
      viaDirect: {
        hasSession: !!uDirect,
        storeId: uDirect?.storeId ?? null,
        role: uDirect?.role ?? null,
        keys: uDirect ? Object.keys(uDirect) : [],
      },
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

      const proxyWorks = !!uProxy?.storeId;
      const directWorks = !!uDirect?.storeId;

      if (proxyWorks && directWorks) {
        return {
          status: "OK",
          message: "Ambas formas funcionan. Recargá la página de productos.",
        };
      }
      if (!proxyWorks && directWorks) {
        return {
          status: "PROXY_BROKEN",
          message:
            "El Proxy en auth.ts está rompiendo los callbacks de NextAuth. " +
            "authOptions (proxy) NO propaga storeId, pero getAuthOptions() directo sí.",
          fix: "Hay que eliminar el Proxy y exportar authOptions directamente.",
        };
      }
      if (!proxyWorks && !directWorks) {
        return {
          status: "JWT_STALE",
          message:
            "Ninguna forma funciona. El JWT está completamente vacío de campos custom.",
          fix:
            "El problema está en el callback jwt() o authorize(). " +
            "Posiblemente el JWT se generó antes del deploy y nunca se regeneró.",
        };
      }
      return { status: "UNKNOWN", message: "Estado no clasificado" };
    })(),
  });
}

