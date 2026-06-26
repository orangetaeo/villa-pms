# 계약: 빌라명 베트남어 병기 (T-villa-name-bilingual)

- **담당**: TDA(스키마)+INTEG(Gemini)+FE(ADMIN UI)+UX-VN(공급자 표시)
- **브랜치/worktree**: `wt/villa-name-bilingual`
- **결정**: ADR-0020 (병기 · Gemini 제안+ADMIN 확정 · 외부 노출 전체)

## 범위
1. 스키마: `Villa.nameVi String?`(schema.prisma) + 라이브 DB raw SQL ALTER(additive·멱등)
2. `lib/villa-name.ts`: `formatVillaName({name, nameVi})` 병기 헬퍼 + 단위 테스트
3. `lib/gemini.ts`: `romanizeVillaName(name)` 음역 제안(키 미설정 폴백)
4. ADMIN 확정: `POST /api/villas/[id]/name-vi`(suggest=Gemini 제안, save=확정 PATCH, canManage 전용·AuditLog) + 빌라 상세 페이지 nameVi 편집 컴포넌트
5. 표시 적용(외부 전체): 각 빌라명 표시 지점에 prisma `nameVi: true` select 추가 + `formatVillaName` 적용
   - 공급자: /earnings, /my-villas, /my-villas/[id], /cleaning, /cleaning/[id], /calendar
   - 공개: /p/[token], /p/[token]/book/[itemId], /p/[token]/roster/[bookingId]
   - 문서: lib/settlement-statement-service.ts(PDF 라인 villaName)
   - Zalo: lib/zalo-share.ts(공급자·고객 빌라 공유 본문), candidates
   - **운영자(app/(admin)/**)는 한국어 원문 유지 — 헬퍼 미적용**(상세 편집 UI 제외)

## 누수/원칙
- 빌라명은 가격·마진·재고 아님 → 비공개 무관. select 확장은 `nameVi`만(다른 필드 금지)
- nameVi는 ADMIN 확정값만 저장(Gemini 출력 무인 저장 금지)

## 수정 금지 구역
- `lib/settlement.ts`·`lib/ledger.ts`·정산 집계 로직 — 무관
- 다른 worktree(정산서 UI PR #25 등) 영역 비접촉

## 완료 기준 (QA 독립 평가)
1. 공급자/공개 화면·PDF·Zalo 빌라명이 nameVi 있을 때 `한국어 (베트남어)` 병기, 없으면 한국어만(폴백)
2. 운영자 빌라 목록/상세 제목은 한국어 원문 유지(병기 미적용 — 편집 섹션 제외)
3. ADMIN nameVi 편집: Gemini 제안 버튼 동작(키 미설정 시 graceful), 저장 후 반영, AuditLog 기록
4. nameVi suggest/save API는 canManage(ADMIN) 전용 — 공급자/비로그인 403/401
5. formatVillaName 단위 테스트(병기·폴백·동일값) 통과
6. `npm run lint && npx tsc --noEmit` 0, `npm test` 그린, `next build` 통과
7. 라이브 DB에 nameVi 컬럼 존재 실측(멱등 ALTER)

## 검증
- vitest: formatVillaName + romanizeVillaName(mock fetch) + i18n
- HTTP/Playwright: ADMIN suggest/save 200, 공급자 403, 공개 빌라명 병기 렌더
- PDF: 한글+베트남어 병기 실렌더(폰트 런분리와 호환 — ADR settlement-pdf-korean-glyph-fix)
