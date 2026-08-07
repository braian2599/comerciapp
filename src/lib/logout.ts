/**
 * Limpia toda la cache del browser: localStorage, sessionStorage,
 * IndexedDB, cache del service worker y cookies controlables.
 *
 * Uso típico: al cerrar sesión, para asegurar que el próximo login
 * arranque desde cero sin datos residuales que causen bugs (JWTs
 * cacheados por el browser, datos de productos viejos, etc.).
 *
 * NOTA: las cookies HttpOnly (como las de next-auth) NO se pueden
 * borrar desde JS — esas las borra el server con `signOut()`. Esta
 * utilidad se enfoca en lo que SÍ podemos limpiar desde el cliente.
 */
export async function clearAllClientStorage(): Promise<void> {
  // 1) localStorage
  try {
    localStorage.clear();
  } catch (e) {
    console.warn("[clearAllClientStorage] localStorage.clear falló:", e);
  }

  // 2) sessionStorage
  try {
    sessionStorage.clear();
  } catch (e) {
    console.warn("[clearAllClientStorage] sessionStorage.clear falló:", e);
  }

  // 3) IndexedDB — borrar todas las bases de datos
  try {
    if (typeof indexedDB !== "undefined" && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map(
          (db) =>
            new Promise<void>((resolve) => {
              if (db.name) {
                const req = indexedDB.deleteDatabase(db.name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              } else {
                resolve();
              }
            })
        )
      );
    }
  } catch (e) {
    console.warn("[clearAllClientStorage] IndexedDB.clear falló:", e);
  }

  // 4) Cookies controlables (no HttpOnly)
  try {
    const cookies = document.cookie.split(";");
    for (const cookie of cookies) {
      const eqPos = cookie.indexOf("=");
      const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
      if (!name) continue;
      // Borrar para múltiples paths y dominios para mayor compatibilidad
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${location.hostname}`;
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.${location.hostname}`;
    }
  } catch (e) {
    console.warn("[clearAllClientStorage] cookie clear falló:", e);
  }

  // 5) Service Worker caches (Cache Storage API)
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn("[clearAllClientStorage] caches.delete falló:", e);
  }

  // 6) Desregistrar service workers
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {
    console.warn("[clearAllClientStorage] SW unregister falló:", e);
  }
}

/**
 * Wrapper para usar en el botón de logout:
 *   1. Limpia toda la cache del cliente
 *   2. Llama a signOut() de next-auth (borra cookie HttpOnly + redirect)
 *
 * Uso:
 *   import { handleLogout } from "@/lib/logout";
 *   import { signOut } from "next-auth/react";
 *   <button onClick={() => handleLogout(signOut)}>Salir</button>
 */
export async function handleLogout(
  signOutFn: (opts?: { callbackUrl?: string }) => Promise<void> | void
): Promise<void> {
  await clearAllClientStorage();
  // Llamar a signOut después de limpiar storage, para que la cookie
  // HttpOnly de next-auth se borre vía HTTP (no la podemos borrar desde JS).
  await signOutFn({ callbackUrl: "/" });
  // Hard reload para asegurar estado limpio
  if (typeof window !== "undefined") {
    window.location.href = "/";
  }
}
