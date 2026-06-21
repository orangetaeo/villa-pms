# 계약: Nike↔villa Zalo 통합 S5 — forward·alias·음성STT 동등 구현 (ADR-0010 이행)

날짜: 2026-06-21 / 담당: villa=BE·INTEG / Nike=INTEG / 평가: QA
근거: docs/decisions/ADR-0010-nike-villa-zalo-session-chat-share.md (A안 채택·정본=villa·SPOF 수용·풀스펙 확정), WBS 그룹 A(**A6**: forward+alias+음성STT 동등)+그룹 B(**B5**: 테오 forward/setAlias/voiceTranslations를 villa로 위임), ADR-0006(zca-js 단일봇), ADR-0007(`__system__`·ownerAdminId 격리), ADR-0009(첨부·번역·답글·리액션·번역모드·별명 DTO). 코드 근거: lib/zalo-runtime.ts(sendChat*AsAdmin 패턴·zca-js api 객체)·lib/zalo-inbound.ts(saveInboundMessage·maybeTranslateInbound·classifyInbound "voice")·lib/gemini.ts(translateText·ocrPassport inline_data REST 패턴)·app/api/zalo/ext/send/route.ts(S1 ext 발송 discriminatedUnion)·app/api/zalo/conversations/[id]/route.ts(SET_NICKNAME 액션)·lib/zalo-webhook.ts(S2 push DTO 화이트리스트)·prisma/schema.prisma(ZaloConversation.nickname·ZaloMessage.translatedText·msgType String). zca-js: `node_modules/zca-js/dist/apis/{forwardMessage,changeFriendAlias,getAliasList,removeFriendAlias}.d.ts`. Nike: `C:\Projects\Nike\src\lib\gemini.ts`(transcribeAudio inlineData)·`zalo-pool.ts`(processVoiceAutoTranslate L778~814)·`zalo.ts`(changeAlias L607·removeAlias L631·getVoiceTranslations L275)·`villa-ext-client.ts`(S1·S2 위임 클라). **선행 계약: docs/contracts/zalo-integration-s1.md(세션 단일화+발송 위임)·s2.md(읽기 정본+webhook→SSE)·s3.md(ETL) — 셋 다 완료·QA통과·배포대기. S5는 S1(발송 경로) 의존, S4와 독립. 착수 선점 선언(이 계약 단독 커밋).**

## 배경
ADR-0010 A안에서 정본 = villa. S1(발송)·S2(읽기·실시간)·S3(ETL)이 핵심 송수신·이력을 villa로 일원화했다. S5는 **통합 이전 Nike에만 있던 3개 부가 기능**(forward / alias / 음성STT)을 villa에 동등 구현해, 테오가 Nike UI에서 쓰던 기능을 villa 허브 경유로도 동일하게 쓰게 한다. 셋 다 villa **스키마 무변경**으로 가능하다:
- **forward**(전달): zca-js `forwardMessage`로 메시지 텍스트를 다른 스레드로 전달. villa 발송 함수 패턴(`sendChat*AsAdmin`) + ext send에 `kind:"FORWARD"` 추가.
- **alias**(별명): villa는 이미 `ZaloConversation.nickname`(ADR-0009 D9) + `SET_NICKNAME` 액션을 보유. Nike의 setAlias(테오)를 villa nickname으로 매핑 — **거의 무비용**(아래 ③).
- **음성STT**: villa `lib/gemini.ts`에 `transcribeVoice`(Gemini audio `inline_data`, ocrPassport·Nike transcribeAudio 패턴) 추가. 수신 voice 메시지 저장 시(zalo-inbound) STT → **기존 `translatedText`에 기록**(스키마 무변경). Nike voiceTranslations를 villa 정본으로 위임.

**절대 불변식(S1/S2/S3 계승)**: 테오 세션 리스너는 villa `__system__` 인스턴스 **정확히 1개**(code 3000 회피). S5는 발송 래퍼 1개·STT 1개·ext kind 1개·webhook 필드 추가만 — **세션 소유·리스너 구조를 일절 건드리지 않는다.**

## ① 구현 범위

### villa-pms (허브) — BE/INTEG

#### A6-1 forward (메시지 전달)
- **villa `sendChatForwardAsAdmin(adminUserId, targetThreadId, message, reference?)`** (lib/zalo-runtime.ts 신규 함수): zca-js `api.forwardMessage({ message, reference? }, [targetThreadId], ThreadType.User)` 래퍼. `sendChat*AsAdmin` 패턴 그대로(getApiForAdmin → 미연결 시 ERROR_BOT_NOT_CONNECTED, try/catch로 BotSendResult 반환). **신규 발송 인프라 작성 금지 — 기존 함수 형태 복제.**
  - **(중요) zca-js forward는 "원본 msgId 재전송"이 아니라 "텍스트 content 전달"**이다: `forwardMessage(payload: { message: string, reference? }, threadIds[], type)` — payload.message가 비면 throw("Missing message content"). 즉 **호출부가 원본 메시지의 본문 텍스트를 넘긴다.** 첨부(이미지/파일/음성)는 forwardMessage가 직접 옮기지 못한다(텍스트 전용). 첨부 전달은 **범위 밖**(아래 범위 밖) — 본문 텍스트 forward만. `reference`(원본 id·ts)는 "전달됨" 표시 데코용 선택값(보유 시 채우되 미보유여도 동작).
  - **OUTBOUND echo 일관성**: forward로 보낸 메시지도 테오 세션에 selfListen 에코로 들어와 `saveOutboundEcho`로 정본 저장 + S2 webhook push된다(별도 저장 로직 불필요 — 기존 경로 재사용). forward 함수는 발송만 책임.
- **ext send `kind:"FORWARD"`** (app/api/zalo/ext/send/route.ts discriminatedUnion에 분기 추가): `{ kind:"FORWARD", threadId(전달 대상), message(원본 본문 텍스트), reference?:{ id,ts,logSrcType,fwLvl } }` → `sendChatForwardAsAdmin(ownerAdminId, threadId, message, reference)` 호출. 기존 TEXT/IMAGE/REPLY/REACTION 분기와 동일 형태(시크릿 게이트·ownerAdminId 서버 고정·502/500 에러 매핑 그대로). **Nike B5가 테오 forward를 이 kind로 위임.**

#### A6-2 alias (별명) — 양방향 편집 (테오 결정 2026-06-21)
- **표시·저장 정본 = villa `ZaloConversation.nickname`**(ADR-0009 D9). villa는 이미 `PATCH /api/zalo/conversations/[id]` `SET_NICKNAME` 액션(app/api/zalo/conversations/[id]/route.ts:170~197, AuditLog) + S2 `/ext/threads` DTO nickname 보유.
- **(테오 확정)** 별칭 편집을 **villa·Nike 양쪽에서** 가능(ADR-0010 setAlias 쓰기 위임 요구와 일치). villa 자체 편집은 기존 SET_NICKNAME 그대로, Nike 편집은 아래 신규 ext 쓰기 라우트로 villa에 위임. 어느 쪽이든 villa nickname 정본 1곳에 저장→S2 읽기로 양쪽 동일 표시.
  - **(테오 결정 2026-06-21 — 양방향 채택)** 별칭 편집을 Nike에서도 가능하게 한다. **신규 ext 쓰기 라우트 `POST /api/zalo/ext/nickname`**(시크릿 게이트 isExtSecretValid + ownerAdminId 테오 서버고정·요청 미수용) 신설: `{ zaloUserId 또는 conversationId, nickname }` → 테오 스코프 대화 nickname을 **SET_NICKNAME과 동일 로직**(검증·trim·길이·AuditLog)으로 UPDATE. conversations/[id] route의 SET_NICKNAME 동작은 불변(공통 헬퍼 추출 또는 ext에서 동일 구현). 응답 최소(ok/nickname)·credential 비노출. villa nickname이 정본이라 Nike·villa 어디서 편집하든 villa 저장→S2 읽기로 양쪽 동일 표시.

#### A6-3 음성STT
- **villa `transcribeVoice(audioBase64, mimeType, fetchFn?)`** (lib/gemini.ts 신규 함수): Gemini `generateContent` REST에 audio `inline_data`로 음성 전달 → 텍스트 반환. **ocrPassport(L48~90)·translateText(L113~156)의 fetch·키게이트·타임아웃·에러(상태코드만 로그) 패턴 그대로 복제**(GEMINI_API_KEY 게이트→GeminiNotConfiguredError, AbortSignal.timeout, `x-goog-api-key`, thinkingBudget:0). 프롬프트는 Nike transcribeAudio(gemini.ts:460~468) 차용: "오디오를 들리는 그대로 받아쓰기, 번역 금지, 설명·라벨 금지, 불명확/무음이면 빈 문자열". 소스언어는 모델 자동감지(베트남 상대 위주). **개인정보 주의: 오디오 base64·STT 결과를 console/AuditLog에 기록 금지(gemini.ts 기존 원칙 계승 — 상태코드·메시지만).**
- **수신 voice 트리거**(lib/zalo-inbound.ts 또는 zalo-runtime.ts 호출부 보강): `classifyInbound`가 이미 `msgType="voice"` + `attachmentUrls=[voiceUrl]`로 분류(zalo-inbound.ts:244~247). 수신 저장 후(saveInboundMessage saved:true) **fire-and-forget**으로 `maybeTranscribeVoice(messageId, voiceUrl, translateMode)` 호출: ① voiceUrl HTTP GET(`AbortSignal.timeout` 15s, Nike processVoiceAutoTranslate 패턴) → base64 → ② `transcribeVoice` → ③ STT 결과를 ko로 번역(`translateText(stt,"ko")`)해 **`ZaloMessage.translatedText`에 UPDATE**(운영자가 읽음 — maybeTranslateInbound와 동일 필드·동일 의미). 저장은 maybeTranslateInbound와 같은 패턴(존재 메시지 id UPDATE). **리스너 블로킹 금지(await 없이 void), 1건 실패가 리스너를 죽이지 않게 전체 try/catch.**
  - **결과 저장 필드 확정(스키마 무변경)**: STT 한 결과는 **`translatedText`**(운영자용 ko). 원문(받아쓴 vi)을 별도 보존할 필드가 스키마에 없으므로(text는 voice일 때 빈 문자열로 저장됨 — zalo-runtime.ts:688~693), **MVP는 translatedText에 ko 번역만 기록**(text는 voice 라벨 유지). 원문 vi 병기는 스키마 컬럼(예 sttText) 필요 → **범위 밖(S4 이후 스키마 변경 시)**. 본 계약은 translatedText 단일 필드로 확정해 무변경 보장.
  - **(BLOCKER 보강 — STT 자막 FE 표시 필수)** QA 실측 결과 현재 voice 메시지는 `chat-pane.tsx`의 `SimpleTypeCard`(:1298~1307)로 렌더되어 **translatedText가 화면에 그려지지 않는다**(translatedText 렌더는 typeCard가 null인 else 분기 :899~933에만 있고 voice는 typeCard non-null이라 도달 불가). 따라서 STT 결과가 데이터엔 차지만 villa 화면엔 안 보임. **villa FE 수정 필수**: `app/(admin)/messages/chat-pane.tsx`의 음성 카드(SimpleTypeCard 또는 voice 분기)에 `translatedText`가 있으면 **STT 자막(음성 내용 텍스트)으로 렌더** 추가(mic 라벨 아래 자막). 따라서 "villa 신규 코드 0건" 주장은 **"FE 1곳(chat-pane voice 카드) 추가"로 정정**. 기존 카드 확장이라 DESIGN 선행은 경미(라벨+자막 한 줄).
  - **번역모드 존중(D7.4)**: `translateMode==="OFF"`면 STT까지 스킵(Gemini 호출 0 — maybeTranslateInbound와 일관). VI/EN이면 STT→ko 번역 저장.
  - **본인 발신(OUTBOUND echo) voice**: 테오가 보낸 음성도 selfListen 에코로 들어오나, MVP는 **수신(INBOUND) voice만 STT**(운영자가 상대 음성을 읽는 게 목적). 본인 발신 음성 STT는 범위 밖.
- **S2 webhook push 보강**(lib/zalo-webhook.ts): STT가 voice 메시지의 `translatedText`를 **비동기로(수신 push 이후) 채우므로**, push 시점엔 translatedText가 아직 null일 수 있다. **결론 = STT 완료 후 별도 재push(또는 Nike poll catch-up)**. push DTO에 이미 `translatedText` 필드가 있으므로(zalo-webhook.ts:31·115), STT UPDATE 직후 **동일 메시지를 한 번 더 `pushInboundToNike`**로 보내 Nike가 STT 텍스트를 실시간 반영하게 한다(멱등 zaloMsgId — Nike가 같은 메시지 update). 재push도 fire-and-forget·실패 무시. (재push 안 하면 Nike는 poll/B3 재조회로 catch-up — 둘 중 재push를 채택해 실시간성 확보.)

### Nike (C:\Projects\Nike) — INTEG (B5)
- **B5-forward**: 테오의 메시지 forward 동작을 villa `POST /ext/send` `{kind:"FORWARD"}`로 위임(villa-ext-client.ts의 `VillaExtSendBody`에 FORWARD 분기 추가). Nike는 원본 메시지 본문 텍스트를 message로 넘긴다. 다른 Nike 계정 forward는 기존 zca-js 경로 유지(테오 userId 분기).
- **B5-alias (양방향)**: 테오 별칭 **표시**는 villa nickname 정본(S2 `/ext/threads` nickname). 테오 별칭 **편집**(changeAlias L607 / removeAlias L631)은 zca-js 직접 호출(테오 세션 Nike 부재로 불가) 대신 villa **`POST /api/zalo/ext/nickname`로 위임**(villa-ext-client에 위임 함수 추가). 즉 Nike UI에서 별칭 수정 → villa 저장 → S2 읽기로 villa·Nike 양쪽 동일 반영. 다른 Nike 계정 alias는 기존 zca-js 경로 유지(테오 분기).
- **B5-voiceSTT**: 테오 voice 수신은 villa `__system__`만 듣는다(S1). Nike의 `processVoiceAutoTranslate`(zalo-pool.ts)·`getVoiceTranslations`(zalo.ts L275)는 테오에 대해 **villa 정본(S2 읽기 DTO의 `translatedText` / webhook push)**을 표시하도록 위임. Nike 자체 STT 호출은 테오에 대해 비활성(중복 Gemini 호출·중복 STT 방지). 다른 Nike 계정 voice STT는 기존 경로 유지.

### 범위 밖 (S5 비포함 — 명시)
- 발송/읽기/실시간/ETL → **S1/S2/S3**(완료, 전제).
- 그룹 스레드 forward/alias/STT → **S4**(threadType/groupMembers/senderUid 스키마 D 이후). S5는 1:1 USER만.
- **첨부(이미지/파일/음성 파일 자체) forward** → 범위 밖(zca-js forwardMessage는 텍스트 content 전용). 첨부 forward는 향후 share route(sendChatImage/File) 재활용 별도 과제(IDEAS).
- **음성 STT 원문(vi) 병기 저장** → 스키마 컬럼 필요(범위 밖). MVP는 translatedText(ko)만.
- **본인 발신(OUTBOUND) voice STT** → 범위 밖(수신 INBOUND만).
- **villa 스키마 변경 0건**(forward=발송 함수+ext kind, alias=기존 nickname·SET_NICKNAME 재사용+ext 쓰기 라우트, STT=기존 translatedText 재사용+FE 자막. 신규 컬럼·마이그레이션 0).

## ② forward 구현 방식 (zca-js forwardMessage — S5 신규 확정)

zca-js `forwardMessage`(node_modules/zca-js/dist/apis/forwardMessage.d.ts) 실측:
```ts
forwardMessage(
  payload: { message: string; ttl?: number; reference?: { id: string; ts: number; logSrcType: number; fwLvl: number } },
  threadIds: string[],
  type?: ThreadType   // 기본 User
): Promise<{ success: {clientId,msgId}[]; fail: {clientId,error_code}[] }>
```
- **존재함** — 대안(재전송) 불필요. `api.forwardMessage`를 그대로 래핑.
- **텍스트 전용**: payload.message(전달할 본문)가 비면 throw. 호출부가 원본 ZaloMessage.text를 넘긴다. 첨부는 옮기지 않음(범위 밖).
- **반환 매핑**: `{ success:[], fail:[] }` → villa BotSendResult로 정규화(success[0].msgId → messageId, fail 있으면 ok:false + error_code). 다중 threadId 가능하나 ext는 단일 threadId만 받아 단순화(향후 다중은 본 계약 개정).
- **reference(선택)**: Nike가 원본 id·ts를 알면 reference에 채워 "전달됨" 데코 — 미보유여도 message만으로 동작(reference undefined 허용).

## ③ alias 매핑 방식 (거의 무비용 — 읽기 단방향 확정)

- **정본 = villa `ZaloConversation.nickname`**(ADR-0009 D9). villa는 이미 SET_NICKNAME 액션(conversations/[id]/route.ts)으로 편집·AuditLog·표시 최우선 처리 완비.
- **S2 읽기 DTO에 nickname 포함됨**(zalo-integration-s2.md ③ threads 허용 필드: `nickname`). Nike는 `/ext/threads` 응답의 nickname을 표시 정본으로 사용 → **별도 동기화 코드 0**.
- **Nike setAlias 위임**: 테오에 대해 Nike 자체 alias 쓰기는 의미 없음(테오 세션 Nike 부재 — S1). Nike는 표시만 villa nickname으로. (양방향 쓰기는 ext nickname-set 신설 필요 — 본 MVP 비채택, ②-대안 참조.)
- **무비용 근거**: villa 측 신규 코드 0(기존 SET_NICKNAME + S2 DTO nickname 재사용). Nike 측은 표시 소스 교체만.

## ④ 음성STT 방식 (gemini.ts 재사용·결과 translatedText·스키마 무변경)

- **villa `transcribeVoice`** = ocrPassport REST 패턴 + audio inline_data. Gemini `generateContent`에 `{ inline_data: { mime_type, data: audioBase64 } }` + STT 프롬프트(번역 금지·받아쓰기만). 키 미설정 → GeminiNotConfiguredError(graceful). 타임아웃 30s. **오디오·STT 결과 로그 금지.**
- **트리거**(zalo-inbound/zalo-runtime 호출부): INBOUND voice(classifyInbound msgType "voice", attachmentUrls[0]) + saved:true + translateMode≠OFF → `maybeTranscribeVoice`(fire-and-forget): voiceUrl GET(15s 타임아웃)→base64→transcribeVoice→`translateText(stt,"ko")`→`ZaloMessage.translatedText` UPDATE.
- **결과 저장 = `ZaloMessage.translatedText`**(기존 컬럼, schema.prisma:638). voice 메시지 text는 빈 문자열 유지(FE "음성" 라벨), translatedText에 ko STT-번역 기록 → 운영자가 음성 내용 읽음. **스키마 무변경 확정**(원문 vi 병기는 별도 컬럼 필요 → 범위 밖).
- **S2 push 정합**: STT는 수신 push 이후 비동기 완료 → STT UPDATE 직후 동일 메시지 재push(멱등 zaloMsgId, Nike update). 재push 실패해도 Nike poll catch-up.
- **비용·실패 처리(③ 요구)**: ⓐ Gemini 호출 비용 = 음성 1건당 1 STT + 1 번역(thinkingBudget:0로 토큰 최소). 수신 voice당만 발생(텍스트·이미지 메시지 무관). ⓑ 실패(CDN 무응답·STT 실패·번역 실패) → translatedText null 유지(폴백 = STT 없이 voice 라벨만 표시 — 메시지 자체는 이미 저장됨, 흔적 손실 0). ⓒ GEMINI_API_KEY 미설정 → GeminiNotConfiguredError로 조용히 스킵(graceful, 수신 저장은 정상). ⓓ 한도초과 등은 로그(상태/메시지만)만 — 리스너·수신 저장에 영향 0.

## ⑤ 테스트 가능한 완료 기준
- [ ] **forward 실동작**: 테오가 메시지를 forward(Nike UI 또는 ext `kind:"FORWARD"` 직접) → 대상 상대가 본문 텍스트를 실제 수신(villa 허브 세션 경유). villa /messages에 OUTBOUND echo로 표시(saveOutboundEcho 정본).
- [ ] **ext FORWARD 시크릿 게이트**: `/ext/send` `kind:"FORWARD"`가 `x-zalo-ext-secret` 없음/오류 시 **401**, ownerAdminId는 서버 고정(요청 본문 주입 무시), 정상 시크릿+message 있을 때만 발송. message 빈값 → 400(VALIDATION_FAILED).
- [ ] **forward 반환 정규화**: forwardMessage `{success,fail}` → BotSendResult(success→ok:true+messageId, fail→ok:false+error). 봇 미연결 시 ERROR_BOT_NOT_CONNECTED.
- [ ] **alias 표시 동기화**: villa에서 SET_NICKNAME으로 별명 설정 → S2 `/ext/threads` 응답 nickname에 반영 → Nike 테오 목록에 동일 별명 표시(villa↔Nike nickname 일치).
- [ ] **음성 수신 STT 표시(FE painted)**: 상대 음성 발신 → villa voice 저장(msgType "voice") → STT→ko가 translatedText에 채워지고 **chat-pane voice 카드에 자막으로 실제 렌더(화면에 painted — 데이터만 아님)**. S2 재push로 Nike에도 STT 텍스트 실시간 반영.
- [ ] **alias 양방향 편집**: Nike UI에서 별칭 수정 → `POST /api/zalo/ext/nickname`(시크릿 게이트·테오 스코프) → villa nickname UPDATE+AuditLog → S2 `/ext/threads`로 villa·Nike 동일 표시. villa 자체 SET_NICKNAME 편집도 동일 정본 반영. ext nickname 라우트 시크릿 없음/오류 401·ownerAdminId 주입 차단.
- [ ] **STT graceful·폴백**: GEMINI_API_KEY 미설정 / CDN 무응답 / STT 실패 시 translatedText null 유지(메시지는 정상 저장, voice 라벨 표시 — 흔적 손실 0, 리스너 영향 0). translateMode=OFF면 STT 호출 0.
- [ ] **credential·마진·STT 원문 누수 0**: ext FORWARD 응답·webhook 페이로드·로그에 `ZaloAccount.credentials`·`salePrice*`·`supplierCost*`·`margin*` 0건, 오디오 base64·STT 원문 로그 0건(QA grep + 동적).
- [ ] **ownerAdminId 테오 고정**: ext FORWARD에 다른 ownerAdminId 주입 → 무시·테오 스코프로만 발송(파라미터 주입 차단).
- [ ] **세션 단일성 회귀(S1)**: S5 배포 후에도 테오 세션 리스너 villa `__system__` 단독, 양쪽 code 3000 0건.
- [ ] **villa 무변경 회귀**: 기존 /messages(발송·번역·리액션·답글·SET_NICKNAME) + S1/S2/S3 경로 + vitest 전체 green, tsc 0, next build 통과. STT/forward 추가가 기존 수신 저장·webhook push를 깨지 않음(saveInboundMessage·pushInboundToNike 시그니처·동작 무변경). 스키마 변경 0(prisma diff 없음).

## ⑥ 검증 방법 (QA — 작성자≠평가자)
1. **ext FORWARD 게이트**: `kind:"FORWARD"`에 시크릿 미포함/오류/정상+message없음/정상 → 401/401/400/정상(발송). ownerAdminId 주입 호출 → 테오 스코프 외 미발송 실증.
2. **forward 실송**(테오 협조): forward한 본문이 실제 대상 상대에게 도달 + villa /messages OUTBOUND echo 표시.
3. **alias 대조**: villa SET_NICKNAME → `/ext/threads` nickname → Nike 표시 일치(테오 실측). villa nickname 변경이 Nike에 반영.
4. **음성STT**: 상대 음성 발신 → villa msgType "voice" 저장 + translatedText에 ko STT 표시 확인. OFF 모드 대화는 STT 0(Gemini 호출 로그 부재). 키 미설정·CDN 차단 시 graceful(메시지 저장·voice 라벨, translatedText null).
5. **누수 grep + 동적**: forward route + transcribeVoice + STT 트리거 소스 grep(`credentials`·`salePrice`·`supplierCost`·`margin`) 0건 + STT 결과·오디오 base64 로그 0건(gemini.ts 기존 "상태코드만" 원칙 준수 확인) + ext FORWARD 응답 본문 동적 0건.
6. **STT 단위 테스트**: transcribeVoice를 fetchFn 주입으로 단위 테스트(키 미설정→throw, 정상 응답→텍스트, 빈/공백→"") — translateText·ocrPassport 테스트 패턴 차용. maybeTranscribeVoice OFF 스킵·실패 swallow 검증.
7. **회귀**: vitest 전체 green(zalo·gemini·inbound·webhook 회귀 0), tsc 0, next build 통과. prisma 스키마 diff 0(무변경 확인).

## ⑦ 수정 금지 구역 (병렬 세션 보호)
**villa-pms** — 다른 세션 미커밋 WIP(2026-06-21 git status 기준), 절대 비접촉:
- `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts` (타 세션 WIP — git status M이면 비접촉)
- `LAUNCH.md`, `partB-evidence-*.png` (타 세션 untracked)
- 공유 파일은 **추가만 + 즉시 커밋**: `docs/INDEX.md`(ADR-0010/S1~S3 행에 S5 멘션 추가만, 충돌 시 양보). `messages/*.json`·`globals.css`·`package.json` 변경 없음(서버 라우트·lib 위주, 신규 의존성 0 — Gemini는 기존 REST fetch 재사용, zca-js forwardMessage는 기존 deps). `.env`/Railway 변수 신규 없음(GEMINI_API_KEY·ZALO_EXT_SHARED_SECRET·NIKE_WEBHOOK_URL·ZALO_WEBHOOK_HMAC_SECRET 전부 S1~S3 기존).

**S5 신규 충돌 가능성(매우 중요 — S1~S3와 같은 파일을 건드림)**: S5는 다음 **기존 파일을 수정**한다 — 착수 전 `git pull`+`git status`로 미커밋 WIP 확인 필수, 충돌 시 해당 세션과 조율:
- `lib/gemini.ts` — `transcribeVoice` **함수 추가만**(기존 ocrPassport·translateText·previewTargetForMode 시그니처·로직 불변). 파일 끝에 append.
- `lib/zalo-runtime.ts` — `sendChatForwardAsAdmin` **함수 추가만** + 수신 핸들러(handleInboundEvent)에 **voice STT 트리거 1줄 추가**(maybeTranslateInbound 호출 직후, 같은 fire-and-forget 패턴). **기존 함수·로직 변경 금지.** ⚠️ 이 파일은 S2가 webhook push 호출부를 이미 보강했고 ADR-0009 등 INTEG 중심 파일 — 같은 함수(handleInboundEvent) 동시 수정 충돌 주의. STT 트리거는 INBOUND voice 분기(zalo-runtime.ts:695~730 영역, maybeTranslateInbound 인접)에만 최소 삽입.
- `lib/zalo-inbound.ts` — STT 헬퍼(`maybeTranscribeVoice`)를 **여기 추가**(maybeTranslateInbound 옆, 같은 모듈·같은 패턴 — translateText·prisma update 재사용). ⚠️ S2에서 이미 수정된 파일 — 기존 export·함수 불변, append만.
- `app/api/zalo/ext/send/route.ts` — bodySchema discriminatedUnion에 `FORWARD` 분기 + POST에 `kind==="FORWARD"` 처리 **추가만**(기존 TEXT/IMAGE/REPLY/REACTION 불변). S1 파일.
- `app/(admin)/messages/chat-pane.tsx` — **(BLOCKER 보강)** voice 카드(SimpleTypeCard/voice 분기)에 translatedText STT 자막 렌더 **추가만**(기존 카드·렌더 분기 불변). ⚠️ 채팅 UI 핵심 파일 — 타 세션 동시 수정 시 충돌 주의(착수 전 git status 확인). DESIGN 선행은 경미(라벨+자막 한 줄 확장).
- `app/api/zalo/ext/nickname/route.ts` — **신규 파일**(A6-2 양방향 alias 쓰기 위임). 시크릿 게이트(isExtSecretValid 재사용)+테오 스코프 nickname UPDATE. conversations/[id] route는 **수정 0**(SET_NICKNAME 로직 공통화 시 헬퍼 추출만, 동작 불변).
- `lib/zalo-webhook.ts` — STT 완료 후 재push는 **기존 `pushInboundToNike` 재호출**(신규 push 함수 불필요 — DTO에 translatedText 이미 포함). zalo-webhook.ts **수정 0**(maybeTranscribeVoice가 STT UPDATE 후 pushInboundToNike를 호출만). S2 파일 비접촉 권장.
- `app/api/zalo/conversations/[id]/route.ts` — **수정 0**(SET_NICKNAME 이미 완비, alias는 기존 재사용). 비접촉.

**Nike (C:\Projects\Nike)** — 별도 레포·별도 세션 경계:
- villa 세션은 Nike 파일을 직접 수정하지 않는다. B5(forward 위임·alias 표시·voiceSTT 표시 위임)는 Nike INTEG 세션이 Nike 레포에서 수행. villa 세션은 ext FORWARD 계약(요청/응답 스키마) + alias 표시 정본(S2 nickname) + STT 정본(translatedText) 계약만 본 계약에 고정해 양 레포 독립 작업 보장.

## ⑧ 보안 체크 (사업 핵심 원칙 + ADR-0010 C4)
- credential(평문/암호문) ext FORWARD 응답·webhook 페이로드·로그·AuditLog 미노출(select 화이트리스트·기존 패턴 계승).
- ownerAdminId 테오 고정 — ext FORWARD는 요청 파라미터 미수용·서버 결정(resolveSystemOwnerId 재사용). 타 관리자·공급자 대화 발송 0.
- ext 시크릿 timingSafeEqual(isExtSecretValid 재사용). 시크릿·HMAC 비밀 서버-서버 전용.
- **음성 STT 개인정보**: 오디오 base64·STT 텍스트를 console·AuditLog에 절대 기록 금지(gemini.ts 기존 ocrPassport 원칙 계승 — 에러는 상태코드·메시지만). STT 결과(translatedText)는 운영자 화면 표시용으로만(누수 무관 — 채팅 본문).
- 채팅 전용 — forward message·STT는 villa 가격 모델(Villa.rates/Proposal/Settlement) 비참조(마진 비공개 무관성).

## ⑨ 배포 순서 (S1 활성 전제 — 절대 규칙, 스키마 무변경)
> S5는 S1(발송 위임·세션 단일화)이 활성이어야 forward 위임이 의미가 있다. **villa 스키마 무변경 → DB 마이그레이션 0.** 세션 소유 불변 → code 3000 위험 없음.

1. **S1 활성 확인** — villa `__system__` 테오 세션 단독 connected(S1 ⑥ 통과). 미충족 시 S5 보류.
2. **villa A6 배포** — `transcribeVoice`(gemini.ts) + `sendChatForwardAsAdmin`(zalo-runtime) + ext `kind:"FORWARD"` + 수신 voice STT 트리거. env 신규 0(기존 GEMINI_API_KEY로 STT, S1 시크릿으로 forward). 이 시점 Nike가 아직 FORWARD를 안 보내고 STT는 villa 내부에서만 동작 — 무해.
3. **Nike B5 배포** — 테오 forward를 ext FORWARD로 위임 + alias 표시를 villa nickname으로 + voice STT 표시를 villa translatedText/재push로 위임.

롤백 시 역순: Nike B5 원복(테오 forward/alias/STT 표시 Nike 로컬 복귀) → villa A6 비활성(forward 함수·STT 트리거 제거 또는 ext FORWARD 분기 비활성). **세션·스키마 불변이라 데이터·세션 위험 0.**

## 테오(사업주) 액션 (S5 배포 시)
- **villa env**: `GEMINI_API_KEY` 활성 확인(STT용 — 미설정 시 STT graceful 스킵, 다른 기능 무영향). 신규 env 없음.
- **Nike env**: S1 기존(`VILLA_EXT_BASE_URL`·`ZALO_EXT_SHARED_SECRET`) 재사용 — forward 위임에 그대로. 신규 없음.
- **배포 순서 협조**: S1 활성(테오 세션 villa 단독) 확인 → villa A6 → Nike B5.
- **실측 검증**: 테오 forward한 메시지가 상대에게 도달, 상대 음성이 villa /messages에 텍스트(translatedText)로 표시, villa 별명이 Nike에 동일 표시.
