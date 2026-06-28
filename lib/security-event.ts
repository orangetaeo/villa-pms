// 보안 이벤트 기록 유틸 (보안 P0-1) — 로그인 실패·권한 거부·토큰 무효·rate-limit·SSRF/CSRF 차단 등.
//
// 설계 원칙:
// - **fire-and-forget**: 기록 실패가 본 흐름(로그인·API 응답)을 절대 막지 않는다. 자체 try/catch로 삼킨다.
// - **비민감만**: meta에 비밀번호·해시·credential·마진·판매가 등 민감값 금지. 아래 redactMeta로 방어적 제거.
// - AuditLog(정상 변경 영구보존)와 분리된 채널 — 공격 감지·추적용.

import { prisma } from "@/lib/prisma";

export type SecurityEventType =
  | "LOGIN_FAIL"
  | "LOGIN_OK"
  | "AUTHZ_DENY" // 권한 부족(403)
  | "TOKEN_INVALID" // 만료/위조 토큰 접근
  | "RATE_LIMIT" // rate-limit 차단
  | "PWRESET_FAIL" // 비밀번호 재설정 실패
  | "CRED_DECRYPT_FAIL" // Zalo credential 복호화 실패
  | "SSRF_BLOCK" // 아웃바운드 내부망 차단
  | "CSRF_BLOCK" // 교차출처 위조 차단
  | "PII_PURGE" // PII 보존정책 실행(여권·서명 만료 삭제)
  | "PII_FORWARD" // PII(여권 사진) 외부 전달 — tạm trú 목적 공급자 Zalo 전송 (ADR-0029)
  | "CSP_REPORT" // CSP 위반 리포트(enforce 전환 관찰용 — 디렉티브·호스트만)
  | "ALERT_SENT"; // 이상탐지 경보 발송 마커(P3-S3 쿨다운용, meta.category)

export interface SecurityEventInput {
  type: SecurityEventType;
  actorUserId?: string | null;
  actorPhone?: string | null;
  ip?: string | null;
  path?: string | null;
  meta?: Record<string, unknown> | null;
}

// meta에서 민감 키를 제거(값까지)하는 방어막 — 실수로 민감값을 넘겨도 저장 안 되게.
const SENSITIVE_KEY = /pass|secret|credential|token|margin|saleprice|price.*krw|fxvnd|hash|cookie|authorization/i;

function redactMeta(meta: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    // 문자열 값은 과도한 길이 컷(로그 플러드·우발적 본문 유입 방지)
    out[k] = typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "…" : v;
  }
  return out;
}

/**
 * 보안 이벤트 1건 기록. 절대 throw하지 않는다(실패 시 console.error만).
 * 호출처는 await 없이 호출해도 되지만, 순서 보장이 필요 없으면 await 권장(테스트 결정성).
 */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        type: input.type,
        actorUserId: input.actorUserId ?? null,
        actorPhone: input.actorPhone ?? null,
        ip: input.ip ?? null,
        path: input.path ?? null,
        meta: (redactMeta(input.meta) ?? undefined) as object | undefined,
      },
    });
  } catch (e) {
    // 보안 로그 기록 실패가 인증·API를 막지 않도록 삼킨다. (메시지만, 민감값 미포함)
    console.error("[security-event] 기록 실패:", e instanceof Error ? e.message : String(e));
  }
}

// 테스트·내부용: redactMeta 노출
export const __test = { redactMeta };
