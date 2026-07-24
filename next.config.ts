import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// CSP — **enforce**(2026-07-23 전환). 2026-07-15~22 Report-Only로 수집한 실사용 위반 8,610건을
// 근거로 출처를 확정한 뒤 플립했다. `report-uri`는 유지 — enforce 상태에서도 차단 사실이 계속 보고된다.
//
// 전환 근거(SecurityEvent CSP_REPORT 집계):
//   img-src 6,565 = Zalo 그룹사진 `photo-stal-*.zdn.vn` → `*.zdn.vn` 허용으로 해소
//   script-src-elem 1,331 = CF 프록시가 주입하는 비콘 → static.cloudflareinsights.com 허용으로 해소
//   media-src 43 = 빌라 클립 mp4 → media-src 신설로 해소
//   script-src(eval) 628 · frame-src(null) 36 = **고유 IP 2개·2026-07-21 이후 0건 = 브라우저 확장 노이즈**.
//     → 'unsafe-eval'은 **넣지 않는다**(넣으면 CSP의 핵심 방어를 스스로 버린다). 확장이 막히는 건 의도된 결과다.
//
// ⚠ 되돌리기: 아래 헤더 key를 `Content-Security-Policy-Report-Only`로 되돌리고 배포(3~4분)하면 즉시 원복된다.
// ⚠ script/style 'unsafe-inline'은 Next.js 인라인 부트스트랩용이라 남아 있다 — 인라인 XSS 방어는
//   nonce 마이그레이션(별도 과제) 전까지 없다. 이번 전환의 효과는 **외부 출처 잠금**이다.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  // challenges.cloudflare.com = Turnstile(웹챗 세션 생성 봇 차단). script/frame 양쪽 필요.
  // static.cloudflareinsights.com = Cloudflare Web Analytics 비콘. **우리 코드가 아니라 프록시가
  //   주입**한다(2026-07-23 실측: 로그인·비로그인 가리지 않고 전 페이지에서 script-src-elem 위반).
  //   빠뜨리고 enforce하면 모든 페이지에서 콘솔 에러가 뜬다.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  // youtube-nocookie = 쿠키 없는 임베드(개인정보 보호형). 빌라 페이지 쇼츠 재생용(T-seo-media).
  // maps.google.com·www.google.com = 지도 임베드(<iframe output=embed>). 빌라 대략지도·장소 정밀지도
  //   (블로그)·제안링크·판매화면 MapEmbed가 쓴다. ★임베드 URL은 maps.google.com에서 시작해
  //   www.google.com/maps/embed 로 301 리다이렉트하므로 **두 호스트 모두** 있어야 한다(브라우저는
  //   프레임 내 각 내비게이션을 frame-src로 검사 → 리다이렉트 대상 호스트 누락 시 지도가 통째로 안 뜬다).
  "frame-src 'self' https://challenges.cloudflare.com https://www.youtube-nocookie.com https://www.youtube.com https://maps.google.com https://www.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // blob: = 첨부 대기열·붙여넣기 미리보기 썸네일(objectURL). *.zdn.vn = Zalo 그룹 사진(photo-stal-*).
  // maps.google.com·maps.gstatic.com = 채팅의 **지도 링크 미리보기**(lib/maps-unfurl.ts가 og:image로
  //   정적 지도 이미지를 뽑는다). 실측 60건 전부 /messages — 빠뜨리면 미리보기 이미지가 깨진다.
  "img-src 'self' data: blob: https://*.r2.dev https://*.r2.cloudflarestorage.com https://picsum.photos https://fastly.picsum.photos https://lh3.googleusercontent.com https://*.zadn.vn https://*.zdn.vn https://i.ytimg.com https://maps.google.com https://maps.gstatic.com",
  // media-src = <video> 재생원. ★영상 기능(빌라 클립·릴스·쇼츠) 도입으로 **필수가 됐다**
  //   (2026-07-23 실측: /villas/[id]에서 pub-*.r2.dev/villa-clips/*.mp4가 default-src 폴백에 걸림).
  //   blob: = 업로드 전 로컬 미리보기(probeLocalVideo가 objectURL을 <video>에 물린다).
  //   미지정 시 default-src 'self' 폴백 → enforce 순간 **영상이 전부 안 보인다**.
  "media-src 'self' blob: https://*.r2.dev",
  // connect-src = fetch/XHR 목적지. ★R2 presigned PUT은 브라우저→R2 직결이라 반드시 필요하다
  //   (누락 시 enforce 순간 영상 업로드 전멸 — [[r2-bucket-cors-missing-blocks-browser-upload]]와 같은 증상).
  //   challenges.cloudflare.com = Turnstile 위젯의 검증 요청(script/frame과 짝).
  "connect-src 'self' https://*.r2.cloudflarestorage.com https://challenges.cloudflare.com",
  "report-uri /api/csp-report",
].join("; ");

const nextConfig: NextConfig = {
  // zca-js는 네이티브/ws 의존 — 서버 번들에서 제외하여 번들링 충돌 회피 (ADR-0006 S2).
  // ffmpeg-static은 정적 바이너리를 default export 경로로 spawn한다. 번들링되면 경로가
  //   .next/server/chunks/ffmpeg 로 깨져 런타임 spawn ENOENT(릴스/쇼츠 MP4 합성 전면 실패).
  //   외부 패키지로 지정해야 node_modules의 실제 바이너리 경로로 해결된다.
  // (Next 15: instrumentation.ts는 기본 활성, serverExternalPackages는 stable)
  // ★ ffprobe-static도 반드시 포함(2026-07-22 실측): 빠뜨리면 번들러가 경로를 갈아엎어
  //   서버에서 ffprobe spawn이 실패한다. 그런데 실패가 **조용하다** — lib/youtube/edit.ts의
  //   probeDurationSec·probeIsHorizontal은 catch에서 null/false를 돌려주기 때문이다. 결과:
  //     ⑴ segDurs가 실제 길이 대신 **요청 길이**로 폴백 → xfade 오프셋이 어긋나
  //        마지막 프레임이 정지한 채 나레이션만 흐른다(실제 발행 영상에서 확인)
  //     ⑵ 원본 부족분 감속 로직이 avail=null이라 아예 발동하지 않는다
  //     ⑶ 가로 클립 blur 패딩이 영영 켜지지 않는다(항상 세로로 가정)
  //   로컬에서는 ffprobe가 정상이라 재현되지 않아 원인 파악이 오래 걸렸다.
  serverExternalPackages: ["zca-js", "ffmpeg-static", "ffprobe-static"],
  // 전역 HTTP 보안 헤더 (T-sec-public-hardening, Phase 1 보안). CSP는 인라인/CDN 호환성
  // 검증 후 별도 추가(후속). Referrer-Policy는 공개 제안 URL의 token이 외부 referrer로
  // 새는 것을 차단하는 핵심 항목.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Railway HTTPS 전제 — 2년 + 서브도메인 (preload는 별도 등록 절차라 제외)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" }, // 클릭재킹 방어
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // 브라우저 기능은 우리 사이트(self)만 허용, 외부 출처(iframe 등)는 차단. camera=사진촬영, microphone=음성입력(STT), geolocation=위치.
          // ⚠ ()로 완전 차단 시 안드로이드 등에서 getUserMedia가 즉시 거부되어 "권한 필요" 오표시됨.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
          // CSP enforce(2026-07-23) — 위반은 **차단**되고 동시에 /api/csp-report로 계속 보고된다.
          //   문제가 생기면 key를 "Content-Security-Policy-Report-Only"로 되돌리고 배포하면 즉시 원복.
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "**.r2.dev", // R2 공개 개발 도메인 (pub-xxx.r2.dev)
      },
      // 데모/파일럿 시드 placeholder 사진 (prisma/demo-seed.ts) — 실데이터 전환 시 제거 가능
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "fastly.picsum.photos", // picsum.photos 302 리다이렉트 대상
      },
      // 데모 빌라 실사진 — Google Drive 공개 링크 CDN (07.빌라 > 푸꾸옥 빌라)
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      // ADR-0009 S6/D8.4 — Zalo 프로필 아바타 CDN. getAvatarUrlProfile 응답 호스트.
      // 실측 미확정: Zalo 아바타는 통상 s*-ava-talk.zadn.vn 등 *.zadn.vn 대역.
      // 운영에서 실제 호스트 확인 후 좁힐 것(현재는 *.zadn.vn 와일드카드). 만료 시 이니셜 폴백.
      {
        protocol: "https",
        hostname: "**.zadn.vn",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
