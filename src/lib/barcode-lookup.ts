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

// ---------------------------------------------------------------------------
// Helpers para construir un nombre legible a partir de los campos de OFF
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "con", "sin", "el", "la", "los", "las", "de", "del", "y", "o", "u",
  "en", "para", "elaborada", "elaborado", "producto", "tipo", "based",
]);

const GENERIC_CATEGORIES = new Set([
  // ES
  "alimentos", "comidas", "bebidas", "productos", "alimenticios",
  // EN
  "beverages", "alimentos", "food", "foods", "drinks", "products",
  "groceries", "snacks",
  // FR
  "aliments", "boissons", "produits",
  // PT
  "alimentos", "bebidas", "produtos",
]);

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Limpia un string de categoría:
 *  - quita prefijos de idioma ("pt:", "en:", "es:", "fr:")
 *  - recorta espacios
 */
function cleanCategory(c: string): string {
  return c.trim().replace(/^[a-z]{2}:/i, "").trim();
}

/**
 * Verifica si un texto parece estar en español (o al menos no en
 * francés/portugués). Se usa para filtrar categorías que no aportarían
 * valor al usuario hispanohablante.
 */
function looksSpanish(s: string): boolean {
  // El español usa á, é, í, ó, ú, ñ, ü. Cualquier otro acento indica otro idioma.
  return !/[âêîôûçãõàù]/i.test(s);
}

/**
 * Filtra las categorías y devuelve la más específica y corta (1-2 palabras)
 * que NO sea genérica. Recorre de la más específica (última) a la más general.
 */
function pickUsableCategory(categoriesRaw: string): string {
  const cats = categoriesRaw
    .split(",")
    .map(cleanCategory)
    .filter((c) => {
      if (!c || c.length < 4) return false;
      if (/^[\d:]/.test(c)) return false;
      const words = c.split(/\s+/);
      if (words.length > 2) return false; // descarta categorías largas
      if (GENERIC_CATEGORIES.has(c.toLowerCase())) return false;
      if (!looksSpanish(c)) return false; // descarta francés/portugués
      return true;
    });
  // Recorremos de la más específica (última) hacia atrás.
  for (let i = cats.length - 1; i >= 0; i--) {
    return cats[i];
  }
  return "";
}

/**
 * Normaliza una cantidad a formato compacto:
 *  "500 gramos" → "500g"
 *  "1 kilo"     → "1kg"
 *  "1.5 litros" → "1.5L"
 *  "33 cl"      → "330ml"
 *  "500g"       → "500g"
 */
function normalizeQuantity(q: string): string {
  if (!q) return "";
  let s = q.trim().toLowerCase();
  // Centilitros → mililitros
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*cl\b/g, (_m, n) => {
    const v = Number(String(n).replace(",", ".")) * 10;
    return `${v}ml`;
  });
  // Litros
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(litros|litro|lts|lt|l)\b/g, (_m, n) => `${n}l`);
  // Kilogramos
  s = s.replace(
    /(\d+(?:[.,]\d+)?)\s*(kilogramos|kilogramo|kilos|kilo|kg)\b/g,
    (_m, n) => `${n}kg`
  );
  // Gramos
  s = s.replace(
    /(\d+(?:[.,]\d+)?)\s*(gramos|gramo|grs|gr)\b/g,
    (_m, n) => `${n}g`
  );
  // Mililitros
  s = s.replace(
    /(\d+(?:[.,]\d+)?)\s*(mililitros|mililitro|ml|cc)\b/g,
    (_m, n) => `${n}ml`
  );
  // Unidades sueltas que quedaron: "400 g" → "400g", "1 L" → "1L"
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(g|kg|l|ml)\b/g, "$1$2");
  // Compactar espacios
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Detecta si un `product_name` parece ser solo la marca (sin tipo de producto).
 * Ej: "PLAYADITO" → true, "Yerba mate especial" → false, "coca-cola" → false.
 */
function looksLikeJustBrand(name: string): boolean {
  if (!name) return false;
  if (name.length > 18) return false;
  if (name.includes(" ")) return false;
  // Si tiene guion bajo/medio, probablemente ya es un nombre completo
  if (/[-_]/.test(name)) return false;
  return true;
}

/**
 * Construye un nombre de producto completo y legible a partir de los
 * campos disponibles en Open Food Facts.
 *
 * Estrategia:
 *  - Si `product_name` ya contiene una palabra del tipo de producto
 *    (de la categoría o del generic_name), usarlo tal cual.
 *  - Si `product_name` parece ser solo la marca (palabra corta sin espacios)
 *    → prependear la categoría específica ("Yerba mate PLAYADITO").
 *  - Si `product_name` está vacío → construir desde generic + brand.
 *  - Appendear la cantidad normalizada si no está ya incluida.
 */
function buildDisplayName(p: any): string {
  const rawName = (p.product_name_es || p.product_name || p.product_name_en || "").trim();
  const generic = (p.generic_name || "").trim();
  const brands = p.brands ? String(p.brands).split(",")[0].trim() : "";
  const quantity = (p.quantity || "").trim();
  const usableCategory = p.categories ? pickUsableCategory(String(p.categories)) : "";

  // Palabras significativas del tipo de producto (de la categoría y del generic)
  const typeWords = new Set<string>();
  for (const src of [usableCategory, generic]) {
    if (!src) continue;
    for (const w of src.toLowerCase().split(/\s+/)) {
      if (w.length > 3 && !STOP_WORDS.has(w)) typeWords.add(w);
    }
  }

  const nameLower = rawName.toLowerCase();
  const nameContainsType = Array.from(typeWords).some((w) => nameLower.includes(w));

  let baseName = "";

  if (!rawName) {
    // Sin nombre → construir desde cero
    if (generic && brands) baseName = `${capitalize(generic)} ${brands}`;
    else if (usableCategory && brands) baseName = `${capitalize(usableCategory)} ${brands}`;
    else if (generic) baseName = capitalize(generic);
    else if (brands) baseName = brands;
    else if (usableCategory) baseName = capitalize(usableCategory);
  } else if (nameContainsType) {
    // El nombre ya tiene el tipo de producto (ej: "Yerba mate especial")
    baseName = rawName;
  } else if (looksLikeJustBrand(rawName) && generic && looksSpanish(generic)) {
    // El nombre es solo la marca Y hay generic_name en español →
    // prependear la categoría (si existe y está en español) o las primeras
    // palabras del generic_name.
    if (usableCategory) {
      baseName = `${capitalize(usableCategory)} ${rawName}`;
    } else {
      const shortGeneric = generic.split(/\s+/).slice(0, 3).join(" ");
      baseName = `${capitalize(shortGeneric)} ${rawName}`;
    }
  } else {
    // Si el nombre parece marca pero no hay generic en español, dejamos
    // el nombre tal cual (evita prependear categorías en otros idiomas).
    baseName = rawName;
  }

  // Appendear cantidad si no está ya en el nombre
  if (quantity && baseName) {
    const normalizedQty = normalizeQuantity(quantity);
    if (normalizedQty && !baseName.toLowerCase().includes(normalizedQty.toLowerCase())) {
      baseName = `${baseName} ${normalizedQty}`;
    }
  }

  return baseName.trim();
}

/**
 * Construye una descripción enriquecida:
 *  - Si hay generic_name, usarlo completo (es lo más descriptivo).
 *  - Si no, combinar marca + categoría.
 */
function buildDescription(p: any): string {
  const parts: string[] = [];
  if (p.generic_name) parts.push(String(p.generic_name).trim());
  if (p.brands) {
    const brand = String(p.brands).split(",")[0].trim();
    if (brand) parts.push(`Marca: ${brand}`);
  }
  return parts.filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------

/** Open Food Facts — base de datos colaborativa de alimentos y productos. */
async function lookupOpenFoodFacts(barcode: string): Promise<ProductLookupResult | null> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
      barcode
    )}.json?fields=product_name,product_name_es,product_name_en,generic_name,brands,categories,image_url,image_front_url,image_front_small_url,quantity,product_quantity,quantity_value,quantity_unit,compared_to_category`;
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

    const displayName = buildDisplayName(p);
    if (!displayName) return null;

    const imageUrl = p.image_front_url || p.image_url || p.image_front_small_url || "";
    const brand = p.brands ? String(p.brands).split(",")[0].trim() : undefined;
    const description = buildDescription(p);

    return {
      found: true,
      source: "openfoodfacts",
      barcode,
      name: displayName,
      brand: brand || undefined,
      description: description || undefined,
      category: p.categories
        ? cleanCategory(String(p.categories).split(",").pop() || "")
        : undefined,
      imageUrl: imageUrl || undefined,
      quantity: p.quantity ? normalizeQuantity(String(p.quantity)) : undefined,
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
