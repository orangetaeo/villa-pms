import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        phone: { label: "Phone", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.phone || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { phone: credentials.phone as string },
          select: {
            id: true,
            name: true,
            role: true,
            locale: true,
            passwordHash: true,
            isActive: true,
          },
        });
        if (!user?.passwordHash || !user.isActive) return null;
        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;
        return { id: user.id, name: user.name, role: user.role, locale: user.locale };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.locale = user.locale;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.locale = token.locale;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
