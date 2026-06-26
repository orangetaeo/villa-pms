# 계약서 — 정산 2차 P2-4 월 정산서 PDF (vi)

- 태스크: P2-4
- 담당 세션: wt/settlement-pdf
- 선행: P2-1/2/3(머지, main e9d9f25)
- 테오 결정(2026-06-25): ADMIN 생성/다운로드 + 정산완료 Zalo 전달, 둘 다.

## 범위
- PDF 라이브러리 **@react-pdf/renderer**(서버, 네이티브 의존 없음, Railway 호환).
- 베트남어 글리프 위해 **Unicode TTF 폰트 번들**(Roboto/NotoSans, `assets/fonts/`).
- `lib/settlement-statement.tsx`: 정산 데이터 → PDF Buffer. **vi 본문**. 내용 = 공급자명·월·라인아이템(빌라·체크아웃·박수·금액VND)·합계VND·환차(있으면). **마진·판매가·KRW 절대 미포함**(공급자 화면 원칙2).
- **비공개 저장**: 여권 패턴(savePassportFile류, 항상 디스크/volume, 공개 URL 미생성). `Settlement.statementUrl`에 파일명 저장.
- API:
  - `POST /api/settlements/[id]/statement` (ADMIN) — 생성·저장·statementUrl 갱신, writeAuditLog.
  - `GET /api/settlements/[id]/statement` — 서빙. 게이트: **ADMIN(canViewFinance) 또는 그 정산의 소유 공급자(supplierId === session.user.id)**. private,no-store.
- UI: ADMIN 정산 화면에 "정산서 생성/다운로드" 버튼.
- Zalo: MARK_PAID 시 정산서 자동 생성 + SETTLEMENT_READY 알림 **텍스트에 다운로드 링크** 포함.

## 미해결/후속 (이 계약 범위 밖)
- **실제 Zalo 파일 첨부 발송**: 현재 `sendBotMessage`는 텍스트 전용(zalo.ts 484–486 "잔여"). 파일 첨부는 zca-js 파일 송신 배선(INTEG 선행) 필요 → 본 P2-4는 **다운로드 링크 전달**까지. 첨부 실발송은 별도 태스크.

## 수정 금지 구역
- 공유 메인 폴더 직접 커밋 금지(worktree). messages/*.json 키 추가만.
- settlements-view.tsx는 타 세션 활성 가능 — 버튼은 최소 추가, 충돌 시 page.tsx/별도 컴포넌트로.

## 완료 기준 (테스트 가능)
1. 생성된 PDF에 **마진·판매가·KRW 미포함**(생성기 단위테스트로 필드 검증).
2. PDF 본문 vi, 라인아이템 합 = totalVnd(BigInt).
3. 서빙 게이트: ADMIN·소유 공급자만 200, 그 외 403, 비로그인 401.
4. statementUrl 갱신 + AuditLog 기록.
5. MARK_PAID 시 정산서 생성 + 알림 텍스트에 링크.
6. typecheck0 · 기존 테스트 무회귀 · `next build` 통과 · 누수0.

## 검증 방법
- `npx vitest run lib/settlement-statement.test.ts lib/settlement.test.ts`
- `npm run typecheck` / `npx next build`
- 누수: grep statement import 경로 + 공급자 게이트 + PDF 필드 확인
