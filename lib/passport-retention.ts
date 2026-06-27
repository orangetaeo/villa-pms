// 여권·서명 등 게스트 PII 증빙 보존정책 (보안 P1-S3)
//
// 위협/규제: 여권 사진·서명은 민감 PII다. 무기한 보존은 유출 시 피해를 키우고 PDPD(베트남)·PIPA(한국)
//   최소보존 원칙에 어긋난다. 체류는 단기이므로 업로드 후 N일(기본 90) 지난 파일은 purge한다.
// 방식: 비공개 passports 디렉터리(getPassportDir, public 밖)를 스캔해 mtime이 보존기간을 넘긴 파일 삭제.
//   - mtime = 업로드 시각. 체크아웃은 보통 그 직후이므로 업로드+90일이면 안전하게 만료.
//   - 멱등: 이미 삭제된 파일은 자연 스킵. 디렉터리 부재면 무작업.
//   - DB 참조(Booking.passportPhotoUrls 등)는 그대로 둘 수 있다 — 서빙 라우트가 파일 부재 시 404(의도된 purge).

import { promises as fs } from "fs";
import path from "path";
import { getPassportDir } from "@/lib/storage";

export const PASSPORT_RETENTION_DAYS = 90;

export interface PurgeResult {
  scanned: number;
  deleted: number;
  errors: number;
}

/**
 * 보존기간을 넘긴 PII 증빙 파일을 삭제한다.
 * @param now 기준 시각(테스트 주입)
 * @param retentionDays 보존 일수(기본 90)
 * @param dir 대상 디렉터리(기본 비공개 passports 디렉터리)
 */
export async function purgeExpiredPassports(
  now: Date,
  retentionDays: number = PASSPORT_RETENTION_DAYS,
  dir: string = getPassportDir(),
): Promise<PurgeResult> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  let scanned = 0;
  let deleted = 0;
  let errors = 0;

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return { scanned: 0, deleted: 0, errors: 0 }; // 디렉터리 부재(미생성) — 무작업
  }

  for (const name of files) {
    const full = path.join(dir, name);
    try {
      const st = await fs.stat(full);
      if (!st.isFile()) continue;
      scanned += 1;
      if (st.mtimeMs < cutoff) {
        await fs.unlink(full);
        deleted += 1;
      }
    } catch {
      errors += 1; // 개별 파일 오류는 집계만 하고 계속(전체 중단 금지)
    }
  }
  return { scanned, deleted, errors };
}
