"use client";

// 빌라 등록 마법사 7단계 (T1.1 → T-bedroom-composition-sync)
//   1 기본정보 → 2 잠자리구성 → 3 위치·셀링포인트 → 4 사진 → 5 비품 → 6 이용규칙 → 7 원가
// 상태는 이 컴포넌트에 보관 — 뒤로가기 시 입력값 유지
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FEATURE_CATEGORIES, FEATURE_ITEMS, hasPoolFeatureTag } from "@/lib/features";
import {
  INITIAL_STATE,
  buildPhotoSlots,
  buildBedroomDetails,
  type PhotoSlotState,
  type SupplierOption,
  type ComplexAreaOption,
  type WizardState,
} from "./wizard-types";
import StepBasic from "./step-basic";
import StepBedding from "./step-bedding";
import StepLocation from "./step-location";
import StepPhotos from "./step-photos";
import StepAmenities from "./step-amenities";
import StepRules from "./step-rules";
import StepRates from "./step-rates";

const TOTAL_STEPS = 7;

export default function VillaWizard({
  villaId,
  initialState,
  isAdmin = false,
  suppliers = [],
  complexAreas = [],
}: {
  /** T1.2b 재제출 — 있으면 PUT(수정), 없으면 POST(신규) */
  villaId?: string;
  initialState?: WizardState;
  /** ADMIN 직접등록 모드 — 1단계에서 귀속 공급자 선택 노출 */
  isAdmin?: boolean;
  suppliers?: SupplierOption[];
  /** 단지 마스터 목록 (active만, 서버 주입) — 1단계 드롭다운 소스 */
  complexAreas?: ComplexAreaOption[];
} = {}) {
  const t = useTranslations("wizard");
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(initialState ?? INITIAL_STATE);
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

    // 사전 항목 (미니바 외 1=있음) + 직접입력(custom) 항목을 하나의 amenities 배열로 병합.
    // custom은 itemKey="custom" + customLabel(vi 원문). 수량은 항상 1 이상(빈 라벨/0 수량 제외).
    const amenities: {
      category: "KITCHEN" | "BATHROOM" | "APPLIANCE" | "MINIBAR";
      itemKey: string;
      quantity: number;
      customLabel?: string;
    }[] = Object.entries(state.amenities)
      .filter(([, quantity]) => quantity > 0)
      .map(([key, quantity]) => {
        const [category, itemKey] = key.split(":");
        return {
          category: category as "KITCHEN" | "BATHROOM" | "APPLIANCE" | "MINIBAR",
          itemKey,
          quantity,
        };
      });
    for (const c of state.customAmenities) {
      const label = c.label.trim();
      if (!label || c.quantity < 1) continue;
      amenities.push({
        category: c.category,
        itemKey: "custom",
        customLabel: label,
        quantity: Math.min(99, c.quantity),
      });
    }

    // 잠자리 구성 → bedroomDetails[] (전송 시 서버가 bedrooms/bathrooms/maxGuests 파생, body 스칼라 무시)
    const bedroomDetails = buildBedroomDetails(state.rooms);

    // 셀링포인트 — featureKey[] → {category, featureKey}[] (사전 역참조로 category 정합)
    const features: { category: "VIEW" | "FACILITY" | "LOCATION"; featureKey: string }[] = [];
    const featureSet = new Set(state.features);
    for (const category of FEATURE_CATEGORIES) {
      for (const item of FEATURE_ITEMS[category]) {
        if (featureSet.has(item.featureKey)) features.push({ category, featureKey: item.featureKey });
      }
    }
    // 풀 태그(프라이빗풀·키즈풀) 선택 시 수영장 있음 자동 반영 (서버도 동일 보정)
    const effectiveHasPool = state.hasPool || hasPoolFeatureTag(features);

    // 구글맵 링크는 https만 유효 — 잘못된 값으로 제출 전체가 400 나지 않도록 방어적으로 null 처리
    const gmap = state.googleMapUrl.trim();
    const googleMapUrl = /^https:\/\//i.test(gmap) ? gmap : null;

    try {
      // T1.2b — villaId 있으면 PUT(재제출), 없으면 POST(신규 등록)
      const res = await fetch(villaId ? `/api/villas/${villaId}` : "/api/villas", {
        method: villaId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // ADMIN 직접등록 시에만 의미 — SUPPLIER는 서버가 세션으로 강제(바디 무시)
          supplierId: state.supplierId || undefined,
          name: state.name.trim(),
          // 단지 = 마스터 FK만 전송(서버가 complex 캐시 파생). 구 complex 자유 문자열 전송 제거 (ADR-0046)
          complexAreaId: state.complexAreaId || undefined,
          // body 스칼라 — 하위호환용 파생값(서버는 bedroomDetails 전송 시 이 값들을 무시하고 재파생)
          bedrooms: state.bedrooms,
          bathrooms: state.bathrooms,
          maxGuests: state.maxGuests,
          hasPool: effectiveHasPool,
          breakfastAvailable: state.breakfastAvailable,
          address: state.address.trim() || undefined,
          monthlyRentVnd: state.monthlyRent || undefined,
          // 잠자리 구성·셀링포인트·위치·비공개 정보 (T-bedroom-composition-sync)
          bedroomDetails,
          features,
          commonBathrooms: state.commonBathrooms,
          googleMapUrl,
          beachDistanceM: state.beachDistanceM,
          wifiSsid: state.wifiSsid.trim() || null,
          wifiPassword: state.wifiPassword.trim() || null,
          accessType: state.accessType || null,
          accessInfo: state.accessInfo.trim() || null,
          photos,
          amenities,
          // 이용 규칙 — 분 단위 시각·VND 동단위 문자열(빈 값은 null). 서버 villaRulesData가 BigInt 변환
          rules: {
            checkInTime: state.rules.checkInTime,
            checkOutTime: state.rules.checkOutTime,
            smokingAllowed: state.rules.smokingAllowed,
            petsAllowed: state.rules.petsAllowed,
            partyAllowed: state.rules.partyAllowed,
            parkingSlots: state.rules.parkingSlots,
            baseDepositVnd: state.rules.baseDepositVnd || null,
            extraBedAvailable: state.rules.extraBedAvailable,
          },
          // 원가 — LOW/HIGH/PEAK 필수, SHOULDER(준성수기)는 값이 있을 때만 전송(빈 값 미전송 — 구 payload 하위호환)
          rates: {
            LOW: state.rates.LOW,
            HIGH: state.rates.HIGH,
            PEAK: state.rates.PEAK,
            ...(state.rates.SHOULDER ? { SHOULDER: state.rates.SHOULDER } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error("submit failed");
      // 운영자 대행 신규등록은 빌라 관리의 "승인 대기" 탭으로 복귀(공급자 화면 /my-villas로 새지 않게).
      // 재제출(PUT)·공급자 신규는 기존대로 /my-villas.
      const next =
        isAdmin && !villaId
          ? "/villas?status=pending"
          : villaId
            ? "/my-villas?resubmitted=1"
            : "/my-villas?created=1";
      router.push(next);
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
          isAdmin={isAdmin}
          suppliers={suppliers}
          complexAreas={complexAreas}
        />
      )}
      {step === 2 && <StepBedding state={state} update={update} onNext={goNext} />}
      {step === 3 && (
        <StepLocation
          state={state}
          update={update}
          onNext={goNext}
          onChangeComplex={() => setStep(1)}
        />
      )}
      {step === 4 && (
        <StepPhotos state={state} setPhoto={setPhoto} onNext={goNext} onBack={goBack} />
      )}
      {step === 5 && <StepAmenities state={state} update={update} onNext={goNext} />}
      {step === 6 && <StepRules state={state} update={update} onNext={goNext} />}
      {step === 7 && (
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
