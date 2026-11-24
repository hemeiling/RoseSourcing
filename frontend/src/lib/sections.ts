// A product report: 9 tabs in review order. A tab can hold several parts; every tab and part has its own anchor
// (e.g. #listings), so links and deep links reach the exact part. `route` is the old standalone page it replaces.

export type TabId = "overview" | "market" | "competitors" | "fit" | "suppliers" | "compliance" | "channels" | "economics" | "brand";
export type PartId = "review" | "decision" | "market-size" | "research" | "buyers" | "trends" | "pricing" | "listings" | "brands" | "reviews" | "sizing"
  | "supplier-list" | "outreach" | "brand-concepts" | "commerce";
export type SectionId = TabId | PartId;

export type Part = { id: PartId; title: string; route?: string; description?: string };
export type Tab = { id: TabId; title: string; route?: string; description?: string; parts?: Part[] };

export const SECTIONS: Tab[] = [
  { id: "overview", title: "Overview", parts: [
    { id: "decision", title: "AI recommendation & decision", route: "/dashboard", description: "The AI's go / no-go call with a confidence score, the price range, materials and first channel it recommends, and your decision." },
    { id: "review", title: "To-dos", description: "What is still missing or weak for this product, and the research agents that fill it. Each item jumps to the part that fixes it." },
  ] },
  { id: "market", title: "Market & demand", parts: [
    { id: "market-size", title: "Market size", description: "How big the industry and this category are, and how much competitors sell - each figure with its year and source." },
    { id: "research", title: "Market research", route: "/market", description: "Demand, market size, customers, competitors, sourcing and risks - every finding linked to its source." },
    { id: "trends", title: "Search trends", description: "Google Trends: compare up to 5 search phrases over time, see where each is searched most, and the related searches and topics that are rising." },
  ] },
  { id: "competitors", title: "Competitors & pricing", parts: [
    { id: "pricing", title: "Price tiers & needs", description: "Budget to luxury: prices, quality differences, and what buyers in each tier want and complain about." },
    { id: "brands", title: "Competitors & listings", route: "/competitors", description: "Every brand selling this with its listings underneath: tier, channels, revenue and positioning, and each listing's picture, price, rating, reviews and badges. The Listing Tracker's 15-20 directly comparable listings are marked. Starred brands first." },
  ] },
  { id: "fit", title: "Reviews & fit", parts: [
    { id: "reviews", title: "Low-star reviews", description: "Complaints in 1-3 star reviews of the leading listings, tagged for comfort, fit and durability - each quote checked against its source." },
    { id: "sizing", title: "Sizing & fit", route: "/sizing", description: "Size charts, the fit finder and fit research for this product." },
  ] },
  { id: "suppliers", title: "Suppliers & quotes", parts: [
    { id: "supplier-list", title: "Suppliers", route: "/suppliers", description: "Factories, quotes, landed cost and communication." },
    { id: "outreach", title: "Quotes & samples", description: "A spec sheet, requests for quotation at 100 / 300 / 500 units to 5+ suppliers, their price breaks, and 2-3 sample orders." },
  ] },
  { id: "compliance", title: "Compliance & IP", description: "Design patents and trademarks, labelling rules, and UFLPA forced-labour requirements - with questions for your supplier." },
  { id: "channels", title: "Shipping & channels", route: "/channels", description: "Where to sell, fees, and how to ship." },
  { id: "economics", title: "Unit economics", route: "/analytics", description: "Cost scenarios, margins and experiments." },
  { id: "brand", title: "Brand & launch", parts: [
    { id: "buyers", title: "Buyers & style", description: "Who buys this, what they wear it for and which patterns, colours and materials they like - counted from every customer comment collected, with personas and design directions." },
    { id: "brand-concepts", title: "Brand & content", route: "/brand", description: "Brand drafts (names, positioning, voice, palettes) and launch content (social posts, video script, image briefs) written from your research." },
    { id: "commerce", title: "Inventory & listings", route: "/commerce", description: "Products, stock and listing approvals." },
  ] },
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
