# 계약서: youtube-shorts-s1 — 유튜브 쇼츠 콘텐츠 1(빌라 정보 숏츠) + 자동 업로드 기반

- 상태: 착수 (2026-07-16)
- 기획 정본: docs/marketing/youtube-shorts-plan.md (v1)
- 선행 자산: 인스타 P1/P2 (릴스 빌더 lib/instagram/reels.ts·승인 큐 UX·lib/secret-crypto·copy-guide/hashtags)
- 세션: worktree `wt/instagram-p1` 연장

## 범위 (S1 — 콘텐츠 2 자동 편집·Analytics는 S2 별도)

1. **INTEG 실조사+가이드**: API 감사(audit) 최신 정책·미감사 업로드 비공개 강제 여부·OAuth 동의화면 프로덕션 게시 요건 실조사 → docs/marketing/youtube-setup.md (테오용: 채널 생성→GCP→OAuth 클라이언트→동의화면 프로덕션 게시→앱 연결→감사 신청). 조사 결과가 기획과 다르면 기획서 반영.
2. **OAuth 연동**: /api/youtube/oauth/start(동의 URL 리다이렉트)+callback(code→refresh token 교환, AppSetting YT_REFRESH_TOKEN 암호화 저장) — admin에서 버튼 클릭으로 연결. YT_CLIENT_ID·YT_CLIENT_SECRET(암호화)은 설정 패널 입력. access token 캐시·자동 리프레시.
3. **TDA 스키마**: `YoutubeShort` 모델 (InstagramPost 패턴: status 동일 7종, videoUrl, posterUrl, title, description, tags Json, ytVideoId?, ytPrivacyStatus?, scheduledAt, failReason, flaggedTerms, villaId? SetNull, instagramPostId? — 동일 콘텐츠 연결, createdBy). additive raw SQL 라이브 적용+보존.
4. **BE 콘텐츠 1 파이프라인**:
   - lib/youtube/meta.ts: Gemini+카피 사전으로 제목(≤100자)·설명(카카오 텍스트+해시태그)·태그 생성, 금칙어 가드 재사용.
   - draft 확장: 기존 instagram-draft cron에서 `YT_SHORTS_PER_DAY`(기본 0=끔) ≥1이면 빌라 로테이션으로 릴스 빌더 호출(엔딩 CTA=유튜브 버전 "카카오톡 채널 '빌라고' 검색" 분기) → YoutubeShort PENDING_APPROVAL 생성. 0이면 기존 동작 완전 동일.
   - lib/youtube/upload.ts: videos.insert resumable 업로드(R2 영상 스트림), privacyStatus=AppSetting YT_PRIVACY_STATUS(기본 "unlisted" — 감사 전 안전값), Shorts 자동 판정(9:16·≤60s)이므로 별도 플래그 불요. 쿼터 가드(일 업로드 카운터, 기본 상한 6).
   - cron /api/cron/youtube-publish: QUEUED→PUBLISHING 락→업로드→PUBLISHED(ytVideoId·URL)/FAILED+경보. 킬스위치 YT_AUTOPOST_PAUSED(기본 "1"=정지 상태로 시작).
5. **admin API+FE**: /marketing/instagram 패턴 재사용 — /marketing/youtube (큐·편집(제목/설명/시간)·승인/반려·이력) + 설정 패널(클라이언트 ID/시크릿·OAuth 연결 버튼·연결 상태·privacyStatus·킬스위치·일 업로드 상한). posts API 5종 대칭(isOperator, PUT 설정=isSystemAdmin). 사이드바 marketing 그룹에 "유튜브" 추가. NS adminYoutube(ko/vi).

## 완료 기준
- [ ] build·tsc·lint 통과
- [ ] YT_SHORTS_PER_DAY=0(기본)일 때 기존 instagram-draft 동작과 완전 동일(diff 검증)
- [ ] 업로드 클라이언트: 토큰 미설정 시 안전 실패(FAILED+사유)·킬스위치 스킵·쿼터 상한 가드 — 단위 검증
- [ ] OAuth callback: state 검증(CSRF)·refresh token 암호화 저장·응답에 토큰 미노출
- [ ] admin 큐: SUPPLIER 403, 승인/반려 상태 가드 대칭, 금칙어 플래그 표시
- [ ] 메타 생성: 제목 100자 제한·금칙어 가드 동작·설명에 확정가 박제 없음
- [ ] 누수 0: 원가·마진·시크릿(클라이언트 시크릿·refresh token) 어떤 응답·로그에도 미노출
- 실 업로드 E2E는 테오 채널·OAuth 연결 후 별도(범위 밖). cron 등록도 채널 연결 후.

## 검증
- QA 독립 검증 (작성자 자기평가 무효): 빌드 게이트+체크리스트+누수 grep.

## 수정 금지 구역
- 이전과 동일 + lib/instagram/*는 draft cron 확장·릴스 CTA 분기 등 계약 명시분만 additive 수정.
