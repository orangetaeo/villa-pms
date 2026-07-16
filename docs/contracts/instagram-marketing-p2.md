# 계약서: instagram-marketing-p2 — DM 인박스·카카오 유도, 릴스, 인사이트 (Phase 2)

- 상태: 착수 (2026-07-16)
- 선행: instagram-marketing-p1 (PR #323·#325 병합, 계정 biz.villago 연결·토큰 자동갱신 가동)
- 세션: worktree `wt/instagram-p1` 연장 사용

## 범위

### A. DM 인박스 + 카카오 유도 자동응답
1. **전제 조사 (INTEG 선행)**: 웹훅 수신에 "앱 공개(게시) 상태" 요구 — **사업자 서류 없이** 앱 게시(Live 전환)가 가능한지(개인정보처리방침 URL 등 요건) 실조사로 확정. 불가하면 대안(conversations API 폴링) 설계로 전환.
2. `InstagramMessage` 모델 (additive raw SQL): igThreadId·igSenderId·direction IN/OUT·text·attachments·igMessageId unique·receivedAt·readByAdmin (+필요 시 자동응답 발송 여부).
3. `/api/webhooks/instagram`: GET 검증(hub.challenge, IG_WEBHOOK_VERIFY_TOKEN) + POST messages 수신(서명 X-Hub-Signature-256 검증=앱 시크릿, 멱등 igMessageId).
4. **자동응답**: 스레드 첫 수신(또는 24h 무응답 후 첫 수신) 시 1회 — 카카오 채널(pf.kakao.com/_mVAfX) 유도 문구(카피 가이드 톤). 24h 응답 창 준수. 중복 발송 방지.
5. **admin DM 인박스**: /marketing/instagram 하위 탭 또는 별도 뷰 — 스레드 목록(미읽음 뱃지)·대화 뷰·답장 전송(24h 창 잔여 표시, 만료 시 발송 차단 안내)·"카카오 안내 보내기" 원클릭. /messages(Zalo) UI 패턴 재사용, 80개 limit 교훈 적용.
6. 운영자 인앱 알림: 신규 DM 수신 (IG_DM_RECEIVED, 기존 free-form 인앱 경로).

### B. 릴스 (사진 슬라이드쇼)
7. 사진 4~7장 → MP4 슬라이드쇼(1080×1920 9:16, 장당 ~2s, 페이드 전환, 무저작권 BGM 번들 1~3곡) 생성 — ffmpeg 기반. **Railway 빌드에 ffmpeg 가용성 확인 필수**(nixpacks — 불가 시 ffmpeg-static npm).
8. publish.ts REELS 지원(media_type=REELS, video_url, 폴링 타임아웃 상향) + 저녁 슬롯(20:00 KST) 초안을 주 N회 릴스로 생성하는 옵션(AppSetting IG_REELS_PER_WEEK, 기본 0=끔 — 운영자가 켜기 전 비활성).

### C. 인사이트
9. 수집 cron `/api/cron/instagram-insights`(일 1회): PUBLISHED 포스트별 media insights(reach·likes·comments·saved·shares)+계정 인사이트(팔로워·프로필 방문) 수집 저장 (TDA: InstagramPost 컬럼 additive 또는 스냅샷 테이블 — 추이 필요성 기준 판단).
10. admin 성과 뷰: 발행됨 탭 카드에 지표 뱃지 + 상단 요약(최근 7/30일 도달·팔로워 추이). 어떤 빌라·템플릿·시간대가 반응 좋은지 정렬.

## 완료 기준 (테스트 가능)
- [ ] build·tsc·lint 통과
- [ ] 웹훅: 검증 GET 200(challenge 에코)·서명 불일치 POST 401/403·정상 payload → InstagramMessage 생성 멱등(중복 igMessageId 1건)
- [ ] 자동응답: 첫 수신 스레드에만 1회 발송 로직(단위 검증), 카카오 링크 포함
- [ ] DM 인박스: 목록·대화·답장·읽음 처리, SUPPLIER 403, 24h 창 만료 시 발송 차단
- [ ] 릴스: 실사진 N장으로 MP4 생성 스모크(해상도·길이·용량<100MB), REELS 발행은 토큰으로 실호출 직전까지(실발행은 운영 판단)
- [ ] 인사이트: cron이 PUBLISHED 0건에서 안전 no-op, 지표 저장 스키마 검증
- [ ] 누수 0: DM 발신·인사이트 어디에도 원가·마진 미노출, 웹훅 로그에 PII 최소화

## 검증 방법
- QA 독립 검증 (빌드 게이트+누수+웹훅 멱등·서명 검증). 실 DM E2E는 앱 게시 상태 확보 후 실계정으로 별도.

## 수정 금지 구역
- P1과 동일 (design-audit/, docs/plans/, 루트 png, 타 세션 파일). messages/ko·vi.json 키 추가만.
