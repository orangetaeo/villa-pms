// 빌라 등록 zod 스키마 (T1.1) — 클라이언트 마법사와 POST /api/villas가 공유
// 금액 규칙: VND BigInt는 JSON 직렬화 불가 → 문자열(동 단위 숫자)로 수신 후 서버에서 BigInt 변환
import { z } from "zod";
import { isValidAmenity } from "./amenities";
import {
  bedroomRowSchema,
  refineBedroomRooms,
  deriveBedroomScalars,
  type NormalizedBedroomRow,
} from "./bedding";
import { featureRowSchema, refineFeatures } from "./features";

/**
 * 빌라 출입 방식 화이트리스트 — 청소직원 운영정보(cleaning-info)와 등록 마법사가 공유하는 단일 원천.
 * 기존 저장값 KEYPAD·KEY·OTHER 유지 + SMARTKEY 추가(TDA: 진실 이중화 방지 — 신규 doorAccessType 컬럼 대신 재사용).
 * Prisma enum 대신 String + zod(드리프트 회피). app/api/villas/[id]/cleaning-info/route.ts도 이 상수를 import.
 */
export const ACCESS_TYPES = ["KEYPAD", "KEY", "SMARTKEY", "OTHER"] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

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

export const SEASONS = ["LOW", "SHOULDER", "HIGH", "PEAK"] as const;
export type Season = (typeof SEASONS)[number];

/**
 * 등록 마법사(공급자 원가 입력)에서 **화면에 노출하는** 시즌 — 비수기·성수기만.
 * 준성수기(SHOULDER)·극성수기(PEAK)는 공급자에게 묻지 않는다(입력 부담 축소 — 베트남 사용자 우선 UX).
 * 두 시즌 원가는 운영자가 요금 달력(기간별 요금)에서 기간을 추가해 책정한다.
 * ⚠ SEASONS(4종)는 요금 달력·기간 API의 도메인 값이므로 그대로 유지 — 여기서만 좁힌다.
 */
export const WIZARD_SEASONS = ["LOW", "HIGH"] as const;

/**
 * 원가 입력이 필수인 시즌 — LOW/HIGH. SHOULDER·PEAK는 선택(빈 값 허용·미전송).
 * 마법사 제출 게이트(allEntered)·필수 경고 표시가 이 목록을 단일 원천으로 참조한다.
 */
export const REQUIRED_SEASONS = ["LOW", "HIGH"] as const;

/** VND 동 단위 숫자 문자열 (0 허용 — 참고 시세용) */
const vndDigits = z.string().regex(/^\d{1,15}$/);
/** VND 동 단위 양수 문자열 (원가 — 0 불가) */
const vndPositiveDigits = z.string().regex(/^[1-9]\d{0,14}$/);

export const villaCreateSchema = z.object({
  // 귀속 공급자 — ADMIN 직접등록 시에만 사용(존재·role=SUPPLIER 검증은 서버). SUPPLIER 등록 시 무시(세션 강제)
  supplierId: z.string().trim().min(1).max(40).optional(),
  // 기본 정보 (1/5)
  name: z.string().trim().min(1).max(100),
  // 지역(단지) — 자유 문자열 입력 폐지(ADR-0046). ComplexArea 마스터의 id만 수신.
  //   서버가 active 마스터 lookup 후 Villa.complex(캐시)=master.name 파생 저장.
  //   미전송/null = "선택 안 함"(complexAreaId·complex 둘 다 null). 구 complex 키는 zod strip.
  complexAreaId: z.string().trim().min(1).max(40).nullable().optional(),
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
  // 비품 (4/5 — 선택) — itemKey는 lib/amenities.ts 사전에 있는 값만.
  //   직접입력은 itemKey="custom" + customLabel(vi, 1~60자) 필수. custom은 카테고리당 최대 10개.
  amenities: z
    .array(
      z.object({
        category: z.enum(["KITCHEN", "BATHROOM", "APPLIANCE", "MINIBAR"]),
        itemKey: z.string().min(1).max(50),
        quantity: z.number().int().min(1).max(99),
        // itemKey="custom"일 때 공급자 입력 라벨 (vi). custom이면 필수(superRefine).
        customLabel: z.string().trim().min(1).max(60).optional(),
      })
    )
    .max(80)
    .superRefine((items, ctx) => {
      // 카테고리별 custom 항목 개수 — 카테고리당 10개 상한
      const customCountByCategory: Record<string, number> = {};
      items.forEach((item, index) => {
        // 사전 검증 — 임의 itemKey 주입 차단 (custom은 허용 카테고리만)
        if (!isValidAmenity(item.category, item.itemKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "itemKey"],
            message: `Unknown amenity item: ${item.category}/${item.itemKey}`,
          });
        }
        if (item.itemKey === "custom") {
          // (a) custom이면 customLabel 필수 — 텍스트 식별 불가 항목 차단
          if (!item.customLabel) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "customLabel"],
              message: "customLabel is required when itemKey is 'custom'",
            });
          }
          // (b) 카테고리당 custom 최대 10개
          const next = (customCountByCategory[item.category] ?? 0) + 1;
          customCountByCategory[item.category] = next;
          if (next > 10) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "customLabel"],
              message: `Too many custom amenities in ${item.category} (max 10)`,
            });
          }
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
  // 원가 (6/6) — LOW/HIGH 필수. SHOULDER(준성수기)·PEAK(극성수기)는 선택 —
  //   마법사에서 더 이상 묻지 않지만, 기존 빌라 재제출 시 보존된 값이 오면 그대로 수용한다.
  rates: z.object({
    LOW: vndPositiveDigits,
    HIGH: vndPositiveDigits,
    SHOULDER: vndPositiveDigits.optional(),
    PEAK: vndPositiveDigits.optional(),
  }),
  // ── 잠자리 구성·셀링포인트·판매정보 (v1.5 T-bedroom-composition-sync) — 전부 선택(하위호환) ──
  //   전송 시 서버가 bedroomDetails로 bedrooms/bathrooms/maxGuests를 파생하고 body 스칼라는 무시.
  //   미전송/빈 배열이면 body 스칼라(bedrooms/bathrooms/maxGuests) 폴백.
  bedroomDetails: z.array(bedroomRowSchema).max(50).optional(),
  features: z.array(featureRowSchema).max(40).optional(),
  commonBathrooms: z.number().int().min(0).max(10).optional(), // 방 밖 공용 욕실 (0~10)
  // 위치·접근성 (마법사 위치 스텝)
  googleMapUrl: z.string().url().startsWith("https://").max(2000).nullable().optional(),
  beachDistanceM: z.number().int().min(0).max(100000).nullable().optional(),
  // 이용규칙 스텝 확장 — 와이파이·출입정보(기존 Villa.accessType/accessInfo 재사용)
  wifiSsid: z.string().trim().max(100).nullable().optional(),
  wifiPassword: z.string().trim().max(100).nullable().optional(), // ⚠ 비공개 등급
  accessType: z.enum(ACCESS_TYPES).nullable().optional(), // 출입 방식 화이트리스트 (cleaning-info와 공유)
  accessInfo: z.string().trim().max(1000).nullable().optional(), // ⚠ 출입정보(도어코드/키 위치) — 비공개 등급
})
  .superRefine((data, ctx) => {
    // 방 단위 동일값(capacity·bathroomCount) + featureKey 사전 화이트리스트 — 3경로 공유
    if (data.bedroomDetails && data.bedroomDetails.length > 0) {
      refineBedroomRooms(data.bedroomDetails, ctx, "bedroomDetails");
    }
    if (data.features && data.features.length > 0) {
      refineFeatures(data.features, ctx, "features");
    }
  });

export type VillaCreateInput = z.infer<typeof villaCreateSchema>;

/**
 * v1.5 판매정보 신규 스칼라 → Villa prisma data (부분 업데이트 시맨틱).
 * undefined = 미전송(미변경/create시 컬럼 default), null = 명시 클리어, 값 = 설정.
 * POST(create)·PUT(resubmit) 공유. 비공개 필드(wifiPassword·accessInfo)도 여기서 저장(감사로그 마스킹은 호출부).
 */
export function villaSalesInfoData(data: VillaCreateInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined) out[k] = v;
  };
  set("googleMapUrl", data.googleMapUrl);
  set("beachDistanceM", data.beachDistanceM);
  set("wifiSsid", data.wifiSsid);
  set("wifiPassword", data.wifiPassword);
  set("accessType", data.accessType);
  set("accessInfo", data.accessInfo);
  set("commonBathrooms", data.commonBathrooms);
  return out;
}

/**
 * 파생 스칼라 결정 — bedroomDetails 전송 시 파생값으로 body 스칼라 오버라이드, 미전송/빈 배열이면 body 스칼라 폴백.
 * 경계 규칙(계약): 전송 시 body bedrooms/bathrooms/maxGuests 무시. bathrooms 0·maxGuests 부분입력이면 body 스칼라 보존(min 1 불변식).
 * rows = 저장용 정규화 행(roomIndex 1..N). POST·PUT 공유.
 */
export function resolveBedroomScalars(data: VillaCreateInput): {
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  rows: NormalizedBedroomRow[];
} {
  const details = data.bedroomDetails ?? [];
  let bedrooms = data.bedrooms;
  let bathrooms = data.bathrooms;
  let maxGuests = data.maxGuests;
  let rows: NormalizedBedroomRow[] = [];
  if (details.length > 0) {
    const derived = deriveBedroomScalars(details, data.commonBathrooms ?? 0);
    bedrooms = derived.bedrooms; // distinct roomIndex 개수
    if (derived.bathrooms > 0) bathrooms = derived.bathrooms; // 전용합+공용 (0이면 body 보존)
    if (derived.maxGuests !== undefined) maxGuests = derived.maxGuests; // 전원 capacity 존재 시만
    rows = derived.rows;
  }
  return { bedrooms, bathrooms, maxGuests, rows };
}

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
