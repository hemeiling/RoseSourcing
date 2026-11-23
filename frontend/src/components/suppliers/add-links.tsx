"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { errorText, post } from "@/lib/api";

type Result = { added: { id: string; name: string }[]; already_saved: string[]; invalid: string[] };

/** Listing links the founder found (Alibaba, 1688, Made-in-China...): each is saved straight away as an unverified supplier
 *  lead with its link - no AI, no cost. Price and MOQ can be added on the quote later. */
export function AddListingLinks({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const urls = text.split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^(https?:\/\/|www\.)/i.test(u));

  const add = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await post<Result>(`/api/projects/${projectId}/suppliers/from-links`, { urls: urls.slice(0, 20) });
      const parts = [`Added ${r.added.length}`];
      if (r.already_saved.length) parts.push(`${r.already_saved.length} already saved`);
      if (r.invalid.length) parts.push(`${r.invalid.length} not a link`);
      setNote({ tone: "ok", text: parts.join(" · ") });
      if (r.added.length) {
        setText("");
        onAdded();
      }
    } catch (e) {
      setNote({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-white px-3 py-2 sm:flex-row sm:items-center">
      <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-ink"><Link2 className="h-4 w-4 text-primary-600" aria-hidden />Add links you found</span>
      <Input className="h-8 min-w-0 flex-1 py-1" value={text} onChange={(e) => setText(e.target.value)} aria-label="Supplier listing links"
        placeholder="Paste Alibaba, 1688, Made-in-China... listing links, separated by spaces" onKeyDown={(e) => e.key === "Enter" && urls.length && add()} />
      <Button size="sm" onClick={add} loading={busy} disabled={!urls.length} className="shrink-0">
        Add{urls.length > 1 ? ` ${urls.length}` : ""}
      </Button>
      {note && <span className={note.tone === "ok" ? "shrink-0 text-xs text-slate-600" : "text-xs text-red-700"}>{note.text}</span>}
    </div>
  );
}
