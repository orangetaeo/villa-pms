# 계약: T-webchat-proposal-link-send — 웹챗에서 제안(/p) 링크 생성·발송

착수: 2026-07-16 · 브랜치: worktree-webchat-proposal-link · 선행: PR #340(T-webchat-guest-link-share — 체크인 링크 발송 패턴)

## 배경

PR #340은 **예약이 있는** 고객에게 체크인·부가서비스·영수증 링크를 원클릭 발송. 이번엔 **예약 전 문의** 고객에게 제안 링크(/p)를 채팅 안에서 생성·발송한다. 현재는 /proposals/new로 이동→생성→링크 복사→채팅 복귀(화면 전환 3~4회).

## 범위 (IN)

1. **send-link 확장**: `POST /api/webchat/sessions/[id]/send-link`에 `kind:"proposal"` + `proposalId` 추가
   - 검증: 제안 존재 + `effectiveProposalStatus`(lib/proposal.ts)=ACTIVE(만료·취소·사용 제외 400 `proposal_not_active`)
   - URL: `/p/<token>` + 방문자 locale이 공개 페이지 5언어(ko/en/ru/zh/vi)에 있으면 `?lang=<locale>` 부착(방문자 언어로 바로 열림)
   - 기존 kind 3종 동작 불변(예약 연결 불필요 — proposal kind는 bookingId 미요구)
   - writeAuditLog(proposalId 기록)
2. **템플릿**: lib/webchat-link-templates.ts에 `proposal` kind 5언어 추가
3. **제안 후보 API(경량)**: `GET /api/webchat/sessions/[id]/proposal-candidates` — 최근 ACTIVE(유효) 제안 목록. 필드: proposalId, clientName, 채널, 빌라명 목록, checkIn/checkOut, expiresAt — **금액 필드 select 원천 배제**(STAFF 사용 가능). limit 10, 최신순
4. **채팅 내 제안 UI**(app/(admin)/messages/): 빠른 링크 바에 [제안 보내기] 버튼(예약 연결 무관, 항상 노출) → 모달:
   - 탭/섹션 A "기존 제안 선택": 후보 API 목록 → 선택 → 확인 → send-link(kind proposal)
   - 탭/섹션 B "새 제안 만들기"(**canViewFinance 계열 게이트 — 서버는 기존 POST /api/proposals의 canSetPrice가 이미 강제, UI는 권한 없으면 안내만**): 체크인/아웃 날짜 → 기존 `GET /api/proposals/candidates` 후보 조회 → 빌라 1~3개 선택 → 유효기간 24/48h → clientName(기본값=세션 연락처 or "웹챗 고객") → 기존 `POST /api/proposals`(channel=DIRECT 기본) → 성공 시 즉시 send-link 체이닝
   - 발송 전 확인 다이얼로그(빌라 N개·날짜·유효기간 표시)
5. **i18n**: adminWebchat NS ko+vi 동시

## 범위 밖 (OUT)

- 스키마 변경(불필요 — 세션·제안 연결 컬럼 없음, 추적=AuditLog+메시지)
- 채널 TRAVEL_AGENCY/LAND_AGENCY 제안의 채팅 내 생성(웹챗=DIRECT 전제, 파트너 제안은 기존 /proposals/new)
- 기존 제안 생성 폼·/p 페이지 수정
- 카드형 메시지

## 완료 기준 (테스트 가능)

- [ ] kind=proposal + 유효 proposalId → OUTBOUND 생성, translatedText=방문자 언어+`/p/<token>?lang=` URL, Gemini 미호출
- [ ] 만료/취소/사용된 제안 → 400 proposal_not_active
- [ ] proposal kind는 예약 미연결 세션에서도 발송 가능(기존 3종은 여전히 not_linked 400)
- [ ] proposal-candidates 응답에 금액 필드 부재·ACTIVE(유효)만·limit 10
- [ ] 채팅 내 생성: 기존 POST /api/proposals 재사용(신규 생성 API 없음), 서버 canSetPrice 게이트 그대로(STAFF 생성 시도=403)
- [ ] 생성→발송 체이닝 동작(생성 실패 시 발송 미실행·에러 표시)
- [ ] 발송 3경로(신규 포함) AuditLog
- [ ] 방문자 폴링 응답 무변경(diff 0)
- [ ] adminWebchat ko/vi 패리티
- [ ] lint + next build 통과

## 수정 금지 구역

- app/api/webchat/messages/route.ts(방문자 폴링) · lib/webchat.ts 번역 파이프라인
- app/api/proposals/route.ts·lib/proposal.ts(호출만, 수정 금지 — 단 응답에 token이 없으면 additive로 포함하는 최소 수정만 허용)
- app/p/[token]/(공개 페이지) · 기존 send-link kind 3종 로직
- prisma/schema.prisma
