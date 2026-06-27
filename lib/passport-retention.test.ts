import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { purgeExpiredPassports } from "./passport-retention";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pp-retention-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** mtime을 days일 전으로 설정한 파일 생성. */
async function makeFile(name: string, agoDays: number, now: Date) {
  const full = path.join(dir, name);
  await fs.writeFile(full, "x");
  const t = new Date(now.getTime() - agoDays * 24 * 60 * 60 * 1000);
  await fs.utimes(full, t, t);
}

describe("purgeExpiredPassports (보안 P1-S3)", () => {
  const NOW = new Date("2026-06-27T00:00:00Z");

  it("보존기간(90일) 넘은 파일만 삭제, 최근 파일은 보존", async () => {
    await makeFile("old-passport.jpg", 100, NOW);
    await makeFile("old-sig.png", 95, NOW);
    await makeFile("recent.jpg", 10, NOW);
    await makeFile("edge-89.jpg", 89, NOW);

    const r = await purgeExpiredPassports(NOW, 90, dir);
    expect(r.deleted).toBe(2);
    expect(r.scanned).toBe(4);

    const left = (await fs.readdir(dir)).sort();
    expect(left).toEqual(["edge-89.jpg", "recent.jpg"]);
  });

  it("멱등 — 두 번째 실행은 삭제 0", async () => {
    await makeFile("old.jpg", 200, NOW);
    await purgeExpiredPassports(NOW, 90, dir);
    const r2 = await purgeExpiredPassports(NOW, 90, dir);
    expect(r2.deleted).toBe(0);
  });

  it("디렉터리 부재 시 무작업(오류 아님)", async () => {
    const r = await purgeExpiredPassports(NOW, 90, path.join(dir, "nope"));
    expect(r).toEqual({ scanned: 0, deleted: 0, errors: 0 });
  });

  it("보존기간 0이면 모든 파일 삭제(정책 경계)", async () => {
    await makeFile("a.jpg", 1, NOW);
    await makeFile("b.jpg", 0.5, NOW);
    const r = await purgeExpiredPassports(NOW, 0, dir);
    expect(r.deleted).toBe(2);
  });
});
