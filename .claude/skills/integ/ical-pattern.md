# Skill: iCal 수신 동기화 패턴 (T1.6)

## 핵심 구조 (lib/ical.ts — 단일 소스)
- 순수층(파서·diff·충돌 감지)과 DB 래퍼층 분리 — 순수층만 단위 테스트, fetch·db는 주입(`fetchFn`, fake db)
- 멱등성 키: `CalendarBlock @@unique([villaId, icalUid])` — diff는 UID 기준 생성/날짜변경/소멸 3분류
- cron 진입: `GET|POST /api/cron/ical-sync` — `Authorization: Bearer ${CRON_SECRET}` 검증이 어떤 DB 접근보다 선행

## 절대 규칙 (재고 보수 원칙)
1. **외부 피드 동기화의 삭제는 모든 소스(URL)가 성공한 경우에만, 전체 피드 UID 합집합 기준으로 수행한다.** 블록에 출처 URL이 없으므로 URL 단위 삭제 판정은 불가능 — 1개 URL 실패 시 그 빌라는 upsert만 하고 삭제 전면 스킵. 일시 장애로 재고가 열려 더블부킹 되는 사고를 막는 단 하나의 분기다 (`allUrlsSucceeded`)
2. 삭제는 `source=ICAL`만 — deleteMany where에 source 조건 이중 방어, MANUAL 블록 절대 불변
3. 내부 예약과 충돌해도 블록은 생성(점유 우선) + 충돌 보고 — 해소는 ADMIN 수동

## 날짜 규약 (QA 합의 — half-open·UTC 자정)
- 날짜는 **이벤트 타임존 기준 로컬 캘린더 날짜** → UTC 자정 Date 저장
- TZID·floating DATE-TIME은 벽시계 날짜부 직취(변환 불필요), `Z`는 Asia/Ho_Chi_Minh로 Intl 변환
- DTEND에 자정 아닌 시간 성분 → +1일 올림(언더블록 방지). DTEND 누락 → +1일 (RFC 5545)

## 교훈 축적
- **응답 크기 상한은 다운로드 후 검사가 아닌 선검사(Content-Length)/스트리밍 캡이 정석** — 현재 text() 후 length 검사라 메모리 보호는 부분적, 15s 타임아웃이 실질 방어 (QA 비차단 권고, 개선 후보)
- **icalImportUrls 입력 UI를 SUPPLIER에 열 때 사설 IP(redirect 경유 포함) 차단 검토** — 현재 http/https 스킴 제한만 (SSRF, QA 권고)
- vitest는 tsconfig paths(`@/*`)를 읽지 않는다 — vitest.config.ts `resolve.alias` 필요. `@/lib/prisma`를 import하는 모듈은 테스트에서 `vi.mock`으로 차단해 PrismaClient 실생성 방지
