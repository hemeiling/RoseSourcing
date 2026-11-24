"use client";

import { Archive, ArchiveRestore, FolderKanban, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useProjects } from "@/components/providers";
import { Alert, Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { del, errorText, patch, post } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useT, type MsgKey } from "@/lib/i18n";
import { productHref } from "@/lib/sections";
import type { Assumption, Project } from "@/lib/types";

type Form = {
  name: string;
  short_name: string;
  product_category: string;
  target_country: string;
  sourcing_country: string;
  budget_usd: string;
  target_customers: string;
  price_min: string;
  price_max: string;
  notes: string;
  assumptions: Assumption[];
};

const EMPTY: Form = {
  name: "", short_name: "", product_category: "", target_country: "United States", sourcing_country: "", budget_usd: "",
  target_customers: "", price_min: "", price_max: "", notes: "", assumptions: [],
};

// The first use case. Every value is an untested business assumption. These are form values saved with the project, so
// they stay in English in both languages.
const EXAMPLE: Form = {
  name: "Latin & Ballroom Dancewear (US)", short_name: "",
  product_category: "Latin and ballroom dancewear",
  target_country: "United States",
  sourcing_country: "China",
  budget_usd: "5000",
  target_customers: "Adult recreational dancers, dance students, social dancers, and instructors",
  price_min: "49",
  price_max: "89",
  notes: "Initial business assumptions - not verified facts.",
  assumptions: [
    { label: "Target market", value: "United States", status: "hypothesis" },
    { label: "Manufacturing region", value: "China", status: "hypothesis" },
    { label: "Initial investment", value: "$5,000", status: "hypothesis" },
    { label: "Target customers", value: "Adult recreational dancers, students, social dancers, instructors", status: "hypothesis" },
    { label: "Retail price range", value: "$49-$89", status: "hypothesis" },
  ],
};

function toForm(p: Project): Form {
  const s = (v: number | null) => (v === null || v === undefined ? "" : String(v));
  return {
    name: p.name, short_name: p.short_name ?? "", product_category: p.product_category, target_country: p.target_country, sourcing_country: p.sourcing_country ?? "",
    budget_usd: s(p.budget_usd), target_customers: p.target_customers ?? "", price_min: s(p.price_min), price_max: s(p.price_max),
    notes: p.notes ?? "", assumptions: p.assumptions ?? [],
  };
}

function toPayload(f: Form) {
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    name: f.name.trim(), product_category: f.product_category.trim(), target_country: f.target_country.trim(),
    sourcing_country: f.sourcing_country.trim() || null, budget_usd: n(f.budget_usd), target_customers: f.target_customers.trim() || null,
    price_min: n(f.price_min), price_max: n(f.price_max), notes: f.notes.trim() || null,
    assumptions: f.assumptions.filter((a) => a.label.trim()),
  };
}

const STATUS_LABEL: Record<Assumption["status"], MsgKey> = { hypothesis: "Hypothesis", validated: "Validated", invalidated: "Invalidated" };

function ProjectForm({ initial, onSaved, onCancel, editingId }: { initial: Form; onSaved: (p: Project) => void; onCancel: () => void; editingId?: string }) {
  const { t, lang } = useT();
  // "Value" is also a complaint tag (性价比) in the dictionary, so the Chinese for this field has its own key.
  const valueLabel = lang === "zh" ? t("Assumption value") : "Value";
  const [f, setF] = useState<Form>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    // The short name is sent only when edited: otherwise a renamed product gets a fresh one suggested.
    const payload = { ...toPayload(f), ...(editingId && f.short_name !== initial.short_name ? { short_name: f.short_name.trim() } : {}) };
    if (payload.price_min !== null && payload.price_max !== null && payload.price_min > payload.price_max) {
      setError(t("Minimum price must be below maximum price."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = editingId ? await patch<Project>(`/api/projects/${editingId}`, payload) : await post<Project>("/api/projects", payload);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!editingId && (
        <div className="flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5">
          <p className="text-xs text-brand-900">{t("Start from the first use case: Latin & ballroom dancewear, US market, sourced from China.")}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => setF(EXAMPLE)}>
            <Sparkles className="h-3.5 w-3.5" /> {t("Use example")}
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Project name")} className="sm:col-span-2">
          <Input required value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. Dancewear launch")} />
        </Field>
        {editingId && (
          <Field label={t("Short name (sidebar)")} hint={t("2-4 words. Leave empty to have one suggested.")} className="sm:col-span-2">
            <Input maxLength={60} value={f.short_name} onChange={(e) => set("short_name", e.target.value)} placeholder={t("e.g. Heated cat bed")} />
          </Field>
        )}
        <Field label={t("Product category")}>
          <Input required value={f.product_category} onChange={(e) => set("product_category", e.target.value)} placeholder={t("e.g. Latin and ballroom dancewear")} />
        </Field>
        <Field label={t("Target market (country)")}>
          <Input required value={f.target_country} onChange={(e) => set("target_country", e.target.value)} />
        </Field>
        <Field label={t("Sourcing / manufacturing region")}>
          <Input value={f.sourcing_country} onChange={(e) => set("sourcing_country", e.target.value)} placeholder={t("e.g. China")} />
        </Field>
        <Field label={t("Starting budget (USD)")}>
          <Input type="number" min={0} step="any" value={f.budget_usd} onChange={(e) => set("budget_usd", e.target.value)} />
        </Field>
        <Field label={t("Price hypothesis - min (USD)")}>
          <Input type="number" min={0} step="any" value={f.price_min} onChange={(e) => set("price_min", e.target.value)} />
        </Field>
        <Field label={t("Price hypothesis - max (USD)")}>
          <Input type="number" min={0} step="any" value={f.price_max} onChange={(e) => set("price_max", e.target.value)} />
        </Field>
        <Field label={t("Target customers (hypothesis)")} className="sm:col-span-2">
          <Textarea value={f.target_customers} onChange={(e) => set("target_customers", e.target.value)} rows={2} />
        </Field>
        <Field label={t("Notes")} className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-700">{t("Business assumptions to test")}</span>
          <Button type="button" size="sm" variant="ghost"
            onClick={() => setF((cur) => ({ ...cur, assumptions: [...cur.assumptions, { label: "", value: "", status: "hypothesis" }] }))}>
            <Plus className="h-3.5 w-3.5" /> {t("Add")}
          </Button>
        </div>
        {f.assumptions.length === 0 && <p className="text-xs text-slate-500">{t("No assumptions recorded.")}</p>}
        <div className="space-y-2">
          {f.assumptions.map((a, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto_auto] gap-2">
              <Input aria-label={t("Assumption")} placeholder={t("Assumption")} value={a.label}
                onChange={(e) => setF((cur) => ({ ...cur, assumptions: cur.assumptions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />
              <Input aria-label={valueLabel} placeholder={valueLabel} value={a.value}
                onChange={(e) => setF((cur) => ({ ...cur, assumptions: cur.assumptions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }))} />
              <Select aria-label={t("Status")} value={a.status}
                onChange={(e) => setF((cur) => ({ ...cur, assumptions: cur.assumptions.map((x, j) => (j === i ? { ...x, status: e.target.value as Assumption["status"] } : x)) }))}>
                <option value="hypothesis">{t(STATUS_LABEL.hypothesis)}</option>
                <option value="validated">{t(STATUS_LABEL.validated)}</option>
                <option value="invalidated">{t(STATUS_LABEL.invalidated)}</option>
              </Select>
              <button type="button" aria-label={t("Remove assumption")} className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setF((cur) => ({ ...cur, assumptions: cur.assumptions.filter((_, j) => j !== i) }))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("Cancel")}</Button>
        <Button type="submit" loading={busy}>{editingId ? t("Save changes") : t("Create project")}</Button>
      </div>
    </form>
  );
}

const statusTone = { hypothesis: "slate", validated: "green", invalidated: "red" } as const;

function ProjectsInner() {
  const { t, tr, tx } = useT();
  const { projects, project: current, select, reload, loading } = useProjects();
  const router = useRouter();
  const params = useSearchParams();
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);

  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  async function saved(p: Project) {
    setCreating(false);
    setEditing(null);
    await reload();
    select(p.id);
  }

  async function toggleArchive(p: Project) {
    try {
      await patch(`/api/projects/${p.id}`, { status: p.status === "archived" ? "active" : "archived" });
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove(p: Project) {
    try {
      await del(`/api/projects/${p.id}`);
      setConfirmDelete(null);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <PageHeader
        title={t("Business Projects")}
        description={t("Each project captures a product category, target market, sourcing region, budget and the assumptions you are testing. Change them any time - research and analysis use the current values.")}
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {t("New project")}</Button>}
      />
      {error && <Alert tone="red" className="mb-4">{error}</Alert>}
      {loading ? (
        <Spinner />
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderKanban className="h-5 w-5" />} title={t("Create your first business project")}
            action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {t("New project")}</Button>}>
            {t("Start from scratch or use the Latin & ballroom dancewear example.")}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4">
          {projects.map((p) => (
            <Card key={p.id} className={p.id === current?.id ? "ring-2 ring-brand-200" : undefined}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="break-words text-base font-semibold text-slate-900">{p.name}</h2>
                      {p.id === current?.id && <Badge tone="blue">{t("Current")}</Badge>}
                      {p.status === "archived" && <Badge>{t("Archived")}</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">{p.product_category}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={t("Edit project")}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleArchive(p)} aria-label={p.status === "archived" ? t("Unarchive") : t("Archive")}>
                      {p.status === "archived" ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(p)} aria-label={t("Delete project")}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><dt className="text-xs text-slate-500">{t("Target market")}</dt><dd className="text-slate-800">{p.target_country}</dd></div>
                  <div><dt className="text-xs text-slate-500">{t("Sourcing")}</dt><dd className="text-slate-800">{p.sourcing_country ?? "-"}</dd></div>
                  <div><dt className="text-xs text-slate-500">{t("Budget")}</dt><dd className="text-slate-800">{money(p.budget_usd, { decimals: 0 })}</dd></div>
                  <div><dt className="text-xs text-slate-500">{t("Price hypothesis")}</dt>
                    <dd className="text-slate-800">{p.price_min !== null && p.price_max !== null ? `${money(p.price_min, { decimals: 0 })}-${money(p.price_max, { decimals: 0 })}` : "-"}</dd></div>
                </dl>
                {p.target_customers && <p className="mt-2 text-xs text-slate-600"><span className="font-medium">{t("Customers:")}</span> {p.target_customers}</p>}
                {p.assumptions.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {p.assumptions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                        <Badge tone={statusTone[a.status] ?? "slate"}>{t(STATUS_LABEL[a.status] ?? "Invalidated")}</Badge>
                        <span className="min-w-0"><span className="font-medium">{tx(a.label)}:</span> {a.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{t("Created {date}", { date: date(p.created_at) })}</span>
                  <Button size="sm" variant={p.id === current?.id ? "secondary" : "primary"} onClick={() => { select(p.id); router.push(productHref(p.id)); }}>
                    {t("Open dashboard")}
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={t("New business project")} wide>
        <ProjectForm initial={EMPTY} onSaved={saved} onCancel={() => setCreating(false)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("Edit project")} wide>
        {editing && <ProjectForm key={editing.id} initial={toForm(editing)} editingId={editing.id} onSaved={saved} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={t("Delete project?")}>
        <p className="text-sm text-slate-700">
          {tr("This permanently deletes {name} and all its research, competitors, suppliers, scenarios and copilot history. This cannot be undone. Archiving keeps the data instead.", {
            name: <strong>{confirmDelete?.name}</strong>,
          })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>{t("Cancel")}</Button>
          <Button variant="danger" onClick={() => confirmDelete && remove(confirmDelete)}>{t("Delete permanently")}</Button>
        </div>
      </Modal>
    </>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ProjectsInner />
    </Suspense>
  );
}
