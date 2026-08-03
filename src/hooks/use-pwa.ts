/**
 * Hook de React para integrar la PWA en el cliente:
 * - Registro del Service Worker
 * - Detección de estado online/offline
 * - Cola de operaciones offline (lectura/visualización)
 * - Sincronización manual
 * - Actualizaciones del SW (notificación al usuario)
 */

"use client";

import { useEffect, useState, useCallback } from "react";

export interface PWAStatus {
  isOnline: boolean;
  isInstalled: boolean;
  isStandalone: boolean;
  swVersion: string | null;
  updateAvailable: boolean;
  pendingOperations: number;
  registerSW: () => Promise<void>;
  triggerSync: () => Promise<{ ok: boolean; remaining: number }>;
  applyUpdate: () => void;
  enqueueOperation: (op: OfflineOp) => Promise<void>;
}

export interface OfflineOp {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
  entity?: string;
  action?: string;
}

export function usePWA(): PWAStatus {
  // Lazy initializer: leer valor inicial sin efecto
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true
    );
  });
  const [swVersion, setSwVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [pendingOperations, setPendingOperations] = useState(0);
  const [waitingSW, setWaitingSW] = useState<ServiceWorker | null>(null);

  // Estado online/offline — solo suscripción
  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  // beforeinstallprompt — solo suscripción
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setIsInstalled(false);
      (window as any).deferredPrompt = e;
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setIsInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Contar operaciones pendientes
  const refreshPending = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingOperations(count);
    } catch {
      setPendingOperations(0);
    }
  }, []);

  // Registrar SW
  const registerSW = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });

      // Detectar actualizaciones
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
            setWaitingSW(newWorker);
          }
        });
      });

      // Obtener versión
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => {
        if (e.data?.version) setSwVersion(e.data.version);
      };
      if (reg.active) {
        reg.active.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      }

      // Escuchar mensajes del SW
      navigator.serviceWorker.addEventListener("message", (event) => {
        const data = event.data;
        if (!data) return;
        if (data.type === "OFFLINE_QUEUED") {
          refreshPending();
        } else if (data.type === "OFFLINE_SYNCED") {
          refreshPending();
          // Disparar evento custom para que las vistas recarguen
          window.dispatchEvent(new CustomEvent("comerciapp:synced", { detail: data }));
        }
      });

      refreshPending();
    } catch (e) {
      console.warn("[PWA] Error registrando SW:", e);
    }
  }, [refreshPending]);

  useEffect(() => {
    // Registro async del SW fuera del ciclo de render
    const id = setTimeout(() => {
      registerSW();
    }, 0);
    return () => clearTimeout(id);
  }, [registerSW]);

  // Aplicar actualización
  const applyUpdate = useCallback(() => {
    if (waitingSW) {
      waitingSW.postMessage({ type: "SKIP_WAITING" });
      waitingSW.addEventListener("statechange", () => {
        if (waitingSW.state === "activated") {
          window.location.reload();
        }
      });
    } else {
      window.location.reload();
    }
  }, [waitingSW]);

  // Encolar operación manualmente (para uso desde el frontend)
  const enqueueOperation = useCallback(
    async (op: OfflineOp) => {
      try {
        await enqueueOp(op);
        refreshPending();
      } catch (e) {
        console.warn("[PWA] Error encolando:", e);
      }
    },
    [refreshPending]
  );

  // Sincronización manual (vuelve a intentar las pendientes)
  const triggerSync = useCallback(async () => {
    if (!("serviceWorker" in navigator)) {
      // Fallback: ejecutar manualmente
      return manualSync();
    }
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) {
      try {
        await (reg as any).sync.register("comerciapp-sync");
      } catch {
        return manualSync();
      }
    } else {
      return manualSync();
    }
    await new Promise((r) => setTimeout(r, 500));
    await refreshPending();
    return { ok: true, remaining: 0 };
  }, [refreshPending]);

  return {
    isOnline,
    isInstalled,
    isStandalone,
    swVersion,
    updateAvailable,
    pendingOperations,
    registerSW,
    triggerSync,
    applyUpdate,
    enqueueOperation,
  };
}

// ===== INDEXEDDB =====
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("comerciapp-offline", 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("offline-queue")) {
        db.createObjectStore("offline-queue", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("drafts")) {
        db.createObjectStore("drafts", { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

async function getPendingCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("offline-queue", "readonly");
    const store = tx.objectStore("offline-queue");
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueOp(op: OfflineOp): Promise<void> {
  const db = await openDB();
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    url: op.url,
    method: op.method,
    body: op.body,
    headers: op.headers || {},
    timestamp: Date.now(),
    entity: op.entity,
    action: op.action,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction("offline-queue", "readwrite");
    const store = tx.objectStore("offline-queue");
    const req = store.add(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function manualSync(): Promise<{ ok: boolean; remaining: number }> {
  const db = await openDB();
  const all = await new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction("offline-queue", "readonly");
    const store = tx.objectStore("offline-queue");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  const pending = all.sort((a, b) => a.timestamp - b.timestamp);

  let ok = 0;
  let fail = 0;
  for (const op of pending) {
    try {
      const res = await fetch(op.url, {
        method: op.method,
        headers: op.headers,
        body: op.body || undefined,
      });
      if (res.ok) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("offline-queue", "readwrite");
          tx.objectStore("offline-queue").delete(op.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        ok++;
        const data = await res.json().catch(() => ({}));
        window.dispatchEvent(
          new CustomEvent("comerciapp:synced", {
            detail: { tempId: op.id, url: op.url, data },
          })
        );
      } else {
        fail++;
      }
    } catch {
      fail++;
      break; // probablemente offline aún
    }
  }

  const remaining = await getPendingCount();
  return { ok: ok > 0 && fail === 0, remaining };
}

/**
 * Hook simplificado para detectar si el navegador soporta instalación PWA
 * y mostrar el prompt de instalación bajo demanda.
 */
export function usePWAInstall() {
  const [canInstall, setCanInstall] = useState(false);
  const [promptEvent, setPromptEvent] = useState<any>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e);
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!promptEvent) return false;
    promptEvent.prompt();
    const result = await promptEvent.userChoice;
    setCanInstall(false);
    setPromptEvent(null);
    return result.outcome === "accepted";
  }, [promptEvent]);

  return { canInstall, promptInstall };
}
