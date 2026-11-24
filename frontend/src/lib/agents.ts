// The research agents. Each works on any product: run it from that product's report (its section), the copilot,
// or Claude through the connector. Results are saved per product.

import type { SectionId } from "./sections";
import type { ResearchRun } from "./types";

// In the order Run all runs them: each reads what the earlier ones saved, and Market Research's report comes last.
export const AGENTS: { kind: ResearchRun["kind"]; name: string; does: string; section: SectionId }[] = [
  { kind: "price_tiers", name: "Price Range Finder", does: "Budget-to-luxury tiers from real Amazon and Google Shopping listings, with quality and buyer needs per tier.", section: "pricing" },
  { kind: "listing_tracker", name: "Top Listings Tracker", does: "Google Trends plus 15-20 directly comparable listings across Amazon, Etsy and brand sites, logged with price, rating, review count and badges.", section: "listings" },
  { kind: "competitor_discovery", name: "Competitor Finder", does: "Finds brands selling this product, their channels and prices; competitors are placed in price tiers.", section: "brands" },
  { kind: "fit_sizing", name: "Size & Fit Checker", does: "Competitors' size charts, fit complaints and returns policies.", section: "sizing" },
  { kind: "supplier_listings", name: "Supplier Finder", does: "B2B listings on Alibaba, 1688 and Made-in-China with listed prices and MOQs.", section: "supplier-list" },
  { kind: "review_mining", name: "Complaint Reader", does: "Reads low-star reviews of the leading listings and tags comfort, fit and durability complaints, with fixes for your spec sheet.", section: "reviews" },
  { kind: "buyer_style", name: "Buyer Profiler", does: "Reads every customer comment collected (reviews of all star ratings, forums, trend pages) and counts who buys - stated ages, who wears it, occasions - and which patterns, colours and materials they praise, plus personas and design directions.", section: "buyers" },
  { kind: "compliance", name: "Rules & Patent Checker", does: "Design patents and trademarks, labelling rules and UFLPA - plus questions drafted for each supplier.", section: "compliance" },
  { kind: "channels_logistics", name: "Sales & Shipping Planner", does: "Seller fees on Amazon, Etsy, Walmart, Costco, Faire and your own site, plus freight benchmarks and a launch plan.", section: "channels" },
  { kind: "market_opportunity", name: "Market Analyst", does: "Demand signals, market size, customers and risks, then an opportunity report that also uses the competitors, supplier prices and freight the other agents found.", section: "market" },
];

/** One URL per line (or separated by spaces/commas/quotes) -> list; the server strips tracking parameters. */
export const parseUrls = (text: string) => text.split(/[\s,"']+/).map((u) => u.trim()).filter((u) => /^(https?:\/\/|www\.)/i.test(u)).slice(0, 8);
