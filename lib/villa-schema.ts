// 빌라 등록 zod 스키마 (T1.1) — 클라이언트 마법사와 POST /api/villas가 공유
// 금액 규칙: VND BigInt는 JSON 직렬화 불가 → 문자열(동 단위 숫자)로 수신 후 서버에서 BigInt 변환
import { z } from "zod";
import { isValidAmenity } from "./amenities";

export const PHOTO_SPACES = [
  "EXTERIOR",
  "LIVING",
  "KITCHEN",
  "BEDROOM",
  "BATHROOM",
  "BALCONY",
  "POOL",
  "ETC",
] as const;

export const SEASONS = ["LOW", "HIGH", "PEAK"] as const;
export type Season = (typeof SEASONS)[number];

/** VND 동 단위 숫자 문자열 (0 허용 — 참고 시세용) */
const vndDigits = z.string().regex(/^\d{1,15}$/);
/** VND 동 단위 양수 문자열 (원가 — 0 불가) */
const vndPositiveDigits = z.string().regex(/^[1-9]\d{0,14}$/);

export const villaCreateSchema = z.object({
  // 귀속 공급자 — ADMIN 직접등록 시에만 사용(존재·role=SUPPLIER 검증은 서버). SUPPLIER 등록 시 무시(세션 강제)
  supplierId: z.string().trim().min(1).max(40).optional(),
  // 기본 정보 (1/5)
  name: z.string().trim().min(1).max(100),
  complex: z.string().trim().max(100).optional(),
  bedrooms: z.number().int().min(1).max(20),
  bathrooms: z.number().int().min(1).max(20),
  maxGuests: z.number().int().min(1).max(50),
  hasPool: z.boolean(),
  breakfastAvailable: z.boolean(),
  // 위치·참고 (2/5 — 전부 선택)
  address: z.string().trim().max(255).optional(),
  monthlyRentVnd: vndDigits.optional(),
  // 사진 (3/5) — 인터림 디스크(/uploads/) 또는 R2(https) URL만 허용
  photos: z
    .array(
      z.object({
        space: z.enum(PHOTO_SPACES),
        spaceLabel: z.string().max(50).optional(),
        url: z
          .string()
          .max(500)
          .regex(/^(\/uploads\/|https:\/\/)\S+$/),
        sortOrder: z.number().int().min(0).max(100),
      })
    )
    .max(60),
  // 비품 (4/5 — 선택) — itemKey는 lib/amenities.ts 사전에 있는 값만
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
  // 이용 규칙 (5/6 — 선택, 기본값 존재) — 공급자가 등록 시 직접 입력. 미전송 시 스키마 default 적용.
  //   /api/villas/[id]/info(공급자 자가 편집)와 동일 필드 — 단일 진실원천이 Villa 모델.
  rules: z
    .object({
      checkInTime: z.number().int().min(0).max(1439),
      checkOutTime: z.number().int().min(0).max(1439),
      smokingAllowed: z.boolean(),
      petsAllowed: z.boolean(),
      partyAllowed: z.boolean(),
      parkingSlots: z.number().int().min(0).max(999),
      baseDepositVnd: vndDigits.nullable(), // null = 미입력
      extraBedAvailable: z.boolean(),
    })
    .optional(),
  // 원가 (6/6) — 시즌 3종 모두 필수
  rates: z.object({
    LOW: vndPositiveDigits,
    HIGH: vndPositiveDigits,
    PEAK: vndPositiveDigits,
  }),
});

export type VillaCreateInput = z.infer<typeof villaCreateSchema>;

/** 이용 규칙 입력 → Villa prisma data. POST(create)·PUT(resubmit) 공유. 미전송 시 빈 객체(스키마 default 유지). */
export function villaRulesData(rules: VillaCreateInput["rules"]) {
  if (!rules) return {};
  return {
    checkInTime: rules.checkInTime,
    checkOutTime: rules.checkOutTime,
    smokingAllowed: rules.smokingAllowed,
    petsAllowed: rules.petsAllowed,
    partyAllowed: rules.partyAllowed,
    parkingSlots: rules.parkingSlots,
    baseDepositVnd: rules.baseDepositVnd ? BigInt(rules.baseDepositVnd) : null,
    extraBedAvailable: rules.extraBedAvailable,
  };
}
