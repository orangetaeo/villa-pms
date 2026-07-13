# 계약서 — 그룹 대화 이미지·파일·공유 오발송 수정 (share 경로 ThreadType 누락)

## 배경 (P0 버그 — 오발송 = 정보 유출)

/messages 그룹 대화에서 이미지를 첨부 발송하면 그룹이 아니라 **모르는 사람(STRANGER) 1:1 채팅으로 배달**된다.
2026-07-13 실사고: 관리자 화면 스크린샷 2장이 낯선 사용자에게 전달됨 (사용자 스크린샷 확보).
DB 실측: 최근 OUTBOUND photo 중 threadType=GROUP 대화 발송 다수 (04:08, 04:54 UTC 등) — 전부 SENT로 기록되나 실제로는 그룹 미도달.

## 근본 원인

`app/api/zalo/conversations/[id]/share/route.ts`:
- 대화 조회 select에 `threadType` 자체가 없음 (L152~155)
- `sendChatImageAsAdmin` / `sendChatFileAsAdmin` / `sendChatMessageAsAdmin` 호출 전부 threadType 미전달 → 기본 `ThreadType.User`
- zca-js가 그룹 id를 User 타입으로 발송 → Zalo가 엉뚱한 1:1 스레드에 배달

텍스트 채팅(`app/api/zalo/messages/route.ts` L197~199)은 ADR-0010 S4에서 `sendThreadType`을 올바르게 전달 —
runtime 함수들엔 threadType 파라미터가 이미 있으나(ADR-0010 S4 주석) **share 라우트 호출부만 갱신 누락**된 회귀.

## 범위

- `app/api/zalo/conversations/[id]/share/route.ts` 단일 파일:
  1. 대화 select에 `threadType` 추가, `ConversationCtx`에 threadType 필드 추가
  2. `sendThreadType` 파생 (GROUP → ThreadType.Group, 그 외 User) — messages/route.ts와 동일 패턴
  3. 발송 호출 전부에 전달: handlePhoto(sendChatImageAsAdmin), handleFile(sendChatFileAsAdmin),
     sendVillaShare(이미지+텍스트 폴백 둘 다), handleProposal, handleSettlement
- 테스트: share 라우트에 그룹 대화 photo 발송 시 ThreadType.Group 전달 검증 추가(기존 테스트 파일 있으면 거기에)

## 수정 금지 구역

- lib/zalo-runtime.ts (시그니처 이미 지원 — 무변경)
- app/api/zalo/messages/route.ts (정상 동작 — 무변경)
- app/api/zalo/ext/send/route.ts (이미 threadType 전달 — 무변경)
- 메인 폴더 untracked 파일들 (kakao-icon*, villa-go-*, design-audit/ — 타 세션 작업물)

## 완료 기준 (테스트 가능)

1. 그룹 대화(threadType=GROUP)에 photo/file/villa/proposal/settlement 공유 시 zca-js sendMessage가 ThreadType.Group으로 호출된다
2. 1:1 대화(USER)는 기존과 동일하게 ThreadType.User
3. `npm run lint && npx tsc --noEmit && next build` 통과
4. 기존 share 관련 테스트 회귀 없음

## 검증 방법

- 단위: vitest — sendChatImageAsAdmin/sendChatFileAsAdmin mock으로 threadType 인자 검증
- QA: 코드 리뷰(작성자≠평가자) + 프로덕션 배포 후 실그룹방 이미지 발송 확인은 테오 수동(실계정 필요)
