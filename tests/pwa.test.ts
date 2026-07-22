// PWA 매니페스트·아이콘 검증 (T-pwa-install)
// 로컬 풀빌드는 병렬 dev 서버의 prisma 엔진 잠금(EPERM)으로 불가 →
// 빌드 비의존 단위 검증으로 매니페스트 출력·SVG 유효성·apple-icon PNG 생성을 확인.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import manifest from "@/app/manifest";

describe("manifest()", () => {
  const m = manifest();

  it("PWA 설치 필수 필드", () => {
    expect(m.display).toBe("standalone");
    // ★ T-seo-s1: start_url은 "/"가 아니라 "/login"이다.
    //   루트(/)가 비로그인 방문자에게 **공개 마케팅 홈**을 렌더하도록 바뀌었기 때문에,
    //   start_url이 "/"면 앱을 설치한 베트남 공급자가 실행 시 로그인 대신 마케팅 홈을 보게 된다.
    //   "/login"은 로그인 상태면 미들웨어가 역할별 홈으로 되돌려주므로 기존 경험이 보존된다.
    //   이 단언을 "/"로 되돌리려면 먼저 app/page.tsx의 공개 홈 분기를 검토할 것.
    expect(m.start_url).toBe("/login");
    // scope는 "/" 유지 — 앱 안에서 공개 페이지로 이동해도 브라우저로 튕기지 않게 한다.
    expect(m.scope).toBe("/");
    expect(m.lang).toBe("vi");
  });

  it("브랜드 색상 — theme/background (디자인 토큰 일치)", () => {
    expect(m.theme_color).toBe("#0D9488"); // primary teal
    expect(m.background_color).toBe("#F8FAFC"); // 공급자 라이트 bg
  });

  it("아이콘 ≥1, maskable 포함, SVG 단일 소스", () => {
    expect(Array.isArray(m.icons)).toBe(true);
    expect(m.icons!.length).toBeGreaterThanOrEqual(1);
    expect(m.icons!.every((i) => i.src === "/icon.svg")).toBe(true);
    expect(m.icons!.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("이름 — name/short_name 존재", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.short_name!.length).toBeLessThanOrEqual(12); // 홈화면 라벨 잘림 방지
  });
});

describe("app/icon.svg", () => {
  const svg = readFileSync(
    fileURLToPath(new URL("../app/icon.svg", import.meta.url)),
    "utf-8"
  );

  it("유효한 SVG 루트 + viewBox 512", () => {
    expect(svg).toMatch(/<svg[^>]*viewBox="0 0 512 512"/);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("브랜드 teal 배경 라운드 사각형(파비콘/매니페스트 겸용)", () => {
    expect(svg).toMatch(/fill="#0D9488"/);
    expect(svg).toMatch(/rx="112"/); // 라운드 코너
  });
});

describe("app/apple-icon.tsx (next/og ImageResponse)", () => {
  // vitest는 프로젝트 tsconfig(jsx: preserve)로 .tsx를 import 못함 →
  // 런타임 PNG 생성은 배포 스모크(curl /apple-icon)로 검증. 여기선 소스 가드만.
  const src = readFileSync(
    fileURLToPath(new URL("../app/apple-icon.tsx", import.meta.url)),
    "utf-8"
  );

  it("180×180 PNG 메타 export", () => {
    expect(src).toMatch(/size\s*=\s*\{\s*width:\s*180,\s*height:\s*180\s*\}/);
    expect(src).toMatch(/contentType\s*=\s*"image\/png"/);
  });

  it("데이터 URI는 encodeURIComponent로 인코딩(# 미인코딩 버그 가드)", () => {
    // 색상 #0D9488의 '#'가 raw data URI에 들어가면 파싱 깨짐 → encode 필수
    expect(src).toMatch(/encodeURIComponent\(/);
    expect(src).not.toMatch(/data:image\/svg\+xml,<svg/);
  });
});
