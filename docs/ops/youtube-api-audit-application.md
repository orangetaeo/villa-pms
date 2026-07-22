# YouTube Data API — Compliance Audit 신청서 초안 (테오 P0)

> 목적: 미감사 API 프로젝트로 업로드한 영상이 "비공개"로 잠기는 제한을 해제 → 자동 공개 발행.
> 신청 폼: https://support.google.com/youtube/contact/yt_api_form
> ("Audit and Quota Extension" 유형 선택)

## 채우기 전 확인값
- **API 프로젝트 번호**: `188834001539` (YT_CLIENT_ID 앞부분)
- **채널**: @villago.phuquoc — "빌라고 푸꾸옥 Villa GO"
- **연락 이메일**: (채널·Cloud 프로젝트를 소유한 Google 계정 이메일)
- **회사/앱**: Villa GO (villa-go.net)

---

## 폼 답변 (영문 — 그대로 붙여넣기)

**1. Describe your API client and its core functionality.**

Villa GO (villa-go.net) is an internal property-management platform (PMS) for private pool villas in Phú Quốc, Vietnam. Our marketing module automatically produces short vertical promotional videos from photographs of the villas we manage and uploads them to our own YouTube channel, @villago.phuquoc. The API client is a server-side backend authorized against a single channel — our own business channel. It is not a public-facing application and does not serve YouTube data to any third-party end users.

**2. Which YouTube Data API methods do you call, and why?**

- `videos.insert` — the primary method. We upload our own promotional Shorts (vertical, 60 seconds or less, created from our own licensed villa photos with royalty-free CC0 background music) to our own channel, approximately one video per day.
- `channels.list` (mine=true) — occasionally, to confirm the connected channel and locate its uploads playlist for health checks.

We do not use search, comments, subscriptions, or any method that reads other creators' content. We do no data mining.

**3. How do you store, display, or share YouTube data?**

We do not display or share YouTube data with any end users. After a successful upload we store only the returned video ID and privacy status in our own database, solely to record which of our promotional videos have been published and to prevent duplicate uploads. We do not retrieve, cache, or display any other users' YouTube content.

**4. Authorization / access model.**

OAuth 2.0. Only the business owner (the owner of channel @villago.phuquoc) authorizes the application, one time, through the standard Google consent screen. The resulting refresh token is stored encrypted (AES-256-GCM) and used server-side only, exclusively to upload to that single channel. No third-party users connect their own channels.

**5. Compliance.**

We upload only our own original promotional content to our own channel. We comply with the YouTube API Services Terms of Service and the Developer Policies. Uploaded videos are flagged "not made for kids," categorized as Travel & Events, and contain only our own villa imagery and CC0-licensed (public domain) audio. There is no advertising, redirection, or third-party monetization through the API client.

---

## 데모 화면 녹화 시나리오 (Google이 요구 시)

Google 심사자가 앱 작동을 보려 할 수 있음. 아래 순서로 화면 녹화(2~3분):

1. **연결**: 관리자 로그인 → `/marketing/youtube` → "유튜브 연결" 버튼 → Google 동의화면(OAuth) 승인 → 연결됨 표시.
2. **생성**: 승인 대기 큐에 자동 생성된 쇼츠 1건(우리 빌라 사진 + 자막 + CC0 음악)을 보여줌.
3. **업로드**: 그 쇼츠 "승인" → 발행 → @villago.phuquoc 채널의 YouTube Studio 콘텐츠에 **API로 업로드된 영상**이 나타나는 것 확인.
4. **기록**: 우리 시스템(admin)에 그 영상 ID가 저장돼 중복 방지에 쓰이는 것 간단히 언급.

핵심 메시지: "우리 채널에, 우리 콘텐츠만, 자동 업로드. 남의 데이터는 안 씀."

## 심사 기간·주의
- Google 수동 심사, **정해진 기한 없음(수일~수주).** 미리 신청 권장.
- 감사 통과 전까지: 자동 업로드는 비공개로 잠기므로 수동 공개 필요(또는 대기).
- 감사 통과 후: `YT_PRIVACY_STATUS=public` 그대로 → 자동 공개 발행.
