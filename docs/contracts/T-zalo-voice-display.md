# T-zalo-voice-display — Zalo 음성 메시지 표기·번역 완결

- 상태: 착수 (2026-07-10)
- 담당: BE(에코 경로·분류) + FE(인박스 미리보기) + QA
- 배경: 테오 실사용 보고 — "Zalo 앱에서 음성메시지가 오면 화면에 표기도 안 된다."

## 진단 결과 (실데이터 확정)

라이브 DB·워커 로그 조사 결과, 수신(INBOUND) 음성 파이프라인 자체는 정상:
2026-07-10 08:58 UTC 테오→김태진 음성은 김태진 세션에 `msgType=voice` + URL + STT 번역까지
저장 완료(`cmrepeade0007oz0qh9lqdh1t`). 문제는 3곳.

1. **본인 발신(앱) 음성 에코가 조용히 드롭** — 같은 08:58 음성의 테오 세션 발신 에코 행이
   부재. `zalo-runtime.ts` handleInboundEvent의 self 분기(라인 ~726)가
   `!text && attachmentUrls.length === 0`이면 스킵하는데, 전달(forward)된 음성 에코는
   `chat.voice`로 분류되지만 top-level에 URL 필드가 없어(voiceUrl/m4aUrl/href/url 부재)
   첨부 0 → 스킵. 워커 로그에 `[inbound-type]`(unknown류 진단)이 없으므로 분류는 voice로
   확정(소거법). 비교: 09:11 김태진의 직접 녹음 음성 에코는 URL 추출 성공 → 저장됨.
2. **인박스 미리보기에 voice 라벨 없음** — `app/(admin)/messages/inbox.tsx` previewText가
   voice/sticker/video/location/contact 케이스 없이 `"—"` 표기.
3. **발신 에코 음성은 STT 미실행** — 09:11 에코 행 translatedText=null. 수신만
   maybeTranscribeVoice 호출(라인 ~845). 앱에서 보낸(또는 전달한) 음성도 자막이 필요.

## 범위 (수정 파일)

- `lib/zalo-inbound.ts` — ① classifyInbound `chat.voice`: top-level 실패 시 `params`
  JSON 내 URL 필드(m4aUrl/voiceUrl/href/url) 폴백 추출. ② saveOutboundEcho 반환에
  `messageId`·`translateMode` 추가(에코 STT용, 기존 호출부 하위호환).
- `lib/zalo-runtime.ts` — ① self 분기 스킵 조건 축소: 미디어 타입
  (voice/photo/file/sticker/video/location)은 URL 추출 실패여도 미러(타입 카드로 표기).
  스킵은 call/unknown/빈 text만 유지. ② voice인데 URL 0건이면 `[voice-nourl]`로
  content 키 이름만 진단 로그(개인정보 0 — 기존 [inbound-type-keys] 패턴). ③ 발신 에코
  voice 저장 성공 시 maybeTranscribeVoice fire-and-forget (translateMode OFF 제외).
- `app/(admin)/messages/inbox.tsx` — previewText에 voice/sticker/video/location/contact
  케이스 추가(라벨은 기존 adminMessages.preview.* 키 재사용, 없는 키는 ko/vi 동시 추가).
- `messages/ko.json`·`vi.json` — 부족한 preview 키만 추가(키 추가만, 기존 키 불변).
- `lib/zalo-inbound.test.ts` — params 폴백 분류 테스트 추가.

## 수정 금지 구역

- prisma/schema.prisma (스키마 변경 없음)
- worker/ (코드 공유하므로 lib 수정만으로 워커에 반영됨)
- 발송(send) 경로, 번역 파이프라인(gemini.ts), SSE 경로

## 완료 기준 (테스트 가능)

1. `classifyInbound({ params: '{"m4aUrl":"https://cdn/v.m4a"}' }, "chat.voice")` →
   `{ msgType: "voice", attachmentUrls: ["https://cdn/v.m4a"] }` (신규 테스트 통과)
2. self 에코 voice + URL 추출 실패 payload → saveOutboundEcho 호출됨(스킵 안 함),
   행 msgType=voice로 저장 → FE "음성 메시지" 카드 렌더(URL 없으면 재생 링크만 미표시)
3. 발신 에코 voice 저장 시 translatedText에 STT 자막 채워짐(Gemini 설정 시)
4. 인박스에서 마지막 메시지가 voice인 대화 미리보기 = "[음성 메시지]" (— 아님)
5. `npm run lint && npm run typecheck` + 기존 테스트 전건 통과
6. 수신 음성 회귀 0: 기존 INBOUND voice 저장·STT·카드 렌더 경로 무변경 확인

## 검증 방법

- vitest: zalo-inbound.test.ts (분류·에코 반환값)
- 프로덕션 배포 후 실측: 테오가 Zalo 앱에서 음성 발신(직접 녹음 + 전달 각 1회) →
  /messages 양쪽 세션 화면에 음성 카드+자막 확인. [voice-nourl] 로그로 실 payload 키 수집.
