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
- **같은 그룹방 = 계정 세션마다 다른 thread id·발신자 별칭** (2026-07-13 실측): villa go 알림방이 테오 뷰 5469…, Villa Go 계정 뷰 5144…, DK 뷰 8204…로 각각 저장됨(발신자 uid도 세션별 별칭 — 테오가 김태진 뷰에선 652316…). 그룹 동일성 판별은 id가 아니라 그룹명·아바타 URL 등 부수 정보로만 가능. "같은 그룹인데 대화가 계정마다 따로 있다"는 버그가 아니라 Zalo 프로토콜 구조.
- **zalo-worker 재배포 = 짧은 수신 유실 창** (2026-07-13 실측): 구·신 컨테이너 교체 순간에 도착한 메시지 1건 유실 사례(12:53 "네"). zca-js는 재접속 시 미수신분 소급 조회가 없어 재시작 공백의 메시지는 영구 유실. 워커 배포는 대화 한산 시간대 권장, "메시지 안 들어왔다" 제보 시 워커 배포 시각과 대조 먼저.
- **zaloMsgId 멱등키는 반드시 대화별(conversationId 복합) 스코프** (2026-07-13 그룹 수신 유실 사고 — 계약 zalo-msgid-per-conversation): 같은 그룹에 PMS 연결 계정 N개면 같은 서버 msgId가 N개 리스너에 도착해 **소유자별 대화에 각각 저장돼야 한다**. zaloMsgId 전역 @unique + 전역 findUnique 멱등은 첫 저장 외 전부 소리 없이 유실시킴(P2002 워커 로그 도배 + duplicated 오판 스킵). 정본: `@@unique([conversationId, zaloMsgId])` + 멱등 조회는 복합키 + create는 P2002만 duplicated 흡수. zaloMsgId 단독 조회(리액션·webhook·인용)는 반드시 `findFirst + conversation.ownerAdminId` 스코프. 새 멱등키 설계 시 "이 키가 두 소유자 화면에 동시에 존재해야 하는 값인가"를 먼저 물을 것.
