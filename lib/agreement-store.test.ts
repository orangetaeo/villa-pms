import { describe, expect, it, vi } from "vitest";

// 실제 PrismaClient 차단 (agreement.test.ts 패턴) — 함수엔 fake db를 명시 주입
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  AGREEMENT_LANGS,
  AGREEMENT_CONTENT_KEY,
  AGREEMENT_HISTORY_KEY,
  buildDefaultAgreementContent,
  validateAgreementContent,
  normalizeAgreementContent,
  agreementVersionLabel,
  type AgreementContent,
} from "./agreement";
import { getAgreementContent, saveAgreementContent } from "./agreement-store";

// 인메모리 AppSetting fake — DbClient 형태(appSetting.findUnique/upsert)만 구현
function makeDb() {
  const rows = new Map<string, { key: string; value: string }>();
  const db = {
    appSetting: {
      findUnique: async ({ where: { key } }: { where: { key: string } }) =>
        rows.get(key) ?? null,
      upsert: async ({
        where: { key },
        create,
        update,
      }: {
        where: { key: string };
        create: { key: string; value: string };
        update: { value: string };
      }) => {
        const existing = rows.get(key);
        const value = existing ? update.value : create.value;
        const row = { key, value };
        rows.set(key, row);
        return row;
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, rows };
}

// ===================== 순수 헬퍼 =====================

describe("buildDefaultAgreementContent — 코드 상수 시드", () => {
  it("rev 1 + 모든 언어의 제목·본문이 채워져 검증 통과", () => {
    const c = buildDefaultAgreementContent();
    expect(c.rev).toBe(1);
    expect(c.updatedAt).toBe("");
    for (const lang of AGREEMENT_LANGS) {
      expect(c.docTitle[lang].length).toBeGreaterThan(0);
      expect(c.body[lang].length).toBeGreaterThan(0);
      // 본문은 번호 매긴 다줄 텍스트 — "1." 로 시작
      expect(c.body[lang]).toContain("1.");
    }
    expect(validateAgreementContent(c)).toEqual({ ok: true });
  });
});

describe("validateAgreementContent — 법적 완결성", () => {
  it("한 언어의 본문이라도 비면 missing에 잡힌다", () => {
    const c = buildDefaultAgreementContent();
    c.body.vi = "   "; // 공백만 = 비어있음
    const r = validateAgreementContent(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("body.vi");
  });

  it("docTitle 누락도 잡힌다", () => {
    const c = buildDefaultAgreementContent();
    c.docTitle.ru = "";
    const r = validateAgreementContent(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("docTitle.ru");
  });
});

describe("normalizeAgreementContent — 정규화·rev 증가·키 화이트리스트", () => {
  it("알 수 없는 언어 키를 제거하고 trim, rev는 prev+1", () => {
    const raw = {
      rev: 999, // 클라이언트가 보낸 rev는 무시되어야 함
      docTitle: { ko: "  제목  ", xx: "침입" },
      body: { ko: "  1. 본문  ", evil: "주입" },
    };
    const next = normalizeAgreementContent(raw, 4);
    expect(next.rev).toBe(5); // prev+1, 999 무시
    expect(next.docTitle.ko).toBe("제목"); // trim
    expect((next.docTitle as Record<string, string>).xx).toBeUndefined();
    expect(next.body.ko).toBe("1. 본문"); // trim
    expect((next.body as Record<string, string>).evil).toBeUndefined();
    // 누락 언어는 빈 문자열로 채워짐(검증에서 INCOMPLETE로 걸림)
    expect(next.body.vi).toBe("");
  });
});

describe("agreementVersionLabel", () => {
  it("r{rev} 형식", () => {
    expect(agreementVersionLabel({ rev: 3 } as AgreementContent)).toBe("r3");
  });
});

// ===================== 저장소 (fake db) =====================

describe("getAgreementContent — 폴백 안전성", () => {
  it("미저장이면 코드 기본값(rev 1)", async () => {
    const { db } = makeDb();
    const c = await getAgreementContent(db);
    expect(c.rev).toBe(1);
  });

  it("저장된 발행본을 그대로 반환", async () => {
    const { db, rows } = makeDb();
    const saved = { ...buildDefaultAgreementContent(), rev: 7, updatedAt: "2026-06-25T00:00:00Z" };
    rows.set(AGREEMENT_CONTENT_KEY, { key: AGREEMENT_CONTENT_KEY, value: JSON.stringify(saved) });
    const c = await getAgreementContent(db);
    expect(c.rev).toBe(7);
  });

  it("손상된 JSON이면 기본값으로 폴백(체크인 차단 방지)", async () => {
    const { db, rows } = makeDb();
    rows.set(AGREEMENT_CONTENT_KEY, { key: AGREEMENT_CONTENT_KEY, value: "{깨진 json" });
    const c = await getAgreementContent(db);
    expect(c.rev).toBe(1);
  });
});

describe("saveAgreementContent — 발행 + 이력 보존", () => {
  it("첫 저장은 이력 없이 본문만 기록", async () => {
    const { db, rows } = makeDb();
    const next = normalizeAgreementContent(buildDefaultAgreementContent(), 1);
    await saveAgreementContent(db, next);
    expect(rows.has(AGREEMENT_CONTENT_KEY)).toBe(true);
    expect(rows.has(AGREEMENT_HISTORY_KEY)).toBe(false);
  });

  it("두 번째 저장은 직전 발행본을 이력에 append", async () => {
    const { db, rows } = makeDb();
    const v2 = normalizeAgreementContent(buildDefaultAgreementContent(), 1); // rev 2
    await saveAgreementContent(db, v2);
    const v3 = normalizeAgreementContent(buildDefaultAgreementContent(), 2); // rev 3
    await saveAgreementContent(db, v3);

    const current = JSON.parse(rows.get(AGREEMENT_CONTENT_KEY)!.value) as AgreementContent;
    expect(current.rev).toBe(3);
    const history = JSON.parse(rows.get(AGREEMENT_HISTORY_KEY)!.value) as AgreementContent[];
    expect(history).toHaveLength(1);
    expect(history[0].rev).toBe(2);
  });

  it("이력은 최대 20개로 잘린다 (오래된 것 제거)", async () => {
    const { db, rows } = makeDb();
    for (let i = 1; i <= 25; i++) {
      await saveAgreementContent(db, normalizeAgreementContent(buildDefaultAgreementContent(), i));
    }
    const history = JSON.parse(rows.get(AGREEMENT_HISTORY_KEY)!.value) as AgreementContent[];
    expect(history.length).toBe(20);
  });
});
