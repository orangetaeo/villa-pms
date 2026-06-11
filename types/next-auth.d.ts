import { DefaultSession } from "next-auth";

type UserRole = "ADMIN" | "SUPPLIER" | "CLEANER";

declare module "next-auth" {
  interface User {
    role: UserRole;
    locale: string;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
      locale: string;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    locale: string;
  }
}
