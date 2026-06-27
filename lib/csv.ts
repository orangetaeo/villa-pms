// 공용 CSV 직렬화 — 수식 인젝션(OWASP "CSV Formula Injection") 차단 (보안 에픽 P0-7)
//
// 위협: 게스트명·빌라명·파트너명·품목명 등 사용자 입력이 CSV 셀에 그대로 들어가고,
//       그 셀이 =, +, -, @, 탭/CR 로 시작하면 Excel·LibreOffice·Google Sheets가 **수식으로 해석**한다.
//       예: `=cmd|'/c calc'!A1`, `@SUM(1+1)`, `+IEX(...)` → 운영자 PC에서 명령 실행(RCE) 위험.
// 방어: 위험 prefix로 시작하는 셀 앞에 작은따옴표(')를 붙여 강제로 "텍스트"로 만든다(스프레드시트 표준 회피).
//       동시에 쉼표·따옴표·개행이 있으면 RFC 4180대로 큰따옴표로 감싸고 내부 따옴표를 이중화한다.

/** Excel/Sheets가 수식 시작으로 해석하는 선행 문자. (탭=\t, 캐리지리턴=\r 포함) */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * CSV 셀 1개를 안전하게 직렬화한다.
 * - 수식 prefix(`= + - @` 등)로 시작하면 앞에 `'`를 붙여 무력화(엑셀에서 텍스트로 표시).
 * - 쉼표·따옴표·개행이 있으면 큰따옴표로 감싸고 내부 `"`를 `""`로 이스케이프.
 * 숫자는 수식 prefix에 안 걸리므로 그대로 통과(saleKrw 등 손상 없음).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // 1) 수식 인젝션 무력화: 위험 prefix면 ' 선행. (이후 따옴표 래핑 단계가 ' 포함 전체를 안전 처리)
  if (FORMULA_PREFIX.test(s)) {
    s = `'${s}`;
  }
  // 2) RFC 4180 이스케이프
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 행(셀 배열) → CSV 라인 1줄. */
export function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

/**
 * 여러 행 → CSV 본문. Excel이 한글·₫ 등 UTF-8을 올바로 인식하도록 BOM을 선행한다(옵션, 기본 on).
 * 행 구분은 CRLF(스프레드시트 호환).
 */
export function toCsv(rows: Array<Array<string | number | null | undefined>>, withBom = true): string {
  const body = rows.map(csvRow).join("\r\n");
  return withBom ? "﻿" + body : body;
}
