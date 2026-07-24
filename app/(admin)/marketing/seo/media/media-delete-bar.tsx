"use client";

// 자료 사진 다중선택 영구삭제 툴바(클라이언트).
//   ★ 문구는 전부 props로 주입한다 — useTranslations 금지(MediaUploader와 동일 원칙,
//     admin 클라 NS 화이트리스트 함정 회피).
//   ★ 체크박스는 목록 <li> 안에 순수 HTML로 있고 form 속성으로 삭제 form에 연결돼 있다
//     (각 <li>가 이미 수정·중지용 <form>을 품고 있어 중첩 form이 불가하므로, 감싸지 않고 form 속성으로 묶는다).
//   ★ 삭제는 되돌릴 수 없으므로 submit 전에 window.confirm — 취소 시 preventDefault로 제출을 막는다.
import { useState } from "react";

export default function MediaDeleteBar({
  selectAllLabel,
  deleteLabel,
  deletingLabel,
  confirmTemplate,
  noneSelectedText,
}: {
  selectAllLabel: string;
  deleteLabel: string;
  deletingLabel: string;
  /** "{n}"을 포함한 확인 문구 — 실제 선택 개수로 치환해서 보여준다 */
  confirmTemplate: string;
  noneSelectedText: string;
}) {
  const [deleting, setDeleting] = useState(false);

  // 목록의 삭제 대상 체크박스들(data-media-select). 업로드 폼의 topicKeys 체크박스와 섞이지 않는다.
  const boxes = () =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="ids"][data-media-select="1"]'),
    );

  const toggleAll = () => {
    const all = boxes();
    const shouldCheck = all.some((b) => !b.checked);
    all.forEach((b) => {
      b.checked = shouldCheck;
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggleAll}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-800"
      >
        <span className="material-symbols-outlined text-[16px]">select_all</span>
        {selectAllLabel}
      </button>

      <button
        type="submit"
        disabled={deleting}
        onClick={(e) => {
          const checked = boxes().filter((b) => b.checked);
          if (checked.length === 0) {
            e.preventDefault();
            window.alert(noneSelectedText);
            return;
          }
          if (!window.confirm(confirmTemplate.replace("{n}", String(checked.length)))) {
            e.preventDefault();
            return;
          }
          setDeleting(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-red-500 active:scale-[0.98] disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[16px]">delete_forever</span>
        {deleting ? deletingLabel : deleteLabel}
      </button>
    </div>
  );
}
