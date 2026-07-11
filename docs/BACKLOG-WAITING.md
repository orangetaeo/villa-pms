# BACKLOG-WAITING.md — 오픈까지 남은 일 · 외부/테오님 액션 대기 트래커

> 작성 2026-06-25. **목적**: 코드가 아니라 "테오님 액션·외부 활성화·자원" 때문에 멈춰 있는 항목을
> 한곳에 모아 오픈까지 남은 일을 한눈에 본다. 상세 근거는 각 링크(LAUNCH.md·TASKS.md·계약서) 참조.
> **이 문서는 상태 요약이다 — 진실의 원천은 TASKS.md / docs/LAUNCH.md.** 변동 시 함께 갱신.

---

## A. 오픈 직접 차단요인 (이것만 끝나면 공개 가능)

근거: docs/LAUNCH.md §6.6 (2026-06-23 갱신).

| # | 항목 | 남은 일 (테오님) | 준비물 |
|---|---|---|---|
| A1 | **베트남 사용자 1명 실사용 테스트 (T4.4)** | 사용자 1명 섭외 → 설명 없이 빌라 등록·캘린더 토글 관찰 | 키트 완료: `docs/T4.4-pilot-test-kit.md` |
| A2 | ~~**공개 직전 테스트 데이터 삭제**~~ ✅완료 2026-07-09 | ~~파일럿(A1) 완료 후 실행~~ **실데이터 전환 시 테스트 시드 3,526행 purge 완료**([[real-data-transition-2026-07-09]]). 실데이터 입력 개시. 파일럿(A1) 시 신규 테스트 데이터 생기면 재청소 | 스크립트: `npx tsx scripts/cleanup-test-data.ts` |

> ✅ 이미 완료된 차단요인: Zalo QR 로그인(시스템봇 연결), 파일럿 시드 프로덕션 실행, ~~테스트 데이터 purge(A2, 2026-07-09)~~.
> **실질 잔여 차단 = A1 하나.**

---

## B. Zalo 라이브 실연결·실송수신 검증 (코드 완료, 실동작 확인 대기)

QR 로그인은 완료. **아래 B1~B4 전부 실측 완료(2026-07-09) — 실 송수신 검증됨.**

| # | 항목 | 상태 | 계약/근거 |
|---|---|---|---|
| B1 | ~~F5 알림 실발송 1회 + /messages 실수신 검증~~ | ✅완료 2026-07-09 — 발신봇 Taeo·수신 김태진/DK 실측([[real-data-transition-2026-07-09]]·[[zalo-notify-enrichment-2026-07-09]]) | TASKS T3.5b·T6.6 |
| B2 | ~~notifications cron Railway 등록~~ | ✅완료 — `cron-notifications`(*/5) 가동 중(deployment-pattern.md 7종 cron) | TASKS T3.5 잔여 ②, LAUNCH §6.2 |
| B3 | ~~T3.7 수신 webhook·전화번호 자동 매칭 실연결~~ | ✅완료 — 자동매칭 SUPPLIER·CLEANER·VENDOR·PARTNER 체계 완결([[zalo-connect-qr-admin-setting]]) | `docs/contracts/T6.6-T3.7-zalo-screens.md` |
| B4 | ~~여권 이미지 실발송 (T3.5b S5)~~ | ✅완료 — 여권 사진면 실발송(PR #110·[[passport-zalo-forward-and-image-compression]]) | TASKS T3.5b |

---

## C. 테오님 실행 대기 (코드·QA 완료, env/DB 실행만)

| # | 항목 | 남은 일 | 준비물·계약 |
|---|---|---|---|
| C1 | **S3 ETL** — Nike→villa 과거 대화·첨부 재업로드 | `--dry-run` → 본실행 → 멱등 재실행 | env `NIKE_DATABASE_URL`·`NIKE_THEO_USER_ID`·`STORAGE_*` + `npm i -D tsx`. `scripts/etl-nike-zalo.ts`. 계약 `zalo-integration-s3.md` |
| C2 | **S4 그룹 ETL 실행 + Nike B6** | ETL 실행(env 동일) / Nike 레포에서 테오 그룹 스레드 읽기·발신자 표시 | 코드·배포 완료. 계약 `zalo-integration-s4.md` |
| C3 | **S5 forward/alias/음성STT 배포 후 실측** | 배포 후 forward·alias·voice STT 실동작 확인 | 코드·QA 통과. 계약 `zalo-integration-s5.md` |

---

## D. 코드 가능하나 현재 다른 세션 영역 (충돌 회피)

| # | 항목 | 비고 |
|---|---|---|
| D1 | ~~운영자 통계 화면 구현~~ ✅완료 | 관리자 통계(탭4종+미니바) 및 공급자 /earnings 통계 배포 완료([[admin-statistics-status]]·[[supplier-statistics-status]]) |
| D2 | T7.2 잔여 — 시스템 미러 귀속(S4)·끊김 경보(S6) | zalo 영역. ADR-0032 워커 분리 배포됨. 잔여 경보·미러 귀속 확인 |
| D3 | T8.3 멀티디바이스 버그 QA 재검증 | 수정·배포됨(bd4af1c), 정식 QA 잔여. zalo 영역 |

---

## E. 자원 미확보

| # | 항목 | 비고 |
|---|---|---|
| E1 | 러시아어 원어민 최종 감수 | 1차 품질 감수는 반영됨(2026-06-25). 원어민 감수 자원 미확보 |

---

## F. Phase 2 — 보류 (메모리 phase2-on-hold)

Phase 1 수정·보안 우선. 아래는 스키마엔 반영, UI/로직은 대기.

- 정산 페이지 다중 통화 수납 + VND 지급 + 환차 기록 (환전 LEDGER 패턴) — TASKS 118
- 월 정산서 PDF (vi) 자동 생성 — TASKS 119
- 품질점수 로직 + 판매 후순위 정렬 — TASKS 120
- 부가서비스(ServiceOrder) 판매 UI — **BE 완료**(lib/service-order.ts, API, QA 통과), **Stitch 디자인 선행 필요**(예약 상세 서비스 패널) — TASKS 121
- 시즌 요율 환율 자동 갱신 — TASKS 122
- TravelDiary 연계 직판 — TASKS 123

---

### 갱신 규칙
- 항목이 풀리면(테오님 완료) 해당 행을 ~~취소선~~ 또는 제거하고 TASKS.md·LAUNCH.md도 함께 갱신.
- 새 "대기" 항목이 생기면 적절한 구획(A~F)에 추가.
