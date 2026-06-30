# T-supplier-villa-list-compact — 공급자 빌라 리스트를 관리자 컴팩트 행 방식으로 변경

## 범위 (수정 파일)
- `app/(supplier)/my-villas/page.tsx` — 큰 사진 카드 → 관리자식 컴팩트 접기/펴기 행으로 변환
- `messages/ko.json`, `messages/vi.json` — `myVillas`에 키 2개만 **추가**(`cleaningPending`, `detail`)

## 수정 금지 구역
- `app/(admin)/**` (참조만)
- `messages/*` 의 다른 네임스페이스 (myVillas 외 변경 금지, 추가만)
- prisma/schema.prisma (스키마 변경 없음)

## 변경 내용
관리자 리스트(`app/(admin)/villas/page.tsx`)의 **레이아웃 구조**를 차용:
- 왼쪽 작은 썸네일(64~80px) + 단지명(uppercase) + 빌라명 + 메타 아이콘 행(침실/수영장/조식) + 우측 상태배지 + chevron
- `<details>` 접기/펴기 → 펼침 영역에 상세보기/청소보기/재제출 버튼
- 청소검수 대기는 요약 행에 인라인 빨강 배지(cleaningPending)로 표시

공급자 화면 원칙 유지:
- **라이트 테마 유지**(흰 카드 + teal). 다크 색상 미사용
- 공급자명 줄 없음(자기 빌라만)
- 상태배지 5종(active/notSellable/rejected/pending/inactive) 그대로
- 요율·마진·판매가 미조회(누수 0). select에 complex/hasPool/breakfastAvailable만 추가

## 완료 기준 (테스트 가능)
- [ ] 한 화면에 빌라 5~6개 노출(컴팩트 밀도)
- [ ] 상태배지 5종 라이트 색상으로 정상 표시
- [ ] notSellable → 펼침에 청소보기, rejected → 펼침에 재제출 버튼
- [ ] 청소검수 대기 빌라에 인라인 배지 표시
- [ ] ko/vi 키 모두 추가(키 원문 노출 0)
- [ ] 누수: 응답에 rates/salePrice/margin 필드 없음
- [ ] tsc/lint/build 0 에러

## 검증 방법
`npm run typecheck && npm run lint && npm run build` + Playwright 공급자 로그인 후 /my-villas 모바일(390px) 확인
