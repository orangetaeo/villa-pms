import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CURRENCY_BY_LANG,
  convertFromVnd,
  formatConverted,
  getDailyRates,
  type DailyRates,
} from "@/lib/fx-rates";

const NOW = new Date("2026-06-26T03:00:00Z"); // HCM(+7) → 2026-06-26 10:00 → 날짜 2026-06-26
const TODAY = "2026-06-26";

const OK_RESPONSE = {
  result: "success",
  rates: { USD: 1, VND: 25400, KRW: 1370, RUB: 90, CNY: 7.2 },
};

/** AppSetting 인메모리 더블 — findUnique/upsert. */
function makeDb(initial: string | null) {
  const store: { value: string | null } = { value: initial };
  return {
    store,
    appSetting: {
      findUnique: vi.fn(async () => (store.value == null ? null : { value: store.value })),
      upsert: vi.fn(async ({ create }: { create: { value: string } }) => {
        store.value = create.value;
        return {};
      }),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CURRENCY_BY_LANG", () => {
  it("언어별 모국통화 매핑 — vi는 환산 없음(null)", () => {
    expect(CURRENCY_BY_LANG.vi).toBeNull();
    expect(CURRENCY_BY_LANG.ko).toBe("KRW");
    expect(CURRENCY_BY_LANG.en).toBe("USD");
    expect(CURRENCY_BY_LANG.ru).toBe("RUB");
    expect(CURRENCY_BY_LANG.zh).toBe("CNY");
  });
});

describe("convertFromVnd / formatConverted", () => {
  it("VND → 통화 근사치", () => {
    expect(convertFromVnd(25400n, 25400)).toBeCloseTo(1); // 25,400 VND = $1
    expect(convertFromVnd(0n, 25400)).toBe(0);
    expect(convertFromVnd(1000n, 0)).toBe(0); // 0 나눗셈 방지
  });
  it("USD는 정수 반올림 + 기호 앞", () => {
    // 850,000 VND ÷ 25,400 ≈ 33.46 → $33
    expect(formatConverted(850000n, "USD", 25400)).toBe("≈ $33");
  });
  it("KRW는 100단위 반올림", () => {
    // 850,000 ÷ 18.54 ≈ 45,847 → 100단위 → ₩45,800
    const vndPerKrw = 25400 / 1370;
    expect(formatConverted(850000n, "KRW", vndPerKrw)).toMatch(/^≈ ₩45,[0-9]00$/);
  });
  it("RUB·CNY 정수 + 기호", () => {
    expect(formatConverted(282000n, "RUB", 282.2)).toBe("≈ ₽999");
    expect(formatConverted(35277n, "CNY", 3527.7)).toBe("≈ ¥10");
  });
});

describe("getDailyRates — 일1회 캐시", () => {
  it("오늘 캐시가 있으면 fetch 안 함", async () => {
    const cached: DailyRates = { date: TODAY, vndPerUnit: { USD: 25400, KRW: 18.5, RUB: 282, CNY: 3527 } };
    const db = makeDb(JSON.stringify(cached));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const r = await getDailyRates(db, NOW);
    expect(r).toEqual(cached);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("캐시 없으면 API 받아 vndPerUnit 계산 + 저장", async () => {
    const db = makeDb(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => OK_RESPONSE }))
    );
    const r = await getDailyRates(db, NOW);
    expect(r?.date).toBe(TODAY);
    expect(r?.vndPerUnit.USD).toBeCloseTo(25400);
    expect(r?.vndPerUnit.KRW).toBeCloseTo(25400 / 1370);
    expect(r?.vndPerUnit.RUB).toBeCloseTo(25400 / 90);
    expect(r?.vndPerUnit.CNY).toBeCloseTo(25400 / 7.2);
    expect(db.appSetting.upsert).toHaveBeenCalledTimes(1);
    expect(db.store.value).toContain(TODAY);
  });

  it("어제 캐시 + API 성공 → 갱신", async () => {
    const stale: DailyRates = { date: "2026-06-25", vndPerUnit: { USD: 1, KRW: 1, RUB: 1, CNY: 1 } };
    const db = makeDb(JSON.stringify(stale));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => OK_RESPONSE })));
    const r = await getDailyRates(db, NOW);
    expect(r?.date).toBe(TODAY);
    expect(r?.vndPerUnit.USD).toBeCloseTo(25400);
  });

  it("API 장애 시 마지막(stale) 캐시 폴백", async () => {
    const stale: DailyRates = { date: "2026-06-25", vndPerUnit: { USD: 24000, KRW: 18, RUB: 280, CNY: 3400 } };
    const db = makeDb(JSON.stringify(stale));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const r = await getDailyRates(db, NOW);
    expect(r).toEqual(stale); // 갱신 실패 → 기존 값 유지
    expect(db.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("캐시 없고 API도 장애 → null(화면은 VND만)", async () => {
    const db = makeDb(null);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const r = await getDailyRates(db, NOW);
    expect(r).toBeNull();
  });

  it("result!=success면 폴백", async () => {
    const db = makeDb(null);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ result: "error" }) })));
    const r = await getDailyRates(db, NOW);
    expect(r).toBeNull();
  });
});
