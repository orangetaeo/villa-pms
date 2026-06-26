// lib/fx-auto-update 순수 로직 테스트 (Phase 2 — 판매가 환율 opt-in 자동 갱신)
import { describe, it, expect } from "vitest";
import {
  isFxAutoUpdateOn,
  formatFxVndPerKrw,
  runFxAutoUpdate,
  FX_AUTO_UPDATE_KEY,
} from "./fx-auto-update";
import { FX_VND_PER_KRW_KEY } from "./pricing";
import type { DailyRates } from "./fx-rates";

// ── 가짜 DB (AppSetting Map + AuditLog 수집) — getRates 주입으로 네트워크 분리 ──
function makeDb(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const audits: Array<Record<string, unknown>> = [];
  const upserts: Array<{ key: string; value: string }> = [];
  const db = {
    appSetting: {
      async findUnique({ where }: { where: { key: string } }) {
        return store.has(where.key) ? { value: store.get(where.key)! } : null;
      },
      async upsert({
        where,
        update,
      }: {
        where: { key: string };
        create: { key: string; value: string };
        update: { value: string };
      }) {
        store.set(where.key, update.value);
        upserts.push({ key: where.key, value: update.value });
        return {};
      },
    },
    auditLog: {
      async create({ data }: { data: Record<string, unknown> }) {
        audits.push(data);
        return {};
      },
    },
  };
  // runFxAutoUpdate의 FxAutoDbClient 형태로 사용 (테스트 한정 캐스팅)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, store, audits, upserts };
}

const rates = (krw: number): DailyRates => ({
  date: "2026-06-26",
  vndPerUnit: { KRW: krw, USD: 26000, RUB: 280, CNY: 3600 },
});

describe("isFxAutoUpdateOn", () => {
  it("정확히 'on'일 때만 true (보수적)", () => {
    expect(isFxAutoUpdateOn("on")).toBe(true);
    expect(isFxAutoUpdateOn("off")).toBe(false);
    expect(isFxAutoUpdateOn(null)).toBe(false);
    expect(isFxAutoUpdateOn(undefined)).toBe(false);
    expect(isFxAutoUpdateOn("ON")).toBe(false);
    expect(isFxAutoUpdateOn("true")).toBe(false);
  });
});

describe("formatFxVndPerKrw — FX_VND_PER_KRW 파서 호환", () => {
  it("소수 4자리 반올림 + 뒤 0/소수점 정리", () => {
    expect(formatFxVndPerKrw(18.5)).toBe("18.5");
    expect(formatFxVndPerKrw(18.54325)).toBe("18.5433"); // 반올림
    expect(formatFxVndPerKrw(18.54321)).toBe("18.5432");
    expect(formatFxVndPerKrw(20)).toBe("20"); // 정수 — 소수점 없음
    expect(formatFxVndPerKrw(18.543)).toBe("18.543");
  });
  it("결과는 항상 lib/pricing 파서 형식(/^\\d+(\\.\\d{1,4})?$/)에 부합", () => {
    for (const n of [18.5, 18.54325, 20, 1.0001, 999.9999]) {
      const s = formatFxVndPerKrw(n);
      expect(s).not.toBeNull();
      expect(s!).toMatch(/^\d+(\.\d{1,4})?$/);
    }
  });
  it("0·음수·비유한·NaN은 null(갱신 보류)", () => {
    expect(formatFxVndPerKrw(0)).toBeNull();
    expect(formatFxVndPerKrw(-3)).toBeNull();
    expect(formatFxVndPerKrw(Number.NaN)).toBeNull();
    expect(formatFxVndPerKrw(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("runFxAutoUpdate", () => {
  it("토글 OFF(미설정) → skipped_off, 쓰기·로그 없음", async () => {
    const { db, store, upserts, audits } = makeDb({ [FX_VND_PER_KRW_KEY]: "18" });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(19) });
    expect(res.status).toBe("skipped_off");
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("18"); // 불변
    expect(upserts).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("토글 'off' 명시 → skipped_off", async () => {
    const { db } = makeDb({ [FX_AUTO_UPDATE_KEY]: "off" });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(19) });
    expect(res.status).toBe("skipped_off");
  });

  it("ON + 새 환율 → updated + FX_VND_PER_KRW 갱신 + AuditLog(userId null, source 표기)", async () => {
    const { db, store, upserts, audits } = makeDb({
      [FX_AUTO_UPDATE_KEY]: "on",
      [FX_VND_PER_KRW_KEY]: "18",
    });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(18.5432) });
    expect(res.status).toBe("updated");
    expect(res.oldValue).toBe("18");
    expect(res.newValue).toBe("18.5432");
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("18.5432");
    expect(upserts).toEqual([{ key: FX_VND_PER_KRW_KEY, value: "18.5432" }]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      userId: null,
      action: "UPDATE",
      entity: "AppSetting",
      entityId: FX_VND_PER_KRW_KEY,
    });
  });

  it("ON + 기존값 미설정 → updated (oldValue null)", async () => {
    const { db, store } = makeDb({ [FX_AUTO_UPDATE_KEY]: "on" });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(19) });
    expect(res.status).toBe("updated");
    expect(res.oldValue).toBeNull();
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("19");
  });

  it("ON + 동일값 → unchanged, 쓰기·로그 생략", async () => {
    const { db, upserts, audits } = makeDb({
      [FX_AUTO_UPDATE_KEY]: "on",
      [FX_VND_PER_KRW_KEY]: "18.5",
    });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(18.5) });
    expect(res.status).toBe("unchanged");
    expect(upserts).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("ON + 환율 조회 실패(null) → no_rate, 기존값 유지", async () => {
    const { db, store, upserts } = makeDb({
      [FX_AUTO_UPDATE_KEY]: "on",
      [FX_VND_PER_KRW_KEY]: "18",
    });
    const res = await runFxAutoUpdate(db, { getRates: async () => null });
    expect(res.status).toBe("no_rate");
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("18");
    expect(upserts).toHaveLength(0);
  });

  it("ON + 변환 불가(0/음수 환율) → invalid, 기존값 유지", async () => {
    const { db, store, upserts } = makeDb({
      [FX_AUTO_UPDATE_KEY]: "on",
      [FX_VND_PER_KRW_KEY]: "18",
    });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(0) });
    expect(res.status).toBe("invalid");
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("18");
    expect(upserts).toHaveLength(0);
  });
});
