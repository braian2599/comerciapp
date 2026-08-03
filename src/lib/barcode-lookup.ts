/**
 * Barcode lookup service.
 *
 * Consulta bases de datos públicas de productos para autocompletar
 * el formulario de carga a partir del código de barras (EAN/UPC).
 *
 * Fuentes (en orden de prioridad):
 *  1. Open Food Facts — gratis, sin auth, cobertura global.
 *     https://world.openfoodfacts.org/api/v2/product/{barcode}.json
 *  2. UPC Item DB — gratis (trial), sin auth, buena cobertura para
 *     productos de Amazon / retail internacional.
 *     https://api.upcitemdb.com/prod/trial/lookup/{barcode}
 *
 * La respuesta se normaliza a un objeto `ProductLookupResult` único.
 */

export interface ProductLookupResult {
  found: boolean;
  source: "openfoodfacts" | "upcitemdb" | "none";
  barcode: string;
  name?: string;
  brand?: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  /** Precio sugerido si alguna fuente lo trae (en general no viene). */
  suggestedPrice?: number;
  /** Cantidad típica por pack (ej: "500ml", "6u"). */
  quantity?: string;
  raw?: any;
}

const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Open Food Facts — base de datos colaborativa de alimentos y productos. */
async function lookupOpenFoodFacts(barcode: string): Promise<ProductLookupResult | null> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
      barcode
    )}.json?fields=product_name,product_name_es,product_name_en,generic_name,brands,categories,image_url,image_front_url,image_front_small_url,quantity,quantity_value,quantity_unit,compared_to_category`;
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "ComerciApp/1.0 (pos lookup)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const name =
      p.product_name_es || p.product_name || p.product_name_en || p.generic_name || "";
    if (!name) return null;
    const imageUrl = p.image_front_url || p.image_url || p.image_front_small_url || "";
    return {
      found: true,
      source: "openfoodfacts",
      barcode,
      name,
      brand: p.brands ? String(p.brands).split(",")[0].trim() : undefined,
      description: p.generic_name || undefined,
      category: p.categories
        ? String(p.categories).split(",")[0].trim()
        : undefined,
      imageUrl: imageUrl || undefined,
      quantity: p.quantity || undefined,
      raw: p,
    };
  } catch {
    return null;
  }
}

/** UPC Item DB — base de datos internacional de productos por UPC. */
async function lookupUpcItemDb(barcode: string): Promise<ProductLookupResult | null> {
  try {
    const url = `https://api.upcitemdb.com/prod/trial/lookup/${encodeURIComponent(barcode)}`;
    const res = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ComerciApp/1.0",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.code !== "OK" || !Array.isArray(data.items) || data.items.length === 0) {
      return null;
    }
    const item = data.items[0];
    const name = item.title || item.description || "";
    if (!name) return null;
    return {
      found: true,
      source: "upcitemdb",
      barcode,
      name,
      brand: item.brand || undefined,
      description: item.description || undefined,
      category: item.category || undefined,
      imageUrl: item.images && item.images.length > 0 ? item.images[0] : undefined,
      quantity: item.dimension || undefined,
      raw: item,
    };
  } catch {
    return null;
  }
}

/**
 * Ejecuta el lookup completo: primero Open Food Facts, y si no encuentra,
 * prueba con UPC Item DB. Devuelve siempre un objeto (con `found: false`
 * si ningún servicio tiene el producto).
 */
export async function lookupProductByBarcode(
  barcode: string
): Promise<ProductLookupResult> {
  const code = (barcode || "").trim();
  if (!code) {
    return { found: false, source: "none", barcode: "" };
  }

  // Intentamos primero Open Food Facts (más rápido y sin límite estricto).
  const off = await lookupOpenFoodFacts(code);
  if (off && off.found) return off;

  // Fallback a UPC Item DB.
  const upc = await lookupUpcItemDb(code);
  if (upc && upc.found) return upc;

  return { found: false, source: "none", barcode: code };
}

/**
 * Valida el código de barras con el dígito verificador EAN/UPC.
 * Acepta EAN-8, EAN-13, UPC-A (12) y UPC-E (8).
 */
export function isValidBarcode(code: string): boolean {
  const c = (code || "").trim();
  if (!/^\d+$/.test(c)) return false;
  const len = c.length;
  if (len !== 8 && len !== 12 && len !== 13) return false;

  // EAN-13 / EAN-8: posiciones pares*3, impares*1 (desde la derecha, sin DV).
  // UPC-A: igual que EAN-13 pero con 12 dígitos.
  const digits = c.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  let parity = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += digits[i] * (parity === 0 ? 3 : 1);
    parity ^= 1;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}
