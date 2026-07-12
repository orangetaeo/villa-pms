import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseFxMode,
  getEffectiveFxVndPerKrw,
  getEffectiveFxVndPerUsd,
  FX_MODE_KEY,
} from "@/lib/fx-effective";
import { FX_VND_PER_KRW_KEY, FX_VND_PER_USD_KEY } from "@/lib/pricing";
import type { DbClient } from "@/lib/availability";

// 유효 환율 단일 해석(후속확장 3) — MANUAL/AUTO/폴백 체인/미설정 null.
// getDailyRates는 AppSetting FX_DAILY_RATES_VND 캐시를 경유하므로, 오늘 캐시를 심어 fetch 없이 AUTO 검증.

const NOW = new Date("2026-06-26T03:00:00Z"); // HCM(+7) → 2026-06-26
const TODAY = "2026-06-26";
const DAILY_KEY = "FX_DAILY_RATES_VND";

/** AppSetting 인메모리 더블 (key→value Map). getDailyRates/upsert 호환. */
function makeDb(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    appSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        store.has(where.key) ? { value: store.get(where.key)! } : null
      ),
      upsert: vi.fn(
        async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
          store.set(where.key, create.value);
          return {};
        }
      ),
    },
  } as unknown as DbClient & { store: Map<string, string> };
}

/** 오늘(HCM) 일일 시세 캐시 JSON — AUTO에서 fetch 없이 사용. */
function dailyCache(vndPerUnit: { KRW: number; USD: number }): string {
  return JSON.stringify({
    date: TODAY,
    vndPerUnit: { ...vndPerUnit, RUB: 280, CNY: 3600 },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseFxMode — 미설정·기타는 MANUAL(보수적)", () => {
  it("'AUTO'만 AUTO", () => {
    expect(parseFxMode("AUTO")).toBe("AUTO");
    expect(parseFxMode("MANUAL")).toBe("MANUAL");
    expect(parseFxMode(null)).toBe("MANUAL");
    expect(parseFxMode(undefined)).toBe("MANUAL");
    expect(parseFxMode("")).toBe("MANUAL");
    expect(parseFxMode("auto")).toBe("MANUAL"); // 대소문자 구분
  });
});

describe("getEffectiveFxVndPerKrw — MANUAL 기본(현행 보존)", () => {
  it("FX_MODE 미설정 → 수동 키 그대로 반환", async () => {
    const db = makeDb({ [FX_VND_PER_KRW_KEY]: "18.5" });
    expect(await getEffectiveFxVndPerKrw(db, NOW)).toBe("18.5");
  });
  it("MANUAL + 수동 키 미설정 → null", async () => {
    const db = makeDb({ [FX_MODE_KEY]: "MANUAL" });
    expect(await getEffectiveFxVndPerKrw(db, NOW)).toBeNull();
  });
  it("MANUAL은 외부 시세를 보지 않는다(getDailyRates fetch 미발생)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const db = makeDb({ [FX_VND_PER_KRW_KEY]: "18.5" });
    await getEffectiveFxVndPerKrw(db, NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("getEffectiveFxVndPerKrw — AUTO", () => {
  it("오늘 캐시 시세 → Decimal 문자열(trailing 0 정리)", async () => {
    const db = makeDb({
      [FX_MODE_KEY]: "AUTO",
      [DAILY_KEY]: dailyCache({ KRW: 18.54, USD: 26000 }),
      [FX_VND_PER_KRW_KEY]: "17", // 폴백값 — AUTO 성공 시 무시되어야
    });
    vi.stubGlobal("fetch", vi.fn()); // 캐시 히트라 호출 안 됨
    expect(await getEffectiveFxVndPerKrw(db, NOW)).toBe("18.54");
  });

  it("시세 실패(캐시 없음+fetch 장애) → 수동 키 폴백(fail-safe)", async () => {
    const db = makeDb({ [FX_MODE_KEY]: "AUTO", [FX_VND_PER_KRW_KEY]: "19" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      })
    );
    expect(await getEffectiveFxVndPerKrw(db, NOW)).toBe("19");
  });

  it("시세 실패 + 수동 키도 없음 → null(견적을 죽이지 않음)", async () => {
    const db = makeDb({ [FX_MODE_KEY]: "AUTO" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      })
    );
    expect(await getEffectiveFxVndPerKrw(db, NOW)).toBeNull();
  });
});

describe("getEffectiveFxVndPerUsd — MANUAL/AUTO 대칭", () => {
  it("MANUAL 기본 → 수동 USD 키 반환", async () => {
    const db = makeDb({ [FX_VND_PER_USD_KEY]: "26000" });
    expect(await getEffectiveFxVndPerUsd(db, NOW)).toBe("26000");
  });
  it("MANUAL + 미설정 → null", async () => {
    const db = makeDb({ [FX_MODE_KEY]: "MANUAL" });
    expect(await getEffectiveFxVndPerUsd(db, NOW)).toBeNull();
  });
  it("AUTO + 오늘 캐시 → USD Decimal 문자열", async () => {
    const db = makeDb({
      [FX_MODE_KEY]: "AUTO",
      [DAILY_KEY]: dailyCache({ KRW: 18.54, USD: 25400 }),
      [FX_VND_PER_USD_KEY]: "26000", // 폴백값 — AUTO 성공 시 무시
    });
    vi.stubGlobal("fetch", vi.fn());
    expect(await getEffectiveFxVndPerUsd(db, NOW)).toBe("25400");
  });
  it("AUTO 시세 실패 → 수동 USD 키 폴백", async () => {
    const db = makeDb({ [FX_MODE_KEY]: "AUTO", [FX_VND_PER_USD_KEY]: "26000" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      })
    );
    expect(await getEffectiveFxVndPerUsd(db, NOW)).toBe("26000");
  });
});
