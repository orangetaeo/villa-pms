# Skill: Zalo OA·Gemini·iCal 연동 패턴 (Nike 프로젝트 패턴 계승)

## Zalo OA
- 발송 순서: Notification 레코드(PENDING) 생성 → API 발송 → SENT/FAILED 갱신 → 실패 3회 재시도 cron
- 템플릿 메시지는 lib/zalo.ts에 타입별 빌더로 집중 (산발 금지)
- 알림에 판매가·마진 절대 미포함 — 빌더 레벨에서 차단
- 토큰 만료(access_token) 자동 갱신 로직 포함 — Nike 프로젝트에서 만료 미처리로 발송 누락 경험

## Gemini
- 여권 OCR: 이미지 → 구조화 JSON(이름·여권번호·국적·생년월일) 프롬프트 고정, 원본 passportOcrJson 보존
- 번역: vi↔ko 키 일괄 번역 시 용어집(빌라명·단지명은 번역 금지) 전달

## iCal
- 30분 cron, VEVENT → CalendarBlock upsert (icalUid 멱등키)
- 사라진 UID 블록 삭제, 내부 예약과 겹침 발견 시 ADMIN 더블부킹 경보

## 교훈 축적
- (Nike: Zalo 토큰 만료 처리 필수 — 위에 반영됨)
