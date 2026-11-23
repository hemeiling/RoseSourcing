// Sections of a product report, in review order. `route` is the old standalone page, which now opens this section.

export type SectionId = "review" | "overview" | "market" | "competitors" | "sizing" | "suppliers" | "channels" | "economics" | "brand" | "commerce";

export const SECTIONS: { id: SectionId; title: string; route?: string; description?: string }[] = [
  { id: "review", title: "What to improve" },
  { id: "overview", title: "Overview & decision", route: "/dashboard", description: "Your go / no-go decision, key numbers, open recommendations and recent activity." },
  { id: "market", title: "Market research", route: "/market", description: "Demand, market size, customers, competitors, sourcing and risks - every finding linked to its source." },
  { id: "competitors", title: "Competitors", route: "/competitors", description: "Who sells this today, at what prices, and how they position themselves." },
  { id: "sizing", title: "Sizing & fit", route: "/sizing", description: "Size charts, the fit finder and fit research for this product." },
  { id: "suppliers", title: "Suppliers", route: "/suppliers", description: "Factories, quotes, landed cost and communication." },
  { id: "channels", title: "Shipping & channels", route: "/channels", description: "Where to sell, fees, and how to ship." },
  { id: "economics", title: "Unit economics", route: "/analytics", description: "Cost scenarios, margins and experiments." },
  { id: "brand", title: "Brand", route: "/brand", description: "Names, positioning, personas and palettes." },
  { id: "commerce", title: "Inventory & listings", route: "/commerce", description: "Products, stock and listing approvals." },
];

export const SECTION_BY_ROUTE: Record<string, SectionId> = Object.fromEntries(
  SECTIONS.filter((s) => s.route).map((s) => [s.route!, s.id]),
) as Record<string, SectionId>;

export const productHref = (id: string, section?: SectionId) => `/product?id=${id}${section ? `#${section}` : ""}`;
