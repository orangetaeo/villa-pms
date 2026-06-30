# Contract: T-cleaner-features — 청소직원(CLEANER) 화면 갭 4종 (A·B·C·D)

## 배경
청소직원 포털(/cleaning) 전수 점검: 목록·사진제출·상태확인뿐. 관리자엔 있으나 청소직원에 빠진 것 4종(사용자 승인 A·B·C·D).

## 범위 (수정/신규 파일)
- **A. 예정일·청소유형 표시** (스키마 무변경)
  - 수정 `app/(supplier)/cleaning/[id]/page.tsx` — select에 dueDate·type 추가, 라벨 props 전달
  - 수정 `cleaning-submit.tsx`·`cleaning-photos-view`(헤더) — 예정일 + 정기/체크아웃 배지
- **B. 기준 사진 사전 비교** (스키마 무변경)
  - 수정 `cleaning/[id]/page.tsx` — villa.photos(isBaseline) select, 슬롯별 baselineUrl 매핑(space+index)
  - 수정 `cleaning-submit.tsx` — SlotProp.baselineUrl 추가, 업로드 타일 위에 "기준" 참조 이미지
- **C. 청소 지시사항/메모** (Villa.cleaningNotes 추가 — 빌라 단위 재사용)
  - DB additive: `ALTER TABLE "Villa" ADD COLUMN "cleaningNotes" TEXT` (라이브 Neon, 멱등)
  - 수정 `prisma/schema.prisma` Villa + prisma generate
  - 신규 관리자 에디터 + API (name-vi-editor 패턴): `/api/villas/[id]/cleaning-info`(isOperator), admin 빌라 상세에 카드
  - 청소직원 상세에 표시(읽기)
- **D. 빌라 위치·출입정보** (address 기존 + Villa.accessInfo 추가)
  - DB additive: `ALTER TABLE "Villa" ADD COLUMN "accessInfo" TEXT`
  - 관리자 에디터(C와 동일 카드)에서 address·accessInfo 편집, 청소직원 상세에 표시
- i18n `messages/ko.json`·`vi.json` 키 추가만(cleaning·adminVilla 등 해당 NS)

## 수정 금지 구역
- prisma/* seed, 고객 정보(guestName·금액·roster)·미니바 원가·WiFi 비번은 청소직원에 절대 노출 금지(누수)
- 기존 검수(approve/reject) 권한 로직 무변경

## 완료 기준 (테스트 가능)
1. 청소직원 제출 화면에 예정일·청소유형 표시, 슬롯별 기준 사진 노출
2. 관리자가 빌라에 청소메모·출입정보·주소 입력 → 청소직원 상세에 표시
3. CLEANER는 자기 배정분만(IDOR 유지), 고객정보·금액·WiFi비번·미니바원가 비노출
4. DB ALTER는 additive·멱등(IF NOT EXISTS), 기존 데이터 무손상
5. typecheck·lint·build 0, 독립 QA PASS

## 검증 방법
typecheck/lint/build + 독립 QA(누수·IDOR) + (배포 후) Playwright
