import { DefaultSession } from "next-auth";
import type { Role } from "@/lib/permissions";

// 단일 출처: lib/permissions.ts의 Role 재사용 (OWNER·MANAGER·STAFF·ADMIN·SUPPLIER·CLEANER, ADR-0013)
type UserRole = Role;

declare module "next-auth" {
  interface User {
    role: UserRole;
    locale: string;
    mustChangePassword?: boolean;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
      locale: string;
      mustChangePassword?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    locale: string;
    mustChangePassword?: boolean;
  }
}
