# 계약서 — 빌라당 마케팅 콘텐츠 상한 (per-villa-content-cap)

작성: 2026-07-23 / 담당: BE / 검증: QA

## 배경

빌라 재고가 2곳(Sonasea V3B, M villa M1)뿐인데 draft cron이 매일 인스타 3건·유튜브 쇼츠 1건을
생성해 **같은 빌라가 반복 도배**된다. 테오가 승인을 보류 중(인스타 PENDING 2건, 유튜브 PENDING 2건).
빌라가 늘기 전까지는 자동 생성이 멈추는 것이 맞다.

## 범위

1. **AppSetting 2키 신설** (DB 스키마 변경 없음)
   - `IG_POSTS_PER_VILLA` — 빌라 1곳당 인스타 콘텐츠 상한. 미설정 기본 **1**. `0`이면 자동 초안 완전 중단.
   - `YT_SHORTS_PER_VILLA` — 빌라 1곳당 유튜브 쇼츠 상한. 미설정 기본 **1**. `0`이면 완전 중단.
2. **로테이션 적격 판정에 상한 반영** — 살아있는 콘텐츠 수 ≥ 상한인 빌라는 후보에서 제외.
   - "살아있는" = status가 `CANCELLED`/`FAILED`가 **아닌** 것 (반려·실패분은 슬롯을 도로 비워준다).
   - 유튜브는 `sourceType` 무관(직접 업로드분도 상한에 포함).
3. **cron 조기 반환 버그 수정** — 인스타 적격 빌라가 0곳일 때 `return`으로 빠져나가면서
   유튜브 배치까지 스킵되던 흐름을 분리(이번 변경으로 인스타 0곳이 상시화되므로 필수).

## 수정 금지 구역

`lib/youtube/edit.ts`, `lib/instagram/reels.ts`, `render.ts` 등 렌더 파이프라인 일체(타 세션 작업 중일 수 있음).

## 완료 기준 (테스트 가능)

- [ ] `isRotationEligible(photoCount, liveCount, cap)` 순수함수 유닛테스트 통과 (cap=0/1/N, 사진 부족).
- [ ] 현재 DB 상태(두 빌라 모두 PUBLISHED 보유)에서 `selectVillasForRotation`·`selectVillasForYoutubeRotation`이 **0곳** 반환.
- [ ] 인스타 0곳이어도 유튜브 배치 로직이 호출되는 흐름 유지(응답에 `youtube` 필드).
- [ ] `npm run lint && npm run typecheck && npx vitest run` 통과.
- [ ] 상한을 2로 올리면 다시 후보가 되는지 유닛테스트로 확인(운영자 조절 가능성 보장).

## 검증 방법

`npx vitest run lib/instagram lib/youtube` + 프로덕션 DB 읽기 전용 드라이런 스크립트로 후보 0곳 확인.
