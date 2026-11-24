"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { ChannelsTab } from "@/components/channels/channels-tab";
import { PlanTab } from "@/components/channels/plan-tab";
import { ShippingTab } from "@/components/channels/shipping-tab";
import { PageHeader, Spinner, Tabs } from "@/components/ui";
import { useT } from "@/lib/i18n";

type Tab = "plan" | "channels" | "shipping";

function ChannelsView({ projectId }: { projectId: string }) {
  const { t } = useT();
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<Tab>(initial === "channels" || initial === "shipping" ? initial : "plan");
  // The product report remounts this page when an agent finishes, so the tabs always load fresh channels and shipping options.
  const version = 0;

  return (
    <>
      <PageHeader
        title={t("Shipping & Channels")}
        description={t("Decide where to sell and how to get product from the factory to your customer. Channel fees and freight rates are labelled as verified, sourced or assumed, and all margins come from the same deterministic model as Analytics.")}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "plan", label: t("Plan") },
          { value: "channels", label: t("Sales channels") },
          { value: "shipping", label: t("Shipping & fulfillment") },
        ]}
      />
      <div hidden={tab !== "plan"}><PlanTab projectId={projectId} /></div>
      {tab === "channels" && <ChannelsTab projectId={projectId} version={version} />}
      {tab === "shipping" && <ShippingTab projectId={projectId} version={version} />}
    </>
  );
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <RequireProject>{(pid) => <ChannelsView projectId={pid} />}</RequireProject>
    </Suspense>
  );
}
