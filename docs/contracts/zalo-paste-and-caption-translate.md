# 계약: Zalo 채팅 이미지 붙여넣기 + 사진 캡션 번역

- **브랜치**: `wt/zalo-paste-caption` (worktree 격리)
- **요청 (테오, 2026-07-03)**:
  1. 외부에서 복사한 이미지를 /messages 채팅 입력창에 붙여넣기(Ctrl+V)로 전송할 수 없다.
  2. 사진에 캡션으로 들어온 메시지(예: 이미지+베트남어 문장)는 번역이 안 된다 — 사진의 "번역" 버튼은 이미지 OCR 전용이고, 캡션(text)은 자동번역(`msgType==="text"`만)·수동번역(text 버블 전용) 어느 경로에도 안 걸린다.

## 범위

### A. 이미지 붙여넣기 (`app/(admin)/messages/chat-pane.tsx` Composer)
- textarea `onPaste`: clipboardData에서 이미지 파일 추출 → 기본동작 차단 → **미리보기 카드**(답글 미리보기 패턴) 표시.
- 전송 버튼 → 기존 사진 업로드 파이프라인 재사용(`resizeImage` → `POST /api/zalo/conversations/[id]/share` FormData) → 스레드 갱신. 취소 버튼으로 해제.
- 오전송 방지: 붙여넣기 즉시 전송하지 않고 반드시 미리보기→전송 2단계.
- i18n: `adminMessages` 네임스페이스에 ko+vi 키 추가.

### B. 캡션 번역
- **스키마(additive)**: `ZaloMessage.captionTranslated String?` — OCR 번역(`translatedText`)과 캡션 번역을 분리(같은 사진에 둘 다 필요 — 스크린샷 사례). 라이브 DB는 raw SQL `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`(db push 금지).
- **자동번역**: `lib/zalo-runtime.ts` 수신 분기 — `msgType==="photo"` && 캡션 있음 && translateMode≠OFF → `maybeTranslateInbound(..., field: "captionTranslated")` (기존 함수에 대상 필드 파라미터 추가, 기본값 translatedText로 기존 동작 불변).
- **on-demand**: `POST /api/zalo/messages/[id]/translate` — TRANSLATABLE_TYPES에 photo 추가, photo는 `captionTranslated`에 저장·멱등(text/link/location은 기존 그대로 translatedText).
- **직렬화**: `_thread-data.ts`·`app/api/zalo/messages/route.ts` select, `lib/zalo-chat-message.ts` Row/DTO, chat-pane `ChatMessage`에 captionTranslated 추가.
- **UI(PhotoCard)**: 캡션 아래 캡션 번역 표시(번역 라벨), 없으면 캡션 옆 수동 "번역" 버튼(translateMode ON·수신·캡션 있음일 때). 기존 OCR 오버레이 버튼·자막(translatedText)은 불변.
- Nike push DTO는 비변경(villa 화면 전용 개선).

## 완료 기준 (테스트 가능)
1. 클립보드 이미지 붙여넣기 → 미리보기 카드 → 전송 → 사진 버블 표시 + 상대에게 발송(share 라우트 200).
2. 번역모드 VI 대화에서 캡션 있는 사진 수신 → captionTranslated 자동 채움 + SSE 재발행(기존 publishInboundTranslated 경로).
3. 과거 캡션 사진 메시지 → 캡션 "번역" 버튼 → ko 번역 표시·저장(멱등). OCR 버튼은 그대로 동작(별도 필드).
4. `npx vitest run tests/zalo-inbound-translate.test.ts` 통과(필드 파라미터 케이스 추가), `npm run build` 통과.

## 수정 금지 구역
- prisma 스키마의 다른 모델, lib/zalo-webhook.ts(Nike push), 발신 번역 경로(app/api/zalo/messages/route.ts POST 발신 로직 — select 추가만).
