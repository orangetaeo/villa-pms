# 런북: DDoS 방어 (보안 P1-S11)

## 핵심 — 계층별 책임
| 공격 유형 | 방어 위치 | 비고 |
|---|---|---|
| **볼류메트릭 (L3/L4)** — SYN flood, UDP/ICMP flood, 대역폭 고갈 | **인프라 앞단(Cloudflare/Railway)** | ⚠ **앱 코드로는 막을 수 없다.** 트래픽이 앱에 닿기 전에 차단해야 한다 |
| **L7 애플리케이션** — HTTP flood, 비용성 엔드포인트 남용, 초대형 본문 | **앱 백스톱 + 인프라** | 아래 §앱 방어 구현됨. 분산(많은 IP)은 인프라 필요 |

> **결론: 진짜 DDoS 방어선은 Cloudflare(또는 동급)를 Railway 앞에 두는 것이다. 앱 레이어는 보조(백스톱).**

## 1차 방어 — Cloudflare 앞단 (OPS, 강력 권장)
1. 도메인을 **Cloudflare에 추가**(네임서버 변경) → 모든 트래픽이 Cloudflare를 경유.
2. DNS 레코드를 **Proxied(주황 구름)**로 설정 → Railway origin IP 은닉 + L3/4 DDoS 자동 흡수(무료 플랜 포함).
3. **WAF / Rate Limiting Rules**: IP·경로별 요청 한도(예: `/api/*` 분당 N회), Bot Fight Mode, Managed Challenge.
4. **"Under Attack" 모드**: 공격 감지 시 1클릭 활성(JS 챌린지).
5. origin 보호: Railway는 Cloudflare IP만 허용(가능 시), 또는 Cloudflare Authenticated Origin Pulls.
- Railway 자체도 기본 에지 보호가 있으나 **세밀한 rate-limit/WAF는 Cloudflare가 우월**.

## 앱 백스톱 (구현됨 — 이 PR)
- **전역 IP 플러드 리미터** (`middleware.ts` + `lib/ddos-guard.ts`): 단일 IP 기본 **1000회/분** 초과 시 429. 모든 경로(페이지+API)에 적용, SSE(`/api/zalo/stream`) 제외.
  - ⚠ **인스턴스별 인메모리** — Railway 단일 컨테이너 가정. 다중 인스턴스/분산 플러드는 인프라가 담당.
  - 튜닝: `RATE_LIMIT_GLOBAL_MAX`(기본 1000), 킬스위치 `RATE_LIMIT_GLOBAL_DISABLED=1`.
- **요청 본문 크기 상한**: `content-length` > 기본 **30MB** → 413. 튜닝 `MAX_REQUEST_BODY_BYTES`.
- **비용성 엔드포인트 스로틀** (`lib/cost-throttle.ts`): 번역·OCR·전사를 사용자별 기본 **200회/분**으로 제한(Gemini 비용 폭주 방어). 튜닝 `COST_ENDPOINT_MAX`.
- **공개 토큰·인증 엔드포인트**: 기존 라우트별 rate-limit 유지(로그인 5/10분, 가입 10/시간, /p·/g 토큰 한도).

## 자기-DoS(false positive) 주의
- 전역 한도(1000/분)는 NAT·공유 와이파이 사무실도 안전하도록 넉넉하나, 비정상 차단 신고 시:
  - 즉시 완화: `RATE_LIMIT_GLOBAL_MAX` 상향 또는 `RATE_LIMIT_GLOBAL_DISABLED=1`(env만, 무배포).
  - 근본 대응: Cloudflare에서 신뢰 IP 화이트리스트.

## 운영 체크리스트
- [ ] Cloudflare proxied 적용(미적용 시 볼류메트릭 무방비)
- [ ] Cloudflare Rate Limiting / Bot Fight Mode 활성
- [ ] Railway origin이 Cloudflare 경유만 허용
- [ ] 부하 급증 시 Cloudflare "Under Attack" 모드 + 앱 env 한도 조정 절차 숙지
