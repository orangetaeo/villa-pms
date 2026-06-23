// lib/permissions.ts 단위 테스트 — 운영자 권한 capability 헬퍼 (ADR-0013, S-RBAC-1)
// additive 전략 가드: ADMIN이 transition 동안 OWNER 경로에 포함됨을 검증한다.
// 돈 경계 { OWNER, MANAGER } vs STAFF, 시스템 통제 경계 OWNER 를 고정한다.
import { describe, it, expect } from "vitest";
import {
  isOperator,
  canViewFinance,
  isSystemAdmin,
  canOverrideGate,
  canSetPrice,
  type Role,
} from "@/lib/permissions";

describe("계약 완료기준 — 명시 케이스", () => {
  it("canViewFinance: STAFF는 돈 못 봄", () => {
    expect(canViewFinance("STAFF")).toBe(false);
  });
  it("canViewFinance: MANAGER는 돈 봄", () => {
    expect(canViewFinance("MANAGER")).toBe(true);
  });
  it("isSystemAdmin: MANAGER는 시스템 통제 없음", () => {
    expect(isSystemAdmin("MANAGER")).toBe(false);
  });
  it("isOperator: STAFF는 운영자 영역 통과", () => {
    expect(isOperator("STAFF")).toBe(true);
  });
  it("isSystemAdmin: ADMIN은 transition 동안 OWNER 동일취급 → true", () => {
    expect(isSystemAdmin("ADMIN")).toBe(true);
  });
});

describe("isOperator — 운영자 영역 (OWNER·MANAGER·STAFF·ADMIN transition)", () => {
  it.each<Role>(["OWNER", "MANAGER", "STAFF", "ADMIN"])("%s 통과", (r) => {
    expect(isOperator(r)).toBe(true);
  });
  it.each<Role>(["SUPPLIER", "CLEANER"])("%s 차단", (r) => {
    expect(isOperator(r)).toBe(false);
  });
  it("undefined 차단", () => {
    expect(isOperator(undefined)).toBe(false);
  });
});

describe("canViewFinance — 돈 경계 { OWNER, MANAGER, ADMIN } vs STAFF", () => {
  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s 봄", (r) => {
    expect(canViewFinance(r)).toBe(true);
  });
  it.each<Role>(["STAFF", "SUPPLIER", "CLEANER"])("%s 차단", (r) => {
    expect(canViewFinance(r)).toBe(false);
  });
  it("undefined 차단", () => {
    expect(canViewFinance(undefined)).toBe(false);
  });
});

describe("isSystemAdmin — 시스템 통제 (OWNER·ADMIN transition만)", () => {
  it.each<Role>(["OWNER", "ADMIN"])("%s 통과", (r) => {
    expect(isSystemAdmin(r)).toBe(true);
  });
  it.each<Role>(["MANAGER", "STAFF", "SUPPLIER", "CLEANER"])("%s 차단", (r) => {
    expect(isSystemAdmin(r)).toBe(false);
  });
  it("undefined 차단", () => {
    expect(isSystemAdmin(undefined)).toBe(false);
  });
});

describe("canOverrideGate — 위험작업 (OWNER·MANAGER·ADMIN, STAFF 차단)", () => {
  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s 통과", (r) => {
    expect(canOverrideGate(r)).toBe(true);
  });
  it.each<Role>(["STAFF", "SUPPLIER", "CLEANER"])("%s 차단", (r) => {
    expect(canOverrideGate(r)).toBe(false);
  });
});

describe("canSetPrice — 가격작업 (OWNER·MANAGER·ADMIN, STAFF 차단)", () => {
  it.each<Role>(["OWNER", "MANAGER", "ADMIN"])("%s 통과", (r) => {
    expect(canSetPrice(r)).toBe(true);
  });
  it.each<Role>(["STAFF", "SUPPLIER", "CLEANER"])("%s 차단", (r) => {
    expect(canSetPrice(r)).toBe(false);
  });
});
