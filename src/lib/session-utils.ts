import { NextResponse } from "next/server";

/**
 * Utilidades para validación de sesión en API routes.
 *
 * Problema que resuelve:
 *   Algunos endpoints llaman directamente `db.xxx.create({ data: { storeId, ... } })`
 *   con `storeId = u.storeId` SIN validar que storeId sea un string válido.
 *   Si el JWT del usuario no tiene storeId (sesión vieja, usuario creado
 *   sin storeId, token corrupto, etc.), Prisma recibe `storeId: undefined`
 *   y devuelve un error críptico de validación que el usuario no entiende.
 *
 * Solución:
 *   Validar storeId ANTES de tocar la DB y devolver un error 403 claro
 *   con instrucciones accionables ("cerrá sesión y volvé a entrar").
 *
 * Uso:
 *   ```ts
 *   import { requireStoreId } from "@/lib/session-utils";
 *
 *   const u = session.user as any;
 *   const storeId = u.storeId;
 *   const err = requireStoreId(storeId);
 *   if (err) return err;
 *   ```
 */

const ERROR_BODY = {
  error:
    "Tu sesión no tiene un comercio asociado (storeId). " +
    "Cerrá sesión y volvé a entrar. Si el problema persiste, " +
    "contactá al administrador para verificar tu usuario.",
};

/**
 * Devuelve un NextResponse 403 si storeId no es válido, o null si está OK.
 * Uso: `const err = requireStoreId(u.storeId); if (err) return err;`
 */
export function requireStoreId(
  storeId: unknown
): NextResponse | null {
  if (typeof storeId === "string" && storeId.length > 0) {
    return null;
  }
  return NextResponse.json(ERROR_BODY, { status: 403 });
}
