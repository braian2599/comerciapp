"use client";

/**
 * Hook de persistencia del carrito de POS.
 *
 * RESPONSABILIDADES:
 *  1. Cargar el draft guardado al montar el componente (load).
 *     ⚠️ Espera a que `productsReady=true` para poder reconciliar stock/precios.
 *  2. Guardar cambios en el carrito con debounce (auto-save).
 *  3. Reconciliar el draft contra productos actuales al restaurar
 *     (productos borrados, stock cambiado, precios cambiados).
 *  4. Eliminar el draft cuando se completa la venta (clear).
 *  5. Sincronizar entre pestañas vía BroadcastChannel (multi-tab sync).
 *  6. Guardar antes de cerrar la pestaña (visibilitychange / pagehide).
 *  7. Garbage collection de drafts de sesiones anteriores.
 *
 * DISEÑO:
 * - Debounce de 800ms para no escribir en cada keystroke.
 * - Solo guarda si hay items en el carrito. Si está vacío, elimina el draft.
 * - El hook NO maneja el estado del carrito — eso lo hace pos-view.tsx con
 *   useState. Este hook observa los cambios y persiste.
 * - Retorna info útil para UI: estado de carga, si hay draft recuperable,
 *   métricas de reconciliación, fecha del draft.
 *
 * USO:
 *   const {
 *     isRestoring,
 *     reconcileInfo,
 *     draftDate,
 *     isSaved,
 *     clearPersisted,
 *     discardPersisted,
 *     forceSaveNow,
 *   } = usePersistentCart({
 *     storeId, userId, productsReady,
 *     cart, customerId, discount, paymentMethodId, notes, branchId,
 *     products, onRestore, onRemoteUpdate,
 *   });
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  loadCartDraft,
  saveCartDraft,
  deleteCartDraft,
  reconcileDraft,
  cleanupOldDrafts,
  getCartBroadcastChannel,
  broadcastCartChange,
  type CartDraft,
  type ReconcileResult,
  type CartSyncMessage,
} from "@/lib/cart-storage";
import type { CartItem, Product } from "@/lib/types";

export interface UsePersistentCartParams {
  storeId?: string;
  userId?: string;
  /** true cuando `products` ya está cargado (para reconciliar al restaurar) */
  productsReady?: boolean;
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
  /**
   * Se llama cuando OTRA pestaña actualizó el draft del mismo store+user.
   * El componente padre puede decidir recargar el draft (o ignorar si el
   * usuario está editando activamente).
   */
  onRemoteUpdate?: (msg: CartSyncMessage) => void;
}

export interface UsePersistentCartReturn {
  /** true mientras se intenta cargar el draft inicial */
  isRestoring: boolean;
  /** Si hubo draft recuperable y se aplicó, info de reconciliación */
  reconcileInfo: ReconcileResult | null;
  /** Fecha de creación/actualización del draft recuperado (para UI) */
  draftDate: Date | null;
  /** true si el último guardado fue exitoso (para indicador UI) */
  isSaved: boolean;
  /** Limpia el draft persistido (llamar después de venta exitosa) */
  clearPersisted: () => Promise<void>;
  /** Descarta el draft sin aplicarlo (usuario eligió "no restaurar") */
  discardPersisted: () => Promise<void>;
  /** Guarda el draft inmediatamente (sin debounce) — usar antes de cerrar pestaña */
  forceSaveNow: () => Promise<void>;
}

export function usePersistentCart(
  params: UsePersistentCartParams
): UsePersistentCartReturn {
  const {
    storeId,
    userId,
    productsReady,
    cart,
    customerId,
    discount,
    paymentMethodId,
    notes,
    branchId,
    products,
    onRestore,
    onRemoteUpdate,
  } = params;

  const [isRestoring, setIsRestoring] = useState(true);
  const [reconcileInfo, setReconcileInfo] = useState<ReconcileResult | null>(
    null
  );
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // Refs para evitar re-renders y stale closures
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftCreatedAtRef = useRef<number | undefined>(undefined);
  const hasRestoredRef = useRef(false);
  const skipNextSaveRef = useRef(false);
  // Snapshot más reciente de los datos para guardarlos en forceSaveNow
  const snapshotRef = useRef({
    cart,
    customerId,
    discount,
    paymentMethodId,
    notes,
    branchId,
  });
  snapshotRef.current = {
    cart,
    customerId,
    discount,
    paymentMethodId,
    notes,
    branchId,
  };

  // ─── CARGA INICIAL ──────────────────────────────────────────────────────────
  // Espera a que productsReady=true antes de cargar, porque reconcileDraft
  // necesita la lista de productos actual para no eliminar todo.
  useEffect(() => {
    if (!storeId || !userId) {
      setIsRestoring(false);
      return;
    }
    if (!productsReady) return; // esperar
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    let cancelled = false;

    (async () => {
      // GC: limpiar drafts de sesiones anteriores en este navegador
      try {
        await cleanupOldDrafts(storeId, userId);
      } catch {
        // best-effort
      }

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
        setDraftDate(new Date(draft.updatedAt));

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

        // Notificar a otras pestañas que este tab ya restauró el draft
        broadcastCartChange({
          type: "draft-restored",
          storeId,
          userId,
        });
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
  }, [storeId, userId, productsReady]);

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

    const snapshot = snapshotRef.current;

    // Si el carrito quedó vacío, eliminar el draft
    if (snapshot.cart.length === 0) {
      saveTimerRef.current = setTimeout(async () => {
        await deleteCartDraft(storeId, userId);
        draftCreatedAtRef.current = undefined;
        setDraftDate(null);
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
          items: snapshot.cart,
          customerId: snapshot.customerId,
          discount: snapshot.discount,
          paymentMethodId: snapshot.paymentMethodId,
          notes: snapshot.notes,
          branchId: snapshot.branchId,
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

  // ─── MULTI-TAB SYNC VÍA BROADCASTCHANNEL ────────────────────────────────────
  useEffect(() => {
    if (!storeId || !userId) return;
    const bc = getCartBroadcastChannel();
    if (!bc) return;

    const handler = (e: MessageEvent<CartSyncMessage>) => {
      const msg = e.data;
      if (!msg) return;
      // Solo nos interesan mensajes de OTRO store+user o del mismo
      if (msg.storeId !== storeId || msg.userId !== userId) return;
      // Notificar al componente padre
      if (onRemoteUpdate) onRemoteUpdate(msg);
    };
    bc.addEventListener("message", handler);
    return () => {
      bc.removeEventListener("message", handler);
    };
  }, [storeId, userId, onRemoteUpdate]);

  // ─── GUARDAR ANTES DE CERRAR PESTAÑA ────────────────────────────────────────
  // visibilitychange:hidden → el usuario cambió de tab o minimizó.
  // pagehide → está cerrando o navegando fuera.
  // En ambos casos, forzamos un save inmediato sin debounce.
  useEffect(() => {
    if (!storeId || !userId) return;

    const flush = () => {
      const snapshot = snapshotRef.current;
      if (snapshot.cart.length === 0) return;
      // fire-and-forget (el browser puede matar el proceso antes)
      void saveCartDraft(
        storeId,
        userId,
        {
          items: snapshot.cart,
          customerId: snapshot.customerId,
          discount: snapshot.discount,
          paymentMethodId: snapshot.paymentMethodId,
          notes: snapshot.notes,
          branchId: snapshot.branchId,
        },
        draftCreatedAtRef.current
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onPageHide = () => flush();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    // beforeunload NO soporta async可靠mente, pero igual intentamos
    window.addEventListener("beforeunload", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
  }, [storeId, userId]);

  // ─── CLEANUP AL UNMOUNT ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // ─── ACCIONES MANUALES ──────────────────────────────────────────────────────

  const clearPersisted = useCallback(async () => {
    if (!storeId || !userId) return;
    // Cancelar cualquier save pendiente para que no re-escriba el draft
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await deleteCartDraft(storeId, userId);
    draftCreatedAtRef.current = undefined;
    setDraftDate(null);
    setIsSaved(false);
    setReconcileInfo(null);
  }, [storeId, userId]);

  const discardPersisted = useCallback(async () => {
    if (!storeId || !userId) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await deleteCartDraft(storeId, userId);
    draftCreatedAtRef.current = undefined;
    setDraftDate(null);
    setReconcileInfo(null);
  }, [storeId, userId]);

  const forceSaveNow = useCallback(async () => {
    if (!storeId || !userId) return;
    const snapshot = snapshotRef.current;
    if (snapshot.cart.length === 0) {
      await deleteCartDraft(storeId, userId);
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await saveCartDraft(
      storeId,
      userId,
      {
        items: snapshot.cart,
        customerId: snapshot.customerId,
        discount: snapshot.discount,
        paymentMethodId: snapshot.paymentMethodId,
        notes: snapshot.notes,
        branchId: snapshot.branchId,
      },
      draftCreatedAtRef.current
    );
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  }, [storeId, userId]);

  return {
    isRestoring,
    reconcileInfo,
    draftDate,
    isSaved,
    clearPersisted,
    discardPersisted,
    forceSaveNow,
  };
}
