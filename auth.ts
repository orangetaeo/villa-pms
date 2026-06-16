import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, resetRateLimit, clientIp } from "@/lib/rate-limit";

// 무차별 대입·크리덴셜 스터핑 방어 (T-sec-auth-ratelimit, Phase 1 보안)
// 전화번호: 한 계정 집중 공격 차단 / IP: 한 출처에서 여러 계정 시도(스터핑) 차단
const LOGIN_PHONE_LIMIT = { max: 5, windowMs: 10 * 60_000 };
const LOGIN_IP_LIMIT = { max: 20, windowMs: 10 * 60_000 };

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
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
        if (!phoneOk || !ipOk) return null;

        const user = await prisma.user.findUnique({
          where: { phone },
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

        // 로그인 성공 — 전화번호 잠금만 리셋(연속 정상 로그인이 한도에 안 걸리도록).
        // IP 카운터는 의도적으로 유지: 한 번 유효 로그인으로 IP 한도를 초기화해
        // 스터핑을 재개하는 우회를 막는다 (QA 권고).
        resetRateLimit(`login:phone:${phone}`);
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
