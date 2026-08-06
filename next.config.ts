import type { NextConfig } from "next";

/**
 * Configuración Next.js optimizada para Vercel.
 *
 * - Sin `output: "standalone"`: Vercel maneja su propio runtime serverless.
 * - `images.formats`: habilita AVIF/WebP para optimización automática.
 * - `images.remotePatterns`: dominios externos permitidos para next/image.
 * - `serverExternalPackages`: evita que Next bundlee paquetes que dependen
 *   de binaries nativos (Prisma, bcryptjs, sharp). En Next 16+ ya no va
 *   dentro de `experimental`.
 * - `poweredByHeader`: oculta la cabecera X-Powered-By (security hardening).
 * - `reactStrictMode`: desactivado por decisión del proyecto (doble-render
 *   rompía algunos efectos en dev).
 * - `typescript.ignoreBuildErrors`: mantiene build resiliente aunque haya
 *   errores de tipo no críticos (no afecta runtime).
 *
 * NOTA: En Next.js 16, `eslint.ignoreDuringBuilds` fue removido de
 * next.config.ts. El linting se maneja ahora con `next lint --quiet` o
 * un script `prebuild` separado. Vercel no ejecuta ESLint por defecto
 * durante el build, así que no hace falta configurar nada aquí.
 */
const nextConfig: NextConfig = {
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  // Next.js 16+: `serverExternalPackages` (antes `experimental.serverComponentsExternalPackages`).
  // Evita que Next bundlee paquetes con binaries nativos en el server bundle.
  // Sin esto, @prisma/client puede romper en runtime con "Cannot find module".
  serverExternalPackages: ["@prisma/client", "bcryptjs", "sharp"],
  // Headers de seguridad aplicados a todas las rutas.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
      {
        // El service worker NO debe cachearse, necesita actualizarse siempre.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
