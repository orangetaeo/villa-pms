"use client";

// 빌라 등록 마법사 5단계 (T1.1) — a2 → a2b → a1 → a9 → a5
// 상태는 이 컴포넌트에 보관 — 뒤로가기 시 입력값 유지
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  INITIAL_STATE,
  buildPhotoSlots,
  type PhotoSlotState,
  type WizardState,
} from "./wizard-types";
import StepBasic from "./step-basic";
import StepLocation from "./step-location";
import StepPhotos from "./step-photos";
import StepAmenities from "./step-amenities";
import StepRates from "./step-rates";

const TOTAL_STEPS = 5;

export default function VillaWizard() {
  const t = useTranslations("wizard");
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const update = (patch: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  // 사진 업로드는 동시 진행 가능 → 함수형 갱신으로 경합 방지
  const setPhoto = (slotId: string, slot: PhotoSlotState | null) =>
    setState((prev) => {
      const photos = { ...prev.photos };
      if (slot === null) delete photos[slotId];
      else photos[slotId] = slot;
      return { ...prev, photos };
    });

  const goNext = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  const goBack = () => {
    if (step === 1) router.push("/my-villas");
    else setStep((s) => s - 1);
  };

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(false);

    const slots = buildPhotoSlots(state.bedrooms, state.bathrooms, state.hasPool);
    const photos = slots
      .filter((slot) => state.photos[slot.id]?.status === "done" && state.photos[slot.id]?.url)
      .map((slot, sortOrder) => ({
        space: slot.space,
        spaceLabel: slot.index !== undefined ? String(slot.index) : undefined,
        url: state.photos[slot.id].url as string,
        sortOrder,
      }));

    const amenities = Object.entries(state.amenities)
      .filter(([, quantity]) => quantity > 0)
      .map(([key, quantity]) => {
        const [category, itemKey] = key.split(":");
        return {
          category: category as "KITCHEN" | "BATHROOM" | "APPLIANCE" | "MINIBAR",
          itemKey,
          quantity,
        };
      });

    try {
      const res = await fetch("/api/villas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name.trim(),
          complex: state.complex || undefined,
          bedrooms: state.bedrooms,
          bathrooms: state.bathrooms,
          maxGuests: state.maxGuests,
          hasPool: state.hasPool,
          breakfastAvailable: state.breakfastAvailable,
          address: state.address.trim() || undefined,
          monthlyRentVnd: state.monthlyRent || undefined,
          photos,
          amenities,
          rates: state.rates,
        }),
      });
      if (!res.ok) throw new Error("submit failed");
      router.push("/my-villas?created=1");
      router.refresh();
    } catch {
      setSubmitError(true);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      {/* TopAppBar — 전 단계 공통 (a2): 헤더 "Đăng ký villa" + "Bước N/5" */}
      <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-neutral-100 bg-white px-4 shadow-sm">
        <button
          type="button"
          onClick={goBack}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:bg-neutral-50 active:opacity-80"
          aria-label={t("back")}
        >
          <span className="material-symbols-outlined text-neutral-900">arrow_back</span>
        </button>
        <h1 className="font-headline text-lg font-semibold text-neutral-900">{t("header")}</h1>
        <span className="text-sm font-bold text-teal-600">
          {t("step", { n: step, total: TOTAL_STEPS })}
        </span>
      </header>

      {step === 1 && (
        <StepBasic
          state={state}
          update={update}
          onNext={goNext}
          onHome={() => router.push("/my-villas")}
        />
      )}
      {step === 2 && (
        <StepLocation
          state={state}
          update={update}
          onNext={goNext}
          onChangeComplex={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <StepPhotos state={state} setPhoto={setPhoto} onNext={goNext} onBack={goBack} />
      )}
      {step === 4 && <StepAmenities state={state} update={update} onNext={goNext} />}
      {step === 5 && (
        <StepRates
          state={state}
          update={update}
          submitting={submitting}
          submitError={submitError}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
