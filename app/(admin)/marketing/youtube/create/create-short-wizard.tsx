"use client";

// 직접 촬영 쇼츠 자동 편집 마법사 (3스텝) — /marketing/youtube/create.
//   STEP 1: 소재 확보 — ⑴ 승인된 **빌라 영상 불러오기**(재업로드 0) ⑵ 클립 다중 업로드
//           (presign → R2 PUT 직업로드, XHR 진행률, 실패 재시도).
//   ★ ⑴이 VillaClip의 소비처다(youtube-villa-clip-source). 불러온 클립은 업로드를 거치지 않고
//     `villaClipId`만 서버로 보낸다 — 클라이언트는 r2Key를 볼 수 없고, 서버가 키로 해석한다.
//   STEP 2: 순서·구간·가로처리·오디오·헤드라인·빌라·자막 구성.
//   STEP 3: edit-jobs 생성 → run(동기, 수분) → 미리보기 + 승인 대기 큐 이동.
//   ★ 누수 없음: 입력·응답에 원가·판매가·재고 개념 부재. 빌라 목록은 id·name만 사용.
//   ⚠ CSP: 업로드 PUT은 R2 외부 호스트 — 현재 report-only라 동작. connect-src enforce 시 R2 허용 필요.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

// 서버(edit.ts CLIP_COUNT_MAX)와 같은 값이어야 한다 — 8로 두면 "빌라 투어는 8컷으로 맛보기밖에
// 안 된다"고 상향한 서버 상한(16)을 화면이 도로 막는다.
const MAX_CLIPS = 16;
const MAX_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_SUBTITLES = 20;
const HEADLINE_MAX = 120;
const DUR_MIN = 2;
const DUR_MAX = 8;
const ALLOWED_EXT = /\.(mp4|mov)$/i;
const ALLOWED_MIME = new Set(["video/mp4", "video/quicktime"]);

type ClipStatus = "uploading" | "done" | "error";

interface Clip {
  localId: string;
  file: File | null; // 재시도용 보존. 빌라 영상에서 불러온 항목은 null(업로드가 없다)
  fileName: string;
  sizeBytes: number;
  status: ClipStatus;
  progress: number; // 0~100
  key: string | null; // 업로드 완료 시 R2 key
  /** 빌라 자산에서 불러온 소재. 서버가 이 id를 r2Key로 해석한다(클라는 키를 모른다). */
  villaClipId: string | null;
  startSec: string; // number input 문자열(빈 값=기본)
  durationSec: string;
  /**
   * 촬영 공간(PhotoSpace). **나레이션 대본과 컷 속도 조절이 둘 다 이 값을 쓴다.**
   * 빌라 영상에서 불러오면 자동으로 채워지고, 직접 올린 파일은 운영자가 고른다.
   * ★ 비워두면 그 컷은 대본에서 "공간 미지정"이 되고 속도 조절도 안 걸린다.
   */
  space: string;
  /** 이 컷의 특징 메모 — 같은 공간이 여러 컷일 때 대본이 다른 점을 말하게 하는 근거 */
  note: string;
}

/** 선택 가능한 공간 — Prisma PhotoSpace와 동일. i18n 키 create.step1.space.* 재사용. */
const SPACES = [
  "EXTERIOR",
  "LIVING",
  "KITCHEN",
  "BEDROOM",
  "BATHROOM",
  "BALCONY",
  "POOL",
  "ETC",
] as const;

/** 빌라에 등록된 승인 영상 — GET /api/villas/[id]/clips 응답(화이트리스트, r2Key 없음). */
interface VillaClipOption {
  id: string;
  url: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  space: string | null;
  note: string | null;
  status: string;
}

interface Subtitle {
  text: string;
  fromSec: string;
  toSec: string;
}

interface VillaOption {
  id: string;
  name: string;
  complex: string | null;
  nameVi: string | null;
}

interface PresignResp {
  key: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  expiresSec: number;
}

interface RunResp {
  ok: boolean;
  /** true = 대기열 등록됨(렌더는 cron이 수행). 동기 렌더는 폐지됐다(villa-clip-narration-p2). */
  queued: boolean;
  editJobStatus: string;
}

const fmtSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
};

let seq = 0;
const nextId = () => `c${Date.now()}-${seq++}`;

export default function CreateShortWizard() {
  const t = useTranslations("adminYoutube");
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [clips, setClips] = useState<Clip[]>([]);
  const [horizontalMode, setHorizontalMode] = useState<"crop" | "blur">("crop");
  const [audio, setAudio] = useState<"silent" | "ambient">("silent");
  // 컷 속도 조절(복도는 빠르게·방은 천천히)과 나레이션 밑 배경음 — 둘 다 기본 켬.
  const [pacing, setPacing] = useState(true);
  const [bgm, setBgm] = useState<"soft" | "none">("soft");
  const [headline, setHeadline] = useState("");
  const [villaId, setVillaId] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);

  const [villas, setVillas] = useState<VillaOption[]>([]);
  const [villaQuery, setVillaQuery] = useState("");
  const [villaLoadError, setVillaLoadError] = useState(false);

  // ── 빌라 영상 불러오기(VillaClip 소비) — 재업로드 없이 승인된 빌라 자산을 소재로 쓴다 ──
  const [importVillaId, setImportVillaId] = useState("");
  const [importOptions, setImportOptions] = useState<VillaClipOption[]>([]);
  const [importState, setImportState] = useState<"idle" | "loading" | "error">("idle");

  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xhrs = useRef<Map<string, XMLHttpRequest>>(new Map());

  // 실행(STEP 3) 상태
  const [runState, setRunState] = useState<"idle" | "creating" | "running" | "success" | "error">(
    "idle"
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResp | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // 빌라 목록(선택용) — id·name만 사용. 실패해도 마법사 진행 가능(빌라는 선택).
  useEffect(() => {
    let alive = true;
    fetch("/api/villas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: unknown) => {
        if (!alive || !Array.isArray(data)) return;
        setVillas(
          data.map((v) => ({
            id: String((v as VillaOption).id),
            name: String((v as VillaOption).name ?? ""),
            complex: (v as VillaOption).complex ?? null,
            nameVi: (v as VillaOption).nameVi ?? null,
          }))
        );
      })
      .catch(() => {
        if (alive) setVillaLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 선택한 빌라의 **승인된** 영상만 불러온다. 미승인(UPLOADED·REJECTED)은 소재가 될 수 없고
  // 서버도 거부하므로(CLIP_NOT_USABLE), 애초에 목록에서 뺀다.
  useEffect(() => {
    if (!importVillaId) {
      setImportOptions([]);
      setImportState("idle");
      return;
    }
    let alive = true;
    setImportState("loading");
    fetch(`/api/villas/${importVillaId}/clips`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { clips?: VillaClipOption[] }) => {
        if (!alive) return;
        setImportOptions((data?.clips ?? []).filter((c) => c.status === "APPROVED"));
        setImportState("idle");
      })
      .catch(() => {
        if (alive) {
          setImportOptions([]);
          setImportState("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [importVillaId]);

  // 언마운트 시 진행 중 XHR 취소
  useEffect(() => {
    const map = xhrs.current;
    return () => {
      map.forEach((x) => x.abort());
      map.clear();
    };
  }, []);

  const doneClips = useMemo(() => clips.filter((c) => c.status === "done"), [clips]);
  const anyUploading = clips.some((c) => c.status === "uploading");

  const updateClip = useCallback((localId: string, patch: Partial<Clip>) => {
    setClips((prev) => prev.map((c) => (c.localId === localId ? { ...c, ...patch } : c)));
  }, []);

  // 단일 클립 업로드 (presign → R2 PUT). 진행률·상태 갱신.
  const uploadClip = useCallback(
    async (clip: Clip) => {
      // 빌라 영상에서 불러온 항목은 업로드 대상이 아니다(파일이 없다).
      const file = clip.file;
      if (!file) return;
      updateClip(clip.localId, { status: "uploading", progress: 0, key: null });
      try {
        const presignRes = await fetch("/api/youtube/clips/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: clip.fileName,
            contentType: file.type || "video/mp4",
            sizeBytes: clip.sizeBytes,
          }),
        });
        if (!presignRes.ok) {
          let code = "";
          try {
            code = (await presignRes.json())?.error ?? "";
          } catch {
            /* ignore */
          }
          const msg =
            presignRes.status === 503 || code === "R2_NOT_CONFIGURED"
              ? t("create.step1.r2NotConfigured")
              : code === "TOO_LARGE"
                ? t("create.step1.tooLarge")
                : code === "DISALLOWED_TYPE"
                  ? t("create.step1.badType")
                  : t("create.step1.presignError");
          updateClip(clip.localId, { status: "error" });
          setUploadError(msg);
          return;
        }
        const presign = (await presignRes.json()) as PresignResp;

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrs.current.set(clip.localId, xhr);
          xhr.open(presign.method || "PUT", presign.uploadUrl);
          for (const [k, v] of Object.entries(presign.headers ?? {})) {
            xhr.setRequestHeader(k, v);
          }
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              updateClip(clip.localId, { progress: Math.round((e.loaded / e.total) * 100) });
            }
          };
          xhr.onload = () => {
            xhrs.current.delete(clip.localId);
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`PUT ${xhr.status}`));
          };
          xhr.onerror = () => {
            xhrs.current.delete(clip.localId);
            reject(new Error("network"));
          };
          xhr.onabort = () => {
            xhrs.current.delete(clip.localId);
            reject(new Error("abort"));
          };
          xhr.send(file);
        });

        updateClip(clip.localId, { status: "done", progress: 100, key: presign.key });
      } catch (e) {
        if ((e as Error)?.message === "abort") return; // 언마운트/제거
        updateClip(clip.localId, { status: "error" });
        setUploadError(t("create.step1.uploadError"));
      }
    },
    [t, updateClip]
  );

  // 파일 선택 → 검증 → 큐 등록 → 업로드 시작
  const onFilesPicked = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setUploadError(null);
      const incoming = Array.from(fileList);
      setClips((prev) => {
        const room = MAX_CLIPS - prev.length;
        if (room <= 0) {
          setUploadError(t("create.step1.limitReached"));
          return prev;
        }
        const accepted: Clip[] = [];
        for (const file of incoming) {
          if (accepted.length >= room) {
            setUploadError(t("create.step1.limitReached"));
            break;
          }
          const okType = ALLOWED_MIME.has(file.type) || ALLOWED_EXT.test(file.name);
          if (!okType) {
            setUploadError(t("create.step1.badType"));
            continue;
          }
          if (file.size > MAX_SIZE) {
            setUploadError(t("create.step1.tooLarge"));
            continue;
          }
          accepted.push({
            localId: nextId(),
            file,
            fileName: file.name,
            sizeBytes: file.size,
            status: "uploading",
            progress: 0,
            key: null,
            villaClipId: null,
            startSec: "",
            durationSec: "",
            space: "",
            note: "",
          });
        }
        // 업로드는 다음 tick(상태 반영 후) 시작
        accepted.forEach((c) => queueMicrotask(() => uploadClip(c)));
        return [...prev, ...accepted];
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [t, uploadClip]
  );

  // 승인 영상 → 소재 목록에 추가. 업로드가 없으므로 곧바로 "done"이다.
  const addVillaClip = useCallback(
    (opt: VillaClipOption) => {
      setUploadError(null);
      setClips((prev) => {
        if (prev.some((c) => c.villaClipId === opt.id)) return prev; // 같은 영상 두 번 담기 방지
        if (prev.length >= MAX_CLIPS) {
          setUploadError(t("create.step1.limitReached"));
          return prev;
        }
        return [
          ...prev,
          {
            localId: nextId(),
            file: null,
            fileName: opt.note?.trim() || t("create.step1.villaClipName"),
            sizeBytes: opt.sizeBytes,
            status: "done" as ClipStatus,
            progress: 100,
            key: null,
            villaClipId: opt.id,
            startSec: "",
            // 실제 길이를 트림 상한(2~8초)에 맞춰 기본값으로 채운다 — 운영자가 STEP 2에서 조정.
            durationSec: String(Math.min(DUR_MAX, Math.max(DUR_MIN, opt.durationSec))),
            // 공급자가 등록할 때 고른 공간·메모를 그대로 물려받는다 — 대본·속도 조절의 입력.
            space: opt.space ?? "",
            note: opt.note ?? "",
          },
        ];
      });
      // STEP 2의 빌라 선택을 미리 채운다 — 같은 값을 두 번 고르게 하지 않는다.
      setVillaId((cur) => cur ?? importVillaId);
    },
    [importVillaId, t]
  );

  const removeClip = useCallback((localId: string) => {
    const x = xhrs.current.get(localId);
    if (x) {
      x.abort();
      xhrs.current.delete(localId);
    }
    setClips((prev) => prev.filter((c) => c.localId !== localId));
  }, []);

  const moveClip = useCallback((index: number, dir: -1 | 1) => {
    setClips((prev) => {
      const to = index + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }, []);

  const addSubtitle = () =>
    setSubtitles((prev) =>
      prev.length >= MAX_SUBTITLES ? prev : [...prev, { text: "", fromSec: "", toSec: "" }]
    );
  const removeSubtitle = (i: number) =>
    setSubtitles((prev) => prev.filter((_, idx) => idx !== i));
  const updateSubtitle = (i: number, patch: Partial<Subtitle>) =>
    setSubtitles((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const filteredVillas = useMemo(() => {
    const q = villaQuery.trim().toLowerCase();
    const base = q
      ? villas.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            (v.nameVi ?? "").toLowerCase().includes(q) ||
            (v.complex ?? "").toLowerCase().includes(q)
        )
      : villas;
    return base.slice(0, 40);
  }, [villas, villaQuery]);

  const selectedVilla = useMemo(
    () => villas.find((v) => v.id === villaId) ?? null,
    [villas, villaId]
  );

  // edit-jobs 생성 + run 실행(동기). retry=true면 기존 잡 id 재실행.
  const runEdit = useCallback(
    async (retry: boolean) => {
      if (runState === "creating" || runState === "running") return;
      setRunError(null);

      let jobId = jobIdRef.current;
      try {
        if (!retry || !jobId) {
          // 잡 생성
          setRunState("creating");
          const params: Record<string, unknown> = {
            clips: doneClips.map((c) => {
              const startSec = c.startSec.trim() === "" ? undefined : Number(c.startSec);
              const durationSec = c.durationSec.trim() === "" ? undefined : Number(c.durationSec);
              return {
                // 빌라 자산은 id만 보낸다 — r2Key는 서버만 안다(클라 응답에 키가 없다).
                ...(c.villaClipId ? { villaClipId: c.villaClipId } : { key: c.key }),
                ...(startSec != null && Number.isFinite(startSec) ? { startSec } : {}),
                ...(durationSec != null && Number.isFinite(durationSec)
                  ? { durationSec }
                  : {}),
                // ★ 공간·메모를 반드시 함께 보낸다: 이게 빠지면 대본이 "공간 미지정"으로 생성되고
                //   컷 속도 조절도 판정 근거가 없어 전부 정속으로 돈다(2026-07-23까지의 실제 상태).
                ...(c.space ? { space: c.space } : {}),
                ...(c.note.trim() ? { note: c.note.trim() } : {}),
              };
            }),
            headline: headline.trim(),
            audio,
            horizontalMode,
            pacing,
            bgm,
            ...(villaId ? { villaId } : {}),
            ...(subtitles.length
              ? {
                  subtitles: subtitles
                    .filter((s) => s.text.trim() !== "")
                    .map((s) => ({
                      text: s.text.trim(),
                      fromSec: Number(s.fromSec) || 0,
                      toSec: Number(s.toSec) || 0,
                    })),
                }
              : {}),
          };
          const createRes = await fetch("/api/youtube/edit-jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ params, ...(villaId ? { villaId } : {}) }),
          });
          if (!createRes.ok) {
            // 소재 자격 거부는 원인이 분명하므로 일반 오류로 뭉뚱그리지 않는다
            // (빌라 불일치는 STEP 2에서 다른 빌라를 고른 경우라 안내 없이는 원인을 알 수 없다).
            let code = "";
            try {
              code = (await createRes.json())?.error ?? "";
            } catch {
              /* ignore */
            }
            setRunState("error");
            setRunError(
              code === "CLIP_VILLA_MISMATCH"
                ? t("create.step3.clipVillaMismatch")
                : code === "CLIP_NOT_USABLE"
                  ? t("create.step3.clipNotUsable")
                  : t("create.step3.createError")
            );
            return;
          }
          const created = (await createRes.json()) as { id: string };
          jobId = created.id;
          jobIdRef.current = jobId;
        }

        // 대기열 등록(비동기) — 렌더는 cron이 수행한다. 동기 실행은 브라우저 타임아웃 때문에 폐지.
        setRunState("running");
        const runRes = await fetch(`/api/youtube/edit-jobs/${jobId}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(retry ? { retry: true } : {}),
        });
        if (runRes.status === 409) {
          setRunState("error");
          setRunError(t("create.step3.invalidState"));
          return;
        }
        if (!runRes.ok) {
          let reason = "";
          try {
            reason = (await runRes.json())?.reason ?? "";
          } catch {
            /* ignore */
          }
          setRunState("error");
          setRunError(reason || t("create.step3.runError"));
          return;
        }
        const data = (await runRes.json()) as RunResp;
        setResult(data);
        setRunState("success");
      } catch {
        setRunState("error");
        setRunError(t("create.step3.runError"));
      }
    },
    [
      runState,
      doneClips,
      headline,
      audio,
      horizontalMode,
      pacing,
      bgm,
      villaId,
      subtitles,
      t,
    ]
  );

  const canProceedFrom1 = doneClips.length >= 1 && !anyUploading;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{t("create.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("create.subtitle")}</p>
        </div>
        <Link
          href="/marketing/youtube"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {t("create.back")}
        </Link>
      </div>

      {/* 스텝 인디케이터 */}
      <ol className="flex items-center gap-2">
        {([1, 2, 3] as const).map((n, i) => {
          const key = n === 1 ? "upload" : n === 2 ? "compose" : "run";
          const active = step === n;
          const done = step > n;
          return (
            <li key={n} className="flex flex-1 items-center gap-2">
              <span
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  active
                    ? "bg-admin-primary text-white"
                    : done
                      ? "bg-admin-primary/20 text-admin-primary"
                      : "bg-slate-800 text-slate-500"
                }`}
              >
                {done ? "✓" : n}
              </span>
              <span
                className={`hidden truncate text-xs font-bold sm:block ${
                  active ? "text-white" : "text-slate-500"
                }`}
              >
                {t(`create.steps.${key}`)}
              </span>
              {i < 2 && <span className="h-px flex-1 bg-slate-800" />}
            </li>
          );
        })}
      </ol>

      {/* ── STEP 1: 클립 업로드 ── */}
      {step === 1 && (
        <section className="space-y-4 rounded-xl border border-slate-800/50 bg-admin-card p-5">
          <div>
            <h2 className="text-sm font-bold text-slate-200">{t("create.step1.title")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("create.step1.hint")}</p>
          </div>

          {/* ── 빌라 영상 불러오기 — 공급자·운영자가 올려 승인된 자산을 재업로드 없이 소재로 ── */}
          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[20px] text-admin-primary">
                video_library
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-200">
                  {t("create.step1.importTitle")}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t("create.step1.importHint")}
                </p>
              </div>
            </div>

            <select
              value={importVillaId}
              onChange={(e) => setImportVillaId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">{t("create.step1.importPickVilla")}</option>
              {villas.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.complex ? ` · ${v.complex}` : ""}
                </option>
              ))}
            </select>

            {importState === "loading" && (
              <p className="text-xs text-slate-500">{t("create.step1.importLoading")}</p>
            )}
            {importState === "error" && (
              <p className="text-xs font-semibold text-red-300">{t("create.step1.importError")}</p>
            )}
            {importState === "idle" && importVillaId && importOptions.length === 0 && (
              <p className="text-xs text-slate-500">{t("create.step1.importEmpty")}</p>
            )}

            {importOptions.length > 0 && (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {importOptions.map((opt) => {
                  const picked = clips.some((c) => c.villaClipId === opt.id);
                  return (
                    <li key={opt.id}>
                      <button
                        type="button"
                        onClick={() => addVillaClip(opt)}
                        disabled={picked}
                        className="flex w-full flex-col items-start gap-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left transition-colors hover:border-admin-primary/60 disabled:opacity-40"
                      >
                        <span className="flex w-full items-center justify-between gap-1">
                          <span className="truncate text-xs font-bold text-slate-200">
                            {opt.space
                              ? t(`create.step1.space.${opt.space}` as never)
                              : t("create.step1.villaClipName")}
                          </span>
                          {picked && (
                            <span className="material-symbols-outlined text-[16px] text-emerald-400">
                              check
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {opt.durationSec}s · {opt.width}×{opt.height}
                        </span>
                        {opt.note && (
                          <span className="line-clamp-1 text-[11px] text-slate-500">{opt.note}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            multiple
            hidden
            onChange={(e) => onFilesPicked(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={clips.length >= MAX_CLIPS}
            className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-slate-700 px-6 py-8 text-center transition-colors hover:border-admin-primary/60 hover:bg-slate-900/40 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[32px] text-slate-500">upload</span>
            <span className="text-sm font-bold text-slate-200">{t("create.step1.pick")}</span>
            <span className="text-[11px] text-slate-500">{t("create.step1.dropHint")}</span>
          </button>

          {uploadError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
              {uploadError}
            </p>
          )}

          {clips.length > 0 && (
            <ul className="flex flex-col gap-2">
              {clips.map((c) => (
                <li
                  key={c.localId}
                  className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
                >
                  <span className="material-symbols-outlined text-[20px] text-slate-500">
                    movie
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-200">{c.fileName}</p>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {fmtSize(c.sizeBytes)}
                      {c.status === "uploading" && ` · ${t("create.step1.uploading")} ${c.progress}%`}
                      {c.status === "done" && ` · ${t("create.step1.uploaded")}`}
                      {c.status === "error" && ` · ${t("create.step1.failed")}`}
                    </p>
                    {c.status === "uploading" && (
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-admin-primary transition-all"
                          style={{ width: `${c.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {c.status === "done" && (
                    <span className="material-symbols-outlined text-[20px] text-emerald-400">
                      check_circle
                    </span>
                  )}
                  {c.status === "error" && (
                    <button
                      type="button"
                      onClick={() => uploadClip(c)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:bg-slate-800"
                    >
                      <span className="material-symbols-outlined text-[14px]">refresh</span>
                      {t("create.step1.retry")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeClip(c.localId)}
                    aria-label={t("create.step1.remove")}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-red-400"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-500 tabular-nums">
              {t("create.step1.countLabel", { n: doneClips.length })}
            </span>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!canProceedFrom1}
              className="inline-flex items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
            >
              {t("next")}
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 2: 구성 ── */}
      {step === 2 && (
        <section className="space-y-5 rounded-xl border border-slate-800/50 bg-admin-card p-5">
          <h2 className="text-sm font-bold text-slate-200">{t("create.step2.title")}</h2>

          {/* 클립 순서·구간 */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("create.step2.clipsTitle")}
            </p>
            <ul className="flex flex-col gap-2">
              {clips.map((c, i) => (
                <li
                  key={c.localId}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-800 text-[11px] font-bold text-slate-300 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">
                    {c.fileName}
                  </span>
                  {/* 공간 — 대본 문장과 컷 속도(복도는 빠르게·방은 천천히)를 함께 결정한다 */}
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    {t("create.step2.space")}
                    <select
                      value={c.space}
                      onChange={(e) => updateClip(c.localId, { space: e.target.value })}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:border-admin-primary focus:outline-none"
                    >
                      <option value="">{t("create.step2.spaceNone")}</option>
                      {SPACES.map((s) => (
                        <option key={s} value={s}>
                          {t(`create.step1.space.${s}` as never)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    {t("create.step2.startSec")}
                    <input
                      type="number"
                      min={0}
                      value={c.startSec}
                      onChange={(e) => updateClip(c.localId, { startSec: e.target.value })}
                      className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 tabular-nums focus:border-admin-primary focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    {t("create.step2.durationSec")}
                    <input
                      type="number"
                      min={DUR_MIN}
                      max={DUR_MAX}
                      value={c.durationSec}
                      placeholder="4"
                      onChange={(e) => updateClip(c.localId, { durationSec: e.target.value })}
                      className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 tabular-nums focus:border-admin-primary focus:outline-none"
                    />
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveClip(i, -1)}
                      disabled={i === 0}
                      aria-label={t("create.step2.moveUp")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveClip(i, 1)}
                      disabled={i === clips.length - 1}
                      aria-label={t("create.step2.moveDown")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-600">{t("create.step2.durationHint")}</p>
            <p className="text-[11px] text-slate-600">{t("create.step2.spaceHint")}</p>
            {/* 컷별 메모 — 같은 공간이 여러 컷일 때 대본이 "또 다른 침실입니다"로 뭉개지지 않게 한다 */}
            <ul className="flex flex-col gap-2">
              {clips.map((c, i) => (
                <li key={`note-${c.localId}`} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-[11px] text-slate-600 tabular-nums">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={c.note}
                    maxLength={200}
                    placeholder={t("create.step2.notePlaceholder")}
                    onChange={(e) => updateClip(c.localId, { note: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-admin-primary focus:outline-none"
                  />
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-600">{t("create.step2.noteHint")}</p>
          </div>

          {/* 컷 속도 조절 — 복도·계단은 빠르게 지나가고 수영장·외관은 여유 있게 */}
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("create.step2.pacingTitle")}
            </legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
              <input
                type="checkbox"
                checked={pacing}
                onChange={(e) => setPacing(e.target.checked)}
                className="mt-0.5 accent-admin-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-slate-200">{t("create.step2.pacingOn")}</span>
                <span className="text-[11px] text-slate-500">{t("create.step2.pacingHint")}</span>
              </span>
            </label>
          </fieldset>

          {/* 나레이션 밑 배경음 */}
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("create.step2.bgmTitle")}
            </legend>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
              {(["soft", "none"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBgm(b)}
                  className={`px-4 py-1.5 text-xs font-bold transition-colors ${
                    bgm === b
                      ? "bg-admin-primary text-white"
                      : "bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {t(`create.step2.bgm_${b}`)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-600">{t("create.step2.bgmHint")}</p>
          </fieldset>

          {/* 가로 클립 처리 */}
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("create.step2.horizontalTitle")}
            </legend>
            <p className="text-[11px] text-slate-600">{t("create.step2.horizontalHint")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(["crop", "blur"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 ${
                    horizontalMode === m
                      ? "border-admin-primary bg-admin-primary/10"
                      : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
                    <input
                      type="radio"
                      name="horizontalMode"
                      checked={horizontalMode === m}
                      onChange={() => setHorizontalMode(m)}
                      className="accent-admin-primary"
                    />
                    {t(`create.step2.${m}`)}
                  </span>
                  <span className="pl-6 text-[11px] text-slate-500">
                    {t(`create.step2.${m}Hint`)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* 오디오 */}
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("create.step2.audioTitle")}
            </legend>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
              {(["silent", "ambient"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAudio(a)}
                  className={`px-4 py-1.5 text-xs font-bold transition-colors ${
                    audio === a
                      ? "bg-admin-primary text-white"
                      : "bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {t(`create.step2.${a}`)}
                </button>
              ))}
            </div>
          </fieldset>

          {/* 헤드라인 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t("create.step2.headlineTitle")}
              </label>
              <span
                className={`text-[11px] font-semibold tabular-nums ${
                  headline.length > HEADLINE_MAX ? "text-red-400" : "text-slate-500"
                }`}
              >
                {headline.length}/{HEADLINE_MAX}
              </span>
            </div>
            <input
              type="text"
              value={headline}
              maxLength={HEADLINE_MAX}
              placeholder={t("create.step2.headlinePlaceholder")}
              onChange={(e) => setHeadline(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
            />
            <p className="text-[11px] text-slate-600">{t("create.step2.headlineHint")}</p>
          </div>

          {/* 빌라 선택 */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("create.step2.villaTitle")}
            </label>
            <p className="text-[11px] text-slate-600">{t("create.step2.villaHint")}</p>
            {villaLoadError ? (
              <p className="text-xs text-amber-400">{t("create.step2.villaLoadError")}</p>
            ) : (
              <>
                <input
                  type="text"
                  value={villaQuery}
                  placeholder={t("create.step2.villaSearchPlaceholder")}
                  onChange={(e) => setVillaQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-admin-primary focus:outline-none"
                />
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setVillaId(null)}
                    className={`text-left rounded-lg border px-3 py-2 text-sm ${
                      villaId === null
                        ? "border-admin-primary bg-admin-primary/10 text-white"
                        : "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    {t("create.step2.villaNone")}
                  </button>
                  {filteredVillas.map((v) => {
                    const active = v.id === villaId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVillaId(v.id)}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left ${
                          active
                            ? "border-admin-primary bg-admin-primary/10"
                            : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                        }`}
                      >
                        <span className="min-w-0">
                          {v.complex && (
                            <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              {v.complex}
                            </span>
                          )}
                          <span className="block truncate text-sm font-bold text-slate-100">
                            {v.name}
                          </span>
                        </span>
                        {active && (
                          <span className="material-symbols-outlined shrink-0 text-admin-primary">
                            check_circle
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* 자막 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {t("create.step2.subtitlesTitle")}
              </p>
              <button
                type="button"
                onClick={addSubtitle}
                disabled={subtitles.length >= MAX_SUBTITLES}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                {t("create.step2.addSubtitle")}
              </button>
            </div>
            <p className="text-[11px] text-slate-600">{t("create.step2.subtitlesHint")}</p>
            {subtitles.map((s, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
              >
                <input
                  type="text"
                  value={s.text}
                  placeholder={t("create.step2.subtitleText")}
                  onChange={(e) => updateSubtitle(i, { text: e.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:border-admin-primary focus:outline-none"
                />
                <label className="flex items-center gap-1 text-[11px] text-slate-500">
                  {t("create.step2.subtitleFrom")}
                  <input
                    type="number"
                    min={0}
                    value={s.fromSec}
                    onChange={(e) => updateSubtitle(i, { fromSec: e.target.value })}
                    className="w-14 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 tabular-nums focus:border-admin-primary focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-slate-500">
                  {t("create.step2.subtitleTo")}
                  <input
                    type="number"
                    min={0}
                    value={s.toSec}
                    onChange={(e) => updateSubtitle(i, { toSec: e.target.value })}
                    className="w-14 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 tabular-nums focus:border-admin-primary focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeSubtitle(i)}
                  aria-label={t("create.step2.removeSubtitle")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-red-400"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            ))}
          </div>

          {/* 네비게이션 */}
          <div className="flex items-center justify-between border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              {t("prev")}
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              {t("next")}
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 3: 편집 실행 ── */}
      {step === 3 && (
        <section className="space-y-4 rounded-xl border border-slate-800/50 bg-admin-card p-5">
          <h2 className="text-sm font-bold text-slate-200">{t("create.step3.title")}</h2>

          {/* 요약 */}
          <div className="flex flex-wrap gap-2">
            <Chip>{t("create.step3.summaryClips", { n: doneClips.length })}</Chip>
            <Chip>
              {headline.trim()
                ? t("create.step3.summaryHeadlineOn")
                : t("create.step3.summaryHeadlineOff")}
            </Chip>
            {subtitles.filter((s) => s.text.trim()).length > 0 && (
              <Chip>
                {t("create.step3.summarySubtitles", {
                  n: subtitles.filter((s) => s.text.trim()).length,
                })}
              </Chip>
            )}
            {selectedVilla && <Chip>{selectedVilla.name}</Chip>}
          </div>

          {/* 상태별 */}
          {runState === "success" && result ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-6 text-center">
                <span className="material-symbols-outlined text-[36px] text-emerald-400">
                  check_circle
                </span>
                <div>
                  <p className="text-sm font-bold text-emerald-300">
                    {t("create.step3.successTitle")}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{t("create.step3.successHint")}</p>
                </div>
              </div>
              {/* 미리보기 없음 — 이 시점엔 아직 렌더 전이다(대기열 등록만 됨).
                  완성되면 운영자에게 알림이 가고, 승인 큐 카드에서 미리보기할 수 있다. */}
              <div className="flex justify-center">
                <Link
                  href="/marketing/youtube?status=PENDING_APPROVAL"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-admin-primary px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
                >
                  <span className="material-symbols-outlined text-base">list</span>
                  {t("create.step3.goToQueue")}
                </Link>
              </div>
            </div>
          ) : runState === "creating" || runState === "running" ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
              <span className="material-symbols-outlined animate-spin text-[36px] text-admin-primary">
                progress_activity
              </span>
              <p className="text-sm font-bold text-slate-200">{t("create.step3.running")}</p>
              <p className="text-xs text-slate-500">{t("create.step3.runningHint")}</p>
            </div>
          ) : (
            <>
              {runState === "error" && runError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                  {runError}
                </div>
              )}
              {doneClips.length < 1 && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300">
                  {t("create.step3.needClip")}
                </p>
              )}
              <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
                >
                  <span className="material-symbols-outlined text-base">arrow_back</span>
                  {t("prev")}
                </button>
                <button
                  type="button"
                  onClick={() => runEdit(runState === "error")}
                  disabled={doneClips.length < 1}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-admin-primary px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-base">
                    {runState === "error" ? "refresh" : "auto_awesome"}
                  </span>
                  {runState === "error" ? t("create.step3.retry") : t("create.step3.run")}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/50 px-3 py-1 text-[11px] font-semibold text-slate-300">
      {children}
    </span>
  );
}
