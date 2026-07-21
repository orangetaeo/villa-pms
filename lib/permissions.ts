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
//   PARTNER = 여행사·랜드사 로그인 계정(ADR-0028). 운영자 아님 — 자기 고객 예약·미수만.
export type Role = "OWNER" | "MANAGER" | "STAFF" | "ADMIN" | "SUPPLIER" | "CLEANER" | "VENDOR" | "PARTNER";

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

/** 파트너(여행사·랜드사 로그인 계정, ADR-0028). 운영자 아님 — 자기 고객 예약·미수·받은 제안서만. */
export function isPartner(r?: Role): r is "PARTNER" {
  return r === "PARTNER";
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

/**
 * 마케팅 화면(인스타그램·유튜브)을 볼 수 있는 계정 — 역할이 아니라 **특정 계정** 단일 전화번호로 제한.
 * 운영자 지시(2026-07-21): 테오 개인 계정 0799493138만 노출(다른 OWNER·운영자도 숨김).
 * 계정이 재생성돼도 번호만 같으면 유지. 확장이 필요하면 배열에 추가하거나 AppSetting으로 전환.
 * 비교 시 숫자만 정규화(로그인 폼과 동일 규칙, lib/password-reset.normalizePhone).
 */
export const MARKETING_ALLOWED_PHONES = ["0799493138"];
export const canSeeMarketing = (phone?: string | null): boolean => {
  if (!phone) return false;
  const digits = phone.replace(/[^0-9]/g, "");
  return MARKETING_ALLOWED_PHONES.some((p) => p.replace(/[^0-9]/g, "") === digits);
};

/**
 * 공급자 직접 판매 링크 생성 — SUPPLIER 전용 (F10 Phase B, ADR-0021 §7).
 * 운영자의 canSetPrice(제안 링크·요율 마스터)와 **완전 분리**한다: 이건 공급자가
 * 자기 빌라를 자기 가격(supplierSalePriceVnd)으로 직접 판매하는 권한이고,
 * 운영자 마진·판매가와 무관하다. 운영자는 이 권한 없음(자기 빌라가 아님).
 */
export const canCreateSupplierLink = (r?: Role): boolean => r === "SUPPLIER";
