import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  // Usamos solo JWT (sin sessions en BD) para SQLite simple
  adapter: undefined,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  },
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
