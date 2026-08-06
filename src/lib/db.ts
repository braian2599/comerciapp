import { PrismaClient } from "@prisma/client";

/**
 * Singleton de PrismaClient para Next.js / Vercel serverless.
 *
 * - En desarrollo, se cachea en `globalThis` para no crear una nueva
 *   conexión en cada hot-reload del dev server.
 * - En producción (Vercel), cada lambda instancia su propio PrismaClient
 *   la primera vez; subsecuentes invocaciones dentro de la misma cold
 *   lambda reutilizan la instancia.
 * - `log` se desactiva en producción para evitar latencia y ruido.
 * - Usamos el datasource pooled de Neon (pgbouncer) por lo que no hace
 *   falta configurar `connection_limit` aquí.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["error", "warn"]
        : ["query", "error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
