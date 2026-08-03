/**
 * Utilidades para llamadas fetch seguras desde el cliente.
 *
 * El problema que resuelve:
 *   `await res.json()` falla con "Unexpected end of JSON input" cuando
 *   el servidor devuelve una respuesta sin cuerpo (204, 500 vacío, o
 *   HTML plano si el runtime de Next.js crashea antes de devolver JSON).
 *
 * Estas helpers garantizan que el cliente siempre reciba un objeto
 * JavaScript interpretable, sin tirar excepciones por parseo.
 */

export interface SafeResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/**
 * Hace fetch + parsea JSON de forma segura.
 *
 * - Si el body está vacío o no es JSON válido, `data` es `null`.
 * - Si la respuesta no es ok (status >= 400), devuelve `ok: false` y
 *   `error` con el mensaje del servidor (o uno genérico).
 * - Nunca tira excepción por parseo. Solo tira si el propio `fetch`
 *   falla (problema de red).
 *
 * Uso:
 *   const { ok, data, error } = await safeFetchJSON("/api/products", {
 *     method: "POST",
 *     body: JSON.stringify(payload),
 *   });
 *   if (!ok) toast.error(error);
 */
export async function safeFetchJSON<T = any>(
  url: string,
  init?: RequestInit
): Promise<SafeResponse<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        // Por defecto enviamos JSON; el caller puede sobreescribir.
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: e?.message || "Error de red",
    };
  }

  // Leer el body como texto SIEMPRE (no llamar a .json() directo).
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const error =
      (data && typeof data === "object" && (data as any).error) ||
      `Error del servidor (${res.status})`;
    return { ok: false, status: res.status, data, error };
  }

  return { ok: true, status: res.status, data };
}

/**
 * Helper específico para GET que devuelve un array.
 * Si la respuesta no es un array, devuelve `fallback` (por defecto []).
 */
export async function safeFetchArray<T = any>(
  url: string,
  fallback: T[] = []
): Promise<T[]> {
  const { ok, data } = await safeFetchJSON<T[]>(url);
  if (!ok || !Array.isArray(data)) return fallback;
  return data;
}
