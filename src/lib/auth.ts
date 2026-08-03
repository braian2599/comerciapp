import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

// Validación temprana: si NEXTAUTH_SECRET no está definido, los JWT firmados
// en una sesión previa no se pueden desencriptar al reiniciar el server,
// provocando `JWEDecryptionFailed` en TODOS los requests y un cascade de
// 401 que rompe toda la UI. Mejor fallar al arrancar con un mensaje claro.
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
if (!NEXTAUTH_SECRET && process.env.NODE_ENV !== "production") {
  console.warn(
    "\n⚠️  NEXTAUTH_SECRET no está definido en .env.\n" +
      "   Next-auth usará un secreto efímero que se invalida en cada reinicio\n" +
      "   del server, cerrando todas las sesiones activas. Generá uno con:\n" +
      "   openssl rand -base64 32\n"
  );
}

export const authOptions: NextAuthOptions = {
  // Usamos solo JWT (sin sessions en BD) para SQLite simple
  adapter: undefined,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  },
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
