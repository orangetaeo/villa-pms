# 계약서 — ADMIN 전용 빌라명(name+nameVi) 편집 (T-villa-name-admin-edit)

날짜: 2026-07-13 | 담당: FE(구현, API 포함) → QA | 상태: 착수

## 배경 (Triage·회의 요약)

활성(ACTIVE) 빌라의 한국어명 `Villa.name`을 바꿀 경로가 시스템에 없음 — 공급자 info 라우트는
`name/complex` 의도적 미수신(운영자 기준명), 공급자 PUT은 REJECTED 전용, ADMIN PATCH는 상태 전이 전용,
ADMIN 화면은 nameVi 편집기뿐. 개명(오타·리브랜딩) 시나리오 공백.

**회의 결정 (테오 승인)**: 공급자에게 이름 변경권을 주지 않는다 — `name`은 운영자의 판매 식별자이고
실시간 조인 구조라 공급자 개명 시 제안 링크·예약 화면이 운영자 모르게 바뀜. 공급자 니즈는 Zalo 요청 →
ADMIN 반영으로 처리. **ADMIN 전용 name+nameVi 동시 편집기**가 정본.

## 범위

1. **API** — `app/api/villas/[id]/name-vi/route.ts` 확장 (라우트 경로 유지, additive):
   - `action=save`에 옵셔널 `name` 추가 (trim, min 1, max 100). name+nameVi 함께 저장.
   - `action=suggest`에 옵셔널 `name` 추가 — 전달 시 그 초안으로 Gemini 음역 제안(저장 전 새 이름 기준 제안).
   - 변경 없으면 멱등 반환(기존 패턴 유지). `writeAuditLog` changes에 name·nameVi 각각 old/new 기록.
   - 권한 불변: `isOperator` 전용.
2. **UI** — `app/(admin)/villas/[id]/name-vi-editor.tsx`를 name+nameVi 편집기로 확장:
   - 한국어명 입력 필드 추가, 이름 수정 시 "제안" 버튼이 초안 name 기준으로 음역 재제안.
   - `formatVillaName` 미리보기 유지. 저장 성공 시 `router.refresh()`(상세 헤더 즉시 반영).
   - 이름 변경 시 기존 nameVi가 구명 기준일 수 있음을 안내(재제안 유도).
3. **i18n** — 기존 NS `adminVillas.detail.nameVi`에 키 추가만 (ko+vi 동시, NS 화이트리스트 변경 없음).

## 범위 밖 (수정 금지)

- `app/api/villas/[id]/info/route.ts`·공급자 화면 일체 (공급자 차단 유지가 요구사항)
- `complex` 편집 — 별도 태스크 (지역 필터·벤더 커버리지 연동 검토 필요)
- 스키마 변경 없음

## 완료 기준 (QA 검증)

- [ ] ADMIN이 상세 화면에서 name 수정·저장 → 목록/상세/예약 화면에 새 이름 반영
- [ ] AuditLog에 name old/new 기록
- [ ] SUPPLIER 토큰으로 name-vi POST → 403 (기존 가드 유지)
- [ ] name 공백/100자 초과 → 400
- [ ] nameVi만 저장하는 기존 흐름 회귀 없음 (name 미전송 시 이름 불변)
- [ ] ko/vi 키 양쪽 존재, next build 통과
