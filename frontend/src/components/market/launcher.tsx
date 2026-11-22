"use client";

import { Play, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, ConfigNotice, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { ApiError, errorText, post } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Project, ProviderStatus, ResearchRun } from "@/lib/types";
import { ConfirmModal } from "./shared";

type ProvidersResp = {
  default: string;
  providers: ProviderStatus[];
  guardrails: { max_searches_per_step: number; max_research_cost_usd: number; max_step_attempts: number };
};

const RESEARCH_STEPS = [
  "Market size & growth evidence",
  "Customer segments & unmet needs",
  "Competitors & pricing",
  "Sourcing, duties & cost benchmarks",
  "Risks, compliance & channels",
];

export function ResearchLauncher({
  project,
  hasActiveRun,
  onStarted,
}: {
  project: Project;
  hasActiveRun: boolean;
  onStarted: (run: ResearchRun) => void;
}) {
  const { data: prov, error: provError, loading: provLoading } = useApi<ProvidersResp>("/api/research/providers");
  const [category, setCategory] = useState(project.product_category);
  const [geography, setGeography] = useState(project.target_country);
  const [budget, setBudget] = useState(project.budget_usd !== null ? String(project.budget_usd) : "");
  const [focus, setFocus] = useState("");
  const [provider, setProvider] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  useEffect(() => {
    if (prov && !provider) setProvider(prov.default);
  }, [prov, provider]);

  const selected = prov?.providers.find((p) => p.name === provider);
  const g = prov?.guardrails;
  const budgetNum = budget.trim() === "" ? undefined : Number(budget);
  const budgetInvalid = budgetNum !== undefined && (Number.isNaN(budgetNum) || budgetNum < 0);
  const formInvalid = !category.trim() || !geography.trim() || budgetInvalid;

  async function start() {
    setBusy(true);
    setError(null);
    setConfigMsg(null);
    try {
      const run = await post<ResearchRun>(`/api/projects/${project.id}/research-runs`, {
        kind: "market_opportunity",
        category: category.trim(),
        geography: geography.trim(),
        budget_usd: budgetNum,
        focus: focus.trim() || undefined,
        provider: provider || undefined,
      });
      setConfirmOpen(false);
      setFocus("");
      onStarted(run);
    } catch (e) {
      setConfirmOpen(false);
      if (e instanceof ApiError && e.isConfigError) setConfigMsg(e.message);
      else if (e instanceof ApiError && e.status === 409)
        setError("A research run is already in progress for this project. Wait for it to finish or cancel it below.");
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Play className="h-4 w-4" />}
        title="Start market research"
        subtitle="Searches the web, extracts findings, checks each one against the retrieved source excerpts, then writes an evidence-linked opportunity report."
      />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Product category">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Target market (country)">
            <Input value={geography} onChange={(e) => setGeography(e.target.value)} />
          </Field>
          <Field label="Investment budget (USD)" hint={budgetInvalid ? "Enter a non-negative number." : undefined}>
            <Input type="number" min={0} step={100} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
        </div>
        <Field label="Focus (optional)" hint="Anything the research should pay special attention to, e.g. practice wear for adult beginners.">
          <Textarea value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={1000} className="min-h-[60px]" />
        </Field>

        <div className="grid gap-4 lg:grid-cols-3">
          <Field label="Research provider">
            {provLoading ? (
              <Spinner label="Loading providers..." />
            ) : (
              <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {prov?.providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label}
                    {p.configured ? "" : " (not configured)"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="lg:col-span-2">
            <div className="mb-1 text-xs font-medium text-slate-700">Workflow</div>
            <ol className="flex flex-wrap gap-1.5 text-[11px] text-slate-600">
              {[...RESEARCH_STEPS, "Opportunity report synthesis"].map((s, i) => (
                <li key={s} className="rounded-md bg-slate-100 px-2 py-1">
                  {i + 1}. {s}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {provError && <Alert tone="red">Could not load research providers: {errorText(provError)}</Alert>}
        {selected && !selected.configured && <ConfigNotice message={`${selected.label} is not configured. ${selected.requirement ?? ""}`} />}
        {configMsg && <ConfigNotice message={configMsg} />}
        {error && <Alert tone="red">{error}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          {g ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Guardrails: up to {g.max_searches_per_step} searches per step · {g.max_step_attempts} attempts per step · stops at $
              {g.max_research_cost_usd.toFixed(2)} estimated cost
            </p>
          ) : (
            <span />
          )}
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={formInvalid || !selected?.configured || hasActiveRun}
            title={hasActiveRun ? "A run is already in progress" : undefined}
          >
            <Play className="h-4 w-4" aria-hidden />
            Review &amp; start
          </Button>
        </div>
        {hasActiveRun && <p className="text-right text-xs text-slate-500">A research run is in progress. You can start another when it finishes.</p>}
      </CardBody>

      <ConfirmModal
        open={confirmOpen}
        title="Approve research spend"
        confirmLabel="Start research"
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={start}
      >
        <p>
          This run researches <strong>{category}</strong> in <strong>{geography}</strong>
          {budgetNum !== undefined ? (
            <>
              {" "}
              with a budget of <strong>${budgetNum.toLocaleString()}</strong>
            </>
          ) : null}{" "}
          using <strong>{selected?.label}</strong>.
        </p>
        {g && (
          <ul className="list-disc space-y-1 pl-5 text-[13px]">
            <li>
              {RESEARCH_STEPS.length} research steps, each making up to <strong>{g.max_searches_per_step}</strong> web searches, then one synthesis call.
            </li>
            <li>A step that fails with a temporary error is retried, up to {g.max_step_attempts} attempts.</li>
            <li>
              The run stops starting new steps once estimated cost reaches <strong>${g.max_research_cost_usd.toFixed(2)}</strong>.
            </li>
            <li>API usage is billed to the configured provider account(s). Cost shown in the app is an estimate.</li>
          </ul>
        )}
        <p className="text-xs text-slate-500">
          Findings are labelled as sourced evidence, AI inference, assumption or data unavailable. Nothing is invented to fill gaps.
        </p>
      </ConfirmModal>
    </Card>
  );
}
