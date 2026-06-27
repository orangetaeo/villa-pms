"use client";

// 리스트 공통 검색 입력 — 돋보기 아이콘 + 지우기(clear) 버튼. 운영자(다크)·포털(라이트) 양쪽.
// PaginationBar와 동일하게 두 모드 지원:
//  ① controlled 모드: value + onChange 전달 → 클라이언트 인메모리 목록 필터용(부모가 상태 보유).
//  ② URL 모드: value/onChange 생략 → q(기본) 파라미터를 디바운스로 갱신, RSC 목록(서버 where)용.
//     검색어 변경 시 page 파라미터를 제거해 1페이지로 되돌린다.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function ListSearch({
  placeholder,
  value,
  onChange,
  light = false,
  paramKey = "q",
  className = "",
}: {
  placeholder: string;
  /** controlled 모드: 둘 다 주면 URL 대신 부모 상태로 동작 */
  value?: string;
  onChange?: (v: string) => void;
  /** 포털(라이트) 화면이면 true — 기본은 운영자 다크 */
  light?: boolean;
  /** URL 모드에서 쓸 검색 파라미터 키 (기본 q) */
  paramKey?: string;
  className?: string;
}) {
  const controlled = value !== undefined && !!onChange;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL 모드 로컬 입력값(디바운스 전 즉시 반영). controlled면 미사용.
  const [local, setLocal] = useState(searchParams.get(paramKey) ?? "");
  useEffect(() => {
    // 외부에서 q가 바뀌면(필터 초기화 등) 동기화
    if (!controlled) setLocal(searchParams.get(paramKey) ?? "");
  }, [searchParams, paramKey, controlled]);

  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushUrl = (v: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (v.trim()) next.set(paramKey, v.trim());
    else next.delete(paramKey);
    next.delete("page"); // 검색 변경 → 1페이지로
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handle = (v: string) => {
    if (controlled) {
      onChange!(v);
      return;
    }
    setLocal(v);
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => pushUrl(v), 350);
  };

  const clear = () => {
    if (controlled) {
      onChange!("");
      return;
    }
    setLocal("");
    if (debRef.current) clearTimeout(debRef.current);
    pushUrl("");
  };

  const cur = controlled ? value! : local;

  // 테마 클래스
  const wrap = light
    ? "border-neutral-300 bg-white text-neutral-900 focus-within:ring-teal-500"
    : "border-slate-700 bg-slate-900 text-slate-200 focus-within:ring-admin-primary";
  const iconCls = light ? "text-neutral-400" : "text-slate-500";

  return (
    <div
      className={`relative flex items-center rounded-lg border px-2.5 focus-within:ring-1 ${wrap} ${className}`}
    >
      <span className={`material-symbols-outlined text-lg pointer-events-none ${iconCls}`}>
        search
      </span>
      <input
        type="search"
        value={cur}
        onChange={(e) => handle(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent px-2 py-2 text-sm focus:outline-none placeholder:text-slate-400"
      />
      {cur && (
        <button
          type="button"
          onClick={clear}
          aria-label={placeholder}
          className={`shrink-0 ${iconCls} hover:opacity-70`}
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      )}
    </div>
  );
}
