// [SHARED-MODULE] from Nike src/lib/commission-ocr-shared.ts
/**
 * 커미션 영수증(카카오톡 메시지) OCR — Gemini/Claude 공용 프롬프트 + JSON 스키마.
 *
 * 프롬프트는 두 엔진이 동일 입력을 받도록 단일 출처로 관리한다.
 * (기존 gemini.ts ocrCommissionMessage 인라인 프롬프트를 이 const로 이관 — 바이트 동일)
 */

export const COMMISSION_OCR_PROMPT = `이 이미지는 Nike 매장에서 가이드에게 보내는 카카오톡 커미션 메시지 스크린샷입니다.
이미지에서 정보를 추출하여 JSON으로 반환하세요.

## 실제 메시지 예시와 정답

### 예시 1
메시지:
<JUSTSHOES 매출>
전품목20% 명품30%
03월14일. 강종구님
신발 5개:  9,100,000
컴20%: 1,820,000

의류 14개:  7,200,000
컴20%: 1,440,000

총매출: 16,300,000
총.  컴:  3,260,000

정답:
{"guideName":"강종구","date":"03월14일","categories":[{"name":"신발","count":5,"sales":9100000,"commissionRate":20,"commission":1820000},{"name":"의류","count":14,"sales":7200000,"commissionRate":20,"commission":1440000}],"totalSales":16300000,"totalCommission":3260000}

### 예시 2
메시지:
<JUSTSHOES 매출>
전품목20% 명품30%
03월11일. 장기환님
신발 7개:  11,060,000
컴20%: 2,212,000

의류 3개:  1,360,000
컴20%: 272,000

명품 1개: 3,290,000
컴30%: 987,000

총매출: 15,710,000
총. 컴:  3,471,000

정답:
{"guideName":"장기환","date":"03월11일","categories":[{"name":"신발","count":7,"sales":11060000,"commissionRate":20,"commission":2212000},{"name":"의류","count":3,"sales":1360000,"commissionRate":20,"commission":272000},{"name":"명품","count":1,"sales":3290000,"commissionRate":30,"commission":987000}],"totalSales":15710000,"totalCommission":3471000}

## 추출 규칙

### 가이드명
- "MM월DD일. OOO님" 패턴에서 이름만 추출
- "님" 접미사 반드시 제거 (강종구님 → 강종구)
- 매장명(<JUSTSHOES 매출>), 날짜, 커미션율(전품목20%)은 절대 포함하지 마세요
- 한글 자모를 정확하게 인식하세요 — 한 글자라도 틀리면 매칭 실패합니다

### 날짜
- "MM월DD일" 형식 (0 패딩: 3월8일 → 03월08일)

### 카테고리
- name: "신발" | "의류" | "모자" | "명품" | "골프" 중 하나만 사용
- "신발 5개: 9,100,000" → count: 5, sales: 9100000
- "컴20%: 1,820,000" → commissionRate: 20, commission: 1820000
- 카테고리별 커미션율이 다를 수 있음 (예: 전품목20% 명품30%)

### 숫자
- 콤마 제거 후 정수 (5,100,000 → 5100000)
- "총매출:" / "총 매출:" 뒤 → totalSales
- "총. 컴:" / "총.  컴:" / "총커미션:" 뒤 → totalCommission

### 기타
- 여러 메시지가 보이면 첫 번째만 추출
- 읽을 수 없는 값은 null
- JSON만 반환`;

/**
 * Claude Structured Outputs(`output_config.format`)용 JSON 스키마.
 * OcrCommissionData(commission-verify.ts) 구조와 일치. 모든 키 required + additionalProperties:false.
 * nullable 필드는 type 배열(["string","null"])로 표현.
 */
export const COMMISSION_OCR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    guideName: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    categories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          count: { type: ["integer", "null"] },
          sales: { type: ["integer", "null"] },
          commissionRate: { type: ["integer", "null"] },
          commission: { type: ["integer", "null"] },
        },
        required: ["name", "count", "sales", "commissionRate", "commission"],
      },
    },
    totalSales: { type: ["integer", "null"] },
    totalCommission: { type: ["integer", "null"] },
  },
  required: ["guideName", "date", "categories", "totalSales", "totalCommission"],
} as const;
