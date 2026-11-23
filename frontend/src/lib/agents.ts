// The research agents. Each works on any product: run it from that product's report (its section), the copilot,
// or Claude through the connector. Results are saved per product.

import type { SectionId } from "./sections";
import type { ResearchRun } from "./types";

export const AGENTS: { kind: ResearchRun["kind"]; name: string; does: string; section: SectionId }[] = [
  { kind: "market_opportunity", name: "Market Research Agent", does: "Demand signals, market size, customers, competitors, sourcing costs, risks and an opportunity report.", section: "market" },
  { kind: "price_tiers", name: "Price Tier Agent", does: "Budget-to-luxury tiers from real Amazon and Google Shopping listings, with quality and buyer needs per tier.", section: "pricing" },
  { kind: "competitor_discovery", name: "Competitor Discovery Agent", does: "Finds brands selling this product, their channels and prices; competitors are placed in price tiers.", section: "competitors" },
  { kind: "fit_sizing", name: "Fit & Sizing Agent", does: "Competitors' size charts, fit complaints and returns policies.", section: "sizing" },
  { kind: "supplier_listings", name: "Supplier Sourcing Agent", does: "B2B listings on Alibaba, 1688 and Made-in-China with listed prices and MOQs.", section: "suppliers" },
  { kind: "compliance", name: "Compliance & IP Agent", does: "Design patents and trademarks, labelling rules and UFLPA - plus questions drafted for each supplier.", section: "compliance" },
  { kind: "channels_logistics", name: "Channels & Shipping Agent", does: "Seller fees on Amazon, Etsy, Walmart, Costco, Faire and your own site, plus freight benchmarks and a launch plan.", section: "channels" },
];

/** One URL per line (or separated by spaces/commas/quotes) -> list; the server strips tracking parameters. */
export const parseUrls = (text: string) => text.split(/[\s,"']+/).map((u) => u.trim()).filter((u) => /^(https?:\/\/|www\.)/i.test(u)).slice(0, 8);
