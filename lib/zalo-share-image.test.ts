// T-villa-share-photo — 빌라 공유 대표 사진 로더 (best-effort·보안 가드)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { loadVillaShareImage, MAX_SHARE_IMAGE_BYTES } from "./zalo-share-image";

// 유효 JPEG 최소 바이트(매직 FF D8 FF + 패딩 — sniffImageMime 최소 12바이트)
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "villa-share-img-"));
  await fs.writeFile(path.join(dir, "rep.jpg"), JPEG_BYTES);
  await fs.writeFile(path.join(dir, "not-image.jpg"), Buffer.from("<html>hi</html> padding"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadVillaShareImage — 디스크(/uploads) 경로", () => {
  it("유효 이미지 파일 → buffer+fileName 반환", async () => {
    const img = await loadVillaShareImage("/uploads/rep.jpg", { uploadDir: dir });
    expect(img).not.toBeNull();
    expect(img!.fileName).toBe("rep.jpg");
    expect(img!.buffer.equals(JPEG_BYTES)).toBe(true);
  });

  it("경로 탈출(../)·비허용 문자 파일명 거부", async () => {
    expect(await loadVillaShareImage("/uploads/../secret.jpg", { uploadDir: dir })).toBeNull();
    expect(await loadVillaShareImage("/uploads/a b.jpg", { uploadDir: dir })).toBeNull();
  });

  it("실제 이미지 바이트가 아니면(위장 파일) 거부", async () => {
    expect(await loadVillaShareImage("/uploads/not-image.jpg", { uploadDir: dir })).toBeNull();
  });

  it("미존재 파일은 null(폴백) — throw 금지", async () => {
    await expect(
      loadVillaShareImage("/uploads/missing.jpg", { uploadDir: dir })
    ).resolves.toBeNull();
  });
});

describe("loadVillaShareImage — 원격(R2 공개 URL) 경로", () => {
  it("STORAGE_PUBLIC_URL 프리픽스만 fetch 허용(SSRF 이중 가드)", async () => {
    // Buffer 풀 오프셋 함정 회피 — 독립 ArrayBuffer로 복사해 반환
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Uint8Array.from(JPEG_BYTES).buffer,
    }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      // 허용 베이스 외 호스트 — fetch 자체가 호출되지 않아야 함
      expect(
        await loadVillaShareImage("https://evil.example.com/x.jpg", {
          publicBase: "https://pub-abc.r2.dev",
        })
      ).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();

      const img = await loadVillaShareImage("https://pub-abc.r2.dev/rep.jpg", {
        publicBase: "https://pub-abc.r2.dev",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(img?.fileName).toBe("rep.jpg");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("베이스 미설정이면 원격 로드 자체를 하지 않음", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      expect(
        await loadVillaShareImage("https://pub-abc.r2.dev/rep.jpg", { publicBase: "" })
      ).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("http(비TLS)·비URL 형식 거부", async () => {
    expect(
      await loadVillaShareImage("http://pub-abc.r2.dev/rep.jpg", {
        publicBase: "https://pub-abc.r2.dev",
      })
    ).toBeNull();
    expect(await loadVillaShareImage("ftp://x/y.jpg")).toBeNull();
  });
});

describe("크기 상한", () => {
  it("상한 초과 파일 거부", async () => {
    const big = Buffer.alloc(MAX_SHARE_IMAGE_BYTES + 1);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const bigPath = path.join(dir, "big.jpg");
    await fs.writeFile(bigPath, big);
    expect(await loadVillaShareImage("/uploads/big.jpg", { uploadDir: dir })).toBeNull();
    await fs.rm(bigPath, { force: true });
  });
});
