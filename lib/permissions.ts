// lib/permissions.ts — 운영자 권한 capability 헬퍼 (ADR-0013, S-RBAC-1)
//
// 역할 문자열 비교(role === "ADMIN")를 권한 단위 함수로 추상화한다.
// 화면·API는 "어떤 역할인가"가 아니라 "이 권한이 있는가"를 묻는다.
//
// ── additive 전략 (빌드 무중단) ──
// ADMIN enum 값은 이 스프린트에서 제거하지 않는다. 기존 ADMIN 계정·코드(~40곳)가
// 깨지지 않도록, transition 동안 ADMIN을 OWNER와 동일하게 취급한다.
// ADMIN 제거·코드 치환(role==="ADMIN" → isOperator 등)은 S-RBAC-2 몫이다.
//
// 돈의 경계선: { OWNER, MANAGER } vs STAFF
// 시스템 통제 경계선: OWNER (vs MANAGER·STAFF)

/** 시스템 전체 역할 — lib/permissions.ts가 단일 출처(types/next-auth.d.ts가 재사용) */
//   VENDOR = 부가서비스 원천 공급자 로그인 계정(ADR-0023). 운영자 아님 — 모든 capability false.
export type Role = "OWNER" | "MANAGER" | "STAFF" | "ADMIN" | "SUPPLIER" | "CLEANER" | "VENDOR";

/** 운영자 역할 집합 — ADMIN은 transition 동안 OWNER 동일취급으로 포함 (S-RBAC-2서 제거) */
const OPERATORS: Role[] = ["OWNER", "MANAGER", "STAFF", "ADMIN"];

/** 알림 수신 등에서 운영자 User 조회용 readonly 튜플 (lib/roster-reminder 외 재사용) */
export const OPERATOR_ROLES = ["OWNER", "MANAGER", "STAFF", "ADMIN"] as const;

/**
 * 운영자 영역 접근 가능 여부 (기존 role==="ADMIN" 대부분을 이걸로 치환 예정).
 * ADMIN은 transition 동안 OWNER와 동일 취급, S-RBAC-2서 제거.
 */
export const isOperator = (r?: Role): boolean => !!r && OPERATORS.includes(r);

/** 원천 공급자(부가서비스 거래처 로그인 계정, ADR-0023). 운영자 아님 — 자기 발주만 조회·응답. */
export function isVendor(r?: Role): r is "VENDOR" {
  return r === "VENDOR";
}

/**
 * 돈을 볼 수 있는가 — KRW·마진·이윤·매출·정산 조회. STAFF 차단.
 * ADMIN은 transition 동안 OWNER와 동일 취급, S-RBAC-2서 제거.
 */
export const canViewFinance = (r?: Role): boolean =>
  r === "OWNER" || r === "MANAGER" || r === "ADMIN";

/**
 * 시스템 통제 — 계정·설정·감사로그·정산 최종승인·요율 마스터. OWNER 전용.
 * ADMIN은 transition 동안 OWNER와 동일 취급, S-RBAC-2서 제거.
 */
export const isSystemAdmin = (r?: Role): boolean => r === "OWNER" || r === "ADMIN";

/**
 * 위험작업 — force-sellable(검수 게이트 오버라이드, ADR-0012)·삭제 등. STAFF 차단.
 * ADMIN은 transition 동안 OWNER와 동일 취급, S-RBAC-2서 제거.
 */
export const canOverrideGate = (r?: Role): boolean =>
  r === "OWNER" || r === "MANAGER" || r === "ADMIN";

/**
 * 가격이 걸린 작업 — 제안링크 생성·가격 설정 등. STAFF 차단.
 * ADMIN은 transition 동안 OWNER와 동일 취급, S-RBAC-2서 제거.
 */
export const canSetPrice = (r?: Role): boolean =>
  r === "OWNER" || r === "MANAGER" || r === "ADMIN";
