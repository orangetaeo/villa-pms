# T-supplier-villa-mgmt-5screens — 공급자 빌라 관리 5화면 (a11~a15)

> 담당: UX-VN · 합의: QA(사후) · 상태: 착수 (2026-06-16)

## 스코프

Phase 1 공급자(SUPPLIER) 빌라 관리 업그레이드. Stitch a11~a15 → Next.js 변환 + BE API 연결.
라이트·teal·vi·모바일(~390px). 마진 비공개(판매가·마진·KRW·고객명 노출 0).

1. **A 사진 확대 라이트박스** (a11) — 상세 사진 그리드 풀스크린 갤러리
2. **B 사진 관리** (a12) — 공간별 추가/삭제/정렬, 기준사진 배지+삭제경고, 409 처리
3. **C 비품 수정 개편** (a13) — 전 카테고리 수량 스테퍼, 미니바 커스텀 행, 수건 대/중/소
4. **E 캘린더 예약 상세 바텀시트** (a14) — 예약 셀 탭 시 원가·홀드 카운트다운 (고객명/판매가 없음)
5. **D 원가 관리 + 빌라별 시즌** (a15) — 시즌 원가 CRUD + 시즌 날짜 범위

## 수정/생성 파일 (본 세션 전용)

- `app/(supplier)/my-villas/[id]/page.tsx` (사진 그리드 라이트박스 진입, 원가관리 진입)
- `app/(supplier)/my-villas/[id]/photo-lightbox.tsx` (신규)
- `app/(supplier)/my-villas/[id]/photos/page.tsx` + `photo-manager.tsx` (신규)
- `app/(supplier)/my-villas/[id]/amenities/amenities-editor.tsx` (확장)
- `app/(supplier)/my-villas/[id]/cost/page.tsx` + `cost-seasons-editor.tsx` (신규)
- `app/(supplier)/calendar/calendar-view.tsx` (예약 바텀시트 확장)
- `app/(supplier)/calendar/booking-sheet.tsx` (신규, 필요시)
- `messages/ko.json`·`messages/vi.json` — **공급자 5화면 키 추가만**

## 수정 금지 구역 (타 세션 작업 중)

lib/zalo*.ts, lib/cleaning.ts, lib/hold.ts, lib/proposal.ts, prisma/seed-demo.ts,
prisma/schema.prisma, app/api/zalo/**, app/(admin)/**

BE API(읽기 전용 소비): app/api/villas/[id]/photos|cost|seasons/route.ts, amenities/route.ts

## 완료 기준

- 5화면 변환 + API 연결, QA 교정목록 반영
- 마진 비공개: 공급자 화면 렌더/응답에 판매가·마진·KRW·고객명 0
- typecheck 통과(본 세션 파일)
- "베트남 중계인이 설명 없이 쓸 수 있는가" 자가점검 통과
