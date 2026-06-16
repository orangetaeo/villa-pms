// lib/intl-messages 회귀 테스트 (T-util-tests)
// [QA D-2/D-2b] 누수 방지 화이트리스트 — admin 라벨(마진·판매가)이 공급자·공개
// 화면 RSC payload로 새는 경로를 차단. 이 가드가 깨지면 마진 비공개 원칙 위반.
import { describe, it, expect } from "vitest";
import type { AbstractIntlMessages } from "next-intl";
import { pickMessages } from "./intl-messages";

const ALL: AbstractIntlMessages = {
  auth: { login: "Đăng nhập" },
  myVillas: { title: "Villa của tôi" },
  adminSettings: { margin: "마진", salePrice: "판매가" }, // 누수 위험 라벨
  adminBookings: { revenue: "매출" },
};

describe("pickMessages — 화이트리스트만 통과", () => {
  it("나열한 네임스페이스만 포함", () => {
    const picked = pickMessages(ALL, ["auth", "myVillas"]);
    expect(Object.keys(picked).sort()).toEqual(["auth", "myVillas"]);
  });

  it("누수 가드 — admin 네임스페이스는 공급자 화이트리스트에서 제외", () => {
    const picked = pickMessages(ALL, ["auth", "myVillas"]);
    expect(picked.adminSettings).toBeUndefined();
    expect(picked.adminBookings).toBeUndefined();
    // 마진·판매가 라벨이 결과 어디에도 직렬화되지 않음
    expect(JSON.stringify(picked)).not.toContain("마진");
    expect(JSON.stringify(picked)).not.toContain("판매가");
  });

  it("존재하지 않는 네임스페이스는 조용히 무시 (키 미생성)", () => {
    const picked = pickMessages(ALL, ["auth", "doesNotExist"]);
    expect(Object.keys(picked)).toEqual(["auth"]);
    expect("doesNotExist" in picked).toBe(false);
  });

  it("빈 화이트리스트 → 빈 객체", () => {
    expect(pickMessages(ALL, [])).toEqual({});
  });

  it("원본 불변 — 입력 객체 변형 없음", () => {
    const snapshot = JSON.stringify(ALL);
    const picked = pickMessages(ALL, ["auth"]);
    expect(JSON.stringify(ALL)).toBe(snapshot); // 원본 그대로
    // 얕은 복사라도 원본 참조를 통한 오염이 없어야 함
    expect(picked.auth).toBe(ALL.auth);
  });
});
