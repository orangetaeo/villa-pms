// AppSetting 키 화이트리스트·검증자 (T1.7, T1.7-bank-contact)
// route.ts와 단위 테스트(tests/settings-validators.test.ts)가 공유하는 순수 모듈.
// auth/prisma 의존이 없어 테스트 가능 — 라우트는 이 규칙을 호출만 한다.
import { FX_VND_PER_KRW_KEY } from "@/lib/pricing";
import { FX_AUTO_UPDATE_KEY } from "@/lib/fx-auto-update";
import { HOLD_HOURS_DEFAULT_KEY } from "@/lib/hold";
import {
  CANCELLATION_POLICY_KEY,
  isValidCancellationPolicy,
} from "@/lib/cancellation-policy";

// 입금 계좌·연락처 키 (공개 제안 완료/만료 페이지가 소비)
// 한국(KRW) 계좌 — 기존 BANK_* 키를 그대로 사용(데이터 호환). KRW 예약 입금처.
export const BANK_NAME_KEY = "BANK_NAME";
export const BANK_ACCOUNT_NUMBER_KEY = "BANK_ACCOUNT_NUMBER";
export const BANK_ACCOUNT_HOLDER_KEY = "BANK_ACCOUNT_HOLDER";
// 베트남(VND) 계좌 — VND 예약 입금처 (한국계좌와 통화로 자동 분기)
export const BANK_VN_NAME_KEY = "BANK_VN_NAME";
export const BANK_VN_ACCOUNT_NUMBER_KEY = "BANK_VN_ACCOUNT_NUMBER";
export const BANK_VN_ACCOUNT_HOLDER_KEY = "BANK_VN_ACCOUNT_HOLDER";
export const CONTACT_KAKAO_URL_KEY = "CONTACT_KAKAO_URL";
export const CONTACT_PHONE_KEY = "CONTACT_PHONE";

// 빈 문자열 = "미설정"으로 삭제 가능한 키 (선택 입력 필드)
export const CLEARABLE_KEYS = [
  BANK_NAME_KEY,
  BANK_ACCOUNT_NUMBER_KEY,
  BANK_ACCOUNT_HOLDER_KEY,
  BANK_VN_NAME_KEY,
  BANK_VN_ACCOUNT_NUMBER_KEY,
  BANK_VN_ACCOUNT_HOLDER_KEY,
  CONTACT_KAKAO_URL_KEY,
  CONTACT_PHONE_KEY,
] as const;

export const SETTING_KEYS = [
  HOLD_HOURS_DEFAULT_KEY,
  FX_VND_PER_KRW_KEY,
  FX_AUTO_UPDATE_KEY, // 판매가 환율 자동 갱신 토글 "on"/"off" — 비-clearable(off로 저장)
  CANCELLATION_POLICY_KEY, // 취소·환불 정책 JSON (#6b) — 비-clearable(항상 값 존재)
  ...CLEARABLE_KEYS,
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const CLEARABLE_SET = new Set<string>(CLEARABLE_KEYS);

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

/**
 * 키별 값 검증 (비어있지 않은 값에만 적용 — clear는 PUT 핸들러가 별도 처리)
 * - HOLD_HOURS_DEFAULT: 1~168 정수 문자열 (lib/hold resolveHoldHours와 호환)
 * - FX_VND_PER_KRW: 양수 소수 문자열, 소수 4자리까지
 *   (lib/pricing suggestSalePriceKrw의 /^\d+(\.\d{1,4})?$/ 파서와 호환)
 * - BANK_*·CONTACT_PHONE: 길이·형식 라이트 검증 (운영자 자유 입력)
 * - CONTACT_KAKAO_URL: http(s) URL만
 */
export const VALIDATORS: Record<SettingKey, (value: string) => boolean> = {
  [HOLD_HOURS_DEFAULT_KEY]: (value) => {
    if (!/^\d+$/.test(value)) return false;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 168;
  },
  [FX_VND_PER_KRW_KEY]: (value) => {
    if (!/^\d+(\.\d{1,4})?$/.test(value)) return false;
    return Number(value) > 0; // "0", "0.0000" 거부
  },
  // 자동 갱신 토글 — "on"|"off"만 허용 (그 외 값 주입 차단)
  [FX_AUTO_UPDATE_KEY]: (value) => value === "on" || value === "off",
  [BANK_NAME_KEY]: (value) => value.length >= 1 && value.length <= 100,
  [BANK_ACCOUNT_NUMBER_KEY]: (value) => /^[0-9][0-9\- ]{0,39}$/.test(value),
  [BANK_ACCOUNT_HOLDER_KEY]: (value) => value.length >= 1 && value.length <= 100,
  [BANK_VN_NAME_KEY]: (value) => value.length >= 1 && value.length <= 100,
  [BANK_VN_ACCOUNT_NUMBER_KEY]: (value) => /^[0-9][0-9\- ]{0,39}$/.test(value),
  [BANK_VN_ACCOUNT_HOLDER_KEY]: (value) => value.length >= 1 && value.length <= 100,
  [CONTACT_KAKAO_URL_KEY]: (value) => {
    if (value.length > 300) return false;
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  },
  [CONTACT_PHONE_KEY]: (value) => /^[0-9+(][0-9+\-() ]{0,29}$/.test(value),
  // 취소·환불 정책 — JSON 파싱 후 정합성 검증(fullDays>partialDays≥0, 0≤pct≤100)
  [CANCELLATION_POLICY_KEY]: (value) => {
    try {
      return isValidCancellationPolicy(JSON.parse(value));
    } catch {
      return false;
    }
  },
};
