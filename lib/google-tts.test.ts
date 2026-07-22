// lib/google-tts.test.ts — Chirp 3: HD 어댑터 순수함수 테스트
//
// 여기서 반드시 잡아야 하는 것: **WAV 길이 파싱**. 나레이션 파이프라인은 오디오 길이로
// 컷 길이를 역산하므로(narration.ts), 길이가 틀리면 영상 전체의 화면·말이 어긋난다.
// Cloud TTS가 주는 WAV에 LIST 같은 부가 청크가 끼어도 정확해야 한다.
import { describe, it, expect } from "vitest";
import { parseWavDuration, toChirpVoiceName } from "./google-tts";
import { pcmToWav } from "./gemini-tts";

/** 임의 청크를 fmt와 data 사이에 끼운 WAV 생성기(Cloud TTS가 LIST를 넣는 경우 재현). */
function wavWithExtraChunk(pcmBytes: number, sampleRate = 24_000): Buffer {
  const pcm = Buffer.alloc(pcmBytes);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // mono
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * 2, 16); // byteRate
  fmt.writeUInt16LE(2, 20); // blockAlign
  fmt.writeUInt16LE(16, 22); // bits

  const listBody = Buffer.from("INFOISFT测", "utf8");
  const list = Buffer.alloc(8 + listBody.length + (listBody.length % 2));
  list.write("LIST", 0);
  list.writeUInt32LE(listBody.length, 4);
  listBody.copy(list, 8);

  const dataHdr = Buffer.alloc(8);
  dataHdr.write("data", 0);
  dataHdr.writeUInt32LE(pcm.length, 4);

  const body = Buffer.concat([Buffer.from("WAVE"), fmt, list, dataHdr, pcm]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0);
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

describe("parseWavDuration", () => {
  it("표준 44바이트 헤더 WAV의 길이를 정확히 읽는다", () => {
    // 24kHz · mono · 16bit → 초당 48,000바이트. 2초 분량.
    const wav = pcmToWav(Buffer.alloc(96_000));
    expect(parseWavDuration(wav)).toBeCloseTo(2.0, 5);
  });

  it("★fmt와 data 사이에 부가 청크(LIST)가 껴 있어도 정확하다", () => {
    // "44바이트 뒤가 전부 데이터"라고 가정하면 LIST 크기만큼 길이가 부풀어 오른다.
    const wav = wavWithExtraChunk(48_000); // 1초
    expect(parseWavDuration(wav)).toBeCloseTo(1.0, 5);
  });

  it("data 청크 크기가 실제보다 크게 적혀 있으면 남은 바이트로 보정한다", () => {
    const wav = wavWithExtraChunk(48_000);
    // data 청크 size 필드를 실제보다 크게 조작 → 남은 바이트 기준으로 떨어져야 한다
    const dataIdx = wav.indexOf(Buffer.from("data"), 12);
    wav.writeUInt32LE(0xffffffff, dataIdx + 4);
    expect(parseWavDuration(wav)).toBeCloseTo(1.0, 5);
  });

  it("샘플레이트가 다르면 그 값을 반영한다(24kHz 고정 가정 금지)", () => {
    const wav = wavWithExtraChunk(48_000, 16_000); // 16kHz → 초당 32,000바이트 → 1.5초
    expect(parseWavDuration(wav)).toBeCloseTo(1.5, 5);
  });

  it("WAV가 아니면 null (호출부가 폴백을 태울 수 있게)", () => {
    expect(parseWavDuration(Buffer.from("not a wav at all"))).toBeNull();
    expect(parseWavDuration(Buffer.alloc(4))).toBeNull();
  });
});

describe("toChirpVoiceName", () => {
  it("짧은 이름을 Chirp 3: HD 정식 이름으로 확장한다", () => {
    expect(toChirpVoiceName("Kore")).toBe("ko-KR-Chirp3-HD-Kore");
    expect(toChirpVoiceName("Sulafat")).toBe("ko-KR-Chirp3-HD-Sulafat");
  });

  it("이미 정식 이름이면 그대로 둔다(다른 모델로 갈아탈 여지)", () => {
    expect(toChirpVoiceName("ko-KR-Neural2-A")).toBe("ko-KR-Neural2-A");
    expect(toChirpVoiceName("ko-KR-Chirp3-HD-Leda")).toBe("ko-KR-Chirp3-HD-Leda");
  });

  it("앞뒤 공백을 흘리지 않는다(환경변수 값 복붙 사고 방지)", () => {
    expect(toChirpVoiceName("  Leda  ")).toBe("ko-KR-Chirp3-HD-Leda");
  });
});
