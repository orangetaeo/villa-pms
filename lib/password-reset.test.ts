import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// 실제 PrismaClient 생성 차단 — passwordResetToken 접근자만 stateful mock으로 주입 (T1.6 패턴).
const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    passwordResetToken: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import {
  normalizePhone,
  generateResetCode,
  buildResetCodeMessage,
  verifyResetCode,
  RESET_MAX_ATTEMPTS,
} from "./password-reset";

// ===================== 순수 헬퍼 (기존 통과 테스트 유지) =====================

describe("password-reset 순수 헬퍼", () => {
  it("normalizePhone — 숫자만 남긴다(로그인 폼과 동일 규칙)", () => {
    expect(normalizePhone("0123-456-789")).toBe("0123456789");
    expect(normalizePhone("+84 90 123 4567")).toBe("84901234567");
    expect(normalizePhone("abc")).toBe("");
  });

  it("generateResetCode — 항상 6자리 숫자 문자열(선행 0 보존)", () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateResetCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(6);
    }
  });

  it("buildResetCodeMessage — 코드를 포함하고 vi·ko 안내 병기", () => {
    const msg = buildResetCodeMessage("042195");
    expect(msg).toContain("042195");
    expect(msg).toContain("Villa Go");
    expect(msg).toContain("10 phút");
    expect(msg).toContain("10분");
  });
});

// ===================== verifyResetCode 음성 케이스 (D4 — 보안 핵심) =====================

const GOOD_CODE = "123456";
const BAD_CODE = "000000";

/** 유효한 codeHash를 가진 토큰 픽스처 */
async function makeToken(
  over: Partial<{
    id: string;
    expiresAt: Date;
    usedAt: Date | null;
    attempts: number;
  }> = {}
) {
  return {
    id: over.id ?? "tok1",
    codeHash: await bcrypt.hash(GOOD_CODE, 10),
    expiresAt: over.expiresAt ?? new Date(Date.now() + 5 * 60_000), // 기본 미만료
    usedAt: over.usedAt ?? null,
    attempts: over.attempts ?? 0,
  };
}

describe("verifyResetCode (음성·정상 경로)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({});
  });

  it("1) 만료 토큰(expiresAt<now) → EXPIRED 거부 (update 미호출)", async () => {
    mockFindFirst.mockResolvedValue(
      await makeToken({ expiresAt: new Date(Date.now() - 1_000) })
    );
    const res = await verifyResetCode("u1", GOOD_CODE);
    expect(res).toEqual({ ok: false, reason: "EXPIRED" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("2) 사용된 토큰(usedAt!=null) → 미사용만 조회되므로 NO_TOKEN 거부", async () => {
    // findFirst의 where:{usedAt:null} 계약상 사용된 토큰은 조회되지 않는다 → null 반환.
    mockFindFirst.mockResolvedValue(null);
    const res = await verifyResetCode("u1", GOOD_CODE);
    expect(res).toEqual({ ok: false, reason: "NO_TOKEN" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("3) attempts>=5 → 토큰 폐기(usedAt 세팅) + TOO_MANY_ATTEMPTS 거부", async () => {
    mockFindFirst.mockResolvedValue(
      await makeToken({ id: "tokX", attempts: RESET_MAX_ATTEMPTS })
    );
    const res = await verifyResetCode("u1", GOOD_CODE);
    expect(res).toEqual({ ok: false, reason: "TOO_MANY_ATTEMPTS" });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const arg = mockUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { usedAt?: Date };
    };
    expect(arg.where.id).toBe("tokX");
    expect(arg.data.usedAt).toBeInstanceOf(Date);
  });

  it("4) 오코드 → attempts 증가 + WRONG_CODE (상한 미달이면 폐기 안 함)", async () => {
    mockFindFirst.mockResolvedValue(await makeToken({ id: "tokY", attempts: 1 }));
    const res = await verifyResetCode("u1", BAD_CODE);
    expect(res).toEqual({ ok: false, reason: "WRONG_CODE" });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const arg = mockUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { attempts: number; usedAt?: Date };
    };
    expect(arg.data.attempts).toBe(2); // 1 → 2
    expect(arg.data.usedAt).toBeUndefined(); // 상한 미달 → 폐기 안 함
  });

  it("4b) 오코드로 상한 도달(4→5) → attempts 증가 + 즉시 폐기(usedAt)", async () => {
    mockFindFirst.mockResolvedValue(
      await makeToken({ id: "tokZ", attempts: RESET_MAX_ATTEMPTS - 1 })
    );
    const res = await verifyResetCode("u1", BAD_CODE);
    expect(res).toEqual({ ok: false, reason: "WRONG_CODE" });
    const arg = mockUpdate.mock.calls[0][0] as {
      data: { attempts: number; usedAt?: Date };
    };
    expect(arg.data.attempts).toBe(RESET_MAX_ATTEMPTS);
    expect(arg.data.usedAt).toBeInstanceOf(Date); // 상한 도달 → 폐기
  });

  it("5) 정상 코드 → 성공(tokenId 반환). 성공 경로는 verifyResetCode가 토큰을 건드리지 않음", async () => {
    mockFindFirst.mockResolvedValue(await makeToken({ id: "tokOK" }));
    const res = await verifyResetCode("u1", GOOD_CODE);
    expect(res).toEqual({ ok: true, tokenId: "tokOK" });
    // usedAt 기록은 reset-password 라우트 트랜잭션이 담당 → 여기선 update 미호출
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
