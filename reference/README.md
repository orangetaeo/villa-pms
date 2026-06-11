# reference/ — 기존 프로젝트 재사용 코드 (T0.7)

다른 레포의 코드를 **읽기 전용 참조**로 복사한 폴더. 직접 import 금지 — villa-pms에 이식할 때는
`lib/` 등으로 옮기고 `// [SHARED-MODULE] from <프로젝트> <경로>` 주석을 유지한다.
모든 파일 최상단에 동일 주석이 있음 (원본 수정 시 동기화 대상 식별용).

**시크릿**: .env·자격증명 파일은 복사하지 않음. 복사한 코드에서 하드코딩 키 발견 0건 (REDACTED 처리 0건).
주의 — Nike 원본 레포 루트의 `zalo-credentials.json`, `zalo_response.json`은 자격증명 파일이므로 절대 복사 금지.

## nike/ (원본: C:\Projects\Nike)

> **중요 (2026-06-11 갱신)**: villa-pms도 **ADR-0005에 따라 zca-js(개인 계정, QR 로그인) 방식 확정** —
> OA 계정 신청 불가로 OA API 계획 폐기. 따라서 아래 Nike zca-js 코드가 **전송 계층까지 포함한 정본**이며
> 발송·재시도·credential 관리 전부 그대로 이식 가능 (신규 작성 불필요). 상세: docs/decisions/ADR-0005-zalo-zca-js.md

| 파일 | 용도 | villa-pms 사용처 |
|---|---|---|
| `src/lib/zalo.ts` | Zalo API 래퍼 (발송·연결 상태·이미지 sharp 압축) | T3.x Zalo 알림 (lib/zalo.ts 패턴) |
| `src/lib/zalo-pool.ts` | 멀티유저 인스턴스 풀, 연결 복구, globalThis 핫리로드 생존 | T3.x 연결 관리 패턴 |
| `src/lib/zalo-credentials.ts` | credential DB 저장/로드/비활성화 | T3.x 토큰 저장 패턴 (환경변수 우선 규칙 준수) |
| `src/lib/zalo-db-store.ts` | 메시지 DB write-through + 첨부 저장 | T3.x Notification 레코드 패턴 |
| `src/lib/zalo-message-store.ts` | 인메모리 캐시 + DB 동기화 | 참고용 |
| `src/lib/zalo-alerts.ts` | 알림 발송 헬퍼 (prisma 기록 → 발송) | **T3.x 핵심** — Notification 생성→발송→SENT/FAILED 갱신 패턴 |
| `src/lib/zalo-debug.ts` | 디버그 링버퍼 (pool 의존성) | 참고용 |
| `src/app/api/zalo/route.ts` | 메시지 송수신 API (권한·rate-limit·audit log) | T3.x API 패턴 |
| `src/app/api/zalo/events/route.ts` | SSE 이벤트 스트림 | 참고용 |
| `src/app/api/cron/zalo-retry/route.ts` | **발송 실패 재시도 cron** | **T3.x 핵심** — 실패 3회 재시도 규칙 구현 시 |
| `src/lib/gemini.ts` | Gemini 호출 (번역·OCR·quota 에러 처리) | T3.x 번역 + 여권 OCR (lib/gemini.ts) |
| `src/lib/ai-utils.ts` | AI 응답 JSON 추출기 (gemini.ts 의존성) | T3.x OCR 응답 파싱 |
| `src/lib/commission-ocr-shared.ts` | OCR 프롬프트 정의 (gemini.ts 의존성) | 여권 OCR 프롬프트 설계 참고 |
| `src/app/api/ocr/route.ts` | OCR API (이미지→구조화 JSON) | T3.x 여권 OCR API |
| `src/app/api/translate/route.ts` | 텍스트 번역 API | T3.x KR↔VN 번역 |
| `src/app/api/translate-image/route.ts` | 이미지 내 텍스트 번역 | 참고용 |
| `src/app/api/gemini/route.ts` | Gemini 범용 프록시 (rate-limit) | 참고용 |

## exchange/ (원본: C:\Projects\Exchange\hwanjeoneobmu — Express + Drizzle. villa-pms는 Next.js + Prisma이므로 패턴만 이식)

| 파일 | 용도 | villa-pms 사용처 |
|---|---|---|
| `server/services/settlementService.ts` | 정산 생성·집계·확정 로직 | Phase 2 정산 (FIN, 다중 통화) |
| `server/services/trading/bithumbLedger.ts` | 원장(LEDGER) 기록·분류·upsert 패턴 | Phase 2 LEDGER 정산 패턴 |
| `shared/schema.ts` | 전체 스키마 — ledger·settlements·pushSubscriptions 테이블 정의 참고 | Phase 2 스키마 설계 |
| `server/services/webPushService.ts` | web-push 발송 + 만료 구독 정리 | Web Push 알림 (운영자용) |
| `server/routes/pushRoutes.ts` | 구독 등록/해제 API | Web Push API |
| `client/src/hooks/usePushNotification.ts` | 클라이언트 구독 훅 (권한·VAPID) | Web Push 프런트 |
| `client/public/sw.js` | 서비스워커 push/notificationclick 핸들러 | PWA + Push 통합 |

## traveldiary/ (원본: C:\Projects\traveldiary-mvp)

| 파일 | 용도 | villa-pms 사용처 |
|---|---|---|
| `lib/utils/image-compress.ts` | 클라이언트 이미지 압축 (canvas 리사이즈) | T1.x 빌라 사진 업로드 (모바일 데이터 절약) |
| `actions/photo.ts` | 사진 업로드 Server Action (감사 로그 포함) | T1.x 업로드 파이프라인 + 타임스탬프/업로더 기록 |
| `app/manifest.ts` | PWA manifest (Next.js App Router 방식) | T0.x PWA 설정 |
| `app/layout.tsx` | SW 등록 inline script (76행) + 루트 레이아웃 | PWA SW 등록 패턴 |
| `public/sw.js` | 서비스워커 (오프라인 캐시) | PWA |
| `public/offline.html` | 오프라인 폴백 페이지 | PWA |
| `next.config.js` | 보안 헤더(CSP)·CDN 캐시 헤더 | OPS 배포 보안 점검 참고 |

## 못 찾은 항목

- **Nike Zalo OA(Official Account) REST API 코드** — Nike에는 zca-js 개인 계정 연동만 존재. OA API 코드는 없음 (위 주의 참고)
- **Nike Zalo webhook(OA 이벤트 수신) 처리** — OA webhook 핸들러 없음. `api/zalo/events`는 내부 SSE 스트림임
