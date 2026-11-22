"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { RequireProject } from "@/components/app-shell";
import { ChannelsTab } from "@/components/channels/channels-tab";
import { PlanTab } from "@/components/channels/plan-tab";
import { ShippingTab } from "@/components/channels/shipping-tab";
import { PageHeader, Spinner, Tabs } from "@/components/ui";

type Tab = "plan" | "channels" | "shipping";

function ChannelsView({ projectId }: { projectId: string }) {
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<Tab>(initial === "channels" || initial === "shipping" ? initial : "plan");
  // Bumped when research finishes so the other tabs pick up new channels and shipping options.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <>
      <PageHeader
        title="Shipping & Channels"
        description="Decide where to sell and how to get product from the factory to your customer. Channel fees and freight rates are labelled as verified, sourced or assumed, and all margins come from the same deterministic model as Analytics."
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "plan", label: "Plan" },
          { value: "channels", label: "Sales channels" },
          { value: "shipping", label: "Shipping & fulfillment" },
        ]}
      />
      <div hidden={tab !== "plan"}><PlanTab projectId={projectId} onDataChanged={bump} /></div>
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
