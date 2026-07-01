import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, resetRateLimit, clientIp } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-event";
import { isPasswordSessionStale, shouldRecheckPassword } from "@/lib/session-invalidation";
import { verifyPasskeyLogin } from "@/lib/passkey-verify";
import { readCookie, AUTH_CHALLENGE_COOKIE } from "@/lib/webauthn";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";

// 무차별 대입·크리덴셜 스터핑 방어 (T-sec-auth-ratelimit, Phase 1 보안)
// 전화번호: 한 계정 집중 공격 차단 / IP: 한 출처에서 여러 계정 시도(스터핑) 차단
const LOGIN_PHONE_LIMIT = { max: 5, windowMs: 10 * 60_000 };
const LOGIN_IP_LIMIT = { max: 20, windowMs: 10 * 60_000 };

// 세션 수명 (보안 P0-5①) — JWT 만료를 명시(기본값 의존 제거). 7일·하루 단위 갱신.
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7일
const IS_PROD = process.env.NODE_ENV === "production";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // 세션·쿠키 보안 명시 (보안 P0-5①) — httpOnly(JS 접근 차단)·sameSite lax(CSRF 완화)·secure(prod HTTPS).
  // Auth.js 기본값과 동일하나 운영 정책을 코드로 고정(기본값 변경에 흔들리지 않게). 쿠키 이름은 기본 유지.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE, updateAge: 60 * 60 * 24 },
  cookies: {
    sessionToken: {
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: IS_PROD },
    },
  },
  providers: [
    Credentials({
      credentials: {
        phone: { label: "Phone", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        if (!credentials?.phone || !credentials?.password) return null;
        const phone = String(credentials.phone).trim();
        const ip = clientIp(request?.headers ?? null);

        // 한도 초과 시 bcrypt·DB 조회 생략 후 잠금(null — 공격자에게 실패와 구분 불가).
        // hit는 시도마다 기록, 성공 시 리셋 → 정상 사용자는 누적되지 않음.
        const phoneOk = checkRateLimit(`login:phone:${phone}`, LOGIN_PHONE_LIMIT).allowed;
        const ipOk = ip ? checkRateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT).allowed : true;
        if (!phoneOk || !ipOk) {
          // rate-limit 차단 기록 (보안 P0-1). 기록량은 rate-limit가 자연 상한.
          await recordSecurityEvent({
            type: "RATE_LIMIT",
            actorPhone: phone,
            ip,
            path: "/login",
            meta: { scope: !phoneOk ? "phone" : "ip" },
          });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { phone },
          select: {
            id: true,
            name: true,
            role: true,
            locale: true,
            passwordHash: true,
            isActive: true,
            mustChangePassword: true,
            deletedAt: true,
            passwordChangedAt: true, // 보안 P0-5② — 세션 무효화 baseline
          },
        });
        // 소프트 삭제된 계정은 비활성과 동일하게 로그인 차단(실패와 구분 불가)
        if (!user?.passwordHash || !user.isActive || user.deletedAt) {
          await recordSecurityEvent({
            type: "LOGIN_FAIL",
            actorUserId: user?.id ?? null,
            actorPhone: phone,
            ip,
            path: "/login",
            meta: { reason: !user ? "no_user" : !user.isActive ? "inactive" : user.deletedAt ? "deleted" : "no_hash" },
          });
          return null;
        }
        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) {
          await recordSecurityEvent({
            type: "LOGIN_FAIL",
            actorUserId: user.id,
            actorPhone: phone,
            ip,
            path: "/login",
            meta: { reason: "bad_password" },
          });
          return null;
        }

        // 로그인 성공 — 전화번호 잠금만 리셋(연속 정상 로그인이 한도에 안 걸리도록).
        // IP 카운터는 의도적으로 유지: 한 번 유효 로그인으로 IP 한도를 초기화해
        // 스터핑을 재개하는 우회를 막는다 (QA 권고).
        resetRateLimit(`login:phone:${phone}`);
        await recordSecurityEvent({
          type: "LOGIN_OK",
          actorUserId: user.id,
          actorPhone: phone,
          ip,
          path: "/login",
        });
        return {
          id: user.id,
          name: user.name,
          role: user.role,
          locale: user.locale,
          mustChangePassword: user.mustChangePassword,
          // 보안 P0-5② — 발급 토큰에 박을 baseline(ms). null=한 번도 안 바꿈 → 0.
          pwdAt: user.passwordChangedAt ? user.passwordChangedAt.getTime() : 0,
        };
      },
    }),
    // 패스키(지문·얼굴·Windows Hello) 로그인 provider (ADR-0030).
    //   클라이언트가 WebAuthn 어설션(JSON)을 signIn("passkey", { response }) 로 전달.
    //   challenge는 /api/auth/passkey/login/options 가 심은 httpOnly 쿠키에서 읽어 대조.
    //   무거운 검증은 lib/passkey-verify(동형 @simplewebauthn/server)에 위임 — 성공 시 동일 user 형태 반환.
    Credentials({
      id: "passkey",
      name: "Passkey",
      credentials: { response: { label: "response", type: "text" } },
      authorize: async (credentials, request) => {
        const raw = credentials?.response;
        if (typeof raw !== "string") return null;
        const ip = clientIp(request?.headers ?? null);

        let parsed: AuthenticationResponseJSON;
        try {
          parsed = JSON.parse(raw) as AuthenticationResponseJSON;
        } catch {
          return null;
        }
        const challenge = readCookie(
          request?.headers?.get("cookie") ?? null,
          AUTH_CHALLENGE_COOKIE
        );
        if (!challenge) return null;

        const result = await verifyPasskeyLogin({ response: parsed, expectedChallenge: challenge });
        if (!result) {
          await recordSecurityEvent({
            type: "LOGIN_FAIL",
            ip,
            path: "/login",
            meta: { reason: "passkey_verify", method: "passkey" },
          });
          return null;
        }

        // 검증 통과 — 계정 상태 확인(비활성·소프트삭제는 차단) 후 세션 발급.
        const user = await prisma.user.findUnique({
          where: { id: result.userId },
          select: {
            id: true,
            name: true,
            role: true,
            locale: true,
            isActive: true,
            deletedAt: true,
            mustChangePassword: true,
            passwordChangedAt: true,
          },
        });
        if (!user || !user.isActive || user.deletedAt) {
          await recordSecurityEvent({
            type: "LOGIN_FAIL",
            actorUserId: result.userId,
            ip,
            path: "/login",
            meta: { reason: "inactive_or_deleted", method: "passkey" },
          });
          return null;
        }

        await recordSecurityEvent({
          type: "LOGIN_OK",
          actorUserId: user.id,
          ip,
          path: "/login",
          meta: { method: "passkey" },
        });
        return {
          id: user.id,
          name: user.name,
          role: user.role,
          locale: user.locale,
          mustChangePassword: user.mustChangePassword,
          pwdAt: user.passwordChangedAt ? user.passwordChangedAt.getTime() : 0,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.locale = user.locale;
        token.mustChangePassword = user.mustChangePassword;
        // 보안 P0-5② — 로그인 시 baseline 박기. 이후 비번이 바뀌면 이 토큰은 무효가 된다.
        token.pwdAt = user.pwdAt ?? 0;
        token.pwdCk = Date.now();
        return token;
      }

      // 후속 요청 — 서버측 세션 무효화 검사 (보안 P0-5②).
      // ⚠ DB 조회는 Node 런타임에서만. 미들웨어(edge)에서는 prisma 불가이므로 건너뛰고,
      // 실제 무효화는 페이지/서버컴포넌트/API의 auth()(Node)가 담당한다(미들웨어는 coarse 게이트만).
      if (token.id && process.env.NEXT_RUNTIME !== "edge") {
        const now = Date.now();
        if (token.pwdAt === undefined) {
          // 그랜드파더 — 기능 도입 전 발급 토큰: 현재 baseline 채택(1회), 무효화 안 함(대량 락아웃 방지).
          const u = await prisma.user.findUnique({
            where: { id: token.id },
            select: { passwordChangedAt: true },
          });
          token.pwdAt = u?.passwordChangedAt ? u.passwordChangedAt.getTime() : 0;
          token.pwdCk = now;
        } else if (shouldRecheckPassword(token.pwdCk, now)) {
          const u = await prisma.user.findUnique({
            where: { id: token.id },
            select: { passwordChangedAt: true },
          });
          const dbMs = u?.passwordChangedAt ? u.passwordChangedAt.getTime() : null;
          if (isPasswordSessionStale(token.pwdAt, dbMs)) {
            // 비밀번호가 토큰 발급 이후 변경됨 → 이 세션 무효(타 디바이스 강제 로그아웃).
            return null;
          }
          token.pwdCk = now;
        }
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.locale = token.locale;
      session.user.mustChangePassword = token.mustChangePassword;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
