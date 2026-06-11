# ADR-0005: Zalo 알림 — OA API → zca-js(개인 계정) 전환

날짜: 2026-06-11
상태: 승인 (테오 확정, TDA)
관련: T3.5(발송), T3.6(여권 전달), T3.7(온보딩), T6.6(채팅), b14 디자인, reference/nike/, CLAUDE.md 기술 스택·환경 변수

## 맥락

- 원계획은 Zalo **공식 OA(Official Account) API**(`openapi.zalo.me`)로 공급자 알림을 발송하는 것이었음 (CLAUDE.md 기술 스택 명시)
- 그러나 **테오가 Zalo OA 계정 신청이 불가한 상황** — OA 개설은 베트남 사업자 인증 등 요건이 있어 현실적으로 진행 불가
- Nike 프로젝트에 **zca-js(비공식 라이브러리, 개인 Zalo 계정 + QR 로그인)** 기반 연동이 이미 검증·운영 중이며, reference/nike/에 17개 파일(발송 래퍼, 인스턴스 풀, credential 암호화 저장, 메시지 DB 저장, 알림 헬퍼, 재시도 cron, API routes)이 수집되어 있음

## 대안 비교

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| Zalo OA API (원계획) | 공식 지원, 안정적, 밴 위험 없음 | **계정 신청 불가** (전제 붕괴), 48h 응답 창 제약, 템플릿 심사 | 불가 |
| **zca-js 개인 계정** | Nike에서 검증된 코드 전량 재사용, 48h 창 제약 없음, 무료, 공급자가 친구추가만 하면 끝 | 비공식 — 정책 변경 리스크, 개인 계정 밴 위험, 단일 계정 의존 | **채택** |
| SMS (베트남 통신사) | 공식, 도달률 높음 | 건당 비용, 발신번호 등록 절차, 양방향 채팅(T6.6) 불가, 이미지 전송 불가 | 기각 |
| 이메일 | 무료, 간단 | 베트남 공급자(중계인)는 이메일을 거의 안 봄 — UX 원칙 위배 | 기각 |

## 결정

1. **Zalo 알림은 zca-js(개인 Zalo 계정, QR 로그인) 기반으로 구현** — Nike 방식 재사용
2. reference/nike/의 zca-js 코드(zalo.ts·zalo-pool.ts·zalo-credentials.ts·zalo-db-store.ts·zalo-alerts.ts·retry cron 등)가 **전송 계층까지 거의 그대로 정본** — "OA REST 전송 계층 신규 작성" 계획 폐기
3. credential은 Nike 패턴대로 **DB 암호화 저장**(AES-256-GCM, `ZALO_CREDS_KEY` 파생 키) — `ZALO_OA_ACCESS_TOKEN`/`ZALO_APP_ID`/`ZALO_APP_SECRET` 환경변수 불필요
4. T3.7 온보딩: "OA follow webhook + 전화번호 매칭" → **zca-js 친구추가/수신 메시지 이벤트 + 전화번호 매칭**으로 변경
5. 스키마: `User.zaloUserId`의 의미가 OA user id → zca-js 대화 상대 id로 바뀌나 **컬럼 구조 변경 없음** (마이그레이션 불필요 — 확인 완료)

## 리스크와 완화책

| # | 리스크 | 완화책 |
|---|---|---|
| ① | **비공식 라이브러리** — Zalo 측 프로토콜·정책 변경 시 작동 중단 가능 | Notification 큐 + SENT/FAILED 상태 기록으로 발송 실패 즉시 가시화. 중단 시에도 알림은 큐에 남아 수동 처리 가능. zca-js 버전 고정 + Nike 운영 경험 공유 |
| ② | **개인 계정 차단(밴) 위험** — 대량 발송 패턴 감지 시 계정 정지 | 발송량 제한(스로틀), 재시도 백오프(3회 제한 — T3.5 기구현), 일일 발송 상한 설정. Phase 1 공급자 수가 적어 실발송량 자체가 낮음 |
| ③ | **단일 계정 의존** — 세션 만료·로그아웃 시 전체 알림 중단 | QR 재로그인 절차를 운영 문서화(ops/deployment-pattern.md), ADMIN 화면에 연결 상태 표시(a0-zalo-connect), 끊김 감지 시 운영자에게 별도 채널(Web Push) 경보 |
| ④ | (장점) **48h 응답 창 제약 없음** — 개인 계정은 OA와 달리 마지막 수신 후 48시간 제한이 없음 | b14-zalo-chat의 "48시간 경과" 비활성 상태는 렌더하지 않음 |

## 영향 범위

- **태스크**: T3.5(기완료분의 "ZALO_OA_ACCESS_TOKEN 입력" 잔여 → zca-js QR 연결로 대체), T3.6, T3.7(webhook → zca-js 이벤트), T6.6(채팅 — 48h 창 로직 제거)
- **디자인**: b14-zalo-chat의 "48h 경과" 상태 1건 렌더 제외. a0-zalo-connect QR은 개인 계정 친구추가 QR로 의미만 변경 — 화면 수정 없음
- **환경 변수**: `ZALO_OA_ACCESS_TOKEN`·`ZALO_APP_ID`·`ZALO_APP_SECRET` 삭제 → `ZALO_CREDS_KEY`(credential 암호화 키) 추가
- **스키마**: 변경 없음 (User.zaloUserId 의미 재정의만). Nike의 ZaloAccount 모델 이식은 T3.5 실연동 시 TDA 검토

## 결과

- reference/README.md의 "OA REST 전송 계층 신규 작성 필요" 경고 폐기 — Nike zca-js 코드가 전송 계층 정본
- CLAUDE.md 기술 스택·환경 변수 갱신, TASKS.md T0.7/T3.5/T3.7 문구 갱신 (본 ADR과 동시 반영)
