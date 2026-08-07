/**
 * Service Worker de ComerciApp
 *
 * Capacidades:
 * - Precaching del shell de la app (HTML, JS, CSS)
 * - Estrategia network-first para navegación (con fallback offline)
 * - Estrategia stale-while-revalidate para assets estáticos
 * - Network-first corto para TODAS las APIs (red primero, cache como fallback offline)
 * - Invalidación automática de cache tras mutaciones (POST/PUT/PATCH/DELETE)
 * - Background sync para encolar operaciones realizadas offline
 * - Mensajería con el cliente (sincronización manual, limpieza de cache)
 *
 * Versión: 5.0
 *
 * Cambios en v5.0 (FIX real-time refresh):
 *   Antes, los endpoints /api/products, /api/customers, /api/categories,
 *   /api/payment-methods, /api/dashboard, /api/store, /api/me usaban
 *   staleWhileRevalidate, que devuelve la cache STALE instantáneamente y
 *   revalida en background. Después de crear/editar/borrar, la vista llamaba
 *   load() pero el SW entregaba la respuesta vieja → la lista no se
 *   actualizaba hasta recargar la página.
 *   Ahora TODAS las APIs usan networkFirstShort (red primero; cache solo si
 *   la red falla) y se invalidan las caches relacionadas tras cada mutación
 *   exitosa. Así la próxima lectura siempre ve datos frescos.
 */

const SW_VERSION = "comerciapp-v5.0.0";
const CACHE_SHELL = `${SW_VERSION}-shell`;
const CACHE_DATA = `${SW_VERSION}-data`;
const CACHE_API = `${SW_VERSION}-api`;

// Recursos del shell que se cachean al instalar (se rellenan en runtime)
const SHELL_ASSETS = [
  "/",
  "/manifest.json",
  "/logo.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/offline.html",
];

// Endpoints que nunca se cachean (escrituras siempre van a la red,
// y lecturas sensibles que no deben servirse desde cache)
const API_NEVER_CACHE = [
  "/api/auth",
  "/api/sales",
  "/api/cash-registers/close",
  "/api/print",
];

// Mapa de invalidación: cuando una mutación (POST/PUT/PATCH/DELETE) a un
// path cuyo prefix es `key` tiene éxito (2xx), se borran de CACHE_API todas
// las entradas cuyo pathname empieza con cualquiera de los prefixes listados.
// Así la próxima lectura GET va a la red en lugar de servir cache stale.
//
// Nota: /api/dashboard aparece en muchos lugares porque agrega métricas de
// ventas, gastos, stock, clientes, etc. Casi cualquier mutación lo afecta.
const INVALIDATION_MAP = {
  "/api/products":        ["/api/products", "/api/dashboard"],
  "/api/categories":      ["/api/categories", "/api/products", "/api/dashboard"],
  "/api/customers":       ["/api/customers", "/api/dashboard"],
  "/api/payment-methods": ["/api/payment-methods"],
  "/api/expenses":        ["/api/expenses", "/api/dashboard"],
  "/api/inventory":       ["/api/inventory", "/api/products", "/api/dashboard"],
  "/api/cash-registers":  ["/api/cash-registers", "/api/dashboard"],
  "/api/invoices":        ["/api/invoices", "/api/dashboard"],
  "/api/credit-notes":    ["/api/credit-notes", "/api/dashboard"],
  "/api/refunds":         ["/api/refunds", "/api/customers", "/api/dashboard"],
  "/api/promotions":      ["/api/promotions"],
  "/api/purchase-orders": ["/api/purchase-orders", "/api/inventory", "/api/products", "/api/dashboard"],
  "/api/branches":        ["/api/branches", "/api/store"],
  "/api/commissions":     ["/api/commissions"],
  "/api/print-templates": ["/api/print-templates"],
  "/api/store":           ["/api/store", "/api/me"],
  "/api/me":              ["/api/me", "/api/store"],
  "/api/loyalty":         ["/api/loyalty", "/api/customers"],
  "/api/tax-config":      ["/api/tax-config"],
  "/api/ecommerce":       ["/api/ecommerce"],
  "/api/suppliers":       ["/api/suppliers"],
};

// ===== EVENTOS =====
self.addEventListener("install", (event) => {
  console.log("[SW] Instalando", SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activando", SW_VERSION);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(SW_VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "GET_VERSION") {
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }
  // Permite al cliente limpiar la cache de API bajo demanda
  if (event.data?.type === "CLEAR_API_CACHE") {
    event.waitUntil(
      caches.delete(CACHE_API).then(() => {
        event.ports[0]?.postMessage({ ok: true });
      })
    );
  }
});

// ===== FETCH =====
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo same-origin para no interferir con recursos externos
  if (url.origin !== self.location.origin) return;

  // Mutaciones (non-GET): interceptar para invalidar cache tras éxito.
  // Si estamos offline, encolar para background sync.
  if (req.method !== "GET") {
    const online =
      typeof navigator !== "undefined"
        ? navigator.onLine
        : self.navigator.onLine;
    if (!online) {
      event.respondWith(handleOfflineMutation(req));
    } else {
      event.respondWith(handleOnlineMutation(req));
    }
    return;
  }

  // Navegación: network-first con fallback a offline.html
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  // API GET: network-first corto (red primero, cache como fallback offline).
  // ANTES se usaba staleWhileRevalidate para algunos endpoints, pero eso
  // devolvía datos viejos instantáneamente y rompía la actualización en
  // tiempo real tras mutaciones. networkFirstShort garantiza datos frescos.
  if (url.pathname.startsWith("/api/")) {
    if (API_NEVER_CACHE.some((p) => url.pathname.startsWith(p))) {
      return; // dejar pasar sin cachear
    }
    event.respondWith(networkFirstShort(req));
    return;
  }

  // Assets estáticos: stale-while-revalidate (OK para assets inmutables con hash)
  if (
    req.destination === "style" ||
    req.destination === "script" ||
    req.destination === "image" ||
    req.destination === "font"
  ) {
    event.respondWith(staleWhileRevalidate(req, CACHE_SHELL));
    return;
  }
});

// ===== ESTRATEGIAS =====
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_SHELL);
    cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return caches.match("/offline.html");
  }
}

async function networkFirstShort(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_API);
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

// ===== MUTACIONES ONLINE (con invalidación de cache) =====
// Intercepta POST/PUT/PATCH/DELETE cuando hay red, deja pasar la petición,
// y tras una respuesta 2xx invalida las caches relacionadas para que la
// próxima lectura GET vaya a la red y vea los datos actualizados.
async function handleOnlineMutation(req) {
  const res = await fetch(req);
  if (res.ok) {
    // Invalidar caches relacionadas (no bloquea la respuesta más de unos ms).
    await invalidateCachesFor(req.url).catch((e) => {
      console.warn("[SW] Error invalidando cache tras mutación:", e);
    });
  }
  return res;
}

// ===== INVALIDACIÓN DE CACHE =====
function getInvalidationPrefixes(pathname) {
  for (const key of Object.keys(INVALIDATION_MAP)) {
    if (pathname.startsWith(key)) {
      return INVALIDATION_MAP[key];
    }
  }
  return [];
}

async function invalidateCachesFor(requestUrl) {
  let pathname;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return;
  }
  const prefixes = getInvalidationPrefixes(pathname);
  if (prefixes.length === 0) return;

  const cache = await caches.open(CACHE_API);
  const keys = await cache.keys();
  const toDelete = keys.filter((key) => {
    try {
      const keyPath = new URL(key.url).pathname;
      return prefixes.some((p) => keyPath.startsWith(p));
    } catch {
      return false;
    }
  });
  await Promise.all(toDelete.map((key) => cache.delete(key)));
  if (toDelete.length > 0) {
    console.log(
      `[SW] Invalidadas ${toDelete.length} entradas de cache tras mutación a ${pathname}`
    );
  }
}

// ===== MUTACIONES OFFLINE =====
async function handleOfflineMutation(req) {
  const body = await req.clone().text();
  const op = {
    url: req.url,
    method: req.method,
    body,
    headers: Object.fromEntries(req.headers.entries()),
    timestamp: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };

  // Guardar en IndexedDB
  const db = await openQueueDB();
  await db.put("offline-queue", op);

  // Registrar Background Sync si está disponible
  if ("sync" in self.registration) {
    try {
      await self.registration.sync.register("comerciapp-sync");
    } catch (e) {
      console.warn("[SW] No se pudo registrar sync:", e);
    }
  }

  // Notificar a clientes
  const clients = await self.clients.matchAll();
  clients.forEach((c) =>
    c.postMessage({ type: "OFFLINE_QUEUED", id: op.id, url: op.url })
  );

  // Responder con una respuesta "aceptada" simulada (el frontend debe
  // manejar la reconciliación)
  return new Response(
    JSON.stringify({
      offline: true,
      queued: true,
      tempId: op.id,
      message: "Operación encolada. Se sincronizará al volver online.",
    }),
    {
      status: 202,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// ===== BACKGROUND SYNC =====
self.addEventListener("sync", (event) => {
  if (event.tag === "comerciapp-sync") {
    event.waitUntil(processOfflineQueue());
  }
});

async function processOfflineQueue() {
  const db = await openQueueDB();
  const all = await db.getAll("offline-queue");
  const pending = all.sort((a, b) => a.timestamp - b.timestamp);

  for (const op of pending) {
    try {
      const res = await fetch(op.url, {
        method: op.method,
        headers: op.headers,
        body: op.body || undefined,
      });
      if (res.ok || res.status === 400 || res.status === 409) {
        // Éxito o error definitivo: eliminar de la cola
        await db.delete("offline-queue", op.id);
        // Tras replay exitoso, invalidar caches relacionadas para que la
        // próxima lectura vea el efecto de la operación replayed.
        if (res.ok) {
          await invalidateCachesFor(op.url).catch(() => {});
        }
        // Notificar a clientes
        const data = await res.json().catch(() => ({}));
        const clients = await self.clients.matchAll();
        clients.forEach((c) =>
          c.postMessage({
            type: "OFFLINE_SYNCED",
            tempId: op.id,
            url: op.url,
            status: res.status,
            data,
          })
        );
      } else {
        // Reintentar luego
        console.warn(`[SW] Sync ${op.url} falló con ${res.status}`);
      }
    } catch (e) {
      console.warn(`[SW] Sync ${op.url} falló:`, e.message);
      // Si seguimos offline, no seguir procesando
      if (!navigator.onLine) break;
    }
  }
}

// ===== INDEXEDDB PARA LA COLA =====
function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("comerciapp-offline", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("offline-queue")) {
        db.createObjectStore("offline-queue", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("drafts")) {
        db.createObjectStore("drafts", { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ===== PUSH NOTIFICATIONS (placeholder para futuras notificaciones) =====
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || "ComerciApp", {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: data.data || {},
      })
    );
  } catch (e) {
    console.warn("[SW] Push malformado:", e);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients[0]) {
        clients[0].focus();
      } else {
        self.clients.openWindow("/");
      }
    })
  );
});
