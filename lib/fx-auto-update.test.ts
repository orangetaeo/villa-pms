// lib/fx-auto-update 순수 로직 테스트 — 유효 환율 AUTO 모드일 때 KRW·USD 수동 키 갱신
import { describe, it, expect } from "vitest";
import { isFxAutoUpdateOn, formatFxVndPerKrw, runFxAutoUpdate } from "./fx-auto-update";
import { FX_VND_PER_KRW_KEY, FX_VND_PER_USD_KEY } from "./pricing";
import { FX_MODE_KEY } from "./fx-effective";
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

describe("isFxAutoUpdateOn (deprecated — FX_MODE로 대체, 헬퍼만 잔존)", () => {
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

const keyOf = (res: Awaited<ReturnType<typeof runFxAutoUpdate>>, key: string) =>
  res.keys.find((k) => k.key === key)!;

describe("runFxAutoUpdate — FX_MODE=AUTO일 때만 KRW·USD 수동 키 갱신", () => {
  it("FX_MODE 미설정(=MANUAL) → skipped_manual, 쓰기·로그 없음", async () => {
    const { db, store, upserts, audits } = makeDb({ [FX_VND_PER_KRW_KEY]: "18" });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(19) });
    expect(res.status).toBe("skipped_manual");
    expect(res.keys).toHaveLength(0);
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("18"); // 불변
    expect(upserts).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("FX_MODE=MANUAL 명시 → skipped_manual (구 FX_AUTO_UPDATE=on 값 무시)", async () => {
    const { db, upserts } = makeDb({ [FX_MODE_KEY]: "MANUAL", FX_AUTO_UPDATE: "on" });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(19) });
    expect(res.status).toBe("skipped_manual");
    expect(upserts).toHaveLength(0);
  });

  it("AUTO + 새 시세 → updated + KRW·USD 동시 갱신 + AuditLog(userId null, source)", async () => {
    const { db, store, upserts, audits } = makeDb({
      [FX_MODE_KEY]: "AUTO",
      [FX_VND_PER_KRW_KEY]: "18",
      [FX_VND_PER_USD_KEY]: "25000",
    });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(18.5432) }); // USD 26000
    expect(res.status).toBe("updated");
    expect(keyOf(res, FX_VND_PER_KRW_KEY)).toMatchObject({
      status: "updated",
      oldValue: "18",
      newValue: "18.5432",
    });
    expect(keyOf(res, FX_VND_PER_USD_KEY)).toMatchObject({
      status: "updated",
      oldValue: "25000",
      newValue: "26000",
    });
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("18.5432");
    expect(store.get(FX_VND_PER_USD_KEY)).toBe("26000");
    expect(upserts).toEqual([
      { key: FX_VND_PER_KRW_KEY, value: "18.5432" },
      { key: FX_VND_PER_USD_KEY, value: "26000" },
    ]);
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.entityId).sort()).toEqual(
      [FX_VND_PER_KRW_KEY, FX_VND_PER_USD_KEY].sort()
    );
    expect(audits.every((a) => a.userId === null && a.entity === "AppSetting")).toBe(true);
  });

  it("AUTO + 기존값 미설정 → updated (oldValue null, KRW·USD 둘 다 생성)", async () => {
    const { db, store } = makeDb({ [FX_MODE_KEY]: "AUTO" });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(19) });
    expect(res.status).toBe("updated");
    expect(keyOf(res, FX_VND_PER_KRW_KEY).oldValue).toBeNull();
    expect(keyOf(res, FX_VND_PER_USD_KEY).oldValue).toBeNull();
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("19");
    expect(store.get(FX_VND_PER_USD_KEY)).toBe("26000");
  });

  it("AUTO + 두 키 모두 동일 → unchanged, 쓰기·로그 생략", async () => {
    const { db, upserts, audits } = makeDb({
      [FX_MODE_KEY]: "AUTO",
      [FX_VND_PER_KRW_KEY]: "18.5",
      [FX_VND_PER_USD_KEY]: "26000",
    });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(18.5) }); // USD 26000
    expect(res.status).toBe("unchanged");
    expect(keyOf(res, FX_VND_PER_KRW_KEY).status).toBe("unchanged");
    expect(keyOf(res, FX_VND_PER_USD_KEY).status).toBe("unchanged");
    expect(upserts).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("AUTO + 환율 조회 실패(null) → no_rate, 기존값 유지", async () => {
    const { db, store, upserts } = makeDb({
      [FX_MODE_KEY]: "AUTO",
      [FX_VND_PER_KRW_KEY]: "18",
      [FX_VND_PER_USD_KEY]: "25000",
    });
    const res = await runFxAutoUpdate(db, { getRates: async () => null });
    expect(res.status).toBe("no_rate");
    expect(res.keys).toHaveLength(0);
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("18");
    expect(store.get(FX_VND_PER_USD_KEY)).toBe("25000");
    expect(upserts).toHaveLength(0);
  });

  it("AUTO + KRW 변환 불가(0) → 그 키만 invalid(기존값 유지), USD는 정상 갱신", async () => {
    const { db, store, audits } = makeDb({
      [FX_MODE_KEY]: "AUTO",
      [FX_VND_PER_KRW_KEY]: "18",
      [FX_VND_PER_USD_KEY]: "25000",
    });
    const res = await runFxAutoUpdate(db, { getRates: async () => rates(0) }); // KRW 0(무효), USD 26000
    expect(res.status).toBe("updated"); // USD가 갱신되어 전체는 updated
    expect(keyOf(res, FX_VND_PER_KRW_KEY).status).toBe("invalid");
    expect(store.get(FX_VND_PER_KRW_KEY)).toBe("18"); // 불변
    expect(keyOf(res, FX_VND_PER_USD_KEY).status).toBe("updated");
    expect(store.get(FX_VND_PER_USD_KEY)).toBe("26000");
    expect(audits).toHaveLength(1); // USD 1건만
    expect(audits[0].entityId).toBe(FX_VND_PER_USD_KEY);
  });
});
