# ADR-0009: 채팅 첨부·공유 + 대화별 번역언어·아바타·별명 (상대 타입별 누수 분기)

날짜: 2026-06-16
상태: 제안 (TDA 설계 — 테오/QA 검토 후 승인 시 DESIGN→INTEG/BE 구현 착수)
개정: 2026-06-16 — D7(대화별 번역언어)·D8(아바타)·D9(별명) 3건 추가(테오 추가 요구). 기존 D1~D6·결정·디자인 유지, 섹션 보완.
개정2: 2026-06-16 — **채팅 상대 분류 5종 확장**(TRAVEL_AGENCY 여행사·LAND_AGENCY 랜드사 추가). D1 분류·D2 누수 그룹·통화 매핑 갱신(아래 "개정2" 섹션). 스키마 `ZaloCounterpartyType` additive enum 확장 + db push 적용 완료. 빌라 공유 본문 통화 분기(보류 항목) 설계 해소 — 코드 반영은 BE 후속.
개정3: 2026-06-16 — **채팅 답글(인용)·리액션(하트)**. `ZaloMessage`에 `cliMsgId`·`quotedMsgId`·`quotedText`·`quotedSender`·`reactions` 5컬럼 additive 추가(아래 "개정3" 섹션). zca-js `addReaction`(msgId+cliMsgId)·`sendMessage` quote·리스너 `reaction` 이벤트 기반. db push 적용 완료. 발송·수신·FE는 INTEG/BE/FE 후속. 누수·통화 무관(Zalo 영역만).
관련: ADR-0007(멀티관리자 Zalo 채팅·ZaloConversation.ownerAdminId·복합키), ADR-0006(zca-js 런타임·sendBotMessage·sendChatMessageAsAdmin), ADR-0005(zca-js 채택·이미지 발송 가능), ADR-0004(이미지 저장 R2/디스크·lib/storage), ADR-0003(통화·VillaRate·ZaloMessage.msgType), SPEC F3(제안)·F6(정산), CLAUDE.md 사업원칙 1(재고 비공개)·2(마진 비공개), reference/nike/src/lib/zalo.ts(sendZaloImage), lib/zalo-runtime.ts·lib/zalo-inbound.ts·lib/storage.ts·lib/pricing.ts, app/(admin)/messages/(page.tsx·chat-pane.tsx), app/api/zalo/messages/route.ts, design/stitch/b14-zalo-chat/

> **번호 주의:** 본 ADR은 파일명 `ADR-0008-chat-attachments`로 요청되었으나, `docs/decisions/0008-per-villa-season-periods.md`가 이미 ADR-0008을 점유 중이어서 **0009**로 발급한다(중복 방지). 향후 ADR 순번 정합성은 PM이 docs/INDEX.md에서 관리.

---

## 결론 요약 (보고용 4문)

**① 고객 모델 확장 규모 — 작음(additive). 신규 모델 0개, 컬럼 2~3개 + enum 1개 추가, 비-additive 없음.**
현재 `ZaloConversation`은 "관리자×Zalo상대" 단위이고 `userId?`는 매칭된 **공급자 User**를 가리킨다(고객은 User가 없어 표현 불가). 그러나 ADR-0007이 이미 `userId @unique`를 제거하고 `(ownerAdminId, zaloUserId)` 복합키로 전환했으므로, **고객을 새 행/새 모델로 만들 필요가 없다** — `ZaloConversation`에 `counterpartyType (SUPPLIER|CUSTOMER|UNKNOWN)` 1개만 추가하면 같은 테이블에서 공급자/고객을 구분한다. 고객은 `counterpartyType=CUSTOMER` + `userId=null`(User 없음) + `displayName`(Zalo 프로필명). "기존 userId=null=미매칭 공급자"와의 충돌은 **분류 필드로 명시 해소**(미분류는 UNKNOWN, 기존 행은 SUPPLIER로 백필). 고객↔Proposal/Booking 연결은 Phase 1에서 **하지 않는다**(전화번호 자동 매칭은 부정확·누수 위험 — D1.4). 즉 고객은 "ADMIN이 수동 분류한 Zalo 친구"로만 존재.

**② 누수 분기 핵심 — 공유 데이터는 `counterpartyType`에 따라 쿼리 단계(select 화이트리스트)에서 통화·필드를 분리한다. 마진은 양쪽 모두 영구 차단.**
4개 공유 중 누수 위험은 **빌라 공유**에 집중된다: 공급자에겐 `supplierCostVnd`(원가)만, 고객에겐 `salePriceVnd|salePriceKrw`(판매가)만 SELECT한다 — **마진 필드(`marginType`/`marginValue`)와 반대편 통화는 쿼리에서 아예 제외**(가공·필터가 아니라 미조회). 제안서는 `/p/[token]`이 이미 공개·판매가 전용 페이지이므로 **고객에게만** 링크 전송(공급자엔 부적합 → 비활성). 정산서는 `supplierCostVnd` 기반 VND이므로 **공급자에게만**(고객엔 해당없음 → 비활성). 사진은 양쪽 동일(텍스트·금액 없음 → 누수 0). 핵심 불변식: **어떤 공유도 마진을 노출하지 않으며, 공급자 화면 경로엔 판매가/KRW가, 고객 화면 경로엔 원가가 절대 흐르지 않는다.**

**③ zca-js 이미지 발송 — 가능(검증 완료, 코드 패턴 확보).**
zca-js `api.sendMessage`는 `MessageContent.attachments`로 이미지를 보낸다. 형식은 **메모리 Buffer**: `{ data: Buffer, filename: "name.ext", metadata: { totalSize } }` — URL/파일경로 직접 전달 불가. Nike `sendZaloImage(userId, threadId, imageBuffer, fileName, caption?, isGroup?)`가 정본(EXIF 회전 sharp 적용 후 attachments 배열). villa-pms는 이미 이미지 업로드 파이프라인(`lib/storage.saveFile` R2/디스크)·런타임 풀(`sendChatMessageAsAdmin`)이 있으므로, `lib/zalo-runtime`에 **버퍼 인자 발송 함수 1개 추가**(예: `sendChatImageAsAdmin(adminUserId, zaloUserId, buffer, fileName, caption?)`)로 닫힌다. 시스템봇 발송(`sendBotMessage`)은 무변경.

**④ 권장 단계 + 디자인 필요 화면.**
점진 경로(누수 위험 오름차순): **S0**(스키마 — `counterpartyType` enum/컬럼, `ZaloMessage.msgType` 확장값 정의, 백필) → **S1 사진**(누수 0 — `sendChatImageAsAdmin` + 업로드 + `ZaloMessage(msgType=image, attachmentUrls)`) → **S2 제안서 링크**(고객 전용, `/p/[token]` URL 텍스트 발송 — 누수 0, 이미 공개) → **S3 빌라 공유**(누수 분기 핵심 — 상대 타입별 select 화이트리스트, 텍스트 요약) → **S4 정산서**(공급자 전용, 본인 정산 텍스트 요약). 각 단계 QA 독립 누수 검사.
디자인 필요 화면(DESIGN 인계): (1) **b14 입력창 첨부 메뉴**(+버튼 → 사진/촬영/빌라/제안/정산, 상대 타입별 가시성), (2) **빌라 선택 모달**, (3) **제안 선택 모달**, (4) **정산 선택 모달**, (5) **공유 카드 메시지 버블**(빌라/제안/정산 요약을 채팅에 표시하는 형태), (6) **상대 분류 컨트롤**(대화 헤더에서 SUPPLIER/CUSTOMER 지정). 상세는 8절.

---

## 개정 요약 (2026-06-16 추가 3건 — 보고용 3문)

**⑤ 대화별 번역언어 — `ZaloConversation.translateMode`(OFF|VI|EN) 1컬럼 추가(additive). 한국어끼리는 OFF로 번역 자체를 끈다.**
현재 번역은 `translateText(text, "vi"|"ko")`로 vi↔ko **고정**이고, 입력창 미리보기도 항상 `target:"vi"` 하드코딩(chat-pane.tsx:274). 실제 상대는 (a)한국인=번역 불필요, (b)베트남인=vi, (c)영어권=en로 갈린다. **대화 단위로 번역 대상 언어를 저장**(`translateMode`)하고 그 값으로 수신 자동 번역·발신 미리보기 언어를 결정한다. OFF면 수신 자동번역·발신 미리보기를 **둘 다 끈다**(Gemini 호출 0 → 비용·지연 절감, 한국어끼리 자연스러운 UX). `translateText`에 `"en"` 타깃을 1개 추가(소스 언어는 모델 자동감지 — 현재도 명시 안 함). 기본값은 상대 타입 연계: SUPPLIER=VI, CUSTOMER/UNKNOWN=OFF(D7.3). 마진·누수와 무관(번역은 채팅 본문만, 금액 본문은 이미 발송 전 필터됨). 상세 D7.

**⑥ 아바타 — Zalo 프로필 이미지 표시(인박스·대화 헤더). zca-js `getAvatarUrlProfile`/`getUserInfo`로 URL 확보(검증: 수신 메시지 payload엔 avatar 없음 — 별도 조회 필요 확인됨). `ZaloConversation.avatarUrl` 캐시 + 이니셜 폴백.**
수신 메시지 데이터(`TMessage`)는 `dName`(표시명)만 싣고 **avatar 필드가 없다**(zca-js 타입 정독 확인). 아바타 URL은 `api.getAvatarUrlProfile(friendId)` → `{ [userId]: { avatar } }` 또는 `api.getUserInfo(userId)`(ProfileInfo.avatar)로 **별도 조회**해야 한다. 외부 Zalo CDN URL은 만료·핫링크 차단 리스크가 있으므로 **`ZaloConversation.avatarUrl`에 캐시**하되, 만료 시 폴백은 기존 이니셜(현 `initials()`)로 자동 회귀. `next.config` images에 Zalo CDN 도메인 허용 필요(또는 R2 캐시로 만료 회피 — Phase 2). 누수 0(공개 프로필 이미지). 상세 D8.

**⑦ 별명 — `ZaloConversation.nickname`(신규 컬럼) ADMIN 수정 가능. 표시 우선순위 nickname > User.name > displayName > 이니셜.**
현재 표시명은 `User.name ?? displayName ?? "(이름 미확인)"`(page.tsx:115·168)이고 ADMIN이 고칠 방법이 없다. Zalo 프로필명(`displayName`)을 덮어쓰면 수신 시 보강 로직(`zalo-inbound`)과 충돌하므로 **별도 `nickname` 컬럼**을 두고(displayName=Zalo 원본 보존), 표시 우선순위를 `nickname > 매칭 User.name > Zalo displayName > 이니셜`로 정한다. 수정 API는 ADMIN·본인 대화만(기존 `PATCH /api/zalo/conversations/[id]` 확장). 상세 D9.

---

## 개정2 (2026-06-16) — 채팅 상대 분류 5종 확장 (여행사·랜드사 추가)

> **요지:** 채팅 상대 분류를 **3종(SUPPLIER/CUSTOMER/UNKNOWN) → 5종**으로 확장한다. 판매가측을 직접 고객(KRW)·여행사(VND)·랜드사(VND)로 세분해, D2 누수 매트릭스와 **빌라 공유 본문 통화**(보류됐던 "고객 통화 분기")를 분류값만으로 결정한다. `ZaloCounterpartyType`에 `TRAVEL_AGENCY`·`LAND_AGENCY`를 **additive enum**으로 추가(기존 행 백필 불필요 — SUPPLIER/CUSTOMER/UNKNOWN 유지). 이 개정은 **D1(분류)·D2(누수 매트릭스/통화)**를 갱신하고, D3~D9·디자인·런타임은 무영향이다(분류 게이트 조건만 그룹 단위로 일반화).

### R2-1. 분류 5종 (D1 갱신)

| 분류 | 상대 | 누수 그룹 | 빌라 공유 통화 | 빌라 본문 금액 | 제안 공유 | 정산 공유 |
|---|---|---|---|---|---|---|
| **SUPPLIER** | 공급자(중계인·부동산·분양자) | 원가측 | (해당없음 — VND 원가) | **원가(supplierCostVnd)** | ✗ | **✓**(본인) |
| **CUSTOMER** | 직접 고객(여행객) | 판매가측 | **KRW** | **판매가 KRW(salePriceKrw)** | ✓ | ✗ |
| **TRAVEL_AGENCY** | 여행사 | 판매가측 | **VND** | **판매가 VND(salePriceVnd)** | ✓ | ✗ |
| **LAND_AGENCY** | 랜드사 | 판매가측 | **VND** | **판매가 VND(salePriceVnd)** | ✓ | ✗ |
| **UNKNOWN** | 미분류 | (잠금) | — | **사진만**(빌라/제안/정산 잠금) | ✗ | ✗ |

- **마진(marginType/marginValue)은 5종 전부에 영구 금지**(D2 불변식 유지).
- 통화 매핑 근거: **ADR-0003** 채널별 통화(여행사·랜드사=VND, 직접 소비자=KRW)와 정합. `Proposal.saleCurrency`/`Booking.saleCurrency` 채널 정책을 채팅 분류에 그대로 투영.

### R2-2. 누수 그룹 (D2 갱신 — 매트릭스를 "그룹" 단위로 재정의)

D2의 상대별 4열 매트릭스를 **2그룹 + UNKNOWN**으로 일반화한다(기존 SUPPLIER/CUSTOMER 행은 그룹의 특수형):

- **원가측 = {SUPPLIER}** — 빌라 공유는 **원가만**(supplierCostVnd select 화이트리스트), **정산 공유 허용**(본인 supplierId 일치), 제안 공유 금지.
- **판매가측 = {CUSTOMER, TRAVEL_AGENCY, LAND_AGENCY}** — 빌라 공유는 **판매가만**(salePriceVnd|salePriceKrw select 화이트리스트, 원가·마진 미조회), **제안 공유 허용**(`/p/[token]` 공개 URL), **정산 공유 금지**. 본문 통화는 `currencyForType()`(R2-3)로 분류별 결정.
- **UNKNOWN** — 사진만(빌라/제안/정산 전부 잠금).

**불변식(D2와 동일, 그룹으로 표현):**
- 마진은 어떤 그룹·어떤 공유에도 미포함(쿼리 select 제외).
- 원가측 경로엔 `salePrice*`가, 판매가측 경로엔 `supplierCostVnd`가 **쿼리에서 조회되지 않는다**(미SELECT — 필터 아님).
- 정산은 원가측(본인)만, 제안은 판매가측만 — 잘못된 그룹 조합은 서버 400/403(D4.4 게이트를 그룹 함수로 판정).

### R2-3. 통화 매핑 — 빌라 공유 본문 saleCurrency 결정 (보류 항목 해소)

- 기존 `app/api/zalo/conversations/[id]/share/route.ts` `handleVilla` 고객 경로는 `saleCurrency = Currency.KRW` **하드코딩**(Phase 1 임시, 채널 세분화 보류). 분류 5종으로 **분류값만으로 통화가 결정**되므로 이 하드코딩을 제거한다:
  - `CUSTOMER → KRW`, `TRAVEL_AGENCY → VND`, `LAND_AGENCY → VND`.
- `lib/zalo-share.ts`의 `buildVillaShareTextForCustomer(villa, rates, saleCurrency)`는 **이미 `saleCurrency` 파라미터로 통화가 분기**되어 있다(VND/KRW 둘 다 처리) — **빌더 변경 불필요**. route에서 분류별 통화를 전달하면 끝.
- 판매가측 빌라 select는 **VND·KRW 두 컬럼 모두 화이트리스트로 조회**(`salePriceVnd`, `salePriceKrw`)하되 **본문엔 분류 통화 한쪽만 기재**(빌더가 `saleCurrency`로 선택). 원가·마진은 미조회(불변).

### R2-4. 번역 기본값 (D7 — 변경 없음)

- 신규 분류(TRAVEL_AGENCY/LAND_AGENCY)는 `defaultTranslateMode`에서 **SUPPLIER가 아니므로 OFF**(기존 D7.3 규칙 그대로 — 한국 여행사·랜드사 다수, 오버트랜슬레이션 방지). 별도 분기 추가 불필요.
- **분류 변경 시 translateMode 자동 변경 안 함**(ADMIN 수동). 기존 동작 유지.

### R2-5. 첨부 메뉴 가시성 (D2/8절 디자인 — 그룹 단위로 일반화)

- **원가측(SUPPLIER):** 사진 + 빌라 + 정산
- **판매가측(CUSTOMER/TRAVEL_AGENCY/LAND_AGENCY):** 사진 + 빌라 + 제안
- **UNKNOWN:** 사진만(+분류 안내)
- FE는 분류값 4종이 아니라 **그룹 판정 함수**(`isSellSideType`/`isCostSideType`)로 메뉴를 토글 — 분류가 더 늘어도 함수만 갱신.

### R2-6. additive·백필·영향

- **변경:** `ZaloCounterpartyType`에 `TRAVEL_AGENCY`·`LAND_AGENCY` 2값 추가 = **순수 additive enum**. 컬럼·기본값·관계 무변경. 비-additive 0.
- **백필 불필요:** 기존 행은 SUPPLIER/CUSTOMER/UNKNOWN 그대로 유효(개정2 분류는 신규 지정 시에만 사용). `db push`로 enum 값만 추가 — 데이터 손실 0.
- **코드 영향(BE 후속, TDA 범위 밖):** ① `share/route.ts` 게이트(`=== CUSTOMER` 단일 비교 → 판매가측 그룹 판정), 빌라 통화 하드코딩 제거(R2-3). ② `lib/zalo-counterparty.ts`에 그룹·통화 헬퍼 추가(권고 시그니처는 결과·인계 참조). ③ FE 메뉴 가시성(R2-5), 분류 컨트롤 UI에 여행사·랜드사 옵션 추가. **lib/zalo-share.ts 빌더는 무변경**(이미 통화 파라미터화).
- **무영향:** D3(발송 방식)·D4(누수 차단 메커니즘 — 그룹으로 일반화만)·D5~D9·런타임·시스템봇·`/p/[token]`·정산 집계.

---

## 개정3 (2026-06-16) — 채팅 답글(인용)·리액션(하트)

> **요지:** 채팅에서 ① 특정 메시지에 **답글(인용)**, ② 메시지에 **하트 등 리액션**을 단다(Nike에 동일 기능 존재 — `reference/nike/src/lib/zalo-pool.ts`). zca-js API는 둘 다 **Zalo 서버 `msgId` + 클라이언트 `cliMsgId` 두 식별자**를 요구하는데, 현재 `ZaloMessage`는 `zaloMsgId`(msgId)만 저장하고 `cliMsgId`가 없어 **신규 발송·수신분에 `cliMsgId`를 저장하는 것이 답글·리액션의 전제**다. 본 개정은 `ZaloMessage`에 **5개 additive 컬럼**(`cliMsgId`·`quotedMsgId`·`quotedText`·`quotedSender`·`reactions`)을 추가한다. **TDA 범위는 스키마·설계 + db push**까지이고, 발송·수신·FE는 INTEG/FE 후속이다. **Zalo 영역만 변경**(누수 분기·통화·다른 도메인 무접촉).

### R3-1. zca-js API (검증 — 타입 정독 완료)

- **리액션:** `api.addReaction(icon: Reactions | CustomReaction, dest: AddReactionDestination)`
  - `Reactions` enum 값(`models/Reaction.d.ts`): `HEART="/-heart"`, `LIKE="/-strong"`, `HAHA`, `WOW`, `CRY`, `ANGRY`, `KISS`, `ROSE`, `BROKEN_HEART` … 다수. **DB엔 우리 키(enum 이름) 문자열로 저장**(예 `"HEART"`), zca-js 호출 시점에 `Reactions[키]`로 매핑.
  - `dest = { data: { msgId, cliMsgId }, threadId, type }` — **`msgId`(Zalo 서버 id)와 `cliMsgId` 둘 다 필수.** → `ZaloMessage.zaloMsgId`(있음) + `cliMsgId`(신규) 동시 필요.
- **답글(인용):** `api.sendMessage({ msg, quote: SendMessageQuote }, threadId, type)`
  - `SendMessageQuote = { content, msgType, propertyExt, uidFrom, msgId, cliMsgId, ts, ttl }` — 원본 메시지의 식별자·내용 일체. 답글을 보내려면 원본의 **`cliMsgId`·`msgId`·`content`·`msgType` 등을 보관**해야 한다 → `cliMsgId` 저장이 전제.
- **수신 리스너 이벤트(`apis/listen.d.ts`):** `reaction: [Reaction]`(단건), `old_reactions: [Reaction[], isGroup]`(대량 — Phase 1 스킵 가능). `Reaction.data`(`TReaction`)에 `msgId`·`cliMsgId`·`content.rIcon`(Reactions) 포함 → 수신 시 `msgId`로 `ZaloMessage`를 찾아 `reactions` 갱신.
- **수신 답글:** 상대가 보낸 답글의 인용은 수신 메시지 `data.quote`로 들어온다(Nike `extractQuote` 721~746행: `quote.msg`(quoteText)·`quote.fromD`(senderName)·`quote.cliMsgType`(msgType)·`quote.globalMsgId`(원본 msgId) 파싱). → `quotedText`·`quotedSender`·`quotedMsgId`에 스냅샷 저장.

### R3-2. 스키마 — `ZaloMessage` 5컬럼 추가 (additive)

```prisma
model ZaloMessage {
  // ... 기존 필드 유지 ...
  cliMsgId     String?  // zca-js cliMsgId — 리액션(msgId+cliMsgId 둘 다)·답글 대상 식별. 발송·수신 시 저장
  quotedMsgId  String?  // 인용 원본 메시지 zaloMsgId (참조용, FK 아님)
  quotedText   String?  // 인용 본문 스냅샷 (표시용)
  quotedSender String?  // 인용 발신자 표시명 스냅샷
  reactions    Json?    // 리액션 집계 { "HEART": 2, "LIKE": 1 } — 수신 reaction 이벤트로 갱신
}
```

- **답글은 self-relation이 아니라 스냅샷**(`quotedMsgId`+`quotedText`+`quotedSender`). 이유: ① 인용 표시는 본문·발신자만 있으면 충분, ② 원본 메시지가 삭제·미저장(상대 과거분)이어도 인용이 보존, ③ FK self-relation의 정합성·cascade 부담 회피. `quotedMsgId`는 "원본으로 점프" 같은 후속 UX를 위한 참조 힌트(있으면 매칭, 없어도 표시 정상).
- **리액션은 집계 Json**(아이콘별 카운트). Phase 1은 "누가 달았는지"를 저장하지 않는다(불필요·복잡). 형식은 `{ "<ReactionKey>": <count> }` 권고. (누가 달았는지·byMe 표시가 필요해지면 Phase 2에서 `[{ icon, byMe }]` 또는 별도 테이블로 확장 — additive.)
- **`reactions`는 Prisma `Json?`** — VND/KRW 금액과 무관(부동소수점 규칙 비대상). 카운트는 정수.

### R3-3. 발송·수신 시 cliMsgId·quote·reaction 동작 (INTEG/FE 후속 — 설계 명시)

1. **발송 시 cliMsgId 저장:** b14 발송(`sendChatMessageAsAdmin`)·시스템 발송 경로에서 zca-js `sendMessage` 응답·생성 시점의 cliMsgId를 `ZaloMessage.cliMsgId`에 기록. (zca-js 발신 cliMsgId 노출 방식은 INTEG 구현 시 확정 — Nike는 발신 추적에 cliMsgId 사용.)
2. **수신 시 cliMsgId·quote 저장:** `saveInboundMessage`(현 `zaloMsgId`만 저장, lib/zalo-inbound.ts:260·401)에서 파싱된 `cliMsgId`·`data.quote`(extractQuote 패턴)를 함께 저장. INBOUND·OUTBOUND echo 양쪽.
3. **리액션 발송(답글·하트 버튼):** `addReaction(Reactions.HEART, { data:{ msgId, cliMsgId }, threadId, type })` — 대상 `ZaloMessage`의 `zaloMsgId`+`cliMsgId` 사용. 성공 시 본인 리액션을 `reactions`에 +1(낙관적) 또는 수신 이벤트로 반영.
4. **답글 발송:** 원본 `ZaloMessage`에서 `cliMsgId`·`zaloMsgId`·본문·msgType을 읽어 `SendMessageQuote` 구성 → `sendMessage({ msg, quote }, ...)`. 보낸 답글 메시지 행에도 `quotedMsgId/quotedText/quotedSender` 스냅샷 기록(자기 화면 표시).
5. **리액션 수신(`reaction` 이벤트):** `reaction.data.msgId`로 `ZaloMessage`를 조회 → `reactions[아이콘키]` 증감 갱신. `old_reactions`(대량 동기화)는 **Phase 1 스킵**(처리량·복잡도 — 신규 단건만).

### R3-4. 멱등·정합·백필

- **기존 메시지:** `cliMsgId=null`. 과거 메시지엔 리액션·답글을 걸 수 없다(zca-js가 cliMsgId 없이 거부) — **신규 발송·수신분부터** 동작. 백필 불필요(상대 cliMsgId를 소급 복원할 방법 없음).
- **멱등:** 기존 `zaloMsgId @unique` 멱등 키는 그대로. 리액션 수신은 msgId로 메시지를 찾아 카운트를 **갱신**(중복 이벤트는 카운트 정합을 INTEG가 보장 — 단순 +1이 아니라 최신 상태 반영 권고).
- **additive 판정:** 5개 컬럼 전부 nullable, default 없음(null), 관계·unique·제약 변경 0. `ZaloMessage` 기존 컬럼·인덱스 무변경. → **순수 additive**, `prisma db push` 안전(프로덕션 데이터 손실 0).

### R3-5. 지원 리액션 아이콘 (발송)

- Phase 1 발송 최소 1종: **HEART**. zca-js `Reactions`가 LIKE·HAHA·WOW·CRY·ANGRY·KISS·ROSE 등 다수 제공 → FE가 노출할 아이콘 세트는 DESIGN/FE가 결정(권고: 카카오톡류 6종 = HEART/LIKE/HAHA/WOW/CRY/ANGRY). DB·집계는 아이콘 키 문자열이므로 세트 확장은 코드 변경만(스키마 무변경).
- **수신**은 zca-js가 보내는 모든 Reactions를 그대로 키로 저장(표시 못 하는 아이콘도 카운트는 보존).

### R3-6. 단계 (개정3 — S0~S7과 독립, 누수 분기 무관)

| 단계 | 범위 | 산출 | 담당 |
|---|---|---|---|
| **R3-S0** | 스키마 + db push | `ZaloMessage` 5컬럼 추가, generate, build 통과 | **TDA(본 개정 — 완료 대상)** |
| **R3-S1** | cliMsgId 저장 배선 | 발송(`sendChat*`)·수신(`saveInboundMessage`/echo)에서 cliMsgId·data.quote 파싱·저장 | INTEG |
| **R3-S2** | 답글 발송 | 원본에서 `SendMessageQuote` 구성 → `sendMessage({msg,quote})`, 보낸 행에 스냅샷 | INTEG·BE |
| **R3-S3** | 리액션 발송 | `addReaction(HEART, dest{msgId,cliMsgId})`, `reactions` 낙관적 갱신 | INTEG·BE |
| **R3-S4** | 리액션 수신 | `reaction` 이벤트 → msgId 조회 → `reactions` 갱신(old_reactions 스킵) | INTEG |
| **R3-S5** | FE 표시 | 답글 인용 블록(MessageBubble), 하트 버튼(롱프레스/호버), 리액션 카운트 배지 | FE |

- **누수·통화 무관:** 답글·리액션은 채팅 본문 메타데이터일 뿐 금액·원가·마진·통화와 무접촉. D2 누수 매트릭스·D4 게이트에 영향 없음. AuditLog는 기존 메시지 발송 로그에 포함(별도 추가 불필요 — 리액션 단건은 저빈도·비민감).

### R3-7. 리스크

| # | 리스크 | 완화책 |
|---|---|---|
| ⑬ | 발신 cliMsgId 확보 방식이 zca-js 버전별 상이 | INTEG 구현 시 실측(Nike 정본 참조), 못 얻으면 자기 메시지 리액션은 보류·수신분만 |
| ⑭ | 리액션 수신 이벤트 중복·순서 → 카운트 부정합 | 단순 +1 대신 최신 상태 반영, old_reactions로 주기 재동기(Phase 2) |
| ⑮ | 인용 스냅샷이 원본과 불일치(원본 수정) | 스냅샷은 발송 시점 고정이 의도(원본 변경 추적 안 함) — 수용 |

---

## 맥락

테오가 ADMIN 채팅(`/messages`, b14)에 4가지 첨부·공유 기능을 확정했다:
1. **사진 첨부/촬영** — 이미지를 Zalo로 전송
2. **빌라 정보 공유** — 빌라 요약을 상대에게
3. **제안서 공유** — 제안(`/p/[token]`)을
4. **정산서 공유** — 정산 내역을

**핵심 제약(CLAUDE.md 사업원칙):** 채팅 상대는 **공급자 + 고객 둘 다**다.
- **공급자(SUPPLIER)**: 원가(`supplierCostVnd`)만 본다. 마진·판매가(KRW/VND)·고객 상세 절대 금지.
- **고객(여행사·여행객)**: 판매가만 본다. 원가·마진 절대 금지.
- **마진(`marginType`/`marginValue`)**: 양쪽 모두 영구 금지(사업원칙 2 — 마진은 누구에게도 노출하지 않음).

현재 구조(코드 정독):
- `ZaloConversation`(ADR-0007): `(ownerAdminId, zaloUserId)` 복합키. `userId?`는 매칭된 공급자 User(전역 `User.zaloUserId` 조인). **고객 표현 불가** — User 없는 상대는 `userId=null`로만 남고, 이는 "미매칭 공급자"와 구분되지 않는다.
- `ZaloMessage`: `msgType String @default("text")`(text|image|sticker|file 주석), `attachmentUrls String[]`, `text`, `direction`, `source`(USER|CHAT|SYSTEM), `status`. **스키마는 이미 이미지/첨부를 담을 수 있다** — `msgType=image` + `attachmentUrls` 채우면 됨.
- `lib/zalo-runtime`: `sendChatMessageAsAdmin(adminUserId, zaloUserId, text)` 텍스트 발송 구현됨. 이미지 발송 함수는 **없음**(추가 필요).
- `lib/storage.saveFile(buffer, mime, uploaderId)`: R2/디스크 업로드 + 공개 URL 반환. MIME 화이트리스트(jpg/png/webp/heic/heif, svg/gif 차단). **재사용**.
- `app/api/zalo/messages/route.ts`: 텍스트 발송 라우트. 소유 검증(`ownerAdminId=session.user.id`) + AuditLog + status 영속. **공유는 별도 라우트 또는 본 라우트 확장**.
- `lib/pricing.ts`: `quoteStay`(원가·판매가 박별 합산), `computeSalePriceVnd`(마진 적용). 상단 주석에 "원가 누수 주의(StayQuote는 supplierCostVnd 포함)" 경고 — **공유 시 StayQuote를 그대로 클라이언트/상대에 보내면 안 됨**.
- `/p/[token]`: 비로그인 공개 제안 페이지(판매가 전용, 마진·원가·타통화 비노출 — SPEC F3 규칙). **이미 공개 URL** → 고객에게 링크만 보내면 됨.
- 정산: `Settlement(supplierId, yearMonth, totalVnd, items[])` + `SettlementItem(bookingId, amountVnd)`. VND 단일·공급자 원가 기반(SPEC F6).

핵심 통찰: **고객을 위해 새 엔티티를 만들 유혹을 피한다.** ADR-0007이 이미 대화 테이블을 "관리자×Zalo상대" 1:N으로 풀어놨으므로, 고객은 같은 테이블에 `counterpartyType=CUSTOMER`로 들어가면 충분하다. 진짜 설계 부담은 모델이 아니라 **공유 데이터의 누수 분기**(②)다.

---

## 결정

### D1. 채팅 상대 모델 확장 — `ZaloConversation.counterpartyType` (additive)

1. **enum 추가:**
```prisma
enum ZaloCounterpartyType {
  SUPPLIER   // 공급자(중계인·부동산·분양자) — 원가만 공유 (마진·판매가 금지)
  CUSTOMER   // 고객(여행사·여행객) — 판매가만 공유 (원가·마진 금지)
  UNKNOWN    // 미분류 — 공유 기능 잠금(분류 후 활성). 기본값
}
```
2. **컬럼 추가:** `ZaloConversation.counterpartyType ZaloCounterpartyType @default(UNKNOWN)`.
3. **고객 표현:** 고객 대화 = `counterpartyType=CUSTOMER` + `userId=null`(User 없음) + `displayName`(Zalo 프로필명). 공급자 대화 = `counterpartyType=SUPPLIER` + (매칭 시)`userId`. **"userId=null=미매칭 공급자" 모호성은 `counterpartyType`으로 명시 해소** — `UNKNOWN`이면 미분류(공유 잠금), `SUPPLIER`+null이면 미매칭 공급자, `CUSTOMER`이면 고객.
4. **고객 식별 — Phase 1은 ADMIN 수동 분류만(자동 매칭 안 함):**
   - 새 대화 생성 시(`saveInboundMessage`) `counterpartyType=UNKNOWN`.
   - **전화번호 자동 매칭은 시스템봇 수신 + 공급자(SUPPLIER)에만**(ADR-0007 D4 그대로 — 매칭되면 `counterpartyType=SUPPLIER` 자동 설정).
   - 고객은 ADMIN이 대화 헤더에서 **수동으로 CUSTOMER 지정**(b14 분류 컨트롤, 8절). 자동으로 Proposal.clientName/Booking.guestPhone과 연결하지 **않는다** — 전화번호 일치가 보장되지 않고(여행사 담당자 ≠ 투숙객), 오매칭 시 고객에게 원가가 새거나 공급자에게 판매가가 새는 **양방향 누수**가 되므로 위험이 너무 크다. (Phase 2에서 명시적 "이 대화를 예약 X에 연결" 수동 링크 검토 — IDEAS.md.)
5. **백필:** 기존 모든 `ZaloConversation` → `counterpartyType=SUPPLIER`(현재 채팅 상대는 전부 공급자 전제였으므로). additive 컬럼 default UNKNOWN로 추가 후, 기존 행만 SUPPLIER로 UPDATE.
6. **additive 판정:** enum 추가 + nullable 아님(default 있음) 컬럼 추가 + 백필 UPDATE = **비-additive 변경 없음**. `prisma migrate dev` 1단계로 충분(ADR-0007의 복합키 같은 제약 교체 없음).

> **검증 필요:** 고객(여행사 담당자)이 시스템봇이 아닌 테오 **개인 계정**에 친구추가/메시지하는 실제 흐름. 통합 모드(ADR-0007 D1)에서 테오 시스템봇=개인계정이므로 고객 수신도 시스템봇 인스턴스로 들어올 수 있다 → 이때 전화번호 매칭이 SUPPLIER 후보를 못 찾으면 `UNKNOWN` 유지(고객은 매칭 안 됨)가 정상 동작인지 확인(D1.4가 이를 보장 — 매칭 실패=UNKNOWN, ADMIN 수동 CUSTOMER 분류).

### D2. 4개 공유 × 상대별 누수 매트릭스 (핵심)

| 공유 | 공급자(SUPPLIER) | 고객(CUSTOMER) | UNKNOWN |
|---|---|---|---|
| **① 사진** | 이미지 발송 (텍스트·금액 없음) | 동일 | **활성** (누수 없음 — 유일하게 미분류도 허용 가능, 단 안전하게 분류 후 권장) |
| **② 빌라 공유** | 빌라명·단지·사진·시설(VillaAmenity)·**원가**(`supplierCostVnd`/박, 시즌별) — 마진·판매가·KRW **제외** | 빌라명·단지·사진·시설·**판매가**(`salePriceVnd` 또는 `salePriceKrw`, 통화는 상대 맥락) — 원가·마진 **제외** | **비활성**(분류 전엔 어느 금액을 보낼지 결정 불가 → 잠금) |
| **③ 제안서 공유** | **비활성**(제안은 고객용 판매가 페이지 — 공급자에 부적합) | **활성** — `/p/[token]` 공개 URL 텍스트 발송(판매가만, 이미 공개·마진 비노출) | **비활성** |
| **④ 정산서 공유** | **활성** — 본인(supplierId 일치) 정산 요약(`totalVnd`·기간·건수, VND 원가 기반) | **비활성**(정산은 공급자↔운영자 — 고객 해당없음) | **비활성** |

**불변식(전 공유 공통):**
- **마진(`marginType`/`marginValue`)은 어떤 공유에도, 누구에게도 포함하지 않는다.** select 단계에서 제외.
- 공급자 경로엔 `salePrice*`/KRW 판매가가, 고객 경로엔 `supplierCostVnd`가 **쿼리에서 조회되지 않는다**(필터링이 아니라 미SELECT — D4).
- 빌라/정산 공유는 **본인 소유 검증**(D4.2): 공급자에겐 그 공급자(`userId`로 연결)의 빌라/정산만? → **아니다. 빌라 공유 대상은 ADMIN이 판매하려는 임의 빌라**(고객에게 추천)이거나 그 공급자의 빌라(원가 확인). 정산은 **그 공급자 본인 것만**(supplierId = 대화 상대 userId). 상세 D4.2.

### D3. 발송 방식 — 가장 단순·안전한 형태 권고

1. **사진(①):** zca-js 이미지 실발송. 흐름: 클라이언트가 파일 업로드 → 라우트가 `saveFile`로 R2/디스크 저장(증빙·표시용 URL 확보) → 같은 버퍼로 `sendChatImageAsAdmin`(zca-js `attachments` Buffer) → `ZaloMessage(msgType=image, attachmentUrls=[url], text=캡션?)`. **이미지는 양쪽 동일 — 누수 없음.** (③ 참고: zca-js는 Buffer 필요 → URL 재다운로드 아닌 업로드 시점 버퍼 재사용.)
2. **빌라 공유(②):** **텍스트 요약 메시지** 권고(이미지 카드·HTML 아님). 누수 분기가 텍스트 필드 단위로 명확하고, zca-js 텍스트 발송이 가장 안정적이며, 번역(ko↔vi) 파이프라인과도 호환. 빌라 사진은 별도로 ①(이미지) 1~N장 첨부 가능(빌라 baseline 사진 URL → 버퍼 발송). 요약 본문 = `빌라명 · 단지 · 침실/욕실/최대인원 · 수영장/조식 · 시설목록 · [상대별 금액 줄]`. **금액 줄만 상대 타입별로 분기**(D4).
3. **제안서 공유(③):** **`/p/[token]` 공개 URL 텍스트 발송** — 가장 단순·안전. 이미 공개 페이지이고 판매가 전용(마진·원가 비노출, SPEC F3). 본문 = `제안 링크 안내 + URL + 유효기간`. 고객 전용.
4. **정산서 공유(④):** **텍스트 요약** — `대상 월 · 총 지급액(totalVnd, ₫ 천단위 점) · 예약 건수 · 상태`. 공급자 본인 것만. PDF(`statementUrl`)는 Phase 2 — Phase 1은 텍스트.
5. **ZaloMessage 기록(msgType 확장):** 기존 `msgType String @default("text")`에 값 추가(enum이 아니라 문자열이므로 **스키마 변경 없이 값만 정의**):
   - `image` — 사진(attachmentUrls)
   - `villa_share` — 빌라 요약(text=요약본문, attachmentUrls=[사진들])
   - `proposal_share` — 제안 링크(text=안내+URL)
   - `settlement_share` — 정산 요약(text=요약본문)
   - 채팅 버블 렌더는 msgType별 분기(8절 디자인). **금액이 들어간 본문은 발송 시점에 이미 누수 필터링된 텍스트** → 저장된 text 자체가 안전(상대에게 보낸 그대로).

> **설계 원칙:** 빌라/정산은 "구조화 카드 JSON을 ZaloMessage에 저장 후 클라가 렌더" 방식도 가능하나, **누수 안전을 위해 발송 본문(이미 필터링된 텍스트)을 그대로 `text`에 저장**한다. 카드 JSON을 저장하면 원가/판매가 둘 다 담길 위험이 생긴다 — 저장 단계에서 한쪽만 담도록 강제하면 발송 본문과 저장이 어긋날 수 있어, "보낸 그대로 저장"이 단일 진실원이자 누수 0 보장.

### D4. 권한·누수 차단 설계

1. **공유 데이터 조회 = select 화이트리스트(상대 타입 분기):**
   - **빌라 공유:** 대화의 `counterpartyType`을 먼저 읽고,
     - `SUPPLIER` → `prisma.villa.findUnique({ select: { name, complex, bedrooms, bathrooms, maxGuests, hasPool, breakfastAvailable, amenities, rates: { select: { season, supplierCostVnd } } } })` — **`salePriceVnd`/`salePriceKrw`/`marginType`/`marginValue` 미포함.**
     - `CUSTOMER` → `rates: { select: { season, salePriceVnd, salePriceKrw } }` — **`supplierCostVnd`/`marginType`/`marginValue` 미포함.** 통화는 상대 맥락(여행사=VND, 직접=KRW)에 따라 한쪽만 본문에 기재.
     - **`lib/pricing.ts`의 `quoteStay`/`StayQuote`를 공유 본문 생성에 직접 쓰지 않는다**(StayQuote는 원가+판매가 동시 포함 — 누수 객체). 공유 전용 빌더(`buildVillaShareText(villa, counterpartyType)`)가 타입별로 분리된 select 결과만 받아 본문 조립.
   - **마진 필드는 어떤 공유 쿼리에도 select하지 않는다**(쿼리 단계 제외 = 코드에서 마진이 흐를 경로 자체를 차단).
2. **공유 대상 검증:**
   - **빌라:** ADMIN은 전체 재고 접근 권한이 있으므로 임의 빌라를 공유할 수 있다(재고 비공개는 외부 노출 차단이지 ADMIN 내부 제약 아님). 단 **고객에게 공유 시 ACTIVE+isSellable 빌라만**(판매 가능 재고만 — 미검수 빌라 노출 방지), **공급자에게 공유 시 그 공급자 소유 빌라 권고**(자기 원가 확인 맥락 — 단 ADMIN 판단으로 타 빌라 원가 공유도 가능하나 기본은 본인 빌라; 구현 시 빌라 선택 모달이 공급자 대화면 그 공급자 빌라 우선 노출).
   - **정산:** **반드시 본인 것만** — `Settlement.supplierId === conversation.userId`(대화 상대 공급자) 검증. 다른 공급자 정산 공유 금지(타 공급자 원가 누수). `userId=null`(미매칭 공급자)이면 정산 공유 불가(상대를 특정 못 함).
   - **제안:** `Proposal.token` 임의 공유 가능하나 **CUSTOMER 대화에만**. 제안은 이미 공개 링크라 토큰 자체가 권한.
3. **ADMIN 전용 발송:** 모든 공유 라우트 첫 줄 `session.user.role === "ADMIN"` + `conversation.ownerAdminId === session.user.id`(본인 대화만, ADR-0007 D3.4). SUPPLIER/CLEANER/비로그인 차단.
4. **상대 타입 게이트:** 라우트에서 `counterpartyType`과 공유 종류 조합을 D2 매트릭스로 검증 — 불일치(예: 공급자에게 제안서, 고객에게 정산서, UNKNOWN에 빌라)는 **400/403 거부**(클라 UI 숨김 + 서버 이중 가드).
5. **AuditLog:** 모든 공유 발송에 `writeAuditLog(CREATE, ZaloMessage, …, changes:{ msgType, counterpartyType, sharedEntity:{type,id} })` — **본문·금액·credential 미기록**(기존 규칙).
6. **누수 검사 항목 추가(`.claude/skills/qa/leak-checklist`):** (a) 빌라 공유 select에 상대 타입과 다른 통화/원가가 섞이지 않는지, (b) 마진 필드가 어떤 공유 쿼리에도 없는지, (c) 정산 공유 대상이 상대 공급자 본인인지, (d) 제안/정산 공유가 잘못된 상대 타입에 허용되지 않는지, (e) StayQuote/quoteStay가 공유 본문 빌더에 직접 유입되지 않는지.

### D5. 발송 런타임 — 이미지 함수 1개 추가 (시스템봇 무변경)

1. **`lib/zalo-runtime.ts`에 추가:** `sendChatImageAsAdmin(adminUserId, zaloUserId, buffer, fileName, caption?)` — `getApiForAdmin(adminUserId)` 인스턴스로 `api.sendMessage({ msg: caption ?? "", attachments: [{ data: buffer, filename, metadata: { totalSize: buffer.length } }] }, zaloUserId, ThreadType.User)`. Nike `sendZaloImage` 패턴(EXIF 회전 `sharp(buffer).rotate()` 적용 권고 — 모바일 촬영 회전 보정).
2. **`sendVia`/`sendBotMessage`/`sendChatMessageAsAdmin`(텍스트)는 무변경.** 시스템 알림 발송 경로 일절 안 건드림.
3. 빌라/제안/정산 공유는 **텍스트 발송**이므로 기존 `sendChatMessageAsAdmin`(텍스트) 재사용 — 본문만 누수 필터된 요약. 빌라 사진 첨부는 `sendChatImageAsAdmin` 재사용.
4. **검증 필요:** zca-js `attachments` Buffer 발송이 villa-pms 통합 모드 인스턴스에서 실동작(Nike는 멀티풀에서 동작 확인됨 — 위험 낮음). 이미지 크기·HEIC 변환(아이폰 촬영 heic → zca-js가 받는지) 실측.

### D6. 스키마 변경안 + 단계 분해

```prisma
enum ZaloCounterpartyType {
  SUPPLIER
  CUSTOMER
  UNKNOWN
}

enum ZaloTranslateMode {     // D7 추가
  OFF
  VI
  EN
}

model ZaloConversation {
  // ... 기존 필드(ADR-0007) 유지 ...
  counterpartyType ZaloCounterpartyType @default(UNKNOWN)  // D1 — 기존 행은 SUPPLIER로 백필
  translateMode    ZaloTranslateMode    @default(OFF)      // D7 — 기존 행은 VI로 백필
  avatarUrl        String?                                  // D8 — Zalo 아바타 캐시(없으면 이니셜 폴백)
  avatarFetchedAt  DateTime?                                // D8 — 마지막 아바타 조회 시각(주기 갱신, 선택)
  nickname         String?                                  // D9 — ADMIN 지정 별명(표시 최우선)
}

// ZaloMessage: 스키마 변경 없음.
//   msgType String @default("text") — 값에 image|villa_share|proposal_share|settlement_share 추가(문자열, enum 아님).
//   attachmentUrls String[] — 이미지/빌라사진 URL. text — 공유 요약 본문(누수 필터된 그대로).
```

**변경 분류:**
- **Additive(안전):** `ZaloCounterpartyType`·`ZaloTranslateMode` enum, `ZaloConversation`의 `counterpartyType`·`translateMode`(default 있음)·`avatarUrl`·`avatarFetchedAt`·`nickname`(nullable). `ZaloMessage` msgType은 **문자열 값 추가만**(스키마 무변경).
- **백필:** 기존 `ZaloConversation` → `counterpartyType=SUPPLIER` + `translateMode=VI`(공급자 전제, 1회 UPDATE). `avatarUrl`/`nickname`은 null 시작(폴백 동작).
- **비-additive 변경:** **없음**(ADR-0007과 달리 unique 제약 교체 없음). `prisma migrate dev` 1단계로 D1·D7·D8·D9 컬럼을 함께 추가 가능(또는 S0/S5로 분리 — 단계표 참조).

**단계(누수 위험 오름차순 — 사진→링크→빌라→정산):**

| 단계 | 범위 | 산출 | 검증 |
|---|---|---|---|
| **S0** | 스키마 + 백필 | `ZaloCounterpartyType`·`counterpartyType`, msgType 값 상수 정의, 기존 대화 SUPPLIER 백필 | studio에서 기존 대화 counterpartyType=SUPPLIER, 신규=UNKNOWN. 마이그레이션 데이터 손실 0 |
| **S1 사진** | 이미지 발송(누수 0) | `sendChatImageAsAdmin`(zca-js attachments), 업로드 라우트, `ZaloMessage(image, attachmentUrls)`, b14 +버튼→사진/촬영 | 양쪽 상대에 이미지 실수신, attachmentUrls 저장, MIME 화이트리스트(svg 거부), 회전 보정 |
| **S2 제안서 링크** | 고객 전용 링크(누수 0) | 제안 선택 모달, `/p/[token]` URL 텍스트 발송, `proposal_share`, CUSTOMER 게이트 | 고객 대화에만 메뉴 노출, 공급자/UNKNOWN 거부, URL이 판매가 페이지(원가·마진 비노출 재확인) |
| **S3 빌라 공유** | **누수 분기 핵심** | 빌라 선택 모달, `buildVillaShareText(villa, type)` 타입별 select 화이트리스트, `villa_share`, 사진 첨부 | **공급자=원가만/고객=판매가만/마진 양쪽 0** 본문 검증, quoteStay 미유입, 잘못된 통화 미포함. QA 교차 검사 |
| **S4 정산서** | 공급자 전용 요약 | 정산 선택 모달, 본인(supplierId=userId) 정산 요약 텍스트, `settlement_share`, SUPPLIER+본인 게이트 | 타 공급자 정산 공유 거부, userId=null 거부, VND 표기, 고객 대화 메뉴 미노출 |

**추가 단계(2026-06-16 — 사진/공유와 독립, 병행 가능):**

| 단계 | 범위 | 산출 | 검증 |
|---|---|---|---|
| **S5 번역언어** | 대화별 번역모드(D7) | `ZaloTranslateMode`·`translateMode`(백필 VI), `translateText` en 추가, 수신 자동번역·발신 미리보기 모드 분기, 헤더 드롭다운, OFF 시 미리보기 숨김, `SET_TRANSLATE_MODE` 액션 | OFF=Gemini 호출 0·번역 줄 미표시, VI=ko↔vi, EN=ko↔en, 대화별 저장 영속, 기본값(SUPPLIER=VI/그외 OFF) |
| **S6 아바타** | 아바타 캐시·표시(D8) | `avatarUrl`·`avatarFetchedAt`, lazy 조회(getAvatarUrlProfile, 리스너 외부), 인박스·헤더·버블 `<img>`+이니셜 폴백, next.config 도메인 | 아바타 표시·onError 폴백, 만료 시 이니셜, 리스너 무변경(수신 블로킹 0), next.config 호스트 확정 |
| **S7 별명** | 별명 수정(D9) | `nickname` 컬럼, `SET_NICKNAME` 액션(ADMIN+본인 게이트·길이검증·빈값→null), 표시 우선순위 통일, 헤더 편집 UI, AuditLog | 별명 저장·우선순위(nickname>User.name>displayName>이니셜), 타 관리자 대화 수정 거부, displayName 원본 보존 |

> S5~S7은 사진/공유(S0~S4)와 **데이터 독립**(번역·아바타·별명은 누수 분기와 무관). 스키마 컬럼은 S0 마이그레이션에 함께 묶거나 별도 마이그레이션으로 분리 — BE/TDA 판단(additive라 어느 쪽도 안전). UI는 b14 헤더 1곳에 집중되므로 DESIGN 인계 시 S5·S6·S7 헤더 변경을 1개 디자인으로 통합 권고.

각 단계 QA 독립 검증(작업자 자기평가 무효). S3·S4에서 누수 검사(D4.6) 필수. **S1~S4 어느 단계도 ADR-0007 멀티관리자 구조·시스템 알림 발송을 깨지 않는다**(텍스트/이미지 발송은 본인 인스턴스, 시스템봇 무관).

---

## D7. 대화별 번역 언어 — `ZaloConversation.translateMode` (additive, 2026-06-16 추가)

### D7.1 문제
- 현재 `lib/gemini.translateText(text, target)`의 `target`은 `"vi" | "ko"` 고정(gemini.ts:95). 소스 언어는 프롬프트에서 명시하지 않음 → **모델이 자동 감지**해 타깃 언어로 번역(이미 단방향 "타깃 지정" 구조라 언어쌍 확장이 쉽다).
- 입력창 미리보기는 `target: "vi"` 하드코딩(chat-pane.tsx:274). 수신 INBOUND 번역(translatedText)도 ko 고정 전제.
- 실제: 한국인 상대=번역 불필요, 베트남인=vi, 영어권=en. 대화마다 다르다.

### D7.2 스키마 — enum + 컬럼 1개 (additive)
```prisma
enum ZaloTranslateMode {
  OFF   // 번역 끔 — 수신 자동번역·발신 미리보기 둘 다 비활성 (한국어끼리)
  VI    // 상대는 베트남어 — 수신 vi→ko 표시, 발신 ko→vi 미리보기
  EN    // 상대는 영어 — 수신 en→ko 표시, 발신 ko→en 미리보기
}

model ZaloConversation {
  // ... 기존 필드 유지 ...
  translateMode ZaloTranslateMode @default(OFF)  // 신규 — 백필 규칙 D7.3
}
```
- **운영자(ADMIN) 기준 언어는 항상 ko로 고정**(수신은 무조건 ko로 번역해 보여주고, 발신은 ko 입력 → 상대 언어로 미리보기). 따라서 모드는 "상대 언어" 1축만 저장하면 충분 — ko↔X 쌍이 모드값으로 결정된다. 별도 `targetLang` 자유 문자열보다 enum이 누수·오타·UI 측면에서 안전(권고).
- 향후 언어 추가는 enum 값 추가만(예: `JA`, `ZH`) — additive.

### D7.3 기본값·백필 — 상대 타입(D1 counterpartyType) 연계
- **신규 대화 기본값:** enum default는 `OFF`로 두되, 생성 시점에 `counterpartyType`으로 1차 추론:
  - 수신 매칭으로 `SUPPLIER` 확정(전화번호 매칭 성공) → `translateMode=VI`(공급자는 베트남인 전제 — 사업 정의).
  - `CUSTOMER`/`UNKNOWN` → `OFF`(한국 여행사·여행객이 다수, 영어는 ADMIN이 수동 EN 전환). 오버트랜슬레이션(한국어를 vi로 깨는 사고)보다 OFF 기본이 안전.
- **백필(기존 대화):** 기존 대화는 전부 공급자 전제였으므로(D1.5 SUPPLIER 백필과 동일 맥락) `translateMode=VI`로 UPDATE. additive 컬럼 default OFF로 추가 후 기존 행만 VI로 백필.
- ADMIN이 헤더 드롭다운에서 언제든 OFF/VI/EN 변경 — 대화별 영속.

### D7.4 `translateText` 확장 — `"en"` 타깃 추가 (시그니처 호환)
- `TranslateTarget = "vi" | "ko"` → `"vi" | "ko" | "en"`로 확장. `TARGET_LABEL`에 `en: "English"` 추가. **기존 호출부 무변경**(ko/vi 그대로). 소스 언어는 계속 모델 자동감지(프롬프트 "Translate ... into <target>" 유지).
- 수신 자동번역 호출부: 모드가 `OFF`면 `translateText` **호출 자체를 건너뛴다**(translatedText=null 저장 → 버블에 번역 미표시). `VI`/`EN`이면 수신 메시지를 ko로 번역(target="ko"). **수신은 항상 ko 타깃**(운영자가 읽음).
- 발신 미리보기 호출부(`/api/zalo/translate`): 현재 `target:"vi"` 하드코딩을 **대화 모드 기반**으로 변경 — `VI`→target="vi", `EN`→target="en", `OFF`→미리보기 비활성(번역 영역 자체를 숨김, Gemini 호출 0).

### D7.5 UI — 헤더 번역 드롭다운 + OFF 처리
- 대화 헤더(chat-pane.tsx 헤더)에 **번역언어 드롭다운**(OFF / Tiếng Việt / English) — 선택 시 `PATCH /api/zalo/conversations/[id]`(action: `SET_TRANSLATE_MODE`)로 영속, `router.refresh()`.
- **OFF일 때 Composer:** 하단 미리보기 영역(현 previewLabel 줄, chat-pane.tsx:348~363)을 **숨긴다**(번역 없이 ko 입력 그대로 전송). `onBlur`의 `translate()` 호출도 모드 OFF면 no-op.
- **OFF일 때 INBOUND 버블:** translatedText=null이므로 기존 렌더가 자연히 번역 줄을 안 그림(추가 작업 없음).
- i18n 키 추가(next-intl): `translateMode.off/vi/en`, `translateModeLabel`.

### D7.6 누수·비용
- 번역은 **채팅 본문에만** 적용 — 빌라/정산 공유 본문은 발송 전 이미 누수 필터된 텍스트(D3.5)이므로 번역해도 마진·반대편 통화가 생길 수 없다(원문에 없음). 누수 0.
- OFF는 Gemini 호출을 없애 비용·지연을 줄인다(한국어끼리 대화가 많을수록 절감). FIN COSTS.md에 번역 호출 감소 반영 가능.

---

## D8. 아바타 표시 — `ZaloConversation.avatarUrl` 캐시 (additive, 2026-06-16 추가)

### D8.1 zca-js 아바타 제공 여부 — 검증 결과(확인됨, 별도 조회 필요)
- **수신 메시지 payload(`TMessage`)엔 avatar 필드가 없다**(zca-js `dist/models/Message.d.ts` 정독 — `dName`만 존재). 따라서 수신 시점에 아바타를 바로 얻을 수 없다.
- 아바타 URL은 **별도 API**로 조회:
  - `api.getAvatarUrlProfile(friendId)` → `{ [userId]: { avatar: string } }` (아바타 URL 전용, 가벼움 — 권고).
  - `api.getUserInfo(userId)` → `ProfileInfo`(=User)에 `avatar`·`displayName`·`zaloName`·`phoneNumber` 포함(프로필 일괄 조회 — displayName 보강·전화 매칭에도 재사용 가능).
- **결론:** 아바타는 "필요 시 1회 조회 후 캐시"가 맞다. 매 수신마다 조회하면 API 부하·레이트리밋 위험.

### D8.2 저장·갱신 전략 — URL 캐시 + 폴백
```prisma
model ZaloConversation {
  // ...
  avatarUrl       String?    // Zalo 프로필 아바타 URL 캐시 — 없으면 이니셜 폴백 (D8.3)
  avatarFetchedAt DateTime?  // 마지막 조회 시각 — 만료/주기 갱신 판단 (선택, 권고)
}
```
- **수집 시점:** (a) 대화 첫 생성 시(`saveInboundMessage` upsert create 분기)에 `getAvatarUrlProfile` 1회 조회해 저장, 또는 (b) `/messages` 진입 시 `avatarUrl=null`이거나 `avatarFetchedAt`이 오래된(예: 7일) 대화만 lazy 갱신. **수신 핸들러(리스너) 안에서 동기 조회는 지양**(리스너 블로킹·실패 전파 위험) → 별도 경로(라우트·잡)에서 best-effort. 구현 단계에서 (a)/(b) 택일(b 권고 — 리스너 무변경).
- **만료 리스크:** Zalo CDN URL은 토큰·만료가 붙을 수 있다. Phase 1은 **외부 URL 직접 표시 + 만료 시 이니셜 폴백**(저비용). Phase 2에서 R2 캐시(`lib/storage`)로 영속화 검토(IDEAS.md — 만료 완전 회피, 단 저장소·갱신 비용).

### D8.3 표시·폴백
- 인박스(`inbox.tsx`)·대화 헤더(`chat-pane.tsx` 헤더)·INBOUND 버블 아바타를 `avatarUrl` 있으면 `<img>`, 없으면 **기존 이니셜 원**(현 `initials()` + teal 원, chat-pane.tsx:81·137) 유지. 이미지 로드 실패(onError)도 이니셜로 폴백.
- `header`(ChatHeader)·`InboxItem`에 `avatarUrl: string | null` 필드 추가, page.tsx select에 `avatarUrl` 포함.

### D8.4 next.config 이미지 도메인
- `next.config` `images.remotePatterns`에 Zalo 아바타 CDN 호스트 허용 필요(예: `s*.zadn.vn`/`zalo` CDN — **실측 호스트 검증 필요**, 조회 응답 URL로 확정). 미허용 시 `next/image` 거부 → 일반 `<img>` 사용 또는 도메인 등록. **검증 필요:** 실제 avatar URL 호스트명(조회 결과로 확정 후 next.config 반영).

### D8.5 누수
- 아바타는 공개 프로필 이미지 — 마진·금액과 무관, 누수 0. AuditLog 불필요(읽기 전용 캐시). 단 avatarUrl을 응답에 담을 때 credential·전화번호는 함께 싣지 않음(기존 select 화이트리스트 유지).

---

## D9. 별명(nickname) 수정 — `ZaloConversation.nickname` (additive, 2026-06-16 추가)

### D9.1 별도 컬럼 — displayName 덮어쓰기 금지
- 현재 표시명 = `user?.name ?? displayName ?? "(이름 미확인)"`(page.tsx:115·168). `displayName`은 Zalo 프로필명 원본이며 수신 시 보강된다(`zalo-inbound` saveInboundMessage 197행 — 비어있을 때만 채움).
- **`displayName`을 ADMIN 수정값으로 덮어쓰면**: ① Zalo 원본을 잃고, ② 수신 보강 로직(`!conversation.displayName`)과 충돌. 따라서 **별도 `nickname` 컬럼** 신설(displayName=Zalo 원본 보존, nickname=ADMIN 지정).
```prisma
model ZaloConversation {
  // ...
  nickname String?   // ADMIN이 지정한 별명 — 표시 최우선. 없으면 User.name → Zalo displayName → 이니셜
}
```

### D9.2 표시 우선순위 (단일 규칙)
`nickname` > 매칭 `User.name` > Zalo `displayName` > 이니셜("(이름 미확인)").
- page.tsx의 이름 계산 2곳(115·168행)을 `c.nickname ?? c.user?.name ?? c.displayName ?? "(이름 미확인)"`로 통일. 이니셜도 이 최종 표시명에서 산출(현 `initials(name)` 그대로).

### D9.3 수정 API·UI
- **API:** 기존 `PATCH /api/zalo/conversations/[id]` 확장(현 MARK_READ 액션 보유) — 새 액션 `SET_NICKNAME { nickname: string | null }`. 첫 줄 `role==="ADMIN"` + `ownerAdminId === session.user.id`(본인 대화만, ADR-0007 D3.4). 빈 문자열 입력은 `null`로 정규화(별명 해제 → 원래 우선순위로 복귀). 길이 제한(예: 1~40자) 검증.
- **AuditLog:** `writeAuditLog(UPDATE, ZaloConversation, id, changes:{ nickname:{ old, new } })` — 별명은 민감정보 아님(기록 가능). credential·금액 무관.
- **UI:** 대화 헤더 표시명 옆 편집 아이콘(연필) → 인라인 인풋 또는 작은 모달. 저장 시 `router.refresh()`. UNKNOWN/CUSTOMER 등 이름이 비어있는 대화에서 특히 유용(고객 식별).

### D9.4 Zalo 측 별명(changeFriendAlias)은 사용 안 함
- zca-js `api.changeFriendAlias(alias, friendId)`가 있으나 이는 **Zalo 계정 자체의 친구 별명**을 바꾼다(부수효과·외부 상태 변경). 본 요구는 PMS 화면 표시만이므로 **로컬 `nickname`만** 사용(외부 상태 불변, 안전·단순). changeFriendAlias 연동은 범위 밖(IDEAS.md 후보).

---

## 리스크와 완화책

| # | 리스크 | 완화책 | 단계 |
|---|---|---|---|
| ① | **빌라 공유 시 원가/판매가 혼입**(공급자에 판매가, 고객에 원가) | 상대 타입별 select 화이트리스트(반대편 통화·원가 미조회), 공유 전용 빌더(quoteStay/StayQuote 미사용), 서버 타입 게이트(D4.4) | S3 |
| ② | **마진 노출**(어떤 공유든) | 마진 필드를 모든 공유 쿼리 select에서 제외(코드 경로 차단), QA 검사 항목 (b) | S3 |
| ③ | 고객↔공급자 **오분류 → 양방향 누수**(고객에 원가 / 공급자에 판매가) | Phase 1 자동 매칭 금지(D1.4), ADMIN 수동 CUSTOMER 분류, UNKNOWN은 빌라/제안/정산 전부 잠금(사진만 허용) | S0·S3 |
| ④ | 정산 공유 시 **타 공급자 정산 누수** | `Settlement.supplierId === conversation.userId` 강제, userId=null이면 거부 | S4 |
| ⑤ | zca-js 이미지 발송 실패(HEIC·대용량·Buffer 형식) | Nike sendZaloImage 정본 패턴, sharp 회전·변환, MIME 화이트리스트(storage.ts 재사용), 실패 시 status=FAILED(텍스트 발송과 동일 처리) | S1 |
| ⑥ | 제안 링크가 **이미 만료/REVOKED**인데 공유 | 공유 전 `Proposal.status=ACTIVE` + `expiresAt > now` 검증, 만료면 경고 | S2 |
| ⑦ | 카드 JSON 저장이 원가+판매가 동시 포함 | **저장은 발송 본문(필터된 텍스트) 그대로**(D3.5 원칙) — 카드 JSON 미사용 | S3·S4 |
| ⑧ | UNKNOWN 대화에 사진은 허용하나 실수로 빌라/정산 노출 | UI 메뉴 가시성 + 서버 게이트 이중(D4.4), UNKNOWN은 빌라/제안/정산 라우트에서 400 | S1~S4 |
| ⑨ | **오버트랜슬레이션**(한국어끼리인데 vi로 깨서 보냄) | 기본값 OFF(CUSTOMER/UNKNOWN), 대화별 모드 저장, OFF면 미리보기·자동번역 호출 0 (D7.3·D7.5) | S5 |
| ⑩ | Zalo 아바타 **URL 만료/핫링크 차단**으로 깨진 이미지 | `<img onError>`·avatarUrl null → 이니셜 폴백, avatarFetchedAt 주기 갱신, Phase 2 R2 캐시 (D8.2·D8.3) | S6 |
| ⑪ | 아바타 조회를 **리스너 안에서 동기 호출** → 수신 블로킹·레이트리밋 | 리스너 무변경, lazy 갱신(/messages 진입 시 null/만료만 best-effort 조회, D8.2) | S6 |
| ⑫ | 별명 수정이 **Zalo 원본 displayName 손상** 또는 타 관리자 대화 수정 | 별도 nickname 컬럼(displayName 보존), API 첫 줄 ADMIN+ownerAdminId 게이트(D9.1·D9.3) | S7 |

---

## 영향 범위

- **스키마:** `ZaloCounterpartyType`·`ZaloTranslateMode` enum + `ZaloConversation`의 `counterpartyType`(default UNKNOWN, 백필 SUPPLIER)·`translateMode`(default OFF, 백필 VI)·`avatarUrl`·`avatarFetchedAt`·`nickname`(nullable). `ZaloMessage` 무변경(msgType 문자열 값만 추가). 전부 additive — `prisma migrate dev` 1단계(또는 S0/S5 분리), 비-additive 없음.
- **신규 파일:** 공유 발송 라우트(예: `app/api/zalo/share/route.ts` 또는 `messages/route.ts` 확장 + `app/api/zalo/images/route.ts`), `lib/zalo-share.ts`(`buildVillaShareText`·`buildSettlementShareText`·`buildProposalShareText` — 누수 필터 단일 소스), b14 첨부 메뉴·선택 모달 컴포넌트(8절).
- **수정 파일:**
  - `lib/zalo-runtime.ts`: `sendChatImageAsAdmin` 추가(텍스트·시스템봇 함수 무변경).
  - `lib/zalo-inbound.ts`: `saveInboundMessage`에서 매칭 성공 시 `counterpartyType=SUPPLIER` 설정(매칭 실패는 UNKNOWN 유지).
  - `app/(admin)/messages/chat-pane.tsx`: Composer에 +버튼/첨부 메뉴, 공유 카드 버블 렌더(msgType 분기), 대화 헤더 분류 컨트롤. **+ D7: 헤더 번역 드롭다운·OFF 시 미리보기 숨김·translate target 모드화. D8: 헤더/버블 아바타 img+폴백. D9: 헤더 별명 편집.**
  - `app/(admin)/messages/page.tsx`: 대화 select에 `counterpartyType` 추가, 헤더에 전달. **+ select에 `translateMode`·`avatarUrl`·`nickname` 추가, 표시명 계산을 `nickname ?? user.name ?? displayName`으로(115·168행), ChatHeader/InboxItem에 avatarUrl·translateMode·nickname 전달.**
  - `app/(admin)/messages/inbox.tsx`: 아바타 img+이니셜 폴백(D8.3).
  - `lib/gemini.ts`: `TranslateTarget`에 `"en"` 추가 + `TARGET_LABEL.en`(D7.4, 기존 호출 무변경).
  - `lib/zalo-runtime.ts`: 아바타 조회 헬퍼(`getAvatarUrlForAdmin(adminUserId, zaloUserId)` — getApiForAdmin→getAvatarUrlProfile, best-effort) 추가 권고(D8.2). 텍스트·시스템봇 함수 무변경.
  - `app/api/zalo/conversations/[id]/route.ts`(PATCH): `SET_TRANSLATE_MODE`·`SET_NICKNAME` 액션 추가(ADMIN+ownerAdminId 게이트, D7.5·D9.3).
  - `app/api/zalo/translate/route.ts`: 하드코딩 `target:"vi"` → 대화 모드 기반(또는 클라가 모드 전달). OFF면 호출 차단.
  - `next.config`: `images.remotePatterns`에 Zalo 아바타 CDN 호스트 추가(D8.4, 호스트 실측 후).
  - `.claude/skills/qa/leak-checklist`: D4.6 항목 + (f) 번역 본문에 마진/반대편 통화 없음(원문에 없으므로 자동), (g) 별명 수정 ownerAdminId 게이트, (h) 아바타/별명 응답에 credential·전화 미포함 추가.
- **재사용:** `lib/storage.saveFile`(이미지 업로드), `lib/pricing`(단, StayQuote는 공유 본문에 미사용 — 시즌별 요율 조회만), Nike `sendZaloImage` 패턴.
- **무변경 보장:** 시스템 알림(F5)·`sendBotMessage`·`dispatchOne`·ADR-0007 멀티풀/복합키/수신 귀속·`/p/[token]` 공개 페이지·정산 집계 로직.
- **환경변수:** 추가 없음(R2 STORAGE_* 기존, ZALO_CREDS_KEY 기존).

## 미결 (구현 단계에서 확정)

- 고객 수신 흐름(D1 검증): 통합 모드에서 고객이 테오 개인계정에 메시지 시 UNKNOWN 분류·수동 CUSTOMER 지정 UX.
- zca-js HEIC/대용량 이미지 발송 실측(D5.4).
- 빌라 공유 시 사진 장수 기본값(전체 baseline vs 외관 1장) — DESIGN/테오 협의.
- 공유 라우트를 `messages/route.ts` 확장 vs 신규 분리 — BE 구현 시 결정(누수 게이트 응집도 기준 신규 분리 권고).
- Phase 2: 고객 대화↔Booking 명시 수동 링크, 정산서 PDF(`statementUrl`) 공유, 빌라 공유 이미지 카드.
- **D8.4 아바타 CDN 호스트명 실측**(getAvatarUrlProfile 응답 URL 호스트 → next.config images.remotePatterns 확정). 아바타 수집 시점 (a)생성 시 vs (b)lazy 갱신 택일(b 권고).
- **D7 발신 미리보기 모드 전달 방식**: 클라가 translateMode를 알고 target을 보낼지, 라우트가 conversationId로 모드를 조회할지(라우트 조회 권고 — 단일 진실원). 구현 시 확정.
- **D7 EN 양방향**: 영어권 상대의 수신을 en→ko로 번역할 때 한국어/베트남어 혼입 대화의 감지 정확도(Gemini 자동감지 신뢰) — 실사용 관찰 후 조정.
- Phase 2: 별명을 Zalo 측에도 반영(`changeFriendAlias`) 여부, 아바타 R2 영속 캐시(만료 완전 회피).

---

## 디자인 인계 (DESIGN)

| # | 화면 | 변경 | 비고 |
|---|---|---|---|
| 1 | b14 입력창 — **첨부 +버튼** | **신규** | Composer 좌측 + 버튼 → 메뉴(사진·촬영·빌라·제안·정산). 다크 톤. **상대 타입별 메뉴 가시성**: SUPPLIER=사진+빌라+정산 / CUSTOMER=사진+빌라+제안 / UNKNOWN=사진만(+분류 안내) |
| 2 | **빌라 선택 모달** | **신규** | 빌라 검색·선택(공급자 대화면 그 공급자 빌라 우선, 고객 대화면 ACTIVE+isSellable). 시즌/날짜 선택 후 공유. 다크 |
| 3 | **제안 선택 모달** | **신규** | ACTIVE 제안 목록(만료 임박 표시), 선택 → /p/[token] 링크 발송. CUSTOMER 대화 전용 |
| 4 | **정산 선택 모달** | **신규** | 상대 공급자의 월 정산 목록(supplierId=userId), 선택 → 요약 발송. SUPPLIER 대화 전용 |
| 5 | **공유 카드 버블** | **신규** | 채팅 스레드에 image/villa_share/proposal_share/settlement_share를 카드형으로 표시(아이콘+요약). MessageBubble msgType 분기 |
| 6 | 대화 헤더 — **상대 분류 컨트롤** | **신규** | UNKNOWN/미분류 대화에서 "공급자/고객" 지정 토글·드롭다운. 분류 후 공유 메뉴 활성 |
| 7 | **대화 헤더 — 번역언어 드롭다운**(D7) | **신규** | 헤더 우측에 OFF / Tiếng Việt / English 드롭다운. 선택 시 대화별 저장. 다크. **OFF 선택 시 Composer 하단 미리보기 영역 숨김**(번역 없이 ko 전송) |
| 8 | **대화 헤더·인박스·INBOUND 버블 — 아바타**(D8) | **수정** | 현 이니셜 원(teal)을 `avatarUrl` 있으면 `<img>`, 없으면 이니셜 폴백. 인박스 아이템·헤더·버블 3곳 동일 패턴 |
| 9 | **대화 헤더 — 별명 편집**(D9) | **신규** | 표시명 옆 연필 아이콘 → 인라인 인풋/소형 모달. 빈값=별명 해제. 표시 우선순위 nickname>User.name>displayName |
| 10 | b14 기존 텍스트 입력·전송 동작 | **무변경** | Composer 전송·48h 로직 그대로(미리보기 표시 여부만 모드 연동) |

→ 1·2·3·4·5·6 + 7·8·9가 **신규/수정 디자인**(Stitch 대상). **7·8·9는 모두 b14 대화 헤더 영역 변경**이므로 1개 헤더 리디자인으로 통합 권고(아바타 + 별명(편집) + 번역언어 드롭다운 + (기존)연결배지·빌라배지). DESIGN은 다크 운영자 톤. 구현 순서는 S1(사진) 우선이나, 헤더 3종(S5~S7)은 데이터 독립이라 병행 디자인 가능.

---

## 결과

- 채팅 상대를 **공급자+고객**으로 확장하되, ADR-0007의 복합키 구조 덕에 **신규 모델 없이 `counterpartyType` 1컬럼**으로 해결(additive, 비-additive 변경 0).
- 4개 공유의 누수는 **상대 타입별 select 화이트리스트**로 차단 — 공급자=원가만, 고객=판매가만, **마진은 양쪽 영구 금지**. 빌라 공유가 누수 분기 핵심이며 `quoteStay`/StayQuote를 공유 본문에 직접 쓰지 않는다.
- zca-js **이미지 발송 가능**(Buffer attachments, Nike 정본) — `sendChatImageAsAdmin` 1개 추가, 시스템봇 무변경.
- 발송은 **사진=이미지, 빌라/정산=누수 필터 텍스트 요약, 제안=공개 URL** — 가장 단순·안전. 저장은 "보낸 본문 그대로"(카드 JSON 미사용 → 누수 0).
- 1차 구현: **S0(스키마+백필) → S1(사진)** 부터 누수 위험 오름차순. S3(빌라)·S4(정산)에 QA 누수 검사 집중.
- 승인 시 PM 보고 → DESIGN(b14 첨부 메뉴·모달 + **대화 헤더 리디자인: 아바타+별명편집+번역드롭다운**)에 선행 인계 → INTEG/BE에 S0(마이그레이션)·S1(사진 발송) 지시. 단, **D1(고객 수신 흐름)·D5.4(zca-js HEIC 실측) 검증 결과를 S3 착수 전 확인.**

**개정 추가(2026-06-16) 3건 — 전부 additive, 누수 분기와 독립:**
- **D7 대화별 번역언어:** `translateMode(OFF|VI|EN)` 1컬럼 + `translateText` en 추가. 한국어끼리는 OFF로 번역 호출 0. 기본값 SUPPLIER=VI/그외 OFF, 기존 대화 VI 백필.
- **D8 아바타:** 수신 payload엔 avatar 없음(검증 완료) → `getAvatarUrlProfile`로 별도 조회·`avatarUrl` 캐시·이니셜 폴백. 리스너 무변경(lazy 갱신), next.config 도메인 허용(호스트 실측 필요).
- **D9 별명:** `nickname` 별도 컬럼(displayName 원본 보존), ADMIN·본인 대화만 수정(PATCH 액션 확장), 표시 우선순위 nickname>User.name>displayName>이니셜.
- 3건의 UI는 b14 대화 헤더 1곳에 집중 → 헤더 통합 리디자인 권고. 스키마는 S0에 함께 또는 별도 마이그레이션(어느 쪽도 additive·안전).

**개정2 추가(2026-06-16) — 분류 5종 확장(여행사·랜드사):** `ZaloCounterpartyType`에 `TRAVEL_AGENCY`(VND)·`LAND_AGENCY`(VND)를 additive enum으로 추가. 누수 그룹을 원가측{SUPPLIER}/판매가측{CUSTOMER,TRAVEL_AGENCY,LAND_AGENCY}/UNKNOWN으로 일반화하고, 빌라 공유 본문 통화를 분류값으로 결정(CUSTOMER=KRW, 여행사·랜드사=VND — ADR-0003 정합, 보류됐던 통화 분기 해소). 빌더(`lib/zalo-share`)는 이미 통화 파라미터화되어 무변경, route 게이트·통화 전달·FE 메뉴는 BE/FE 후속. db push 적용·백필 불필요.
