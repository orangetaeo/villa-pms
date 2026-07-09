# Skill: Stitch → Next.js 변환 패턴

1. design/stitch/<화면>/ HTML을 읽고 구조 파악 (docs/DESIGN.md 변환 규칙 선행 확인)
2. 첫 변환 시 색·radius·간격을 tailwind.config/globals.css 토큰으로 추출 → 이후 화면은 토큰 재사용, 임의값(text-[#123456]) 남발 금지
3. Stitch의 더미 데이터·이미지는 Prisma 쿼리·next/image로 전부 교체
4. 폼: react-hook-form + zod (서버 zod 스키마 재사용)
5. 상태 색상(공실/홀드/확정/차단)은 전 화면 공통 변수로 통일
6. **코치마크 투어 동기화(T-tutorial-onboarding)**: `data-tour` 앵커가 있는 화면의 UI를 변경할 때는 `components/tour/tour-definitions.ts` 스텝 정의와 `messages/ko.json·vi.json`의 `tour` 문구를 **동시에 갱신**한다. 앵커 요소를 지우면 해당 스텝은 런타임 자동 스킵되지만(안전장치) 안내 공백이 생긴다 — `tests/tour-onboarding.test.ts`(앵커 실존·키 패리티)가 절반을 잡고, 나머지(문구가 새 UI와 맞는지)는 사람이 확인. 새 화면에 투어를 추가할 때는 화면당 3스텝 상한·오버레이 하드요구(createPortal(body)·z-[70]·100vh 금지)를 지킬 것.

## 교훈 축적
- (2026-07-09 T-zalo-connect-qr-admin-setting 라이브 E2E) **react-hook-form 저장 성공 후 `reset(values)` 필수** — 저장 성공 시 reset 없이 `router.refresh()`만 하면 isDirty 기준선이 최초 defaultValues에 머문다. 같은 세션에서 "저장→값 비우기(=최초값과 동일)→저장"이 `disabled={!isDirty}`에 걸려 **조용히 무시**된다(에러 없음, 사용자는 저장됐다고 오인). RSC prop(initial)이 refresh로 갱신돼도 클라 컴포넌트는 리마운트되지 않아 defaultValues는 그대로다. isDirty로 저장 버튼을 게이트하는 폼은 onSubmit 성공 직후 `reset(제출값)`으로 기준선을 재설정할 것.
- (2026-06-11 T3.4-FE QA) **쿼리 파라미터(?task=) 기반 선택 전환 시 클라이언트 useState가 유지됨** — 같은 라우트에서 searchParams만 바뀌면 클라 컴포넌트는 리마운트되지 않아 반려 사유 입력·rejectMode·성공/게이트 배너가 이전 선택의 것 그대로 다음 선택에 남는다(잘못된 사유를 다른 태스크에 제출 가능). 선택 대상 ID가 props로 바뀌는 뷰는 ① 부모(RSC)에서 `key={selectedId}`로 리마운트시키거나 ② 액션·메시지 상태를 selectedId와 묶어 저장하고 렌더 시 일치 검사할 것.
