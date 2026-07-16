# 인스타그램 DM 자동응답 — 설정 가이드 & 실현 가능성 조사 (테오용)

> 작성: INTEG (2026-07-16). 대상: 비개발자(테오). 계약서 `docs/contracts/instagram-marketing-p2.md` §A.
> 결론 한 줄: **개발/테스트는 지금 서류 없이 가능. 하지만 "실제 고객"의 DM을 받아 자동응답하려면
> 앱을 Live(공개)로 전환 + 메시지 권한 심사(App Review)가 필요하고, 이 심사는 사실상 사업자 인증(Business Verification)을 요구한다.**

---

## 1. 핵심 결론 (먼저 읽으세요)

인스타그램 DM은 **"앱이 어떤 모드냐"**에 따라 받을 수 있는 범위가 다릅니다.

| 모드 | 누구의 DM을 받나 | 사업자 서류 | 지금 가능? |
|---|---|---|---|
| **개발(Development) 모드** — 지금 상태 | **앱에 "테스터"로 등록한 계정**의 DM만 (테오 개인 계정 등, 최대 25명) | 불필요 | ✅ **바로 가능** |
| **공개(Live) 모드** | **아무 일반 사용자**(실제 한국 여행객)의 DM | 사실상 필요 | ⚠️ 심사·인증 후 |

즉,
- **지금 당장** 웹훅·자동응답·인박스를 **테오 본인 계정으로 끝까지 테스트**할 수 있습니다(서류 0). → 개발/시연용으로 충분.
- **실제 고객**이 `biz.villago`에 보낸 DM이 우리 시스템으로 들어오게 하려면, 아래 3가지가 모두 필요합니다:
  1. 앱을 **Live(공개)로 전환** — 이때 **개인정보처리방침 URL**이 반드시 있어야 함.
  2. **`instagram_business_manage_messages` 권한을 App Review(앱 심사)로 승인** 받기.
  3. 그 심사가 **Business Verification(사업자 인증)**을 요구 — 여기서 **사업자 등록증 등 서류**가 걸림.

> ★ 핵심 리스크: **사업자 서류 없이 실제 고객 DM 자동응답을 켜는 것은 현재 정책상 어렵습니다.**
> 개발 모드(테스터 한정)까지는 서류 없이 가능하지만, 그 이상은 서류가 관문입니다.

---

## 2. "폴링(주기 조회)으로 우회하면?" — 안 됩니다 (플랜 B 검토 결과)

웹훅 대신 **conversations API를 주기적으로 조회**(폴링)하는 방식도 검토했습니다. 결론:

- 폴링도 **똑같이 `instagram_business_manage_messages` 권한**이 필요합니다.
- 이 권한을 **일반 사용자 대상으로** 쓰려면 **동일하게 App Review + 사업자 인증**을 거쳐야 합니다.
- 즉 폴링은 "**전달 방식**만 다를 뿐(밀어주기 vs 끌어오기)", **권한 관문을 우회하지 못합니다.** 플랜 B로서의 의미가 없습니다.

**진짜 대안(서류가 없을 때):**
- (A) **개발 모드 + 테스터 한정**으로 내부 시연/QA만 진행 — 코드는 그대로 두고, 서류가 준비되면 스위치만 켜기.
- (B) **실제 고객 대응은 당분간 인스타그램 앱에서 수동으로** 확인하고, 인스타그램 앱 자체의
  **"자주 묻는 질문(Ice Breakers)" · "인사말/자리비움 자동 메시지"** 기능으로 카카오 유도. (API 없이 앱에서 설정)
- (C) 사업자 서류가 확보되면 (App Review + Business Verification) 진행 → 우리 자동응답 시스템 Live.

---

## 3. 개인정보처리방침(Privacy Policy) URL — 지금 없음, 만들어야 함

앱을 Live로 전환하려면 Meta가 **공개된 개인정보처리방침 URL**을 요구합니다.

- **현재 `villa-go.net`에는 개인정보처리방침 페이지가 없습니다** (사이트 하단 링크가 빈 링크 `#`로 연결됨 — 확인함).
- 따라서 Live 전환 전에 **`https://villa-go.net/privacy` 같은 공개 페이지를 먼저 만들어야** 합니다. (FE/LOC 태스크로 분리 필요 — 이 태스크 범위 밖)
- 개인정보처리방침 페이지 자체는 **사업자 서류와 무관**하게 만들 수 있습니다(문서만 게시). 하지만 위 §1의 사업자 인증은 별개 관문입니다.

---

## 4. 테오가 Meta 개발자 콘솔에서 할 일 (단계별)

> 아래는 **개발 모드에서 테스트를 시작**하기 위한 최소 절차입니다. (실제 고객 오픈은 §1·§5 참고)

### 4-1. 웹훅 콜백 URL·검증 토큰 등록
1. [developers.facebook.com](https://developers.facebook.com) → 우리 앱 선택.
2. 왼쪽 메뉴 **Instagram → API setup with Instagram login** (또는 **Webhooks**) 로 이동.
3. **Callback URL(콜백 URL)** 칸에 아래를 입력:
   ```
   https://villa-go.net/api/webhooks/instagram
   ```
4. **Verify Token(검증 토큰)** 칸에는, 우리 시스템 설정에 저장해 둔 **`IG_WEBHOOK_VERIFY_TOKEN`** 값과 **똑같은 문자열**을 입력.
   - 이 값은 아무 문자열이나 정해서 양쪽(우리 DB의 AppSetting `IG_WEBHOOK_VERIFY_TOKEN` + Meta 콘솔)에 **동일하게** 넣으면 됩니다. (대소문자 구분)
   - 우리 DB에 넣는 건 개발자(운영자 설정 화면 또는 OPS)가 처리. 콘솔엔 그 값을 그대로 복사.
5. **[Verify and Save]** 클릭 → 초록색으로 확인되면 성공(우리 서버가 challenge를 되돌려줌).

### 4-2. `messages` 필드 구독
1. 같은 Webhooks 화면에서 구독할 **필드(Fields)** 목록 중 **`messages`** 항목을 **Subscribe(구독)** 로 켜기.
   - (선택) `messaging_postback` 도 켜면 Ice Breakers 버튼 클릭도 들어옵니다.
2. Instagram 계정(`biz.villago`)이 이 앱에 연결되어 있어야 하고, 계정 구독도 활성화되어 있어야 합니다(P1에서 연결됨).

### 4-3. (지금 단계) 테스터 추가 — 서류 없이 실제 흐름 테스트
1. 앱 대시보드 **App roles → Roles(역할)** 에서, **테스트용 인스타 계정을 가진 사람**(테오 개인 계정 등)을 **Tester(테스터)** 로 추가.
2. 그 사람이 초대를 수락하면, **그 계정에서 `biz.villago`로 DM**을 보내보세요.
3. 우리 시스템에 DM이 들어오고(운영자 알림), **카카오 유도 자동응답이 1회** 나가면 정상.

### 4-4. (실제 고객 오픈 단계) 앱 게시 스위치 = Live 전환
1. 대시보드 상단의 **App Mode** 토글을 **In development → Live** 로 전환.
   - 전환 전 요구사항: **개인정보처리방침 URL**(§3), **Data Use Checkup** 완료.
2. **App Review → Permissions and Features** 에서 **`instagram_business_manage_messages`** 를 **Advanced Access** 로 신청.
   - 신청 화면에 표시되는 **요구사항(Business Verification 등)**을 그대로 따라야 하며, 여기서 **사업자 인증/서류**가 요구됩니다.
   - 심사에는 보통 **사용 시나리오 설명 + 화면 녹화 영상**이 필요합니다.

> 확인 위치: App Dashboard → **App Review → Permissions and Features** → `instagram_business_manage_messages` 옆의
> **"requirements(요구사항)"** 를 눌러 현재 시점의 정확한 조건(사업자 인증 필요 여부)을 확인하세요. Meta 정책은 수시로 바뀝니다.

---

## 5. 우리 시스템에 저장해야 할 설정값 (개발자/OPS 몫)

| AppSetting 키 | 값 | 비고 |
|---|---|---|
| `IG_WEBHOOK_VERIFY_TOKEN` | 아무 문자열(콘솔과 동일) | 웹훅 GET 검증용. 평문 저장. |
| `IG_APP_SECRET` | Meta 앱 **App Secret** | X-Hub-Signature-256 서명 검증용. **암호화 저장**(우리 시스템이 자동 암호화). |
| `IG_DM_AUTOREPLY_TEXT` | (선택) 자동응답 문구 | 미설정 시 코드 내장 기본 문구(카카오 채널 유도). |
| `IG_DM_AUTOREPLY_PAUSED` | `1` = 자동응답 정지 | 킬스위치. 자동응답만 멈춤(수신·인박스는 계속). |

> 앱 토큰(`IG_ACCESS_TOKEN`)·계정 id(`IG_USER_ID`)는 P1에서 이미 저장·자동갱신 가동 중.

---

## 6. 한눈에 보는 실행 순서

1. **[지금]** DB에 `IG_WEBHOOK_VERIFY_TOKEN`·`IG_APP_SECRET` 저장 → 콘솔에 콜백 URL·검증 토큰 입력 → `messages` 구독.
2. **[지금]** 테오 계정을 **테스터**로 추가 → 본인 계정으로 DM 보내 **전체 흐름 검증**(수신·알림·자동응답·인박스 답장).
3. **[오픈 준비]** `villa-go.net/privacy` 개인정보처리방침 페이지 제작(FE/LOC).
4. **[오픈]** 앱 **Live 전환** + `instagram_business_manage_messages` **App Review**(+ 사업자 인증) 통과.
5. **[오픈 후]** 실제 고객 DM 자동응답 가동. Ice Breakers 3종은 `scripts/setup-ig-ice-breakers.ts --confirm` 로 적용.

---

## 출처 (2026-07 기준, Meta 공식 문서)

- [Instagram Platform — Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)
- [Send Messages (Instagram API with Instagram Login)](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/)
- [Instagram Platform — App Review](https://developers.facebook.com/docs/instagram-platform/app-review/)

> 정책·요구사항은 Meta가 수시 변경합니다. 실제 오픈 직전 App Review 화면의 최신 요구사항을 반드시 재확인하세요.
