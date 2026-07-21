# 계약: T-webchat-backlog-cleanup — 웹챗 링크 백로그 잔여 2건

착수: 2026-07-21 · 브랜치: worktree-webchat-backlog-cleanup · 선행: PR #347(백로그 3건)

## 배경
PR #347에서 남긴 백로그 잔여 2건 정리.

## 범위 (IN)

### (1) phoneTailMatch / tokenPrefixOf lib 통합
- 현재 `phoneTailMatch`가 2곳에 동일 복제:
  - app/api/webchat/sessions/[id]/booking-candidates/route.ts:61
  - app/api/webchat/inbox/route.ts:21 (+tokenPrefixOf:31)
- 신규 `lib/webchat-candidate-match.ts`로 순수 함수 추출: `phoneTailMatch(a, b)`, `tokenPrefixOf(sourcePage)`(sourcePage `g:<8자>`에서 토큰 prefix 추출, ≥6자 가드). 두 라우트가 이 lib를 import(인라인 복제 제거)
- ★**동작 100% 불변**(순수 리팩터) — 로직·임계값(8자 tail·6자 prefix) 그대로. booking-candidates route는 PR #340 이후 "수정 금지"였으나 이번 태스크에서 **이 함수 추출 목적으로만** 수정 허용(로직 변경 금지, import 치환만)

### (2) 수동 타이핑 URL 번역 보존
- lib/gemini.ts translateText 프롬프트가 숫자·전화·고유명사 보존은 있으나 **URL/링크 보존 지시 없음** → 운영자가 채팅에 직접 URL 타이핑 시 Gemini가 경로·토큰을 변형/번역할 위험
- BASE_PROMPT_NOTE·RETRY_PROMPT_NOTE에 "Keep all URLs/links (http/https and paths) EXACTLY as written — do not translate, alter, encode, or split them" 한 줄 추가
- numbersPreserved 패턴 준용해 `urlsPreserved(source, output)` 순수 함수 추가(원문의 URL 토큰이 출력에 그대로 있는지) → translateText 재시도 트리거(firstBroken)에 `!urlsPreserved` 추가(숫자 보존과 동일 취급: 재시도·선택 로직에 반영)
- ★lib/gemini.ts는 웹챗·Zalo·카탈로그 등 **공용 번역 함수** — 회귀 주의. 기존 테스트(lib/gemini-injection.test.ts 등) 통과 필수. URL 없는 일반 메시지는 동작 불변(urlsPreserved가 URL 0개면 true 반환)

## 범위 밖 (OUT)
- 웹챗 카드/인박스/Zalo 링크 기능 자체(PR #347 완료)
- 번역 모델·비용 구조 변경

## 완료 기준 (테스트 가능)
- [ ] phoneTailMatch·tokenPrefixOf가 lib 단일 정의, 두 라우트 import(중복 0 — grep으로 함수 정의 1곳)
- [ ] 리팩터 후 후보 판정·인박스 배지 동작 불변(기존 테스트 있으면 통과, 없으면 순수 함수 단위 테스트 추가)
- [ ] URL 포함 메시지 번역 시 URL 토큰 보존(urlsPreserved 단위 테스트: 보존 true / 변형 false)
- [ ] URL 없는 메시지는 urlsPreserved=true라 재시도 트리거 무영향(회귀 0)
- [ ] lib/gemini 기존 테스트 전부 통과, tsc·lint·next build 통과

## 수정 금지 구역
- 번역 호출부(webchat.ts·zalo-inbound.ts)의 로직 — gemini.ts 내부만 강화
- prisma·타 기능
