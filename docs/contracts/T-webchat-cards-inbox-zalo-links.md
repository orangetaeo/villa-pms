# 계약: T-webchat-cards-inbox-zalo-links — 웹챗 링크 백로그 3건

착수: 2026-07-21 · 브랜치: worktree-webchat-cards-zalo-links · 선행: PR #340·#344(웹챗 링크 발송)

## 배경

PR #340·#344가 웹챗 링크 발송(체크인/옵션/영수증/제안)을 만듦. 그때 남긴 백로그 3건을 구현. ★조사에서 **Zalo 대화엔 이미 공유 카드 시스템**(POST /api/zalo/conversations/[id]/share — PHOTO·PROPOSAL·VILLA·SETTLEMENT, msgType별 카드 렌더)이 존재함을 확인. 따라서 (C)는 Zalo에 **없는 게스트 링크 3종만** 추가한다.

## 범위 (IN)

### (A) 웹챗 카드형 메시지
- **T1 스키마**: `WebChatMessage.kind String?`(checkin|options|receipt|proposal) · `WebChatMessage.payload Json?`(카드 렌더용: {url, title/요약 키, expiresAt? 등 — 금액 없음) — additive raw SQL(migrations-manual) + generate
- send-link 라우트: 메시지 생성 시 kind + payload 기록(기존 text/translatedText는 폴백 위해 유지)
- 렌더: `kind`가 있으면 카드 UI(제목·요약·"열기" 버튼), 없으면 기존 Linkify 텍스트(구 메시지 하위호환). 방문자 위젯(app/webchat/widget/webchat-widget.tsx) + 운영자 스레드(webchat-thread.tsx) 양쪽. **XSS 안전**(payload는 서버 생성 신뢰값이나 URL은 여전히 스킴 검증, dangerouslySetInnerHTML 금지)
- payload는 방문자에게도 전달되나 URL·제목만(누수 무관 — 링크 자체가 이미 나가는 값). 방문자 폴링 응답에 kind/payload 추가는 **허용**(예약 식별 정보 아님, 링크 표시용). ★단 bookingId·게스트명·proposalId 원문은 payload에 넣지 않음(표시에 불필요)

### (B) 인박스 예약 후보 배지
- 웹챗 인박스 API(app/api/webchat/inbox/route.ts) 응답에 세션별 `bookingLink: "linked" | "candidate" | "none"` 파생 추가:
  - 이미 bookingId 연결됨 → "linked"(+빌라명 등 기존 booking 요약 있으면 재사용)
  - 미연결이지만 후보 존재(sourcePage g:토큰8자 매칭 or 연락처 매칭) → "candidate"
  - 없음 → "none"
- **배치 계산**(N+1 금지): 인박스 페이지 세션들에 대해 토큰 prefix OR 쿼리 1회 + 연락처 윈도우 쿼리 1회로 후보 여부 집계. 후보 "존재 여부"만 필요(정확한 예약 매칭은 기존 booking-candidates가 담당)
- 인박스 UI(webchat-inbox.tsx): "linked"=예약 배지(기존 스타일), "candidate"=🔗 "후보 있음" 옅은 배지. **금액 없음**

### (C) Zalo CUSTOMER 대화 게스트 링크 3종
- Zalo share 라우트(app/api/zalo/conversations/[id]/share/route.ts)에 `GUEST_LINK` 타입 추가: `{ type:"GUEST_LINK", kind:"checkin"|"options"|"receipt", bookingId }`
- **게이트: CUSTOMER 대화만**(counterpartyType === CUSTOMER — 게스트=투숙객 대상. SUPPLIER·여행사·UNKNOWN 차단, allowedShareKinds에 반영). 소유 검증(ownerAdminId)은 기존 그대로
- 토큰: 웹챗 send-link의 재사용 로직 재사용 — **lib로 추출**(lib/guest-link-token.ts 등): 사용가능 시 재사용/불가 시 발급, 기존 QR 링크 불파괴. send-link 라우트도 이 lib를 쓰도록 리팩터(동작 불변)
- 텍스트: lib/zalo-share.ts에 buildGuestLinkShareText(kind, locale) — Zalo 대화의 translateMode/counterparty 기준 언어. 기존 Zalo 공유 텍스트 빌더 패턴 준용
- receipt는 체크아웃 완료 예약만(웹챗과 동일 가드)
- persistShare 재사용(msgType="guest_link_share"), AuditLog. chat-pane 첨부 메뉴(CUSTOMER)에 버튼 추가 + msgType 카드 렌더
- 그룹 대화(threadType GROUP)엔 게스트 링크 미노출(1:1 CUSTOMER만)

### 공통
- i18n: adminWebchat(A·B) + adminMessages(C, Zalo 화면 NS) ko/vi 동시
- 모든 변경 API writeAuditLog

## 범위 밖 (OUT)
- Zalo에 이미 있는 제안/빌라/정산 공유 재작업
- 카드형을 Zalo 기존 카드에까지 통일(Zalo는 이미 카드 있음)
- 인박스 배지에서 정확한 예약 1건 표시(후보 "있음/없음"만 — 상세는 연결 팝오버)

## 완료 기준 (테스트 가능)
- [ ] (A) kind 있는 메시지=카드 렌더, kind null(구 메시지)=기존 텍스트 렌더(하위호환)
- [ ] (A) 방문자 위젯·운영자 스레드 양쪽 카드, `<script>` 텍스트 이스케이프·javascript: URL 차단
- [ ] (A) send-link 4종이 kind+payload 기록, 금액 필드 payload 부재
- [ ] (B) linked/candidate/none 3분류 정확, 인박스 로드가 세션수 비례 쿼리 폭발 없음(배치 2쿼리)
- [ ] (B) candidate 판정=토큰 유입 or 연락처 매칭 존재 시, 금액 응답 부재
- [ ] (C) GUEST_LINK가 CUSTOMER 대화에서만 200, SUPPLIER/UNKNOWN/그룹 403
- [ ] (C) 토큰 재사용(기존 유효 토큰 revoke·재발급 안 함), receipt 체크아웃 전 400
- [ ] (C) send-link 리팩터 후 웹챗 발송 회귀 0(기존 4종 동작 불변)
- [ ] 방문자 폴링에 bookingId/게스트명/proposalId 원문 부재(payload는 url·표시값만)
- [ ] adminWebchat·adminMessages ko/vi 패리티
- [ ] lint + next build 통과

## 수정 금지 구역
- lib/webchat.ts 번역 파이프라인 · 방문자 세션 생성/발신 코어
- Zalo 기존 공유 3종(PROPOSAL/VILLA/SETTLEMENT) 로직·누수 가드
- prisma 타 모델
