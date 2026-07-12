// lib/fx-format — 수치(vndPerUnit) → FX Decimal 문자열 (통화 무관 범용 포매터, 의존성 없음).
//
// 소수 4자리 반올림 + 뒤따르는 0/소수점 제거. 형식·양수 검증 실패 시 null(갱신/사용 보류).
// 예: 18.54325 → "18.5433", 18.5 → "18.5", 26000.0 → "26000".
// ★ 결과는 lib/pricing 파서(/^\d+(\.\d{1,4})?$/, 양수)와 호환 — suggestSalePrice*·*ToVndSnapshot에 그대로 투입 가능.
// (fx-effective ↔ fx-auto-update 순환참조를 끊기 위해 최하위 모듈로 분리 — 둘 다 여기서 import)
export function formatVndPerUnit(vndPerUnit: number): string | null {
  if (!Number.isFinite(vndPerUnit) || vndPerUnit <= 0) return null;
  let s = vndPerUnit.toFixed(4);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (!/^\d+(\.\d{1,4})?$/.test(s) || Number(s) <= 0) return null;
  return s;
}
