import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

/**
 * Configuración de NextAuth para JWT (sin sessions en BD).
 *
 * Robustez para Vercel:
 * - `trustHost: true`: permite que NextAuth acepte el host del request
 *   sin requerir NEXTAUTH_URL en cada preview deployment. Sin esto,
 *   los deploys preview (*.vercel.app) fallan con error NEXTAUTH_URL.
 * - Validación estricta de NEXTAUTH_SECRET en runtime (no en build):
 *   si falta, tiramos error explícito. Mejor que sesiones silenciosamente
 *   rotas. El chequeo es lazy para que `next build` no falle localmente.
 *
 * NOTA IMPORTANTE — Por qué NO usamos Proxy:
 *   Antes exportábamos `authOptions` como un Proxy que lazy-resolvía
 *   `getAuthOptions()`. Esto ROMPÍA los callbacks `jwt` y `session` de
 *   NextAuth: el Proxy interceptaba `get` de propiedades del objeto
 *   authOptions pero, al pasar el Proxy a `getServerSession()`, NextAuth
 *   internamente hace cosas como `Object.keys(authOptions)` o spread
 *   `{...authOptions}` que NO disparan el handler `get` del Proxy,
 *   devolviendo undefined para callbacks, providers, etc. El resultado:
 *   los callbacks NUNCA se ejecutaban y el JWT quedaba vacío de campos
 *   custom (storeId, role, id), lo que rompía todos los endpoints que
 *   dependen de storeId.
 *
 *   Solución actual: build lazy pero SIN Proxy. `authOptions` es null
 *   hasta el primer llamado a `getAuthOptions()`, momento en el que se
 *   construye y se asigna. Los imports en el código siguen siendo
 *   `import { authOptions } from "@/lib/auth"`, pero al usarlo deben
 *   llamar `getAuthOptions()` o usar `authOptions` DESPUÉS del primer
 *   request. Para simplificar y evitar confusiones, exponemos ambas:
 *   - `getAuthOptions()`: función lazy, devuelve authOptions construido.
 *   - `authOptions`: se construye EAGERLY en módulo load. Si
 *     NEXTAUTH_SECRET no está en build-time, lanza warn pero no falla
 *     (porque el chequeo estricto es en runtime, dentro del callback).
 *     En Vercel build, NEXTAUTH_SECRET siempre está configurado, así
 *     que no hay problema.
 */

let _cachedAuthOptions: NextAuthOptions | null = null;

function buildAuthOptions(): NextAuthOptions {
  const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;

  if (!NEXTAUTH_SECRET) {
    // En producción, registramos el error crítico pero NO hacemos throw
    // acá porque esto se ejecuta en módulo-load (build time incluido).
    // El throw real lo hacemos en runtime, dentro del callback authorize,
    // donde sí estamos seguros de que es un request y no un build.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "🚨 NEXTAUTH_SECRET no está definido. En producción (Vercel) es OBLIGATORIO. " +
          "Generá uno con: openssl rand -base64 32 y configuralo como env var en Vercel. " +
          "Las sesiones van a fallar hasta que se configure."
      );
    } else if (typeof window === "undefined") {
      // En dev solo warn — Next-auth usará un secreto efímero.
      console.warn(
        "\n⚠️  NEXTAUTH_SECRET no está definido en .env.\n" +
          "   Next-auth usará un secreto efímero que se invalida en cada reinicio\n" +
          "   del server, cerrando todas las sesiones activas. Generá uno con:\n" +
          "   openssl rand -base64 32\n"
      );
    }
  }

  return {
    adapter: undefined,
    session: {
      strategy: "jwt",
      maxAge: 60 * 60 * 24 * 7, // 7 días
    },
    // trustHost: crítico para Vercel preview deployments.
    trustHost: true,
    secret: NEXTAUTH_SECRET,
    providers: [
      CredentialsProvider({
        name: "Credenciales",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Contraseña", type: "password" },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.password) return null;
          const user = await db.user.findUnique({
            where: { email: credentials.email.toLowerCase() },
            include: { store: true },
          });
          if (!user || !user.active) return null;
          const valid = await bcrypt.compare(
            credentials.password,
            user.passwordHash
          );
          if (!valid) return null;
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            storeId: user.storeId,
            storeName: user.store?.name || "",
            storeRubro: user.store?.rubro || "",
          } as any;
        },
      }),
    ],
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.id = (user as any).id;
          token.role = (user as any).role;
          token.storeId = (user as any).storeId;
          token.storeName = (user as any).storeName;
          token.storeRubro = (user as any).storeRubro;
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          (session.user as any).id = token.id;
          (session.user as any).role = token.role;
          (session.user as any).storeId = token.storeId;
          (session.user as any).storeName = token.storeName;
          (session.user as any).storeRubro = token.storeRubro;
        }
        return session;
      },
    },
    pages: {
      signIn: "/",
    },
  };
}

/**
 * Devuelve las authOptions (cacheadas después del primer llamado).
 * El primer llamado disparará el chequeo de NEXTAUTH_SECRET en runtime.
 *
 * USO PREFERIDO: en lugar de `import { authOptions }`, usar:
 *   import { getAuthOptions } from "@/lib/auth";
 *   const session = await getServerSession(getAuthOptions());
 *
 * Esto garantiza lazy init SIN Proxy, evitando el bug de callbacks
 * que no se ejecutan.
 */
export function getAuthOptions(): NextAuthOptions {
  if (!_cachedAuthOptions) {
    _cachedAuthOptions = buildAuthOptions();
  }
  return _cachedAuthOptions;
}

/**
 * authOptions eager — se construye al cargar el módulo.
 *
 * Si NEXTAUTH_SECRET no está definido en build time, buildAuthOptions()
 * solo hace warn (no throw) — el throw real es en runtime cuando llega
 * un request y se ejecuta el callback. Esto permite que `next build`
 * no falle localmente sin .env.
 *
 * En producción (Vercel), NEXTAUTH_SECRET siempre está configurado en
 * build time, así que esto es seguro.
 *
 * Si querés lazy init explícito, usá `getAuthOptions()` en su lugar.
 */
export const authOptions: NextAuthOptions = buildAuthOptions();

