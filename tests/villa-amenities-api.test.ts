import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isValidAmenity, AMENITY_ITEMS } from "@/lib/amenities";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// T6.4 공급자 비품 수정 — PATCH /api/villas/[id]/amenities 검증 규약 단위 테스트.
// 라우트의 인라인 zod와 동일 규약을 재현해 경계·사전 검증을 고정한다(권한·DB는 QA 실측 소관).
const amenitiesPatchSchema = z.object({
  amenities: z
    .array(
      z.object({
        category: z.enum(["KITCHEN", "BATHROOM", "APPLIANCE", "MINIBAR"]),
        itemKey: z.string().min(1).max(50),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .max(80)
    .superRefine((items, ctx) => {
      items.forEach((item, index) => {
        if (!isValidAmenity(item.category, item.itemKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "itemKey"],
            message: `Unknown amenity item: ${item.category}/${item.itemKey}`,
          });
        }
      });
    }),
});

const validItem = AMENITY_ITEMS.KITCHEN[0];

describe("비품 PATCH payload 검증", () => {
  it("빈 배열 허용 (전체 해제 저장)", () => {
    expect(amenitiesPatchSchema.safeParse({ amenities: [] }).success).toBe(true);
  });
  it("사전에 있는 itemKey 통과", () => {
    const r = amenitiesPatchSchema.safeParse({
      amenities: [{ category: "KITCHEN", itemKey: validItem.itemKey, quantity: 1 }],
    });
    expect(r.success).toBe(true);
  });
  it("사전에 없는 itemKey 거부 (사전 화이트리스트)", () => {
    const r = amenitiesPatchSchema.safeParse({
      amenities: [{ category: "KITCHEN", itemKey: "__bogus__", quantity: 1 }],
    });
    expect(r.success).toBe(false);
  });
  it("카테고리 불일치 거부 (KITCHEN itemKey를 MINIBAR로)", () => {
    const r = amenitiesPatchSchema.safeParse({
      amenities: [{ category: "MINIBAR", itemKey: validItem.itemKey, quantity: 1 }],
    });
    expect(r.success).toBe(false);
  });
  it("수량 경계: 0 거부, 99 허용, 100 거부", () => {
    const make = (q: number) => ({
      amenities: [{ category: "KITCHEN", itemKey: validItem.itemKey, quantity: q }],
    });
    expect(amenitiesPatchSchema.safeParse(make(0)).success).toBe(false);
    expect(amenitiesPatchSchema.safeParse(make(99)).success).toBe(true);
    expect(amenitiesPatchSchema.safeParse(make(100)).success).toBe(false);
  });
  it("미지정 카테고리 enum 거부", () => {
    const r = amenitiesPatchSchema.safeParse({
      amenities: [{ category: "GARDEN", itemKey: validItem.itemKey, quantity: 1 }],
    });
    expect(r.success).toBe(false);
  });
});

// 타입드 JSON 직접 접근 — 키 누락 시 컴파일 에러로도 잡힌다(중첩 객체 캐스트 회피, tsc 클린)
describe("i18n 키 — 비품 수정 (T6.4)", () => {
  it("ko/vi amenities 수정 키(editTitle·save·saving·saveError·cancel) 보유", () => {
    for (const m of [ko.amenities, vi.amenities]) {
      expect(m.editTitle.length).toBeGreaterThan(0);
      expect(m.save.length).toBeGreaterThan(0);
      expect(m.saving.length).toBeGreaterThan(0);
      expect(m.saveError.length).toBeGreaterThan(0);
      expect(m.cancel.length).toBeGreaterThan(0);
    }
  });
  it("ko/vi villaDetail.editAmenities 보유", () => {
    expect(ko.villaDetail.editAmenities.length).toBeGreaterThan(0);
    expect(vi.villaDetail.editAmenities.length).toBeGreaterThan(0);
  });
});
