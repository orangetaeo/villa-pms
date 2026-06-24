# T-admin-villa-source-toggle — ADMIN 빌라 출처(SUPPLIER/DIRECT) 지정 토글

## 배경
T-availability-direct-booking-popover 로 `Villa.source`(SUPPLIER/DIRECT)와 공실 보드의 DIRECT 예약 표시는
구현·배포됨. 그러나 출처를 화면에서 바꿀 UI가 없어 DB 직접수정만 가능 → 기능이 휴면 상태.
이 태스크는 운영자 빌라 판매정보 편집 폼(SalesEditor)에 출처 토글을 추가해 ADMIN이 DIRECT로 지정할 수 있게 한다.

## 범위 (이 태스크가 만지는 파일 — 소유 선언)
- `app/(admin)/villas/[id]/sales-editor.tsx` — 출처 토글(SUPPLIER/DIRECT) 섹션 추가
- `app/(admin)/villas/[id]/page.tsx` — villa select 에 `source` 추가 + SalesEditor 에 초기값 전달
- `app/api/villas/[id]/sales/route.ts` — zod 스키마에 `source` 추가 + scalarData 반영(AuditLog 자동 기록)
- `messages/ko.json` · `messages/vi.json` — `adminVillas.sales.source*` 키 **추가만**

## 수정 금지 구역 (다른 세션 작업 중 — 절대 미수정)
- `messages/*.json` 기존 키 (adminVillas.sales 하위 추가만)
- app/(supplier)/** wizard, app/api/villas/route.ts(생성) — 이번 범위 밖(생성은 기본값 SUPPLIER 유지)
- settings(동의서 편집), guest-roster, sheet-minibar 관련 파일

## 완료 기준 (테스트 가능)
1. ADMIN 빌라 상세 > 판매정보 탭에 "출처" 토글(공급자 등록 / 직접 공급) 표시, 현재값 선택됨
2. DIRECT 선택 후 저장 → `PATCH /api/villas/[id]/sales` 가 source 저장, 재조회 시 유지
3. 출처 변경이 AuditLog(entity=Villa, action=UPDATE)에 기록됨
4. 권한: canSetPrice(OWNER/MANAGER/ADMIN)만 저장 가능(기존 가드 재사용), STAFF/SUPPLIER 차단
5. DIRECT 로 지정한 빌라가 공실 보드에서 예약 셀로 표시됨(기존 기능과 연결 확인)
6. ko/vi 라벨 표시(하드코딩 한국어 없음)

## 검증 방법
- `npx tsc --noEmit` + `npx next build` 통과(배포 게이트)
- 토글 저장 후 source 영속 확인

## 파이프라인
FE(토글) → BE(API+AuditLog) → LOC(ko/vi) → QA
