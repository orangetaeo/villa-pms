// 중앙 API 가드 헬퍼 (보안 P0-6) — 인증·인가 검사를 표준화해 라우트별 수작업 누락을 막는다.
//
// 기존: 라우트마다 `const session = await auth(); if (!session) 401; if (!cap(role)) 403` 반복 →
//       신규 라우트에서 빠뜨리면 무인증/무권한 노출. 이 헬퍼로 일원화하고 403은 SecurityEvent 자동 기록.
//
// 사용:
//   const g = await requireCapability(canViewFinance, "canViewFinance", req);
//   if (!g.ok) return g.response;        // 401/403 표준 응답
//   // 이후 g.userId, g.role, g.session 사용 (타입 좁힘 보장)
//
// 전면 치환(기존 라우트 일괄 적용)은 P1-S8. 본 P0에선 헬퍼 신설 + 신규/고위험 라우트 적용.

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { clientIp } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-event";
import type { Role } from "@/lib/permissions";

export interface GuardOk {
  ok: true;
  session: Session;
  userId: string;
  role: Role;
}
export interface GuardFail {
  ok: false;
  response: NextResponse;
}
export type GuardResult = GuardOk | GuardFail;

function pathOf(req?: Request): string | null {
  if (!req) return null;
  try {
    return new URL(req.url).pathname;
  } catch {
    return null;
  }
}

/** 로그인 필수. 미인증이면 401 응답을 담은 GuardFail 반환. */
export async function requireAuth(req?: Request): Promise<GuardResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  }
  return { ok: true, session, userId: session.user.id, role: session.user.role as Role };
}

/**
 * 로그인 + capability 필수. 권한 부족이면 403 + AUTHZ_DENY 기록.
 * @param capFn   lib/permissions의 capability 함수 (canViewFinance·isSystemAdmin 등)
 * @param capName 기록용 권한 이름
 */
export async function requireCapability(
  capFn: (r?: Role) => boolean,
  capName: string,
  req?: Request,
): Promise<GuardResult> {
  const a = await requireAuth(req);
  if (!a.ok) return a;
  if (!capFn(a.role)) {
    await recordSecurityEvent({
      type: "AUTHZ_DENY",
      actorUserId: a.userId,
      ip: clientIp(req?.headers ?? null),
      path: pathOf(req),
      meta: { capability: capName, role: a.role },
    });
    return { ok: false, response: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  return a;
}

/**
 * 소유권 검사 도우미 — findFirst({where:{id, ownerField}}) 결과가 null이면 404(존재 비노출).
 * 라우트에서 소유 리소스 조회 후 호출. 타인 리소스를 403이 아닌 404로 숨긴다(열거 차단).
 */
export function notFoundIfMissing<T>(resource: T | null | undefined): { ok: true; resource: T } | GuardFail {
  if (resource == null) {
    return { ok: false, response: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  }
  return { ok: true, resource };
}
