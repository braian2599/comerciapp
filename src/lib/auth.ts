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
 * - Validación estricta de NEXTAUTH_SECRET en producción: si falta,
 *   tiramos error explícito (mejor que sesiones silenciosamente rotas).
 * - El secreto efímero en dev solo se usa si NODE_ENV !== "production".
 */
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;

if (!NEXTAUTH_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXTAUTH_SECRET no está definido. En producción (Vercel) es OBLIGATORIO. " +
        "Generá uno con: openssl rand -base64 32 y configuralo como env var en Vercel."
    );
  }
  console.warn(
    "\n⚠️  NEXTAUTH_SECRET no está definido en .env.\n" +
      "   Next-auth usará un secreto efímero que se invalida en cada reinicio\n" +
      "   del server, cerrando todas las sesiones activas. Generá uno con:\n" +
      "   openssl rand -base64 32\n"
  );
}

export const authOptions: NextAuthOptions = {
  adapter: undefined,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  },
  // trustHost: crítico para Vercel preview deployments.
  // Permite que NextAuth derive la URL del host header en lugar de
  // requerir NEXTAUTH_URL configurada en cada environment.
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
