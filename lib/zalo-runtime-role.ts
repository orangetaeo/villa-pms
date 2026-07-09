// lib/zalo-runtime-role.ts — 프로세스 역할 마커 (ADR-0032 리스너 워커 분리)
//
// 목적: 같은 코드가 두 프로세스(web / zalo-worker)에서 돈다. 세션 발송·실시간 신호의
//       분기 결정에 "나는 워커인가?"가 필요하다. 이 마커는 worker/index.ts가 부팅 최상단에서
//       markWorkerRuntime()로 세팅한다. 웹(Next.js)은 세팅하지 않으므로 기본값 false.
//
// 안전(기본-OFF): 마커 미세팅 = 웹 = 현행 동작 100% 보존(no-op). globalThis 캐시(HMR·중복 import 안전).
const g = globalThis as unknown as { __villaZaloWorkerRuntime?: boolean };

/** 이 프로세스를 리스너 워커로 표시 — worker/index.ts 부팅 시 1회 호출. */
export function markWorkerRuntime(): void {
  g.__villaZaloWorkerRuntime = true;
}

/** 현재 프로세스가 리스너 워커인가? (웹=false, 워커=true). */
export function isWorkerRuntime(): boolean {
  return g.__villaZaloWorkerRuntime === true;
}
