"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Megaphone,
  Package,
  Pencil,
  Plug,
  Plus,
  Receipt,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { CopyButton } from "@/components/brand/renderers";
import { ProductForm } from "@/components/commerce/product-form";
import { useStatus } from "@/components/providers";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfigNotice,
  EmptyState,
  Modal,
  PageHeader,
  PlannedBadge,
  Spinner,
  Tabs,
  type Tone,
} from "@/components/ui";
import { ApiError, del, errorText, post } from "@/lib/api";
import { dateTime, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Approval, IntegrationStatus, Product } from "@/lib/types";

const STATUS_TONE: Record<Product["status"], Tone> = { idea: "slate", sampling: "amber", approved: "blue", listed: "green", retired: "slate" };

type Tab = "catalog" | "approvals" | "integrations";

export default function CommercePage() {
  return <RequireProject>{(pid) => <Commerce projectId={pid} />}</RequireProject>;
}

function Commerce({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("catalog");
  const approvals = useApi<Approval[]>(`/api/projects/${projectId}/approvals`);
  const pending = (approvals.data ?? []).filter((a) => a.status === "pending").length;

  return (
    <div>
      <PageHeader
        title="Commerce"
        description="Product catalog, listing drafts and the approval checkpoint for any external action. Store connections are planned; nothing here publishes, buys or sends anything."
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "catalog", label: "Product catalog" },
          { value: "approvals", label: `Approval queue${pending ? ` (${pending})` : ""}` },
          { value: "integrations", label: "Integrations & roadmap" },
        ]}
      />
      {tab === "catalog" && <Catalog projectId={projectId} />}
      {tab === "approvals" && <Approvals approvals={approvals} />}
      {tab === "integrations" && <Integrations />}
    </div>
  );
}

// ----------------------------------------------------------------------------- catalog

function Catalog({ projectId }: { projectId: string }) {
  const products = useApi<Product[]>(`/api/projects/${projectId}/products`);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [listingFor, setListingFor] = useState<string | null>(null);

  function upsert(p: Product) {
    products.setData((prev) => {
      const list = prev ?? [];
      return list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list];
    });
  }

  const listingProduct = (products.data ?? []).find((p) => p.id === listingFor) ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Products"
          icon={<Package className="h-4 w-4" />}
          subtitle="Inventory counts are tracked manually here; they are not synced from a store or warehouse."
          actions={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Add product
            </Button>
          }
        />
        <CardBody>
          {products.loading && !products.data ? (
            <Spinner />
          ) : products.error ? (
            <Alert tone="red">{errorText(products.error)}</Alert>
          ) : (products.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Package className="h-5 w-5" />}
              title="No products yet"
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Add your first product
                </Button>
              }
            >
              Add product concepts (e.g. a practice dress) to generate listing drafts, link supplier quotes and track inventory.
            </EmptyState>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(products.data ?? []).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onEdit={() => setEditing(p)}
                  onDeleted={() => products.setData((prev) => (prev ?? []).filter((x) => x.id !== p.id))}
                  onOpenListing={() => setListingFor(p.id)}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {listingProduct && <ListingPanel product={listingProduct} onUpdated={upsert} onClose={() => setListingFor(null)} />}

      <Modal open={creating || !!editing} onClose={() => (setCreating(false), setEditing(null))} title={editing ? `Edit ${editing.name}` : "Add product"} wide>
        <ProductForm
          key={editing?.id ?? "new"}
          projectId={projectId}
          product={editing}
          onCancel={() => (setCreating(false), setEditing(null))}
          onSaved={(p) => {
            upsert(p);
            setCreating(false);
            setEditing(null);
          }}
        />
      </Modal>
    </div>
  );
}

function ProductCard({ product: p, onEdit, onDeleted, onOpenListing }: { product: Product; onEdit: () => void; onDeleted: () => void; onOpenListing: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lowStock = p.inventory_on_hand !== null && p.reorder_point !== null && p.inventory_on_hand <= p.reorder_point;

  async function remove() {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await del(`/api/products/${p.id}`);
      onDeleted();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold text-slate-900">{p.name}</h3>
            <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
            {lowStock && (
              <Badge tone="red" title="On-hand count is at or below the reorder point">
                <AlertTriangle className="h-3 w-3" /> Low stock
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {[p.product_type, p.sku && `SKU ${p.sku}`].filter(Boolean).join(" · ") || "No type or SKU"}
          </p>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${p.name}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} loading={busy} aria-label={`Delete ${p.name}`}>
            <Trash2 className="h-3.5 w-3.5 text-red-600" />
          </Button>
        </div>
      </div>
      {p.description && <p className="mt-2 text-[13px] text-slate-600">{p.description}</p>}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Target price</dt>
        <dd className="text-slate-800">{p.target_price !== null ? money(p.target_price) : "-"}</dd>
        <dt className="text-slate-500">Materials</dt>
        <dd className="break-words text-slate-800" title={p.materials ?? ""}>{p.materials || "-"}</dd>
        <dt className="text-slate-500">Sizes</dt>
        <dd className="text-slate-800">{p.sizes.length ? p.sizes.join(", ") : "-"}</dd>
        <dt className="text-slate-500">On hand / reorder at</dt>
        <dd className="text-slate-800" title="Manual count">
          {p.inventory_on_hand ?? "-"} / {p.reorder_point ?? "-"}
        </dd>
      </dl>
      {p.features.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.features.map((f) => (
            <Badge key={f} tone="slate">
              {f}
            </Badge>
          ))}
        </div>
      )}
      {error && <Alert tone="red" className="mt-2">{error}</Alert>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <Button size="sm" variant="secondary" onClick={onOpenListing}>
          <Sparkles className="h-3.5 w-3.5" /> {p.listing_draft ? "View listing draft" : "Listing draft"}
        </Button>
        <span title="Planned - requires a Shopify connection and your explicit approval">
          <Button size="sm" variant="secondary" disabled aria-describedby={`publish-${p.id}`}>
            <Upload className="h-3.5 w-3.5" /> Publish to Shopify
          </Button>
        </span>
        <span id={`publish-${p.id}`} className="text-[11px] text-slate-500">
          Planned - requires a Shopify connection and your explicit approval
        </span>
      </div>
    </div>
  );
}

function ListingPanel({ product, onUpdated, onClose }: { product: Product; onUpdated: (p: Product) => void; onClose: () => void }) {
  const { status } = useStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const d = product.listing_draft;
  const aiMissing = status && !status.ai.configured;

  async function generate() {
    setBusy(true);
    setError(null);
    setConfigError(null);
    try {
      onUpdated(await post<Product>(`/api/products/${product.id}/listing`));
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfigError(e.message);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Listing draft - ${product.name}`}
        icon={<Sparkles className="h-4 w-4" />}
        subtitle="Written only from the attributes you entered. Review every claim before publishing anywhere."
        actions={
          <>
            <Button size="sm" onClick={generate} loading={busy} disabled={!!aiMissing}>
              <Sparkles className="h-3.5 w-3.5" /> {d ? "Regenerate" : "Generate listing"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        }
      />
      <CardBody className="space-y-4">
        {aiMissing && <ConfigNotice message={status?.ai.requirement} />}
        {configError && <ConfigNotice message={configError} />}
        {error && <Alert tone="red">{error}</Alert>}
        {busy && <Spinner label="The Commerce Agent is drafting the listing..." />}
        {!d && !busy && (
          <p className="text-sm text-slate-500">
            No draft yet. Fill in materials, features and sizes on the product for a more accurate listing, then generate.
          </p>
        )}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="violet">
                <Sparkles className="h-3 w-3" /> AI-generated draft
              </Badge>
              {d.generated_at && <span className="text-xs text-slate-500">Generated {dateTime(d.generated_at)}</span>}
            </div>
            {d.claims_to_verify.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                  <ShieldCheck className="h-4 w-4" /> Verify before publishing
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-amber-900">
                  {d.claims_to_verify.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            <CopyBlock label="Title" text={d.title} />
            <CopyBlock label="Description" text={d.description} multiline />
            <CopyBlock label="Bullet points" text={d.bullets.map((b) => `• ${b}`).join("\n")} multiline />
            <CopyBlock label="Tags" text={d.tags.join(", ")} />
            <div className="grid gap-4 md:grid-cols-2">
              <CopyBlock label="SEO title" text={d.seo_title} />
              <CopyBlock label="SEO description" text={d.seo_description} />
            </div>
            <CopyBlock label="Size guidance" text={d.size_guidance_note} multiline />
          </>
        )}
      </CardBody>
    </Card>
  );
}

function CopyBlock({ label, text, multiline }: { label: string; text: string; multiline?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {text && <CopyButton text={text} />}
      </div>
      <div className={multiline ? "whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800" : "rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800"}>
        {text || <span className="text-slate-400">-</span>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- approvals

const APPROVAL_TONE: Record<string, Tone> = { pending: "amber", approved: "green", rejected: "red", executed: "green", failed: "red" };

function Approvals({ approvals }: { approvals: ReturnType<typeof useApi<Approval[]>> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(a: Approval, decision: "approve" | "reject") {
    setBusy(`${a.id}:${decision}`);
    setError(null);
    try {
      const updated = await post<Approval>(`/api/approvals/${a.id}/decision`, { decision });
      approvals.setData((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Alert tone="blue" title="Human approval checkpoint">
        External actions - publishing listings, purchasing inventory, launching paid campaigns and messaging suppliers - always require your explicit approval.
        No store, ad or sourcing integration is connected in this release, so approving a request records your decision but nothing is executed, sent or purchased.
      </Alert>
      {error && <Alert tone="red">{error}</Alert>}
      <Card>
        <CardHeader title="Requests" icon={<ClipboardCheck className="h-4 w-4" />} />
        <CardBody>
          {approvals.loading && !approvals.data ? (
            <Spinner />
          ) : approvals.error ? (
            <Alert tone="red">{errorText(approvals.error)}</Alert>
          ) : (approvals.data ?? []).length === 0 ? (
            <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No approval requests">
              When integrations are connected, any action that leaves 136Sourcing will appear here for you to approve or reject first.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(approvals.data ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-900">{a.title}</span>
                      <Badge tone={APPROVAL_TONE[a.status] ?? "slate"}>{a.status}</Badge>
                      <Badge tone="slate">{titleCase(a.action_type)}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Requested by {a.requested_by} · {dateTime(a.created_at)}
                      {a.decided_at ? ` · decided ${dateTime(a.decided_at)}` : ""}
                    </p>
                    {a.execution_result && (
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                        {a.execution_result.executed === false
                          ? `Not executed: ${String(a.execution_result.reason ?? "no integration connected")}`
                          : JSON.stringify(a.execution_result)}
                      </p>
                    )}
                  </div>
                  {a.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => decide(a, "approve")} loading={busy === `${a.id}:approve`} disabled={!!busy}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => decide(a, "reject")} loading={busy === `${a.id}:reject`} disabled={!!busy}>
                        Reject
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------- integrations & roadmap

const ROADMAP = [
  {
    icon: Receipt,
    title: "Orders",
    body: "Import orders from your store to track fulfilment, returns and real unit economics. Requires the Shopify integration.",
  },
  {
    icon: Megaphone,
    title: "Marketing campaigns",
    body: "Plan campaigns and measure acquisition cost. Launching any paid campaign will always require your explicit approval.",
  },
  {
    icon: BarChart3,
    title: "Sales performance",
    body: "Revenue, conversion and margin reporting from actual store data. No figures are shown until real data is connected.",
  },
];

function Integrations() {
  const integrations = useApi<IntegrationStatus[]>("/api/integrations");
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Integrations" icon={<Plug className="h-4 w-4" />} subtitle="Connections are defined as adapter interfaces; none perform external actions in this release." />
        <CardBody>
          {integrations.loading && !integrations.data ? (
            <Spinner />
          ) : integrations.error ? (
            <Alert tone="red">{errorText(integrations.error)}</Alert>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(integrations.data ?? []).map((i) => (
                <li key={i.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-900">{i.name}</span>
                      <Badge tone="slate">{titleCase(i.category)}</Badge>
                    </div>
                    <p className="mt-0.5 max-w-2xl text-xs text-slate-600">{i.detail}</p>
                  </div>
                  {i.state === "planned" ? <PlannedBadge /> : <Badge tone={i.state === "configured" ? "green" : "amber"}>{titleCase(i.state)}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        {ROADMAP.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardBody>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Icon className="h-4 w-4 text-slate-500" /> {title}
                </div>
                <PlannedBadge />
              </div>
              <p className="mt-2 text-[13px] text-slate-600">{body}</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
