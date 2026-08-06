/**
 * Capa de persistencia del carrito de ventas usando IndexedDB.
 *
 * DISEÑO ROBUSTO:
 * - Usa la base de datos existente `comerciapp-offline` (compartida con el SW).
 * - Usa el object store `drafts` que ya estaba creado en use-pwa.ts pero sin usar.
 * - Multi-tenant: la key incluye `storeId` y `userId` para que cada cajero en
 *   cada tienda tenga su propio carrito persistente.
 * - Multi-dispositivo: si el mismo usuario abre la app en 2 pestañas, ambas
 *   leen el mismo draft (sync vía storage event + manual refresh).
 * - Versionado: cada draft tiene `version` y `schema` para futuras migraciones.
 * - Sanitización al restaurar: si un producto fue borrado o cambió de precio
 *   desde que se guardó el carrito, se reconcilia al cargar.
 * - TTL: drafts > 7 días se consideran stale y se eliminan automáticamente.
 * - Debounce implícito: las escrituras se hacen transaccionalmente, IDB
 *   encola operaciones, no bloquean el UI thread.
 *
 * NO usa localStorage porque:
 *  - localStorage es sincrónico y bloquea el main thread.
 *  - localStorage tiene límite de 5MB (un carrito con 100 productos + imágenes
 *    como base64 podría acercarse).
 *  - localStorage no soporta transacciones (race conditions entre pestañas).
 *  - IndexedDB tiene soporte nativo para structured clone (objetos complejos).
 */

import type { Product, CartItem } from "@/lib/types";

export type { CartItem } from "@/lib/types";

export interface CartDraft {
  /** Key única: `cart:${storeId}:${userId}` */
  key: string;
  /** Items del carrito */
  items: CartItem[];
  /** ID del cliente seleccionado */
  customerId: string;
  /** Descuento manual aplicado */
  discount: number;
  /** ID del método de pago seleccionado */
  paymentMethodId: string;
  /** Notas de la venta */
  notes: string;
  /** ID de la sucursal seleccionada */
  branchId: string;
  /** Timestamp de última actualización (ms epoch) */
  updatedAt: number;
  /** Timestamp de creación (ms epoch) */
  createdAt: number;
  /** Versión del schema (para migraciones futuras) */
  schemaVersion: number;
}

const DB_NAME = "comerciapp-offline";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
const SCHEMA_VERSION = 1;
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

// ─── Utilidades internas ──────────────────────────────────────────────────────

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined" &&
    // Excluir contextos de test / SSR donde IDB existe pero no queremos escribir.
    !navigator.userAgent.includes("jsdom")
  );
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB not available in this environment"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      // El store `drafts` ya debería existir por use-pwa.ts, pero por si
      // acaso (ej: browser nuevo, SW no registrado todavía), lo creamos.
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

export function cartDraftKey(storeId: string, userId: string): string {
  if (!storeId || !userId) {
    throw new Error("storeId y userId son requeridos para la key del draft");
  }
  return `cart:${storeId}:${userId}`;
}

// ─── Operaciones públicas ────────────────────────────────────────────────────

/**
 * Carga el draft del carrito para un store+user.
 * Retorna `null` si no existe, expiró, o el schema es incompatible.
 *
 * Limpieza automática: si el draft expiró (> TTL), lo elimina.
 */
export async function loadCartDraft(
  storeId: string,
  userId: string
): Promise<CartDraft | null> {
  if (!isBrowser()) return null;
  try {
    const db = await openDB();
    const key = cartDraftKey(storeId, userId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = async () => {
        const draft = req.result as CartDraft | undefined;
        if (!draft) {
          resolve(null);
          return;
        }
        // Verificar TTL
        const age = Date.now() - draft.updatedAt;
        if (age > DRAFT_TTL_MS) {
          // Stale: eliminar y retornar null
          try {
            await deleteCartDraft(storeId, userId);
          } catch {
            // best-effort
          }
          resolve(null);
          return;
        }
        // Verificar schema version (migraciones futuras)
        if (draft.schemaVersion !== SCHEMA_VERSION) {
          // Por ahora solo hay v1, pero acá iría la lógica de migración.
          // Si el schema es mayor al conocido, descartamos por seguridad.
          if (draft.schemaVersion > SCHEMA_VERSION) {
            await deleteCartDraft(storeId, userId);
            resolve(null);
            return;
          }
        }
        resolve(draft);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[cart-storage] loadCartDraft failed:", err);
    return null;
  }
}

/**
 * Guarda el draft del carrito. Sobrescribe si ya existe.
 * Actualiza `updatedAt` automáticamente.
 */
export async function saveCartDraft(
  storeId: string,
  userId: string,
  data: Omit<CartDraft, "key" | "updatedAt" | "createdAt" | "schemaVersion">,
  existingCreatedAt?: number
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDB();
    const key = cartDraftKey(storeId, userId);
    const now = Date.now();
    const draft: CartDraft = {
      key,
      ...data,
      createdAt: existingCreatedAt ?? now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(draft);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[cart-storage] saveCartDraft failed:", err);
  }
}

/**
 * Elimina el draft del carrito (después de una venta exitosa o por limpieza).
 */
export async function deleteCartDraft(
  storeId: string,
  userId: string
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDB();
    const key = cartDraftKey(storeId, userId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[cart-storage] deleteCartDraft failed:", err);
  }
}

/**
 * Reconcilia el draft guardado contra el estado actual de productos.
 *
 * Casos que maneja:
 *  - Producto fue borrado → se quita del carrito.
 *  - Producto cambió de precio → se actualiza al precio actual.
 *  - Producto cambió de stock → se ajusta la cantidad (si qty > stock, se limita).
 *  - Producto fue desactivado → se quita del carrito.
 *  - Producto cambió de nombre/marca → se actualizan los datos.
 *
 * Retorna el draft reconciliado + info de qué cambió (para mostrar al usuario).
 */
export interface ReconcileResult {
  items: CartItem[];
  removedCount: number;
  adjustedCount: number;
  removedProductNames: string[];
}

export function reconcileDraft(
  draft: CartDraft,
  currentProducts: Product[]
): ReconcileResult {
  const productMap = new Map(currentProducts.map((p) => [p.id, p]));
  const removedProductNames: string[] = [];
  let adjustedCount = 0;

  const items: CartItem[] = [];

  for (const draftItem of draft.items) {
    const current = productMap.get(draftItem.product.id);
    if (!current || !current.active) {
      removedProductNames.push(draftItem.product.name);
      continue;
    }
    // Clamp qty al stock actual
    let qty = draftItem.qty;
    if (qty > current.stock) {
      qty = Math.max(0, current.stock);
      if (qty === 0) {
        removedProductNames.push(current.name);
        continue;
      }
      adjustedCount++;
    }
    // Detectar cambios de precio para info al usuario
    if (current.salePrice !== draftItem.product.salePrice) {
      adjustedCount++;
    }
    items.push({ product: current, qty });
  }

  return {
    items,
    removedCount: draft.items.length - items.length,
    adjustedCount,
    removedProductNames,
  };
}
