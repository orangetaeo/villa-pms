# T-admin-inspections-pagination — 관리자 검수 목록 페이지네이션

## 배경
2026-06-24 모바일 UX 배치(bb34f8e)에서 리스트 공통 페이지네이션을 예약·빌라·제안·사용자·공급자빌라·청소에 적용했으나, **관리자 검수(`/inspections`)** 는 마스터-디테일 구조라 계약상 제외(상한 take 200). 본 태스크는 그 후속(요청 시).

## 범위 (수정 파일 — 이 파일들만 건드림)
- `app/(admin)/inspections/page.tsx` — 정렬 후 page/pageSize 슬라이스, 자동선택은 전역 첫 행 고정
- `app/(admin)/inspections/inspections-view.tsx` — 좌측 큐 하단 PaginationBar(URL 모드, 다크)
- `docs/contracts/T-admin-inspections-pagination.md` (본 파일)
- `PROGRESS.md` (자기 행만)

## 수정 금지 구역 (타 세션 WIP — 절대 미접촉)
- `lib/cleaning.ts` · `lib/hold.ts` · `lib/proposal.ts`
- `messages/ko.json` · `messages/vi.json` (신규 키 불필요 — pagination·adminInspections 네임스페이스 기존 사용)
- `docs/DESIGN.md` · `LAUNCH.md` · `prisma/schema.prisma` · `messages/*` · partB png

## 완료 기준
1. 좌측 검수 큐가 page/pageSize(기본 20, 옵션 10/20/30/50/100)로 분할
2. 승인 대기 우선 정렬 보존(정렬 후 슬라이스)
3. 페이징 시 우측 상세(자동선택)가 바뀌지 않음(전역 첫 행 고정) — 명시 `?task=`는 그대로 유지
4. 탭/날짜/지역 필터·`?task=` 파라미터가 페이지 이동에 보존
5. 모바일에서 상세 선택 시 좌측 큐+바 숨김(기존 동작 유지)
6. 누수 0(select 화이트리스트 무변경) · typecheck 0
