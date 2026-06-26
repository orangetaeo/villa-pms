import { describe, expect, it, vi } from "vitest";
import {
  SupplierBookingForbiddenError,
  assertSupplierCanInspectBooking,
} from "@/lib/supplier-booking-access";
import {
  extractUploaderId,
  fileBelongsToUploader,
  normalizeUploaderId,
} from "@/lib/passport-name";

// T10.5 공급자 체크인·아웃 검수 (F10 D5/D6, ADR-0021 §6) — 권한 가드·여권 스코프·미니바 합계 단위 검증.
// DB는 booking.findUnique만 모킹(가드 분기 확인). 비즈니스 로직(lib/checkin·checkout)은 자체 테스트가 커버.

const SUPPLIER = "supplier-self-cuid";
const OTHER_SUPPLIER = "supplier-other-cuid";

function fakeDb(booking: unknown) {
  return {
    booking: {
      findUnique: vi.fn().mockResolvedValue(booking),
    },
  } as never;
}

describe("assertSupplierCanInspectBooking — 자기 직접예약만 검수 (미일치=던짐→라우트 404)", () => {
  it("자기 빌라 + seller=SUPPLIER → 통과(스코프 반환)", async () => {
    const db = fakeDb({
      id: "bk1",
      status: "CONFIRMED",
      seller: "SUPPLIER",
      villaId: "v1",
      villa: { supplierId: SUPPLIER },
    });
    const scope = await assertSupplierCanInspectBooking(db, "bk1", SUPPLIER);
    expect(scope).toEqual({ bookingId: "bk1", villaId: "v1", status: "CONFIRMED" });
  });

  it("예약 없음 → NOT_FOUND (존재 비노출)", async () => {
    const db = fakeDb(null);
    await expect(assertSupplierCanInspectBooking(db, "bk1", SUPPLIER)).rejects.toMatchObject({
      reason: "NOT_FOUND",
    });
  });

  it("운영자 예약(seller=OPERATOR) → NOT_SUPPLIER_SELLER (운영자 예약 도달 차단)", async () => {
    const db = fakeDb({
      id: "bk1",
      status: "CONFIRMED",
      seller: "OPERATOR",
      villaId: "v1",
      villa: { supplierId: SUPPLIER }, // 자기 빌라여도 운영자 예약이면 차단
    });
    await expect(assertSupplierCanInspectBooking(db, "bk1", SUPPLIER)).rejects.toMatchObject({
      reason: "NOT_SUPPLIER_SELLER",
    });
  });

  it("타 공급자 빌라 직접예약 → NOT_OWN_VILLA (타 공급자 예약 도달 차단)", async () => {
    const db = fakeDb({
      id: "bk1",
      status: "CONFIRMED",
      seller: "SUPPLIER",
      villaId: "v9",
      villa: { supplierId: OTHER_SUPPLIER },
    });
    await expect(assertSupplierCanInspectBooking(db, "bk1", SUPPLIER)).rejects.toMatchObject({
      reason: "NOT_OWN_VILLA",
    });
  });

  it("던지는 에러는 SupplierBookingForbiddenError 인스턴스", async () => {
    const db = fakeDb(null);
    await expect(assertSupplierCanInspectBooking(db, "bk1", SUPPLIER)).rejects.toBeInstanceOf(
      SupplierBookingForbiddenError
    );
  });
});

describe("passport-name — 공급자 여권/서명 서빙 스코프(본인 업로드분만)", () => {
  // storage.buildFileName: `${prefix?}${Date.now()}-${safeUploader}-${uuid}.${ext}`
  const TS = "1717000000000";
  const UUID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
  const me = "clz1abc234def";
  const passport = `${TS}-${me}-${UUID}.jpg`;
  const signature = `sig-${TS}-${me}-${UUID}.png`;
  const paperDoc = `doc-${TS}-${me}-${UUID}.webp`;

  it("업로더 id 추출 — 무접두 여권", () => {
    expect(extractUploaderId(passport)).toBe(me);
  });
  it("업로더 id 추출 — sig- 접두 서명", () => {
    expect(extractUploaderId(signature)).toBe(me);
  });
  it("업로더 id 추출 — doc- 접두 종이서류", () => {
    expect(extractUploaderId(paperDoc)).toBe(me);
  });

  it("본인 업로드 파일 → 접근 허용", () => {
    expect(fileBelongsToUploader(passport, me)).toBe(true);
    expect(fileBelongsToUploader(signature, me)).toBe(true);
  });

  it("타인 업로드 파일 → 접근 거부 (타인 여권 차단)", () => {
    const otherFile = `${TS}-someoneElse999-${UUID}.jpg`;
    expect(fileBelongsToUploader(otherFile, me)).toBe(false);
    // 운영자가 올린 여권을 공급자가 보려는 케이스도 차단
    expect(fileBelongsToUploader(`${TS}-adminUser-${UUID}.jpg`, me)).toBe(false);
  });

  it("형식 불일치 파일명 → null·거부 (uuid 없음 등)", () => {
    expect(extractUploaderId("garbage.jpg")).toBeNull();
    expect(extractUploaderId(`${TS}-${me}.jpg`)).toBeNull(); // uuid 세그먼트 없음
    expect(fileBelongsToUploader("garbage.jpg", me)).toBe(false);
  });

  it("uploaderId 정규화 규칙 일치 (storage.buildFileName의 safeUploader)", () => {
    // cuid는 영숫자라 원형 유지. 비허용 문자는 제거되어 파일명과 동일해야 매칭됨.
    expect(normalizeUploaderId("abc_DEF-123")).toBe("abc_DEF-123");
    expect(normalizeUploaderId("ab.c/d e")).toBe("abcde");
  });
});

// ── 미니바 소모 정산 합계 (D6) — 클라 표시 합계가 서버 산식과 동일해야 함(판매가 × 소비수량, BigInt) ──
// 폼은 표시용으로만 합산하고 서버가 권위 재계산하지만, UX 일관을 위해 동일 산식을 단위 검증한다.
function minibarTotalVnd(
  lines: { unitPriceVnd: string; consumedQty: number }[]
): bigint {
  return lines.reduce(
    (sum, l) => sum + BigInt(l.unitPriceVnd) * BigInt(Math.max(0, l.consumedQty)),
    0n
  );
}

describe("미니바 소모 합계 — 판매가(VND) × 소비수량 (BigInt, 부동소수점 금지)", () => {
  it("디자인 예시: 물2×15.000 + 음료1×20.000 + 맥주0 + 과자3×25.000 = 125.000", () => {
    const total = minibarTotalVnd([
      { unitPriceVnd: "15000", consumedQty: 2 },
      { unitPriceVnd: "20000", consumedQty: 1 },
      { unitPriceVnd: "35000", consumedQty: 0 },
      { unitPriceVnd: "25000", consumedQty: 3 },
    ]);
    expect(total).toBe(125000n);
  });

  it("소비 0이면 합계 0", () => {
    expect(minibarTotalVnd([{ unitPriceVnd: "15000", consumedQty: 0 }])).toBe(0n);
    expect(minibarTotalVnd([])).toBe(0n);
  });

  it("큰 금액도 BigInt로 정밀 (정밀도 손실 없음)", () => {
    expect(minibarTotalVnd([{ unitPriceVnd: "1000000000", consumedQty: 9 }])).toBe(9000000000n);
  });
});
