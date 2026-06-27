# ADR-0029 — 게스트 여권 사진 Zalo 전달 (임시거주신고 tạm trú)

- 상태: 승인 (조건부 — 구현 착수 가능)
- 날짜: 2026-06-27 (초안) · 2026-06-27 갱신(테오 결정 + QA 검토 반영)
- 작성: TDA
- 승인 경위: 미결 5건 중 3건(발송채널·수신자·전달범위) + 미동의 정책을 테오가 확정, QA blocking 3건(B1~B3)·non-blocking(N1~N5) 반영해 조건부 승인. **잔여 조건 = 아래 「구현 범위(Phase 2) 체크리스트」 전 항목 + QA 최종 누수·경로주입·권한 검사 통과.** (이 갱신은 코디네이터 경유 전달이며, 사용자 본인의 직접 승인 기록은 아님 — 구현 착수 전 사용자/QA 게이트로 재확인.)
- 관련 태스크: T3.6(tạm trú 텍스트 알림 Phase 1, 기구현), 신규 T3.7(여권 **이미지** 실발송 Phase 2)
- 관련 ADR/문서:
  - ADR-0005(Zalo zca-js) — 알림 채널
  - ADR-0010(Nike↔villa Zalo 세션·채팅 공유) — `sendChatImageAsAdmin` Buffer 직접발송 패턴의 출처
  - ADR-0019(게스트 셀프 체크인) — `passportPhotoUrls` 수집 경로
  - docs/decisions/0004-image-storage.md, `lib/storage.ts` — 여권 비공개 저장(`savePassportFile`)
  - docs/SECURITY-HARDENING-PLAN-2026-06-27.md — `lib/security-event.ts` 감사 채널
  - SPEC F4(체크인 2)

---

## 배경

베트남 법상 외국인 투숙 시 집주인(현장 빌라 담당)이 **임시거주신고(tạm trú)** 의무를 진다. 신고에는 게스트의 **실제 신원**(여권)이 필요하며, 현장 관리인(SUPPLIER)이 **여권 사진 원본 자체를 요구할 가능성이 크다** — 텍스트로 옮긴 이름·번호만으로는 신고소가 받지 않거나 관리인이 신뢰하지 않는 경우가 많기 때문이다. **수신자는 공급자(SUPPLIER)로 확정**(테오 결정, D3) — CLEANER는 포함하지 않는다.

### 이미 있는 것 (Phase 1 — T3.6, 기배포)

여권 전달의 골격은 이미 존재한다. **이 ADR은 그 위에 "이미지 실발송"만 얹는 Phase 2다 — 새 기능을 처음부터 짓는 게 아니다.**

- 여권 수집: 게스트 셀프(`/g/[token]/passport`) 또는 운영자 체크인 폼 → `savePassportFile()`로 **항상 비공개 디스크**(`private/passports/` 또는 `UPLOAD_DIR/passports`)에 저장. 공개 URL 미생성. 서빙은 `GET /api/passports/[name]`(ADMIN 전체·SUPPLIER 본인 업로드분만·`private,no-store`). **90일 삭제 정책** 대상.
- 전달 트리거: `POST /api/bookings/[id]/tamtru`(ADMIN 전용) → `lib/tamtru.ts`의 `sendTamTruPassport()` → 공급자에게 `TAMTRU_PASSPORT` 알림 큐잉 + `CheckInRecord.tamTruSentAt` 기록 + AuditLog(전달 시각·장수만, URL·OCR 미기록).
- **현재 한계(코드 주석에 명시됨)**: `lib/zalo.ts`의 dispatch는 **텍스트 본문만 실제 발송**한다(빌라명·게스트명·체크인일 + "첨부된 여권 사진을 확인하라"는 안내). `passportPhotoUrls`는 `ZaloMessage.attachmentUrls`에 **증빙으로만 기록**될 뿐, **실제 이미지 바이트는 관리인에게 가지 않는다.** 안내 문구가 가리키는 "첨부 사진"이 실제로는 비어 있는 상태다.

### 결정해야 하는 것

위 Phase 1을 완성한다 — 비공개 디스크의 여권 이미지를 **실제로** 관리인 Zalo로 보낸다. 이미 검증된 안전 발송 패턴(`app/api/zalo/conversations/[id]/share/route.ts`의 `handlePhoto` → `sendChatImageAsAdmin(adminUserId, zaloUserId, buffer, …)`, **공개 URL 미경유·Buffer 직접발송**)을 재사용하면 우리 시스템 쪽 공개 노출은 0이다.

### 테오 확정 전제 (그대로 반영, 재논의 금지)

1. tạm trú에 게스트 신원이 **실제로 필요**하다.
2. 관리인이 **여권 사진 자체를 요구**할 가능성이 크다 → 텍스트 정보뿐 아니라 **이미지를 전달**해야 한다.
3. 전달된 사진이 **관리인의 Zalo·휴대폰에 저장되는 것은 불가피**하며, **테오가 이 트레이드오프를 수용**했다. → **"사진 전달 자체를 막는" 결론은 내지 않는다.** 대신 그 위험을 **최소화·문서화·동의화**하는 설계를 한다.

---

## 결정

### D1. 전달 주체·트리거 — ADMIN 전용, 예약 상세에서 트리거 (공급자 자가 전달 불가)

- **전달을 일으키는 주체는 ADMIN(운영자)만.** 화면은 기존 **예약 상세 → tạm trú 전달 버튼**(이미 존재). 공급자/청소자는 **자기가 전달을 일으킬 수 없다.**
- 근거(누수·책임):
  - 여권은 게스트 개인정보다. **전달 결정권을 한 곳(ADMIN)에 모아야** "누가 보냈나"가 단일하게 추적된다(D6 감사). 공급자가 임의 게스트 여권을 끌어다 보내는 경로를 열면 IDOR·과다전달 표면이 넓어진다.
  - 단, **수신자는 그 빌라의 담당 공급자(SUPPLIER)**이다(D3). "ADMIN이 보낸다"와 "공급자가 받는다"는 별개 — 공급자는 받기만 한다.
  - 공급자 자가 전달(self-pull)은 **이번 범위에서 도입하지 않는다.** ADMIN push만. (운영상 필요가 생기면 본인 빌라·본인 booking 스코프 강제 + 동의 확인 + 감사를 갖춘 별도 ADR로 다룬다.)

### D2. 전송 메커니즘 — zca-js 개인계정 Buffer 직접 발송(확정), **전용 함수로 `lib/tamtru.ts` 확장** (share 라우트 미확장)

- **발송 채널: 테오 개인계정 zca-js로 확정**(테오 결정, QA 권장). Zalo OA 미디어 업로드 API는 후속(권한 확보 시) — 이번 범위 제외.
- 비공개 디스크에서 여권 파일 Buffer를 읽어 **`sendChatImageAsAdmin(systemOwnerId, 공급자 zaloUserId, buffer, …)`로 직접 발송**. **공개 URL을 새로 만들지 않는다**(`saveFile` 공개 경로 절대 미경유 — `share`의 `handlePhoto`가 공개 URL을 함께 만드는 것과 다르게, 여권은 비공개 원본 Buffer만 읽어 보낸다).
- **위치: `lib/tamtru.ts`를 확장한다(전용 경로). `share/route.ts`는 확장하지 않는다.** 근거:
  - tạm trú 전달은 이미 `lib/tamtru.ts`라는 **단일 소스**가 있다(트리거·전제검증·감사·`tamTruSentAt`). 이미지 실발송은 이 흐름의 누락분이므로 **같은 소스에 붙이는 게 일관**된다.
  - `share/route.ts`는 ADMIN이 **자기 대화 상대(conversation)** 에게 임의 사진을 보내는 범용 채팅 도구다. 여권은 "임의 사진"이 아니라 **예약→빌라→담당관리인으로 수신자가 강제되는** 특수 흐름이라(D3) 범용 share의 수신자 모델(임의 conversation 선택)과 보안 모델이 다르다. share에 끼워넣으면 "여권을 아무 대화에나 보낼 수 있는" 표면이 생긴다.
  - 재사용하는 것은 **함수 `sendChatImageAsAdmin`(저수준 발송)** 이지 **라우트가 아니다.**
- **전달 소스 한정(B3 — QA blocking, 필수)**: 발송 대상은 **`passportPhotoUrls` 그 중 사진면(정보면) 1장으로만** 한정한다(D5). **`signatureUrl`·`paperDocUrls`(서명 `sig-`·동의서/지류 `doc-` 접두)는 절대 혼입 금지.** 파일명 경로 가드는 **기존 `lib/passport-name.ts`를 재사용**한다(재구현 금지) — `extractUploaderId`/`fileBelongsToUploader`로 결정형 소유·형식 검증, `getPassportDir()` 하위 강제. 파일명 형식 불일치·`..`·접두 불일치(`sig-`/`doc-`)는 거부.
- 발송 단위: 위 한정에 따라 **사진면 1장 Buffer**를 읽어 발송(D5 단일 면). 파일이 `/api/passports/<name>` 형식 URL로 저장돼 있으므로 **파일명만 안전 추출**해 `getPassportDir()` 하위에서 직접 읽는다.
- 실패 격리: Phase 1과 동일하게 **발송 실패가 라우트를 500으로 죽이지 않는다.** 발송 실패 시 결과에 실패를 담아 FE가 재전달 안내. `tamTruSentAt`은 **발송 성공 시에만** 갱신한다.

### D3. 수신자 검증 — 예약→빌라→공급자(SUPPLIER)로만 강제 (임의 zaloUserId·타 빌라 오발송 차단)

- **수신자는 공급자(SUPPLIER)로 확정**(테오 결정). CLEANER 미포함 → **`Villa.tamTruContactZaloUserId` 같은 별도 수신담당 필드는 불필요**(스키마 추가 안 함). 기존 `supplier.zaloUserId` 매핑만 사용한다.
- 수신자 zaloUserId는 **클라이언트가 지정하지 못한다.** 서버가 `booking.villa.supplierId → supplier.zaloUserId`로 **결정**한다(Phase 1 `sendTamTruPassport`가 이미 이렇게 함). 즉 "이 예약의 빌라를 담당하는 그 공급자"에게만 간다.
- **미연결 short-circuit 차단(B1 — QA blocking, 필수)**: 공급자 Zalo 미연결(`zaloUserId == null`)이면 **여권 Buffer를 디스크에서 읽기 전에** 발송 흐름을 중단한다. 수신자 확정·연결 검증을 **파일 I/O보다 먼저** 수행해 미연결 상황에서 **PII(여권 이미지)를 메모리에 적재조차 하지 않는다.** `supplierLinked:false`를 반환해 FE가 "공급자 Zalo 연결 필요" 경고(조용한 무발송·임의 폴백 금지).
- **재전송 시 매핑 재조회(N2)**: 재전달 때마다 `supplierId → zaloUserId`를 **그 시점 기준으로 재조회**한다(공급자 교체·zalo 재연결 반영). 캐시된 과거 수신자로 보내지 않는다.
- **마진·재고 누수와 무관함**: 여권 이미지·게스트명·체크인일·빌라명만 발송한다. 판매가(KRW)·마진·원가(VND)·타 예약·타 빌라 재고는 payload·발송에 **일절 포함하지 않는다**(Phase 1 화이트리스트 유지). 사업원칙 2(마진 비공개)·1(재고 비공개) 위반 없음.

### D4. 동의(consent) — 제3자 전달 동의를 **체크인 완료 필수 게이트**로 (테오 결정)

- `lib/agreement.ts`(단일 소스, ko/vi/en/zh/ru)에 **신규 조항**을 추가한다 — "여권 정보·사진이 베트남 임시거주신고(tạm trú) 목적으로 빌라 현장 관리인(공급자)에게 전달됨"을 게스트가 체크인 동의서에서 명시 고지·동의.
  - 기존 `c1`("체크인 시 여권 정보 제공")은 **수집** 동의일 뿐 **제3자(공급자) 전달** 동의가 아니다 → 별도 조항 필요(개인정보 처리 고지의 핵심: 수집 ≠ 제공).
  - 5개 언어 전부 채운다(LOC 감수, ko/vi/en/zh/ru).
  - **조항 삽입은 두 곳 모두(N4)**: `buildClauseOrder`(수영장 분기 순서)와 `DEFAULT_BODY_ORDER`(108행, 인쇄·기본 본문 순서) **양쪽에 신규 조항 키를 삽입**한다. 한 곳만 넣으면 일부 경로에서 조항이 누락된다.
  - **`AGREEMENT_VERSION`을 올린다**("2026-06" → 다음 판) — 어느 판본에 동의했는지 서명 증빙에 찍히도록.
- **정책: 동의(서명)는 체크인 완료의 전제조건 — 필수 게이트(테오 결정, QA "경고 후 진행"보다 강한 정책 채택)**
  - **동의서에 서명하지 않으면 체크인 자체가 완료(CONFIRMED)되지 않는다.** 제3자 전달 동의가 포함된 동의서 서명이 **체크인 완료의 전제조건**이다.
  - **세 플로우 모두에 적용**: ① 게스트 셀프(`/g/[token]`) ② 공급자 체크인(`/my-bookings/[id]/checkin`) ③ 운영자 체크인(`/bookings/[id]/checkin`) — 어느 경로든 **동의 서명 없이는 체크인 완료 API/플로우가 통과되지 않는다**(구현 시 체크인 완료 API가 해당 booking의 현행 `AGREEMENT_VERSION` 서명 존재를 검사).
  - **함의(전달측 단순화)**: 이 게이트 덕분에 **여권 전달 시점에는 모든 체크인 완료 게스트가 이미 제3자 전달에 동의한 상태**가 보장된다. 따라서 전달 흐름(D2)에 "미동의면 막기" 분기를 둘 필요가 없다 — 체크인 완료 = 동의 완료. 미동의 전달 자체가 구조적으로 불가능해진다.
  - 단, **감사에는 전달 시점의 동의 스냅샷을 그대로 기록**한다(B2, D6) — 게이트가 있어도 "이 전달이 어느 동의 버전·서명에 근거했는지"를 사후 증빙으로 남긴다.

### D5. 최소 전달 원칙 — 여권 사진면(정보면) 1장만 (테오 확정)

- **확정: 여권 사진면(정보면, 인적사항·MRFOREIGN 면) 1장만 전달.** 전체 스캔·다중 페이지 발송은 **금지**. payload·전달 소스는 **사진면 URL 1개로 한정**한다(B3과 정합).
  - 그 예약의 투숙객에 해당하는 여권 사진면만(다른 예약 사진·추가 페이지 혼입 금지). `signatureUrl`·`paperDocUrls` 미포함(B3).
  - 텍스트 정보(이름/국적/여권번호)는 **이미지에 이미 담겨 있으므로 별도 평문 전송 최소화** — 본문은 식별용 최소(빌라명·게스트명·체크인일, Phase 1 그대로). 여권번호를 텍스트로 또 보내면 평문 PII가 Zalo 로그에 한 번 더 남는다.
  - 발송 후 본문에 "tạm trú 신고용, 신고 완료 후 삭제 권고"를 짧게 안내(공급자 측 보존 최소화 유도 — 강제는 불가, D7).
- ⚠️ 운영 메모(미결 아님): 만약 추후 신고소가 추가 면을 요구하면 **수집 단계(게스트 업로드 UX)부터** 다시 검토한다 — 이번 결정은 "사진면 1장"으로 고정.

### D6. 감사 기록 — 전달 1건마다 SecurityEvent + AuditLog (글로벌 절대 규칙)

- **데이터(여권) 이동이므로 감사 필수.** 전달 1건마다 기록:
  - **AuditLog**(`writeAuditLog`, 영구 변경 이력): 누가(actorUserId=ADMIN)·언제(`tamTruSentAt`)·어느 게스트 여권을(bookingId/checkInRecordId)·어느 공급자(supplierId/빌라)에게. **여권 URL·OCR 원문·여권번호는 기록하지 않는다**(Phase 1 원칙 유지 — 감사 로그에 PII를 재적재하지 않음).
  - **SecurityEvent**(`recordSecurityEvent`, 민감정보 이동 추적 채널): 신규 이벤트 타입 **`PII_FORWARD`** 추가. meta에 `{ bookingId, villaId, recipientSupplierId, agreementSigned, agreementVersion }`. **동의 스냅샷(B2)**: 게이트(D4)로 미동의 전달이 구조적으로 불가능해졌어도, **전달 시점의 동의 버전(`agreementVersion`)·서명 여부(`agreementSigned`) 스냅샷을 매 전달마다 기록**한다(사후 증빙). **`redactMeta`가 가로채는 민감키(token·credential·margin·price·hash…) 외에도, 여권번호·게스트 평문 PII는 애초에 meta에 넣지 않는다.**
    - `SecurityEventType`에 값 추가는 `lib/security-event.ts` 변경(additive 유니온 추가). TDA 검토 후.
- **재전송마다 SecurityEvent 1건(N3)**: 재전달은 새 PII 이동이므로 재전달할 때마다 SecurityEvent를 1건 새로 기록한다(첫 전달과 동일 구조). AuditLog도 `tamTruSentAt` 갱신과 함께 1건.

### D7. 보존/삭제 — 우리 측 정합 + 관리인 측 한계 명시

- **우리 측**: 여권 원본은 `private/passports/`에 보관. 이 전달 기능은 **새 저장본을 만들지 않는다**(Buffer를 읽어 보내고 버림 — 공개 URL·복사본 생성 0). 따라서 우리 보존 표면은 늘지 않는다.
  - **N1 정정**: 여권 90일 보존은 **수동 정책일 뿐 자동 삭제 cron은 현재 존재하지 않는다.** ADR-0029 초안의 "90일 삭제 정책 (자동)" 표현은 부정확 → "90일 보존은 수동 운영 정책, 자동 정리 미구현"으로 정정한다.
  - **OPS 후속 태스크(분리)**: `private/passports/` 90일 경과분 **자동 정리 cron**을 OPS 후속 태스크로 신설(`CRON_SECRET` 게이트, 삭제 시 AuditLog). 이 ADR(Phase 2 전달)과는 별개 작업.
  - `tamTruSentAt` 기록·AuditLog·SecurityEvent는 **메타데이터(PII 아님)** 라 분쟁 대비 장기 보존 가능(여권 이미지와 수명이 다름).
- **관리인 측(통제 불가 — 명시)**: 전달된 이미지가 관리인의 Zalo 대화·휴대폰 갤러리에 저장되는 것은 **우리가 기술적으로 통제·삭제할 수 없다.** 테오가 이 트레이드오프를 수용함(전제 3). **우리가 할 수 있는 통제는 다음으로 한정되며, 그 한계를 그대로 적는다**:
  1. **최소 전달**(D5) — 필요한 면만, 평문 PII 중복 전송 최소화.
  2. **동의 고지**(D4) — 게스트가 "관리인에게 전달됨"을 사전에 안다.
  3. **전달 로그**(D6) — 사후 누가·언제·무엇을 보냈는지 추적 가능.
  4. **삭제 권고 문구**(D5) — 신고 완료 후 삭제 권고(강제 불가).
  5. **수신자 강제**(D3) — 그 빌라 담당에게만, 오발송 차단.
  - ⚠️ 명시적 한계: 위 1~5로도 **공급자 단말의 사본은 회수 불가**. 이는 "사진 전달"이라는 비즈니스 요구에 내재한 비가역 트레이드오프이며, 본 ADR은 이를 **수용된 위험으로 문서화**한다(전제 3).
  - **N5 동의 철회 회수불가**: 게스트가 사후에 동의를 철회해도 **이미 전달돼 공급자 단말에 저장된 사본은 회수할 수 없다.** 철회는 향후 추가 전달을 막을 뿐, 과거 전달분에는 소급 효과가 없다(기술적 한계).

---

## 결과 (Consequences)

- ✅ Phase 1 텍스트 알림의 "첨부 사진을 확인하라"는 안내가 **실제 이미지 발송으로 완성**된다 — 현재의 빈 약속(본문은 첨부를 가리키나 이미지가 안 감) 해소.
- ✅ 발송 경로가 **비공개 Buffer 직접발송**이라 우리 시스템 쪽 공개 노출은 0, 90일 정책·게이트 서빙 모델 무손상.
- ✅ 수신자 강제·전용 함수 분리로 "여권을 아무 대화에나 보내는" 표면이 생기지 않는다(share 라우트 미오염).
- ✅ 동의서 조항·VERSION·감사 2채널 + **체크인 동의 필수 게이트**로 **법적 고지 + 추적성** 확보. 게이트 덕분에 전달 시점 전원 동의 보장(전달측 분기 단순화).
- ✅ 스키마 영향 **최소** — `Villa` 신규 필드 불필요(D3 SUPPLIER 확정으로 `tamTruContactZaloUserId` 폐기). 기존 `supplier.zaloUserId` 매핑만 사용.
- ⚠️ 변경 범위:
  - `SecurityEventType`에 `PII_FORWARD` 추가(유니온, additive — `lib/security-event.ts`).
  - `lib/agreement.ts` 조항 추가(`buildClauseOrder`+`DEFAULT_BODY_ORDER` 양쪽) + `AGREEMENT_VERSION` 상향 + 5개 언어(스키마 무관, 코드 변경).
  - 체크인 완료 API/플로우(게스트·공급자·운영자 3경로)에 동의 서명 검사 게이트 추가.
  - DB 스키마(테이블) 변경 없음 — `SecurityEventType`이 Prisma enum이면 그 추가만 마이그레이션 대상(TDA 전담).
- ⚠️ 공급자 단말 사본은 회수 불가 — 수용된 위험(전제 3).

## 리스크 · 완화 매트릭스

| # | 유출/사고 경로 | 영향 | 완화책 | 잔여 위험 |
|---|---|---|---|---|
| R1 | **오발송**(타 빌라 공급자·임의 zaloUserId로 여권 전송) | 타인에게 게스트 PII 노출 | D3 서버가 booking→villa→supplier로 수신자 **강제**, 클라가 zaloUserId 지정 불가, 재전송 시 매핑 재조회(N2) | 빌라-공급자 매핑 오입력 — 운영 데이터 검증으로 축소 |
| R1b | **미연결 PII 적재**(공급자 zalo 미연결인데 Buffer를 먼저 읽음) | 불필요한 PII 메모리 적재 | **B1** 수신자 연결 검증을 **파일 읽기 전 short-circuit** — 미연결이면 Buffer 미적재 | 없음(I/O 전 차단) |
| R2 | **미동의 전달**(게스트가 제3자 전달을 모른 채) | 개인정보 처리 고지 미흡 | **D4 체크인 동의 필수 게이트** — 미서명이면 체크인 완료 불가 → 전달 시점 전원 동의 보장 + 동의 스냅샷 감사(B2) | 없음(구조적으로 미동의 전달 불가) |
| R3 | **과다 전달**(전체 스캔·타 예약 사진·서명/지류 혼입·여권번호 평문 중복) | 노출면 확대 | D5 **사진면 1장만**·해당 투숙객만 + **B3** `passportPhotoUrls`로만 한정(`signatureUrl`·`paperDocUrls` 혼입 금지) | 신고소 추가면 요구 시 수집단계부터 재검토(이번 결정은 1장 고정) |
| R4 | **로그 누락**(누가 보냈는지 추적 불가) | 사고 시 원인규명 불가 | D6 AuditLog + SecurityEvent **2채널 의무**, 재전송마다 1건(N3), 동의 스냅샷(B2) | 메타만 보존(이미지·번호 미기록은 의도) |
| R5 | **공개 노출**(여권에 공개 URL 생성·CDN 유출) | 무인증 외부 접근 | D2 Buffer 직접발송·공개 URL 미생성, `savePassportFile` 비공개 디스크 유지, `saveFile` 공개경로 미사용 | 없음(설계상 공개경로 미경유) |
| R6 | **경로 주입**(passportPhotoUrls에 `..`/임의 경로·접두 위조) | 임의 파일 읽기 | **B3** 기존 `lib/passport-name.ts`(`extractUploaderId`/`fileBelongsToUploader`) 재사용·`getPassportDir()` 하위 강제·`sig-`/`doc-` 접두 거부 | 없음(화이트리스트·재구현 금지) |
| R7 | **공급자 단말 사본 잔존**(통제 불가) | 게스트 PII가 외부 단말에 영구 잔존 | D7 최소전달·동의·로그·삭제권고로 **축소만** 가능 | **수용된 위험**(전제 3) — 회수 불가 + 동의 철회 소급 불가(N5) |
| R8 | **권한 우회**(비ADMIN이 전달 트리거) | 임의 사용자가 여권 전송 | D1 라우트 첫 줄 `isOperator` 게이트 유지, 공급자 자가 push 미허용 | 없음(이번 범위 ADMIN push만) |

---

## 확정 사항 (이전 미결 5건 종결)

| 항목 | 초안 상태 | 확정 |
|---|---|---|
| (D2) 실발송 채널 | 미결(zca-js vs OA) | **zca-js 개인계정**(`sendChatImageAsAdmin`) 확정. OA는 후속. |
| (D3) 수신자 | 미결(SUPPLIER vs CLEANER) | **SUPPLIER만** 확정. CLEANER 미포함 → `Villa.tamTruContactZaloUserId` **불필요**(스키마 추가 안 함). |
| (D5) 전달 범위 | 미결(1장 vs 전체) | **사진면(정보면) 1장만** 확정. |
| (D4) 미동의 정책 | 미결(차단 vs 경고진행) | **체크인 동의 필수 게이트** — 미서명이면 체크인 완료 불가(QA 권장보다 강한 정책). |
| (D1) 공급자 자가 전달 | 범위 밖 | 이번 범위 도입 안 함(ADMIN push만). 필요 시 별도 ADR. |

## 구현 범위 (Phase 2) 체크리스트 — 조건부 승인의 잔여 조건

- [ ] **① 이미지 실발송**: `lib/tamtru.ts` 확장 — 비공개 디스크에서 사진면 1장 Buffer를 읽어 `sendChatImageAsAdmin`로 직접 발송(공개 URL 미생성). [BE]
- [ ] **② 미연결 short-circuit(B1)**: 공급자 `zaloUserId == null`이면 **Buffer 읽기 전** 중단(PII 메모리 미적재), `supplierLinked:false` 반환. [BE]
- [ ] **③ 전달 소스 한정(B3)**: `passportPhotoUrls` 사진면 1장으로만, `signatureUrl`·`paperDocUrls` 혼입 금지. 경로 가드는 기존 `lib/passport-name.ts` 재사용(재구현 금지). [BE]
- [ ] **④ SecurityEventType `PII_FORWARD` 추가**(additive 유니온 — `lib/security-event.ts`). enum이면 TDA 마이그레이션. [TDA→BE]
- [ ] **⑤ 동의서 조항 5개 언어 + VERSION**: `lib/agreement.ts` — `buildClauseOrder`+`DEFAULT_BODY_ORDER` **양쪽** 신규 조항 삽입(N4), `AGREEMENT_VERSION` 상향, ko/vi/en/zh/ru. [LOC 문구 + BE 반영]
- [ ] **⑥ 체크인 동의 필수 게이트**: 게스트(`/g`)·공급자·운영자 체크인 완료 API/플로우 3경로 모두 동의 서명 검사. [BE]
- [ ] **⑦ 감사 2채널**: 전달 1건마다 AuditLog + SecurityEvent(동의 스냅샷 B2, 재전송마다 1건 N3). [BE]
- [ ] **⑧ 90일 자동 정리 cron(N1)**: `private/passports/` 자동 정리는 **별개 OPS 후속 태스크**로 분리(이 ADR 범위 밖). [OPS]
- [ ] **⑨ QA 최종 검사**: 누수(마진·재고)·경로주입·권한·B1~B3 회귀 통과. [QA]

**담당**: BE(전달·게이트·감사) · LOC(동의서 5개 언어 문구) · TDA(`SecurityEventType` 마이그레이션 검토) · QA(누수·경로주입·권한) · OPS(⑧ cron, 별개).

> 본 ADR은 「승인(조건부)」 — 위 ①~⑨ 완료 + QA 최종 통과가 잔여 조건이다. (이 갱신은 코디네이터 경유 전달이므로, 실제 구현·머지 착수 전 사용자/QA 게이트에서 재확인한다.)
