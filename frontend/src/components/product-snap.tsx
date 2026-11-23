"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowRight, Camera, ImagePlus, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjects, useStatus } from "./providers";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfigNotice, Field, Input } from "./ui";
import { ApiError, api, errorText } from "@/lib/api";
import { prepareImage } from "@/lib/image";
import type { ProductScan } from "@/lib/types";

type ScanResult = {
  scan: ProductScan | null;
  project_id: string | null;
  run: { id: string; status: string } | null;
  research_note: string | null;
  identification?: ProductScan["identification"];
};

/** Upload or paste a product photo: AI identifies the product, then (optionally) starts market research automatically. */
export function ProductSnap({ compact }: { compact?: boolean }) {
  const { project, reload, select } = useProjects();
  const { status } = useStatus();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"new_project" | "current_project">("new_project");
  const [auto, setAuto] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [targetCountry, setTargetCountry] = useState("United States");
  const [sourcingCountry, setSourcingCountry] = useState("China");

  const send = useCallback(async (file: File) => {
    if (busy) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image (JPEG, PNG, WebP or GIF).");
      return;
    }
    setBusy(true);
    setError(null);
    setConfig(null);
    setResult(null);
    try {
      const prepared = await prepareImage(file);
      setPreview(URL.createObjectURL(prepared));
      const form = new FormData();
      form.append("file", prepared);
      form.append("auto_research", String(auto));
      let url = "/api/product-scans";
      if (project) {
        form.append("mode", mode);
        url = `/api/projects/${project.id}/product-scans`;
      } else {
        form.append("target_country", targetCountry);
        form.append("sourcing_country", sourcingCountry);
      }
      const res = await api<ScanResult>(url, { method: "POST", form });
      setResult(res);
      await reload();
      if (!project && res.project_id) select(res.project_id);
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfig(e.message);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [project, busy, mode, auto, reload, select, targetCountry, sourcingCountry]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        send(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [send]);

  const ident = result?.scan?.identification ?? result?.identification;
  const aiOff = status && !status.ai.configured;

  return (
    <Card>
      <CardHeader
        title="Snap a product to research"
        icon={<Camera className="h-4 w-4" />}
        subtitle="Upload, drag in, or paste (Cmd+V) a photo or screenshot of something you might sell. AI identifies it, then researches demand, competitors, pricing and sourcing."
      />
      <CardBody className="space-y-4">
        {aiOff && <ConfigNotice message={status?.ai.requirement} />}
        {config && <ConfigNotice message={config} />}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) send(f); }}
          className={clsx(
            "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 text-center transition-colors",
            compact ? "py-6" : "py-10",
            dragging ? "border-brand-500 bg-brand-50" : "border-line bg-canvas/60",
          )}
        >
          {busy ? (
            <div className="flex flex-col items-center gap-2 text-sm text-brand-700">
              {preview && <img src={preview} alt="Uploaded product" className="h-24 w-24 rounded-lg object-cover" />}
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Identifying the product...</span>
            </div>
          ) : (
            <>
              <ImagePlus className="h-8 w-8 text-brand-400" aria-hidden />
              <div className="text-sm text-slate-600">Drop an image here, paste a screenshot, or</div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => input.current?.click()} disabled={!!aiOff}>Choose photo</Button>
                <label className={clsx("inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border-2 border-primary-600 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-primary-700 hover:bg-primary-50 sm:hidden", aiOff && "pointer-events-none opacity-50")}>
                  <Camera className="h-3.5 w-3.5" /> Camera
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ""; }} />
                </label>
              </div>
            </>
          )}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ""; }} />
        </div>
        {!project && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Selling to (target market)"><Input value={targetCountry} onChange={(e) => setTargetCountry(e.target.value)} /></Field>
            <Field label="Sourcing from (optional)"><Input value={sourcingCountry} onChange={(e) => setSourcingCountry(e.target.value)} /></Field>
          </div>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
          {project ? (
            <>
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === "new_project"} onChange={() => setMode("new_project")} /> Create a new product project
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === "current_project"} onChange={() => setMode("current_project")} /> Add to {project.name}
              </label>
            </>
          ) : (
            <span className="text-slate-500">Your first snap creates a product project automatically.</span>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Start market research automatically
          </label>
        </div>
        {auto && <p className="text-[11px] text-slate-500">Research uses web search{" "}and, if connected, Google Trends and Amazon data. Each run is capped by your research cost limit (Settings).</p>}
        {error && <Alert tone="red">{error}</Alert>}
        {result && ident && (
          <div className="flex flex-col gap-4 rounded-lg border border-line p-4 sm:flex-row">
            {(result.scan?.image_url ?? preview) && <img src={result.scan?.image_url ?? preview!} alt={ident.product_name} className="h-28 w-28 shrink-0 rounded-lg object-cover" />}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-serif text-lg font-semibold text-brand-700">{ident.product_name}</span>
                <Badge tone="violet" title="Identified by AI from the image"><Sparkles className="h-3 w-3" /> AI identification · {ident.confidence}</Badge>
              </div>
              <p className="text-sm text-slate-700"><span className="text-slate-500">Researching as:</span> {ident.research_category}</p>
              {ident.key_attributes.length > 0 && <p className="text-xs text-slate-600">{ident.key_attributes.join(" · ")}</p>}
              <div className="flex flex-wrap gap-1">{ident.search_keywords.map((k) => <Badge key={k} tone="blue">{k}</Badge>)}</div>
              {ident.ip_caution && <Alert>{ident.ip_caution}</Alert>}
              {!ident.is_product && <Alert>This image doesn&apos;t look like a sellable product, so nothing was started.</Alert>}
              {result.research_note && <Alert tone="blue">{result.research_note}</Alert>}
              {result.project_id && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={() => { select(result.project_id!); router.push("/market"); }}>
                    {result.run ? "Watch research progress" : "Open project"} <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => { select(result.project_id!); router.push("/projects"); }}>Edit details</Button>
                </div>
              )}
            </div>
          </div>
        )}
        {result && !ident && result.scan?.error && (
          <Alert tone="red"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{result.scan.error}</Alert>
        )}
      </CardBody>
    </Card>
  );
}
