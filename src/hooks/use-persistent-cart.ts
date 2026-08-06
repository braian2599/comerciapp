"use client";

/**
 * Hook de persistencia del carrito de POS.
 *
 * RESPONSABILIDADES:
 *  1. Cargar el draft guardado al montar el componente (load).
 *  2. Guardar cambios en el carrito con debounce (auto-save).
 *  3. Reconciliar el draft contra productos actuales al restaurar
 *     (productos borrados, stock cambiado, precios cambiados).
 *  4. Eliminar el draft cuando se completa la venta (clear).
 *  5. Sincronizar entre pestañas vía el evento `storage` (no aplica a
 *     IndexedDB directamente, pero exponemos un mecanismo manual).
 *
 * DISEÑO:
 * - Debounce de 800ms para no escribir en cada keystroke.
 * - Solo guarda si hay items en el carrito. Si está vacío, elimina el draft.
 * - El hook NO maneja el estado del carrito — eso lo hace pos-view.tsx con
 *   useState. Este hook observa los cambios y persiste.
 * - Retorna info útil para UI: estado de carga, si hay draft recuperable,
 *   y métricas de reconciliación.
 *
 * USO:
 *   const { isRestoring, draftInfo, clearPersisted } = usePersistentCart({
 *     storeId, userId,
 *     cart, customerId, discount, paymentMethodId, notes, branchId,
 *     products, onRestore,
 *   });
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  loadCartDraft,
  saveCartDraft,
  deleteCartDraft,
  reconcileDraft,
  type CartDraft,
  type ReconcileResult,
} from "@/lib/cart-storage";
import type { CartItem, Product } from "@/lib/types";

export interface UsePersistentCartParams {
  storeId?: string;
  userId?: string;
  cart: CartItem[];
  customerId: string;
  discount: number;
  paymentMethodId: string;
  notes: string;
  branchId: string;
  /** Lista de productos actuales (para reconciliar stock/precios al restaurar) */
  products: Product[];
  /** Se llama cuando se encuentra un draft recuperable al montar */
  onRestore: (data: {
    items: CartItem[];
    customerId: string;
    discount: number;
    paymentMethodId: string;
    notes: string;
    branchId: string;
  }) => void;
}

export interface UsePersistentCartReturn {
  /** true mientras se intenta cargar el draft inicial */
  isRestoring: boolean;
  /** Si hubo draft recuperable y se aplicó, info de reconciliación */
  reconcileInfo: ReconcileResult | null;
  /** true si el último guardado fue exitoso (para indicador UI) */
  isSaved: boolean;
  /** Limpia el draft persistido (llamar después de venta exitosa) */
  clearPersisted: () => Promise<void>;
  /** Descarta el draft sin aplicarlo (usuario eligió "no restaurar") */
  discardPersisted: () => Promise<void>;
}

export function usePersistentCart(
  params: UsePersistentCartParams
): UsePersistentCartReturn {
  const {
    storeId,
    userId,
    cart,
    customerId,
    discount,
    paymentMethodId,
    notes,
    branchId,
    products,
    onRestore,
  } = params;

  const [isRestoring, setIsRestoring] = useState(true);
  const [reconcileInfo, setReconcileInfo] = useState<ReconcileResult | null>(
    null
  );
  const [isSaved, setIsSaved] = useState(false);

  // Refs para evitar re-renders y stale closures
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftCreatedAtRef = useRef<number | undefined>(undefined);
  const hasRestoredRef = useRef(false);
  const skipNextSaveRef = useRef(false);

  // ─── CARGA INICIAL ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId || !userId) {
      setIsRestoring(false);
      return;
    }
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const draft = await loadCartDraft(storeId, userId);
        if (cancelled || !draft) {
          setIsRestoring(false);
          return;
        }
        // Reconciliar contra productos actuales
        const result = reconcileDraft(draft, products);
        if (cancelled) return;

        if (result.items.length === 0) {
          // El draft no tenía items válidos después de reconciliar → descartar
          await deleteCartDraft(storeId, userId);
          setIsRestoring(false);
          return;
        }

        // Guardar createdAt para no sobrescribirlo en el próximo save
        draftCreatedAtRef.current = draft.createdAt;

        // Aplicar al estado del componente padre
        onRestore({
          items: result.items,
          customerId: draft.customerId || "",
          discount: draft.discount || 0,
          paymentMethodId: draft.paymentMethodId || "",
          notes: draft.notes || "",
          branchId: draft.branchId || "",
        });

        setReconcileInfo(result);
        // Skip del próximo auto-save porque ya tenemos el estado actualizado
        skipNextSaveRef.current = true;
        setIsSaved(true);
      } catch (err) {
        console.warn("[use-persistent-cart] restore failed:", err);
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, userId]);

  // ─── AUTO-SAVE CON DEBOUNCE ──────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId || !userId) return;
    if (isRestoring) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    // Limpiar timer anterior
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    // Si el carrito quedó vacío, eliminar el draft
    if (cart.length === 0) {
      saveTimerRef.current = setTimeout(async () => {
        await deleteCartDraft(storeId, userId);
        draftCreatedAtRef.current = undefined;
        setIsSaved(false);
      }, 500);
      return;
    }

    // Debounce 800ms antes de escribir
    saveTimerRef.current = setTimeout(async () => {
      await saveCartDraft(
        storeId,
        userId,
        {
          items: cart,
          customerId,
          discount,
          paymentMethodId,
          notes,
          branchId,
        },
        draftCreatedAtRef.current
      );
      setIsSaved(true);
      // Reset del flag "saved" después de 2s para que el indicador UI desaparezca
      setTimeout(() => setIsSaved(false), 2000);
    }, 800);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [
    storeId,
    userId,
    cart,
    customerId,
    discount,
    paymentMethodId,
    notes,
    branchId,
    isRestoring,
  ]);

  // ─── CLEANUP AL UNMOUNT ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const clearPersisted = useCallback(async () => {
    if (!storeId || !userId) return;
    await deleteCartDraft(storeId, userId);
    draftCreatedAtRef.current = undefined;
    setIsSaved(false);
    setReconcileInfo(null);
  }, [storeId, userId]);

  const discardPersisted = useCallback(async () => {
    if (!storeId || !userId) return;
    await deleteCartDraft(storeId, userId);
    draftCreatedAtRef.current = undefined;
    setReconcileInfo(null);
  }, [storeId, userId]);

  return {
    isRestoring,
    reconcileInfo,
    isSaved,
    clearPersisted,
    discardPersisted,
  };
}
