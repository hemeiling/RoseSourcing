import clsx from "clsx";

/**
 * RoseSourcing mark: a compass rose. "Rose" from the name, and a compass for finding the right product to source.
 * Four long points (each split into a shaded and a lit half, like a drafted compass) over four short diagonal points.
 */
export function RoseMark({ className, light }: { className?: string; light?: boolean }) {
  const dark = light ? "#ffffff" : "#43246f";
  const mid = light ? "rgba(255,255,255,0.72)" : "#6a48a3";
  const soft = light ? "rgba(255,255,255,0.45)" : "#ae97d4";
  const faint = light ? "rgba(255,255,255,0.28)" : "#cfc1e6";
  return (
    <svg viewBox="0 0 40 40" className={clsx("shrink-0", className)} aria-hidden>
      <circle cx="20" cy="20" r="12.5" fill="none" stroke={faint} strokeWidth="1" />
      {[45, 135, 225, 315].map((a) => (
        <g key={a} transform={`rotate(${a} 20 20)`}>
          <path d="M20 8.5 L18.3 18.3 L20 20 Z" fill={soft} />
          <path d="M20 8.5 L21.7 18.3 L20 20 Z" fill={faint} />
        </g>
      ))}
      {[0, 90, 180, 270].map((a) => (
        <g key={a} transform={`rotate(${a} 20 20)`}>
          <path d="M20 2 L16.7 16.7 L20 20 Z" fill={dark} />
          <path d="M20 2 L23.3 16.7 L20 20 Z" fill={mid} />
        </g>
      ))}
      <circle cx="20" cy="20" r="2.4" fill={light ? "#4e2a84" : "#ffffff"} stroke={dark} strokeWidth="1.4" />
    </svg>
  );
}

/** Mark plus wordmark: "Rose" set bold in purple, "Sourcing" in regular weight. */
export function BrandMark({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <RoseMark className="h-9 w-9" light={light} />
      {!compact && (
        <div className="leading-none">
          <div className={clsx("text-[21px] tracking-[-0.01em]", light ? "text-white" : "text-ink")}>
            <span className={clsx("font-bold", light ? "text-white" : "text-primary-700")}>Rose</span>
            <span className="font-normal">Sourcing</span>
          </div>
          <div className={clsx("mt-1 text-[11px] font-medium", light ? "text-white/70" : "text-slate-500")}>Evidence-led launches</div>
        </div>
      )}
    </div>
  );
}
