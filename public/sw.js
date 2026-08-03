/**
 * Service Worker de ComerciApp
 *
 * Capacidades:
 * - Precaching del shell de la app (HTML, JS, CSS)
 * - Estrategia network-first para navegación (con fallback offline)
 * - Estrategia stale-while-revalidate para assets estáticos
 * - Background sync para encolar operaciones realizadas offline
 * - Mensajería con el cliente (para sincronización manual)
 *
 * Versión: 4.0
 */

const SW_VERSION = "comerciapp-v4.0.0";
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

// Endpoints de API que se cachean con stale-while-revalidate (lecturas)
const API_CACHEABLE = [
  "/api/dashboard",
  "/api/products",
  "/api/categories",
  "/api/customers",
  "/api/payment-methods",
  "/api/store",
  "/api/me",
];

// Endpoints que nunca se cachean (escrituras siempre van a la red)
const API_NEVER_CACHE = [
  "/api/auth",
  "/api/sales",
  "/api/cash-registers/close",
  "/api/print",
];

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
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(SW_VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "GET_VERSION") {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});

// ===== FETCH =====
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo manejar GET para cacheo; otros métodos se dejan pasar (con cola offline si hay)
  if (req.method !== "GET") {
    // Para mutaciones POST/PUT/DELETE, interceptar si estamos offline
    if (navigator?.onLine === false || !self.navigator.onLine) {
      event.respondWith(handleOfflineMutation(req));
    }
    return;
  }

  // Navegación: network-first con fallback a offline.html
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  // API: stale-while-revalidate si está en la lista de cacheables
  if (url.pathname.startsWith("/api/")) {
    if (API_NEVER_CACHE.some((p) => url.pathname.startsWith(p))) {
      return; // dejar pasar
    }
    if (API_CACHEABLE.some((p) => url.pathname.startsWith(p))) {
      event.respondWith(staleWhileRevalidate(req, CACHE_API));
      return;
    }
    // Otras APIs: network-first corto
    event.respondWith(networkFirstShort(req));
    return;
  }

  // Assets estáticos: stale-while-revalidate
  if (req.destination === "style" || req.destination === "script" || req.destination === "image" || req.destination === "font") {
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
  clients.forEach((c) => c.postMessage({ type: "OFFLINE_QUEUED", id: op.id, url: op.url }));

  // Responder con una respuesta "aceptada" simulada (el frontend debe manejar la reconciliación)
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
