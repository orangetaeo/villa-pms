# 계약서 — Zalo 정산서 파일 실첨부 (INTEG)

- 태스크: P2-4 후속 — 정산완료 Zalo 알림에 정산서 PDF **파일 실첨부**(현재 텍스트 링크만)
- 담당 세션: wt/zalo-statement-attach
- 선행: P2-4 정산서 PDF(머지, main), zca-js sendMessage attachments 지원 확인됨

## 배경
현재 `dispatchOne`은 `sendBotMessage(zaloUserId, text)` 텍스트 전용. zca-js `api.sendMessage`는
`MessageContent.attachments`(`string 경로` | `{data:Buffer, filename, metadata:{totalSize}}`)로 파일 송신 지원.

## 범위
- `lib/zalo-runtime.ts`:
  - `sendVia`에 `attachments?: BotAttachment[]` 추가 → MessageContent에 zca-js AttachmentSource로 매핑.
  - `buildSendPayload(text, mentions?, attachments?)` 순수 함수 분리(plain string vs MessageContent) + export(테스트용).
  - `sendBotMessageWithAttachments(zaloUserId, text, attachments)` 신규. **기존 sendBotMessage 시그니처 무변경.**
  - `export interface BotAttachment { data: Buffer; filename: string; totalSize: number }`.
- `lib/zalo.ts`:
  - `buildStatementAttachment(buffer, yearMonth)` 순수(파일명 `quyet-toan-{YYYY-MM}.pdf`) — 테스트 대상.
  - `resolveStatementAttachment(notification)`: SETTLEMENT_READY면 settlementId로 private/statements 파일 읽기;
    없으면 settlement-statement-service 동적 import로 생성 후 재읽기; 실패 시 null(텍스트 폴백).
  - `dispatchOne`: 첨부 있으면 `sendBotMessageWithAttachments`로, 없으면 기존 `sendBotMessage`. 미러 msgType="file".

## 수정 금지 구역
- **공급자 화면 정산서 목록 UI = 타 세션 작업** — app/(supplier)/** 및 공급자 정산 화면 미수정.
- settlements-view.tsx 미수정. messages 키 추가 없음. 공유 메인 직접 커밋 금지.

## 완료 기준
1. SETTLEMENT_READY 발송 시 정산서 PDF가 zca-js 파일 첨부로 전송(첨부 있으면 file-capable 경로).
2. 첨부 실패(파일 미생성·읽기 실패·미연결)는 **텍스트 발송으로 graceful 폴백**(크래시·발송누락 없음).
3. 기존 알림 타입·sendBotMessage 동작 무변경(회귀 0).
4. 누수 0(정산서=공급자 본인 원가만), typecheck0, 무회귀 테스트, next build.

## 검증
- `buildSendPayload`·`buildStatementAttachment` 단위테스트 + 기존 zalo.test 무회귀.
- `npm run typecheck` / `npx next build`.
- 실제 Zalo 송신은 봇 연결·실수신자 필요 → 코드리뷰+빌드로 검증(실송신 스팸 회피).
