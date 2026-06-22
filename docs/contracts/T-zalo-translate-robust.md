# 계약: Zalo 채팅 번역 부분실패 견고화 (translateText robustness)

담당: INTEG · 합의: QA · 상태: 착수

## 배경
gemini-2.5-flash(thinkingBudget:0)가 번역을 중간에 멈추고 원문(베트남어)을 그대로 남기는
간헐 부분실패 발생. 예: "Tôi đã tìm đến nhà sản xuất tất…" → "제가 양 nhà sản xuất tất…"
(앞 2~3글자만 한국어, 나머지 원문 잔류).

## 범위 (수정 파일)
1. `lib/gemini.ts` — translateText 내부 견고화만(시그니처 변경 최소):
   - 실패 감지(ko 타겟: 한글 비율 낮음 + 라틴/베트남어 잔류 / 원문과 과도 유사)
   - 실패 시 1회 재시도(강화 프롬프트 + 재시도에만 thinkingBudget 소폭 부여)
   - 기본/재시도 프롬프트 강화("전체 번역, 원문 잔류 금지, 번역문만"). 고유명사 유지 문구 보존
   - 무한루프 금지(재시도 1회), 더 나은 쪽(한글 비율↑) 반환
2. `scripts/fix-broken-translations.ts` (신규) — 프로덕션 DB 부분실패 translatedText 재번역:
   - INBOUND msgType=text, translatedText 있으나 한글 거의 없음+베트남어 잔류
   - 고유명사/연락처/브랜드 false positive 최소
   - `--dry-run`(건수·샘플) / 본실행(UPDATE). 멱등·동시성 제한·건수 로그. translateMode OFF 제외
3. `tests/gemini-translate.test.ts` (신규) — 실패감지·재시도 단위테스트(fetchFn 주입)

## 수정 금지 구역 (비접촉)
- lib/cleaning.ts, lib/hold.ts, lib/proposal.ts
- LAUNCH.md, partB-*.png
- 기존 번역/STT/OCR/발송/webhook 로직 무변경
- 다른 세션 작업 중 파일: app/(admin)/messages/*, lib/zalo-counterparty.ts,
  messages/*.json, prisma/schema.prisma (git status untracked/modified — 비접촉)

## 완료 기준 (테스트 가능)
- [ ] translateText: 부분번역 응답 → 재시도 → 정상번역 반환 (단위테스트)
- [ ] translateText: 재시도도 실패 시 더 나은 쪽 반환, 호출 ≤2회
- [ ] 정상 번역은 재시도 없이 1회 호출(회귀 없음)
- [ ] 신규 의존성 0
- [ ] `npx tsc --noEmit` 통과
- [ ] gemini vitest 통과 (기존 + 신규)
- [ ] `npx next build` 통과
- [ ] 재번역 스크립트 dry-run으로 대상 건수 보고 (본실행은 사용자 확인 후)

## 제약
- 커밋하지 않음(사용자 지시)
