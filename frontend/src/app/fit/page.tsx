"use client";

import { Ruler } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FitFinder, SizeTable, UnitToggle } from "@/components/sizing/fit-finder";
import { Alert, Spinner } from "@/components/ui";
import { errorText, get, post } from "@/lib/api";
import { HOW_TO_MEASURE, dimLabel, type Unit } from "@/lib/sizing";
import type { FitResult, PublicSizeGuide } from "@/lib/types";

/** Customer-facing size guide and fit finder. No sign-in; only guides the owner has shared are served. */
function Guide() {
  const slug = useSearchParams().get("c");
  const [guide, setGuide] = useState<PublicSizeGuide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("in");

  useEffect(() => {
    if (!slug) {
      setError("This size guide link is incomplete.");
      return;
    }
    get<PublicSizeGuide>(`/api/public/size-guides/${encodeURIComponent(slug)}`).then(setGuide).catch((e) => setError(errorText(e)));
  }, [slug]);

  if (error) return <Alert tone="red">{error}</Alert>;
  if (!guide) return <Spinner label="Loading size guide..." />;
  const dims = guide.dimensions.filter((d) => guide.rows.some((r) => r.measurements[d]));
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-accent-600"><Ruler className="h-4 w-4" /> Size guide</p>
        <h1 className="font-serif text-3xl font-semibold text-brand-700">{guide.name}</h1>
        {guide.fit_notes && <p className="text-sm text-slate-700">{guide.fit_notes}</p>}
      </header>

      <section className="rounded-xl border border-line bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-serif text-xl font-semibold text-ink">Find your size</h2>
        <FitFinder chart={guide} unit={unit} onUnitChange={setUnit}
          recommend={(m, u) => post<FitResult>(`/api/public/size-guides/${encodeURIComponent(slug!)}/recommend`, { measurements: m, unit: u })} />
        <p className="mt-3 text-[11px] text-slate-500">Your measurements are used only to suggest a size and are not saved.</p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-xl font-semibold text-ink">Size chart (body measurements)</h2>
          <UnitToggle unit={unit} onChange={setUnit} />
        </div>
        <SizeTable chart={guide} unit={unit} />
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-xl font-semibold text-ink">How to measure</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {dims.filter((d) => HOW_TO_MEASURE[d]).map((d) => (
            <div key={d} className="rounded-lg border border-line bg-white p-3">
              <dt className="text-sm font-semibold text-brand-700">{dimLabel(d, guide.dimension_labels)}</dt>
              <dd className="mt-1 text-[13px] text-slate-600">{HOW_TO_MEASURE[d]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12px] text-slate-500">Use a soft tape measure, keep it level and snug but not tight. If you are between sizes, the fit finder tells you which measurement decides it.</p>
      </section>
    </div>
  );
}

export default function FitPage() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Suspense fallback={<Spinner />}>
          <Guide />
        </Suspense>
      </div>
    </main>
  );
}
