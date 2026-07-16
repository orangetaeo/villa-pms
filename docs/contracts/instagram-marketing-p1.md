# 계약서: instagram-marketing-p1 — 인스타그램 자동 포스팅 파이프라인 (Phase 1)

- 상태: 착수 (2026-07-16)
- 기획 정본: docs/marketing/instagram-marketing-plan.md (v1.1)
- 세션: worktree `wt/instagram-p1` 격리 작업

## 범위 (Phase 1 — DM 인박스는 Phase 2 별도 계약)

1. **DB 모델 (additive raw SQL)**: `InstagramPost` + enum `IgPostKind`/`IgPostStatus`. AppSetting 키: `IG_ACCESS_TOKEN`(암호화)·`IG_USER_ID`·`IG_AUTOPOST_PAUSED`. ※ InstagramMessage는 Phase 2로 이월.
2. **렌더 파이프라인** `lib/instagram/render.ts`: VillaPhoto → sharp 1080×1350 → satori 한글 오버레이(템플릿 4종: 커버/정보바/서비스/CTA) → JPEG → R2 `instagram-renders/` 공개 업로드.
3. **발행 클라이언트** `lib/instagram/publish.ts`: Graph API 캐러셀 컨테이너 생성→폴링→publish, 토큰 AES-256-GCM(AppSetting), 킬스위치 게이트, 실패 시 Zalo 경보.
4. **콘텐츠 생성 cron** `/api/cron/instagram-draft`: 빌라 로테이션 선정 → 사진 선별 → 렌더 → Gemini 캡션(카피 가이드+해시태그 사전 주입, 금칙어 가드) → InstagramPost(PENDING_APPROVAL) 일 3건 + 운영자 Zalo 알림.
5. **발행 cron** `/api/cron/instagram-publish`: QUEUED 중 시간 도래분 발행(07:30/12:30/20:00 KST 슬롯), PUBLISHED/FAILED 전이 + AuditLog.
6. **admin 콘텐츠 큐** `/marketing/instagram` (ko/다크): 초안 카드(렌더 미리보기)·캡션 편집·승인/반려·발행 이력(permalink). 새 NS → ADMIN_CLIENT_NAMESPACES + ko/vi 동시.
7. **카피 체계**: `.claude/agents/copy.md` 신설 + `docs/marketing/copy-guide.md`·`docs/marketing/hashtags.md` 초판.
8. **디자인**: Stitch 템플릿 시안 → `design/stitch/instagram-templates/` (flexbox 제약 명시).
9. **테오 가이드**: `docs/marketing/instagram-account-setup.md` — 계정 생성→프로페셔널 전환→개발자 앱→테스터 등록→토큰 (사업자 서류 불요 경로).

## 완료 기준 (테스트 가능)

- [ ] `next build` 통과 + lint/typecheck 통과
- [ ] 렌더: 실제 VillaPhoto 1건으로 1080×1350 JPEG 4:5 산출물 생성 확인 (한글 폰트 깨짐 없음)
- [ ] 초안 cron 드라이런: InstagramPost 3건 PENDING_APPROVAL 생성 + 캡션에 해시태그 계층 배합 + 금칙어 가드 동작(위반 문구 주입 시 플래그)
- [ ] 발행 클라이언트: 토큰 미설정 시 안전 실패(FAILED+사유), 킬스위치 "1"이면 발행 스킵
- [ ] admin 큐: 미리보기·편집·승인·반려 동작, SUPPLIER 접근 403
- [ ] 권한 누수 0: 공급자 원가·마진 어떤 경로에도 미노출 (캡션 생성 프롬프트 입력 데이터 포함)

## 검증 방법
- QA 독립 검증 (작성자 자기평가 무효): 빌드 게이트 + 위 기준 체크리스트 + 누수 grep
- 실 발행 E2E는 테오의 IG 계정·토큰 준비 후 별도 수행 (이 계약 범위 밖 — 토큰 없이 검증 가능한 데까지)

## 수정 금지 구역 (다른 세션 보호)
- `design-audit/`, `docs/plans/`, `scripts/prod-launch-data-wipe.ts`, `scripts/seed-demo-v25-bookings.ts`, 루트 png 파일들 — 절대 건드리지 않음
- 공유 파일: `messages/ko.json`·`vi.json` 키 추가만, `prisma/schema.prisma` additive만(raw SQL 규약)
