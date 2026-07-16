# 계약서: marketing-s2 — 직접 촬영 자동 편집·유튜브 성과·마케팅 잔여 일괄

- 상태: 착수 (2026-07-16)
- 선행: instagram-marketing-p1/p2 (PR #323~#329), youtube-shorts-s1 (PR #333) — 전부 병합·가동
- 기획: docs/marketing/youtube-shorts-plan.md §3(콘텐츠 2)·§4(성과)
- 세션: worktree `wt/marketing-s2`

## 범위 (4묶음)

### A. 직접 촬영 클립 자동 편집 (유튜브 콘텐츠 2 — 핵심)
1. **클립 업로드**: R2 presigned PUT 직업로드 API(서버 경유 금지, 클립당 ≤500MB·mp4/mov 화이트리스트) + 업로드 세션 관리.
2. **자동 편집 파이프라인** lib/youtube/edit.ts (ffmpeg-static 재사용): 클립 N개(1~8) → ① 9:16 정규화(세로=스케일, 가로=중앙 크롭 기본·블러 패딩 옵션, 1080×1920·30fps 통일) ② 클립별 구간(기본 앞 2~6s, 관리자 조정값) ③ 크로스페이드 연결 ④ villa-go 로고 워터마크(우상단 반투명 PNG) ⑤ 인트로 타이틀 오버레이(빌라명+헤드라인, satori 재사용)·아웃트로 CTA 카드(기존 reel cta) ⑥ 구간 자막(텍스트+시간, drawtext 또는 satori PNG overlay) ⑦ BGM(기존 silent/ambient) → 총 15~60s MP4 → R2.
3. **비동기 잡**: 편집은 요청-즉시 아닌 잡 큐 — YoutubeShort(sourceType=UPLOADED, status DRAFT)에 editJobStatus(PENDING/PROCESSING/DONE/FAILED) additive 컬럼 or Json 파라미터 저장, 처리 트리거는 ① 전용 cron(1~5분 간격은 과함 — publish cron에 편승 or /api/youtube/edit-jobs/run 수동+cron 15분) TDA·BE 판단 ② 완료 시 인앱 알림. Railway 임시디스크·메모리 확인.
4. **편집 조정 UI** (/marketing/youtube 내): 클립 업로드(진행률)·순서 드래그·구간(시작/길이)·자막 텍스트 입력·헤드라인 선택 → "편집 실행" → 완료 시 미리보기 → 기존 승인 큐 합류(제목·설명은 meta.ts 재사용+수정 가능).

### B. 유튜브 성과 수집 + 통합 성과 뷰
5. 수집: **Data API videos.list part=statistics**(viewCount·likeCount·commentCount — 추가 OAuth scope 불요, 1유닛) — Analytics API(시청시간)는 scope 재동의 필요라 **이번 범위 제외**(문서에 명시). 기존 instagram-insights cron에 유튜브 블록 additive(또는 별도 cron — 판단) → InstagramInsightSnapshot scope 확장(YT_MEDIA — TDA: enum 추가 or 별도 판단) + YoutubeShort 캐시 컬럼(latestViews 등 additive).
6. 뷰: /marketing/youtube 발행됨 탭에 조회수·좋아요 뱃지 + 요약 스트립. (인스타 화면과 대칭 — 통합 대시보드는 범위 밖.)

### C. /privacy 개인정보처리방침 페이지
7. 공개 라우트 /privacy (비로그인, ko 기본 + en·vi 전환) — 수집 항목(계정·예약·여권 등 실제 서비스 기준)·이용 목적·보관·제3자 제공(Zalo·Meta·Google)·문의처. LOC 감수. 푸터의 빈 링크(#) 연결. ★법적 확정본 아님 — 페이지 상단에 시행일 표기, 추후 법무 검토 시 갱신 전제.

### D. 마케팅 알림 Zalo 푸시화
8. NotificationType enum **MARKETING_ALERT 1종 additive**(세부는 payload 분기 — 기존 교훈 "타입 재사용+payload") + zalo dispatch switch case + GROUP_ROUTED_TYPES 등재 → IG_DRAFTS_READY·IG_PUBLISH_FAILED·YT_PUBLISH_FAILED·YT_TOKEN(갱신실패)·편집 잡 완료가 인앱+Zalo 그룹으로. 킬스위치(운영자 알림 기존 게이트) 준수.

### E. 정보바 SVG 아이콘 (소형)
9. bed/guests/beach 모노크롬 SVG 3종 → templates.ts info 아이콘 슬롯 교체(DESIGN 인계분 마감). 렌더 스모크 재확인.

## 완료 기준
- [ ] build·tsc·lint 통과 + 기존 테스트 회귀 0
- [ ] 편집 파이프라인 스모크: 임의 클립 2~3개(가로+세로 혼합)로 15~60s 1080×1920 H.264+AAC 산출, 로고·인트로·자막 육안 확인
- [ ] presigned 업로드: 화이트리스트 외 확장자·크기 초과 400, 비로그인 401
- [ ] 잡 상태 머신: PENDING→PROCESSING 락(중복 실행 방지)→DONE/FAILED+경보
- [ ] 성과 수집: 발행 0건 no-op·통계 필드 저장·뱃지 표시
- [ ] /privacy: 3언어 렌더·비로그인 200·푸터 링크 연결
- [ ] Zalo 푸시: enum additive 적용·exhaustive switch 통과·그룹 라우팅 등재·기존 알림 회귀 0
- [ ] 누수 0 (편집·자막 입력 경로 포함) + AuditLog 커버리지

## 검증
QA 독립 검증 (빌드 게이트+체크리스트+회귀). 실 편집 E2E는 실촬영 클립 확보 후 별도.

## 수정 금지 구역
타 세션 파일 일체. messages/*.json 키 추가만. lib/instagram/* 는 D·E 계약 명시분만 additive.
