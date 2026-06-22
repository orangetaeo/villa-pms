# 계약: 채팅 사진(이미지) OCR 번역 (zalo-photo-translate)

## 범위
Nike의 채팅 이미지 OCR→번역 기능을 villa에 이식. 수신 photo 메시지의 이미지 속 텍스트를
추출·번역해 채팅창에 자막으로 표시.

### 트리거 방식 결정: 자동 (villa 패턴 우선)
Nike는 첨부 레벨 수동 버튼(ZaloAttachment.ocrTranslatedText)이나, villa는 첨부 테이블이 없고
메시지 레벨 `translatedText` + fire-and-forget 자동 패턴(maybeTranscribeVoice)을 사용.
villa의 음성 STT 자동 처리와 동일하게 **자동(수신 시 fire-and-forget)** 으로 구현해 일관성 유지.

## 추가 항목 (신규 함수·분기만, 기존 함수 무변경)
- `lib/gemini.ts`: `translateImage(imageBase64, mimeType, target, fetchFn)` 신규 (append)
- `lib/zalo-inbound.ts`: `maybeTranslatePhoto(messageId, imageUrl, translateMode)` 신규 (maybeTranscribeVoice 복제)
- `lib/zalo-runtime.ts`: msgType==="photo" 분기 추가 (voice 분기 옆)
- `app/(admin)/messages/chat-pane.tsx`: PhotoCard에 translatedText 자막 렌더 추가
- `messages/ko.json`·`vi.json`: `adminMessages.typeCard.photoTranscript` 키 추가만
- `tests/gemini-translate-image.test.ts`: translateImage 단위테스트 신규

## 스키마 영향
없음. 기존 `ZaloMessage.translatedText` 재사용 (마이그레이션 없음).
photo의 caption(text)과 OCR 번역은 별개 — caption은 `text`, OCR 번역은 `translatedText`로 구분.

## 수정 금지 구역 (비접촉)
lib/cleaning.ts, lib/hold.ts, lib/proposal.ts, LAUNCH.md, partB-*.png

## 완료 기준
- `npx tsc --noEmit` 통과
- 관련 vitest 통과 (gemini-translate-image, 기존 gemini-transcribe/inbound 회귀 0)
- 기존 ocrPassport·translateText·transcribeVoice·STT·발송·webhook 무변경
