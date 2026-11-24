// A product report: 10 tabs in review order - the market, then customers, then what to make and sell, then how to source it, and last what to do about it. A tab can hold several parts; every tab and part has its own anchor
// (e.g. #listings), so links and deep links reach the exact part. `route` is the old standalone page it replaces.

export type TabId = "overview" | "market" | "competitors" | "fit" | "suppliers" | "compliance" | "channels" | "economics" | "brand" | "actions";
export type PartId = "review" | "decision" | "market-size" | "research" | "buyers" | "trends" | "pricing" | "listings" | "brands" | "reviews" | "sizing"
  | "supplier-list" | "outreach" | "brand-concepts" | "commerce";
export type SectionId = TabId | PartId;

/** `shownWhen`: dashboard counts, any of which above zero means an agent has saved something here. Parts without it are
 * ones you fill in yourself (suppliers, size charts, scenarios...) and always show; a tab hides when all its parts do. */
export type Part = { id: PartId; title: string; route?: string; description?: string; shownWhen?: string[] };
export type Tab = { id: TabId; title: string; route?: string; description?: string; parts?: Part[]; shownWhen?: string[] };

export const SECTIONS: Tab[] = [
  { id: "overview", title: "Overview", parts: [
    { id: "decision", title: "AI recommendation & decision", route: "/dashboard", description: "The AI's go / no-go call with a confidence score, the price range, materials and first channel it recommends, and your decision." },
    { id: "review", title: "Research agents", description: "The same agents work on every product. Each run is saved with this product, with its sources and cost." },
  ] },
  { id: "market", title: "Market & demand", parts: [
    { id: "market-size", title: "Market size", shownWhen: ["market_size_findings"], description: "How big the industry and this category are, and how much competitors sell - each figure with its year and source." },
    { id: "research", title: "Market research", shownWhen: ["findings", "reports"], route: "/market", description: "Demand, market size, customers and risks - every finding linked to its source. Competitors and supplier prices have their own parts." },
    { id: "trends", title: "Search trends", description: "Google Trends: compare up to 5 search phrases over time, see where each is searched most, and the related searches and topics that are rising." },
  ] },
  { id: "competitors", title: "Competitors & pricing", parts: [
    { id: "pricing", title: "Price tiers & needs", shownWhen: ["price_tier_reports"], description: "Budget to luxury: prices, quality differences, and what buyers in each tier want and complain about." },
    { id: "brands", title: "Competitors & listings", route: "/competitors", description: "Every brand selling this with its listings underneath: tier, channels, revenue and positioning, and each listing's picture, price, rating, reviews and badges. The Listing Tracker's 15-20 directly comparable listings are marked. Starred brands first." },
  ] },
  { id: "fit", title: "Customers & fit", parts: [
    { id: "reviews", title: "Low-star reviews", shownWhen: ["review_reports"], description: "Complaints in 1-3 star reviews of the leading listings, tagged for comfort, fit and durability - each quote checked against its source." },
    { id: "buyers", title: "Buyers & style", shownWhen: ["buyer_reports"], description: "Who buys this, what they wear it for and which patterns, colours and materials they like - counted from every customer comment collected, with personas and design directions." },
    { id: "sizing", title: "Sizing & fit", route: "/sizing", shownWhen: ["size_charts", "fit_findings"], description: "Competitors' size charts and what customers say about fit, returns and exchanges." },
  ] },
  { id: "brand", title: "Brand & launch", parts: [
    { id: "brand-concepts", title: "Brand & content", route: "/brand", description: "Brand drafts (names, positioning, voice, palettes) and launch content (social posts, video script, image briefs) written from your research." },
    { id: "commerce", title: "Inventory & listings", route: "/commerce", description: "Products, stock and listing approvals." },
  ] },
  { id: "suppliers", title: "Suppliers & quotes", parts: [
    { id: "supplier-list", title: "Suppliers", route: "/suppliers", description: "Factories, quotes, landed cost and communication." },
    { id: "outreach", title: "Quotes & samples", description: "A spec sheet, requests for quotation at 100 / 300 / 500 units to 5+ suppliers, their price breaks, and 2-3 sample orders." },
  ] },
  { id: "compliance", title: "Compliance & IP", shownWhen: ["compliance_checks"], description: "Design patents and trademarks, labelling rules, and UFLPA forced-labour requirements - with questions for your supplier." },
  { id: "channels", title: "Shipping & channels", route: "/channels", description: "Where to sell, fees, and how to ship." },
  { id: "economics", title: "Unit economics", route: "/analytics", description: "Cost scenarios, margins and experiments." },
  { id: "actions", title: "Risks & next steps", description: "Every agent's risks, open questions and recommended next steps, then what is still left to do - after the research." },
];

/** The tab each anchor lives in (a tab is its own parent). "listings" was its own part; it now sits inside "brands". */
export const TAB_OF: Record<string, TabId> = Object.fromEntries([
  ...SECTIONS.flatMap((t) => [[t.id, t.id], ...(t.parts ?? []).map((p) => [p.id, t.id])]),
  ["listings", "competitors"],
]) as Record<string, TabId>;

export const SECTION_BY_ROUTE: Record<string, SectionId> = Object.fromEntries(
  SECTIONS.flatMap((t) => [t, ...(t.parts ?? [])]).filter((s) => s.route).map((s) => [s.route!, s.id]),
) as Record<string, SectionId>;

export const productHref = (id: string, section?: SectionId) => `/product?id=${id}${section ? `#${section}` : ""}`;
