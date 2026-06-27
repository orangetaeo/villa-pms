import { DefaultSession } from "next-auth";
import type { Role } from "@/lib/permissions";

// 단일 출처: lib/permissions.ts의 Role 재사용 (OWNER·MANAGER·STAFF·ADMIN·SUPPLIER·CLEANER, ADR-0013)
type UserRole = Role;

declare module "next-auth" {
  interface User {
    role: UserRole;
    locale: string;
    mustChangePassword?: boolean;
    // 보안 P0-5② — authorize가 로그인 시 passwordChangedAt(ms) baseline을 토큰에 전달.
    pwdAt?: number;
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
    // 보안 P0-5② 서버측 세션 무효화 — 발급 시점 passwordChangedAt(ms) baseline + 마지막 DB 재조회 시각(ms).
    pwdAt?: number;
    pwdCk?: number;
  }
}
