"use client";

// 공용 날짜 입력 — iOS Safari의 빈 <input type="date"> 공백 렌더 보완.
//
// 문제: iOS Safari(WebKit)는 값이 없는 date 입력을 placeholder 없이 "완전 공백 박스"로 렌더한다.
//   (Chrome은 "연도-월-일" 네이티브 표기를 보임.) 그래서 아이폰에서 체크인/체크아웃 같은 빈 날짜칸이
//   고장난 빈 박스처럼 보인다. 2026-07-09 WebKit(iPhone)로 재현.
//
// 실패한 접근들(모두 iOS 실기기에서 네이티브 date 컨트롤이 위를 덮어 안 보임):
//   ① 형제 span 오버레이(input 위) ② input의 background-image(SVG 텍스트).
//   → 네이티브 컨트롤은 자신보다 위/자신의 배경을 모두 덮어 그린다.
//
// 해결(레이어 독립·투명 기법): 박스 스타일(bg·border·rounded·padding·글자색)을 **래퍼 div**에 두고,
//   실제 <input>은 **배경을 투명**하게 해서 래퍼 위에 얹는다. 안내 문구 span은 input **뒤(z-0)**에 둔다.
//   값이 없으면 input이 투명하므로 뒤의 안내 문구가 그대로 비쳐 보인다(네이티브 컨트롤이 덮어도 뒤라서 무관).
//   값이 차면 input의 네이티브 날짜 텍스트가 앞(z-10)에서 보이고 안내 문구는 렌더하지 않는다.
//   Chrome은 빈 값에 "연도-월-일" 네이티브 표기를 보이므로 `date-empty` 클래스로 globals.css가 이를 숨긴다.
//
// 사용처: 전 포털의 type="date" 입력을 이 컴포넌트로 교체. RHF register 스프레드/제어 컴포넌트 모두 지원.
import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from "react";

type DateFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** 값이 비었을 때 표시할 안내 문구 (i18n 번역문을 넘긴다) */
  placeholder?: string;
  /** 안내 문구 색상(hex). 기본 #94a3b8(slate-400) — 다크·라이트 배경 모두에서 보임 */
  placeholderColor?: string;
  /** (구버전 호환용, 미사용) */
  placeholderClassName?: string;
  /** relative 래퍼에 추가할 클래스 (레이아웃 조정용) */
  wrapperClassName?: string;
};

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    placeholder,
    placeholderColor = "#94a3b8",
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    placeholderClassName,
    wrapperClassName = "",
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

  // 래퍼가 박스(caller className) 역할. 안내 문구는 input 뒤, input은 투명하게 앞.
  return (
    <div className={`relative ${wrapperClassName} ${className}`}>
      {empty && placeholder ? (
        <span
          aria-hidden
          // padding:inherit → 래퍼 패딩만큼 들여써서 input 값 텍스트와 좌측 정렬을 맞춘다
          style={{ padding: "inherit", color: placeholderColor }}
          className="pointer-events-none absolute inset-0 z-0 flex items-center overflow-hidden whitespace-nowrap"
        >
          {placeholder}
        </span>
      ) : null}
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
        // 투명 배경 + 패딩/보더 제거(박스는 래퍼가 담당). 글자색·폰트·color-scheme은 래퍼에서 상속.
        className={`relative z-10 w-full border-0 bg-transparent p-0 outline-none${empty ? " date-empty" : ""}`}
      />
    </div>
  );
});
