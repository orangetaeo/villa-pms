"use client";

// 공용 날짜 입력 — iOS Safari의 빈 <input type="date"> 공백 렌더 보완.
//
// 문제: iOS Safari(WebKit)는 값이 없는 date 입력을 placeholder 없이 "완전 공백 박스"로 렌더한다.
//   (Chrome은 "연도-월-일" 네이티브 표기를 보임.) 그래서 아이폰에서 체크인/체크아웃 같은 빈 날짜칸이
//   "빈 오버레이 박스"처럼 보여 고장난 것으로 오인된다. 2026-07-09 WebKit(iPhone) 실측으로 재현·확인.
//
// 해결: 값이 비었을 때 안내 문구를 오버레이(span)로 얹는다. 동시에 input에 `date-empty` 클래스를 붙여
//   globals.css가 Chrome의 네이티브 "연도-월-일" 표기를 숨겨(오버레이와 겹침 방지) 두 브라우저 모두
//   동일하게 안내 문구만 보이게 한다. 값이 채워지면 클래스가 빠져 네이티브 날짜가 정상 표시된다.
//   오버레이는 pointer-events-none이라 탭은 그대로 input에 전달(네이티브 피커 열림).
//
// 사용처: 전 포털의 type="date" 입력을 이 컴포넌트로 교체. RHF register 스프레드/제어 컴포넌트 모두 지원.
import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from "react";

type DateFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** 값이 비었을 때 오버레이로 표시할 안내 문구 (i18n 번역문을 넘긴다) */
  placeholder?: string;
  /** 오버레이 안내 문구 색상 등 스타일 (테마별). 기본은 다크 대시보드용 text-slate-500 */
  placeholderClassName?: string;
  /** relative 래퍼에 추가할 클래스 (레이아웃 조정용) */
  wrapperClassName?: string;
};

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    placeholder,
    placeholderClassName = "text-slate-500",
    wrapperClassName = "w-full",
    className = "",
    value,
    onChange,
    onInput,
    ...rest
  },
  ref
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const [empty, setEmpty] = useState(true);

  const sync = useCallback(() => {
    setEmpty(!innerRef.current?.value);
  }, []);

  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
      if (el) setEmpty(!el.value);
    },
    [ref]
  );

  // 제어형 value prop 변경 / RHF setValue 후 재렌더 시 빈 상태 동기화
  useLayoutEffect(() => {
    sync();
  }, [value, sync]);

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...rest}
        ref={setRefs}
        type="date"
        value={value}
        onChange={(e) => {
          onChange?.(e);
          sync();
        }}
        onInput={(e) => {
          onInput?.(e);
          sync();
        }}
        className={`${className}${empty ? " date-empty" : ""}`}
      />
      {empty && placeholder ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm ${placeholderClassName}`}
        >
          {placeholder}
        </span>
      ) : null}
    </div>
  );
});
