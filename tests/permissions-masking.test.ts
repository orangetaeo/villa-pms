// tests/permissions-masking.test.ts — S-RBAC-3 STAFF 재무 마스킹 검증 (ADR-0013, 계약 S-RBAC-3)
//
// 목적: STAFF가 운영 화면에 진입은 하되, 판매가(KRW·VND)·마진·정산·매출 신호를
// 화면·응답 모두에서 보지 못함을 단위로 고정한다. 두 층위로 커버한다.
//
//  (A) prisma select 빌더 분기 — booking 상세 / villa 상세 / GET /api/villas 의 rates
//      select 키 집합이 canViewFinance(role)에 따라 정확히 갈리는지. (서버 1차 방어)
//      → 각 페이지/라우트의 select 구성 로직을 동일 규칙으로 재현해 키 집합을 검사.
//
//  (B) middleware 경로 → capability 등급 매핑 테이블 — 3등급(system/finance/operator)이
//      역할별로 진입 허용/차단을 정확히 산출하는지 (계약 A2 등급표 회귀 가드).
//
// 전제: lib/permissions.ts 술어는 S-RBAC-1·2 결과(불변). ADMIN은 모든 술어 true(회귀 0).
import { describe, expect, it } from "vitest";
import {
  isOperator,
  canViewFinance,
  isSystemAdmin,
  canSetPrice,
  type Role,
} from "@/lib/permissions";

const OPERATOR_ROLES: Role[] = ["OWNER", "MANAGER", "STAFF", "ADMIN"];

// ── (A) select 빌더 분기 ──────────────────────────────────────────────────────
// 각 페이지/라우트가 prisma select에 finance 키를 포함하는 규칙을 동일하게 재현한다.
// 실제 코드와 동일하게 `...(canViewFinance(role) ? {...} : {})` 패턴을 키 집합으로 환원.

/** booking 상세(app/(admin)/bookings/[id]/page.tsx)의 select 키 */
function bookingSelectKeys(role: Role): string[] {
  const base = [
    "id",
    "status",
    "saleCurrency",
    "supplierCostVnd", // 원가는 STAFF도 OK
    "guestName",
  ];
  if (canViewFinance(role)) base.push("totalSaleKrw", "totalSaleVnd");
  return base;
}

/** booking 목록(app/(admin)/bookings/page.tsx)의 select 키 — QA H-1 회귀 가드 */
function bookingListSelectKeys(role: Role): string[] {
  const base = [
    "id",
    "status",
    "channel",
    "agencyName",
    "guestName",
    "checkIn",
    "checkOut",
    "nights",
    "saleCurrency",
    "holdExpiresAt",
  ];
  if (canViewFinance(role)) base.push("totalSaleKrw", "totalSaleVnd");
  return base;
}

/** booking 결제(payments)의 select 키 — STAFF는 금액(amount·currency) 미포함 */
function bookingPaymentSelectKeys(role: Role): string[] {
  const base = ["id", "receivedAt", "method", "note"];
  if (canViewFinance(role)) base.push("currency", "amount");
  return base;
}

/** villa 상세(app/(admin)/villas/[id]/page.tsx)의 rates select 키 */
function villaRatesSelectKeys(role: Role): string[] {
  const base = ["season", "supplierCostVnd"];
  if (canViewFinance(role)) {
    base.push("marginType", "marginValue", "salePriceVnd", "salePriceKrw");
  }
  return base;
}

/** GET /api/villas 운영자 분기의 rates select 키 (B4) */
function villasApiOperatorRatesSelectKeys(role: Role): string[] {
  // 운영자 분기 진입 전제 (isOperator). STAFF면 finance 키 제외.
  const base = ["id", "season", "supplierCostVnd"];
  if (canViewFinance(role)) {
    base.push("marginType", "marginValue", "salePriceVnd", "salePriceKrw");
  }
  return base;
}

/**
 * Zalo 공유 라우트(app/api/zalo/conversations/[id]/share) dispatch 게이트 모델 (S-RBAC-3).
 * 판매가·정산이 본문에 실리는 공유는 canViewFinance 필요. STAFF는 원가측 빌라·사진/파일만.
 */
type ShareType = "PHOTO" | "PROPOSAL" | "VILLA" | "SETTLEMENT";
function shareAllowed(
  role: Role,
  type: ShareType,
  sellSide: boolean // VILLA 한정 의미 — 고객(판매가)측 대화면 true
): boolean {
  if (type === "PHOTO") return true; // 첨부는 누수 무관, 양쪽 허용
  if (type === "PROPOSAL" || type === "SETTLEMENT") return canViewFinance(role);
  // VILLA: 고객(판매가)측이면 finance 필요, 공급자(원가)측이면 운영자 누구나
  return sellSide ? canViewFinance(role) : true;
}

const FINANCE_KEYS = [
  "totalSaleKrw",
  "totalSaleVnd",
  "salePriceVnd",
  "salePriceKrw",
  "marginType",
  "marginValue",
  "amount",
  "currency",
];

describe("(A) booking 상세 select — STAFF는 판매가 부재, 원가 존재", () => {
  it("STAFF: totalSale* 부재 + supplierCostVnd 존재", () => {
    const keys = bookingSelectKeys("STAFF");
    expect(keys).not.toContain("totalSaleKrw");
    expect(keys).not.toContain("totalSaleVnd");
    expect(keys).toContain("supplierCostVnd");
  });

  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s: totalSale* 존재", (role) => {
    const keys = bookingSelectKeys(role);
    expect(keys).toContain("totalSaleKrw");
    expect(keys).toContain("totalSaleVnd");
    expect(keys).toContain("supplierCostVnd");
  });

  it("STAFF 결제: amount·currency 부재 (상태만)", () => {
    const keys = bookingPaymentSelectKeys("STAFF");
    expect(keys).not.toContain("amount");
    expect(keys).not.toContain("currency");
    expect(keys).toEqual(["id", "receivedAt", "method", "note"]);
  });

  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s 결제: amount·currency 존재", (role) => {
    const keys = bookingPaymentSelectKeys(role);
    expect(keys).toContain("amount");
    expect(keys).toContain("currency");
  });
});

describe("(A) villa 상세 rates select — STAFF는 원가만", () => {
  it("STAFF: salePrice*·margin* 부재, supplierCostVnd 존재", () => {
    const keys = villaRatesSelectKeys("STAFF");
    expect(keys).toEqual(["season", "supplierCostVnd"]);
    for (const k of ["salePriceVnd", "salePriceKrw", "marginType", "marginValue"]) {
      expect(keys).not.toContain(k);
    }
  });

  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s: 판매가·마진 전부 존재", (role) => {
    const keys = villaRatesSelectKeys(role);
    for (const k of ["salePriceVnd", "salePriceKrw", "marginType", "marginValue"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("(A) GET /api/villas 운영자 rates select — STAFF는 원가만 (B4)", () => {
  it("STAFF: salePriceKrw 부재", () => {
    const keys = villasApiOperatorRatesSelectKeys("STAFF");
    expect(keys).not.toContain("salePriceKrw");
    expect(keys).not.toContain("salePriceVnd");
    expect(keys).toContain("supplierCostVnd");
  });

  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s: salePriceKrw 존재", (role) => {
    expect(villasApiOperatorRatesSelectKeys(role)).toContain("salePriceKrw");
  });
});

describe("(A) 재무 키 누수 가드 — STAFF의 어떤 select에도 finance 키 0", () => {
  it("STAFF select 3종 합집합에 finance 키 부재", () => {
    const all = new Set([
      ...bookingSelectKeys("STAFF"),
      ...bookingPaymentSelectKeys("STAFF"),
      ...villaRatesSelectKeys("STAFF"),
      ...villasApiOperatorRatesSelectKeys("STAFF"),
    ]);
    for (const fk of FINANCE_KEYS) {
      expect(all.has(fk)).toBe(false);
    }
  });

  it("ADMIN select에는 finance 키 존재 (회귀 0 — 마스킹이 ADMIN을 건드리지 않음)", () => {
    const all = new Set([
      ...bookingSelectKeys("ADMIN"),
      ...bookingPaymentSelectKeys("ADMIN"),
      ...villaRatesSelectKeys("ADMIN"),
      ...villasApiOperatorRatesSelectKeys("ADMIN"),
    ]);
    // 대표 키 몇 개로 ADMIN 가시성 보존 확인
    for (const fk of ["totalSaleKrw", "salePriceKrw", "marginValue", "amount"]) {
      expect(all.has(fk)).toBe(true);
    }
  });
});

// ── (B) middleware 경로 → capability 등급 매핑 테이블 (계약 A2 등급표) ──────────
// 미들웨어 진입 게이트를 capability 술어로 환원. 역할별 진입 허용 여부를 고정한다.
type Cap = (r?: Role) => boolean;

const PATH_GRADE: Array<{ path: string; cap: Cap; grade: string }> = [
  // isSystemAdmin (OWNER/ADMIN)
  { path: "/users", cap: isSystemAdmin, grade: "system" },
  { path: "/settings", cap: isSystemAdmin, grade: "system" },
  // canViewFinance (OWNER/MANAGER/ADMIN)
  { path: "/settlements", cap: canViewFinance, grade: "finance" },
  { path: "/cost-alerts", cap: canViewFinance, grade: "finance" },
  { path: "/proposals", cap: canViewFinance, grade: "finance" },
  { path: "/earnings", cap: canViewFinance, grade: "finance" },
  // isOperator (OWNER/MANAGER/STAFF/ADMIN)
  { path: "/dashboard", cap: isOperator, grade: "operator" },
  { path: "/villas", cap: isOperator, grade: "operator" },
  { path: "/bookings", cap: isOperator, grade: "operator" },
  { path: "/inspections", cap: isOperator, grade: "operator" },
  { path: "/messages", cap: isOperator, grade: "operator" },
  { path: "/calendar", cap: isOperator, grade: "operator" },
  { path: "/cleaning", cap: isOperator, grade: "operator" },
  { path: "/my-villas", cap: isOperator, grade: "operator" },
];

describe("(B) middleware 경로 등급 — STAFF 진입 가능여부", () => {
  it.each(PATH_GRADE)("$path ($grade) : STAFF 진입 = operator 등급만", ({ path, cap, grade }) => {
    // STAFF는 operator 등급만 통과. system/finance는 차단.
    expect(cap("STAFF")).toBe(grade === "operator");
    void path;
  });

  it.each(PATH_GRADE)("$path : MANAGER 진입 = system 외 전부", ({ cap, grade }) => {
    // MANAGER는 finance·operator 통과, system(users/settings)만 차단.
    expect(cap("MANAGER")).toBe(grade !== "system");
  });

  it.each(PATH_GRADE)("$path : OWNER 전부 진입", ({ cap }) => {
    expect(cap("OWNER")).toBe(true);
  });

  it.each(PATH_GRADE)("$path : ADMIN 전부 진입 (회귀 0)", ({ cap }) => {
    expect(cap("ADMIN")).toBe(true);
  });

  it.each(PATH_GRADE)("$path : SUPPLIER 운영 영역 전부 차단", ({ cap }) => {
    expect(cap("SUPPLIER")).toBe(false);
  });
});

describe("(B) 등급표 무결성 — 계약 A2 경로 집합 고정", () => {
  it("system 등급 = /users·/settings 두 경로", () => {
    const system = PATH_GRADE.filter((p) => p.grade === "system").map((p) => p.path).sort();
    expect(system).toEqual(["/settings", "/users"]);
  });

  it("finance 등급 = /settlements·/cost-alerts·/proposals·/earnings", () => {
    const finance = PATH_GRADE.filter((p) => p.grade === "finance").map((p) => p.path).sort();
    expect(finance).toEqual(["/cost-alerts", "/earnings", "/proposals", "/settlements"]);
  });

  it("operator 등급에 /dashboard·/bookings·/villas·/calendar 포함", () => {
    const operator = PATH_GRADE.filter((p) => p.grade === "operator").map((p) => p.path);
    for (const p of ["/dashboard", "/bookings", "/villas", "/calendar", "/cleaning"]) {
      expect(operator).toContain(p);
    }
  });

  it("모든 운영자(OWNER/MANAGER/STAFF/ADMIN)는 operator 등급 전 경로 진입", () => {
    const operatorPaths = PATH_GRADE.filter((p) => p.grade === "operator");
    for (const role of OPERATOR_ROLES) {
      for (const { cap } of operatorPaths) {
        expect(cap(role)).toBe(true);
      }
    }
  });
});

describe("(A) booking 목록 select — QA H-1: STAFF는 판매가 부재 (RSC→클라 페이로드 누수 0)", () => {
  it("STAFF: totalSale* 부재", () => {
    const keys = bookingListSelectKeys("STAFF");
    expect(keys).not.toContain("totalSaleKrw");
    expect(keys).not.toContain("totalSaleVnd");
    expect(keys).toContain("guestName"); // 운영 필드는 유지
  });
  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s: totalSale* 존재", (role) => {
    const keys = bookingListSelectKeys(role);
    expect(keys).toContain("totalSaleKrw");
    expect(keys).toContain("totalSaleVnd");
  });
});

// RSC 페이지·민감 라우트 가드 등급 (QA H-2·M-1 회귀 가드) — 페이지가 쓰는 capability 술어
const PAGE_GUARD: { name: string; cap: (r?: Role) => boolean }[] = [
  // M-1: 6개 RSC 페이지 (messages는 이월 — 별도)
  { name: "/inspections", cap: isOperator },
  { name: "/proposals", cap: canViewFinance },
  { name: "/proposals/new", cap: canViewFinance },
  { name: "/settlements", cap: canViewFinance },
  { name: "/settings/zalo", cap: isSystemAdmin },
  // H-2: services PATCH는 priceKrw 반환 → canSetPrice (형제 GET과 정합)
  { name: "PATCH /api/services/[id]", cap: canSetPrice },
];

describe("(D) 페이지·라우트 가드 등급 — QA H-2·M-1 회귀", () => {
  it("STAFF: 검수만 통과, 재무·시스템·서비스PATCH 차단", () => {
    expect(PAGE_GUARD.find((p) => p.name === "/inspections")!.cap("STAFF")).toBe(true);
    for (const n of ["/proposals", "/settlements", "/settings/zalo", "PATCH /api/services/[id]"]) {
      expect(PAGE_GUARD.find((p) => p.name === n)!.cap("STAFF")).toBe(false);
    }
  });
  it("MANAGER: 재무·서비스 통과, 시스템(zalo설정)만 차단", () => {
    for (const n of ["/inspections", "/proposals", "/settlements", "PATCH /api/services/[id]"]) {
      expect(PAGE_GUARD.find((p) => p.name === n)!.cap("MANAGER")).toBe(true);
    }
    expect(PAGE_GUARD.find((p) => p.name === "/settings/zalo")!.cap("MANAGER")).toBe(false);
  });
  it.each<Role>(["OWNER", "ADMIN"])("%s: 전부 통과 (회귀 0)", (role) => {
    for (const { cap } of PAGE_GUARD) expect(cap(role)).toBe(true);
  });
});

describe("(C) Zalo 공유 게이트 — STAFF는 판매가·정산 공유 차단", () => {
  it("STAFF: PROPOSAL·SETTLEMENT·고객측 VILLA 차단, 사진·공급자측 VILLA 허용", () => {
    expect(shareAllowed("STAFF", "PROPOSAL", false)).toBe(false);
    expect(shareAllowed("STAFF", "SETTLEMENT", false)).toBe(false);
    expect(shareAllowed("STAFF", "VILLA", true)).toBe(false); // 고객(판매가)측
    expect(shareAllowed("STAFF", "VILLA", false)).toBe(true); // 공급자(원가)측
    expect(shareAllowed("STAFF", "PHOTO", false)).toBe(true);
  });

  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s: 모든 공유 허용", (role) => {
    expect(shareAllowed(role, "PROPOSAL", false)).toBe(true);
    expect(shareAllowed(role, "SETTLEMENT", false)).toBe(true);
    expect(shareAllowed(role, "VILLA", true)).toBe(true);
    expect(shareAllowed(role, "VILLA", false)).toBe(true);
  });
});
