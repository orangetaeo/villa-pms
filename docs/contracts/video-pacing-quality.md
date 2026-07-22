# 계약: 영상 자동화 품질 개선 — 컷 속도 조절 · 자막 리디자인 · 실측 재동기화

- 태스크: `video-pacing-quality`
- 브랜치: `wt/video-pacing`
- 요청자: 테오 (2026-07-23) — ① 자동화 문제 요소 점검 ② 퀄리티 향상 ③ **속도 조절**(복도는 빠르게·방은 천천히) ④ 자막 디자인 개선
- 담당: 메인 세션 (BE/FE 혼합) · 검증: 로컬 ffmpeg 실렌더 + vitest

## 범위

### A. 발견한 결함 수정 (①)
1. **`space`·`note`가 스키마에서 누락돼 조용히 버려짐** — `validateEditParams`가 클립을 `{key,startSec,durationSec}`로만 정규화해서, 마법사가 보내도 저장되지 않았다.
   결과: 대본 생성기(`clipHintsOf`)가 **항상 "공간 미지정"** 을 받아 나레이션이 화면과 무관한 일반론이 됨. 이 파이프라인 품질 저하의 최대 원인.
2. **오디오·화면 누적 드리프트** — 원본이 짧아 감속 상한(1.6배)에 걸린 컷은 계획보다 짧게 렌더되는데, 나레이션 오프셋은 계획값 그대로였다.
   → 세그먼트 실측 길이로 오프셋·자막을 다시 계산(`retimeNarrationTimeline`).
3. **나레이션 합성 실패가 로그 없이 삼켜짐**(`catch {}`) → 사유 기록.
4. **3세대 인코딩 화질 손실** — 중간 산출물까지 `veryfast`+CRF 기본값.

### B. 컷 속도 조절 (③) — `lib/youtube/pacing.ts` 신규
- 공간·메모로 컷 성격 판정: `transit`(복도·계단·현관) / `feature` / `hero`(외관·수영장)
- **화면 길이는 절대 바꾸지 않는다**(나레이션이 정한 값). 바뀌는 건 그 시간에 소비하는 원본 양뿐:
  transit 1.85배속 · feature 0.95 · hero 0.88
- transit 컷에는 **감속 램프**(빠르게 진입 → 끝에서 정상 속도로 도착). `setpts` 로그 적분식, 콤마 없는 표현식.

### C. 자막 리디자인 (④)
- 줄마다 반투명 알약 + 브랜드 악센트 바, 외곽선 4px→3px, 62px
- 팝인/팝아웃 → **알파 페이드**(자막·인트로 모두)

### D. 퀄리티 (②)
- 나레이션 밑 배경음(번들 CC0, −20dB, highpass 180Hz) — 기본 켬
- 대본 프롬프트에 컷 성격 전달(지나가는 컷=짧은 절, 핵심 컷=감각 표현)
- 최종 인코딩 CRF 20/preset fast/maxrate 8M/AAC 160k, 중간 CRF 16

## 완료 기준 (테스트 가능)
- [x] `planClipTiming` 램프 적분값 = 목표 화면 길이 (수식 테스트)
- [x] 실제 ffmpeg 렌더에서 계획 화면 길이와 실측이 ±0.01s 일치 (4케이스)
- [x] `retimeNarrationTimeline` 합계 = xfade 총 길이 (Σd − 컷수×T)
- [x] 컷이 짧아지면 뒤 문장 오프셋이 그만큼 앞당겨진다
- [x] `validateEditParams`가 space(화이트리스트)·note(200자) 보존
- [x] 나레이션+페이싱+BGM 조합 실렌더 통과(필터그래프 문법)
- [x] `npx tsc --noEmit` · `npx next build` · 관련 vitest 통과

## 수정 금지 구역
- `lib/instagram/**`(릴스 경로) — `reels.ts`는 **읽기만**(CTA 상수·BGM 경로 참조)
- `prisma/schema.prisma` — 스키마 변경 없음(전부 JSON params 내 additive)

## 알려진 미해결
- 기존에 생성된 쇼츠의 `editParamsJson`에는 space가 없다 → 재렌더해도 페이싱이 안 걸린다.
  새로 만들거나 마법사에서 공간을 지정해야 한다.
- 사전 존재 실패 5건(`tests/mutation-route-guard`, `tests/regional-vendor`, `tests/security-invariants`)은
  main에서도 동일하게 실패 — 이 작업과 무관.
