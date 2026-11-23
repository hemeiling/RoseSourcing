"use client";

import clsx from "clsx";
import { Bot, CheckCircle2, Database, Loader2, MessageSquarePlus, Send, Trash2, User as UserIcon, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RequireProject } from "@/components/app-shell";
import { useStatus } from "@/components/providers";
import { Alert, Badge, Button, Card, ConfigNotice, ExternalLink, PageHeader, Spinner } from "@/components/ui";
import { ApiError, del, errorText, get, post } from "@/lib/api";
import { ago, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { CopilotMessage, CopilotThread } from "@/lib/types";

const EXAMPLES = [
  "Start market research for this product, focusing on beginners' practice wear",
  "Add Brand Z as a competitor: their practice dress is $64 at https://example.com/dress",
  "Draft an RFQ to my cheapest supplier asking for samples",
  "Give me a go / no-go decision brief",
  "Is this an attractive market based on the evidence we have?",
  "Which customer segment should I target first?",
  "How should I differentiate from competitors?",
  "What is my expected profit at a $69 retail price?",
  "What additional evidence do I need before investing?",
  "Which supplier has the best landed cost?",
  "What should I do next?",
];

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-ai">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ href, children }) => (href ? <ExternalLink href={href}>{children}</ExternalLink> : <>{children}</>) }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function AssistantMessage({ m }: { m: CopilotMessage }) {
  const writes = m.tool_calls.filter((c) => ["create_recommendation", "save_cost_scenario", "save_size_chart"].includes(c.tool));
  const reads = m.tool_calls.filter((c) => !writes.includes(c));
  const links = m.references.filter((r) => r.url);
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white"><Bot className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        {reads.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {reads.map((c, i) => (
              <Badge key={i} tone={c.ok ? "slate" : "red"} title={JSON.stringify(c.input)}>
                <Database className="h-3 w-3" /> {c.summary}
              </Badge>
            ))}
          </div>
        )}
        <div className="rounded-xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-slate-800">
          <Markdown text={m.content} />
        </div>
        {writes.length > 0 && (
          <div className="mt-2 space-y-1">
            {writes.map((c, i) => (
              <div key={i} className={clsx("flex items-center gap-1.5 text-xs", c.ok ? "text-emerald-700" : "text-red-700")}>
                {c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {c.ok ? `Confirmed by the server: ${c.summary}` : `Not saved: ${c.summary}`}
              </div>
            ))}
          </div>
        )}
        {links.length > 0 && (
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-700">Sources used ({links.length})</summary>
            <ul className="mt-1.5 space-y-1 pl-1">
              {links.map((r) => (
                <li key={`${r.type}:${r.id}`}><Badge>{titleCase(r.type)}</Badge> <ExternalLink href={r.url!}>{r.label}</ExternalLink></li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function CopilotView({ projectId }: { projectId: string }) {
  const { status } = useStatus();
  const threads = useApi<CopilotThread[]>(`/api/projects/${projectId}/copilot/threads`);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThreadId(null);
    setMessages([]);
  }, [projectId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function openThread(id: string) {
    setThreadId(id);
    setError(null);
    setLoadingThread(true);
    try {
      const t = await get<CopilotThread>(`/api/copilot/threads/${id}`);
      setMessages(t.messages ?? []);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingThread(false);
    }
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setPending(q);
    setQuestion("");
    setError(null);
    try {
      const res = await post<{ thread: CopilotThread & { messages: CopilotMessage[] }; message: CopilotMessage }>(
        `/api/projects/${projectId}/copilot/ask`,
        { question: q, thread_id: threadId },
      );
      setThreadId(res.thread.id);
      setMessages(res.thread.messages);
      threads.reload();
    } catch (e) {
      if (e instanceof ApiError && e.isConfigError) setConfigError(e.message);
      else setError(errorText(e));
      setQuestion(q);
    } finally {
      setPending(null);
    }
  }

  async function removeThread(id: string) {
    await del(`/api/copilot/threads/${id}`).catch(() => {});
    if (id === threadId) {
      setThreadId(null);
      setMessages([]);
    }
    threads.reload();
  }

  const aiReady = status?.ai.configured !== false && !configError;

  return (
    <>
      <PageHeader title="AI Business Copilot"
        description="Ask questions about your project. The copilot looks up your saved research, competitors, suppliers and scenarios, cites evidence, and only reports actions the server confirms." />
      {!aiReady && <div className="mb-4"><ConfigNotice message={configError ?? status?.ai.requirement} /></div>}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit">
          <div className="border-b border-slate-100 p-3">
            <Button variant="secondary" size="sm" className="w-full" onClick={() => { setThreadId(null); setMessages([]); }}>
              <MessageSquarePlus className="h-3.5 w-3.5" /> New conversation
            </Button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto p-1.5">
            {threads.loading && !threads.data && <li className="p-2"><Spinner /></li>}
            {threads.data?.length === 0 && <li className="p-3 text-xs text-slate-500">No conversations yet.</li>}
            {threads.data?.map((t) => (
              <li key={t.id} className="group flex items-center">
                <button onClick={() => openThread(t.id)}
                  className={clsx("min-w-0 flex-1 rounded-md px-2.5 py-2 text-left", t.id === threadId ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-50")}>
                  <div className="break-words text-[13px] font-medium">{t.title}</div>
                  <div className="text-[11px] text-slate-400">{ago(t.updated_at)}</div>
                </button>
                <button onClick={() => removeThread(t.id)} aria-label="Delete conversation" className="rounded p-1.5 text-slate-300 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex min-h-[65vh] flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
            {loadingThread && <Spinner />}
            {!loadingThread && messages.length === 0 && !pending && (
              <div className="py-6">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800"><Bot className="h-4 w-4 text-brand-600" /> Try asking</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EXAMPLES.map((ex) => (
                    <button key={ex} disabled={!aiReady} onClick={() => ask(ex)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50">
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end gap-3">
                  <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white">{m.content}</div>
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600"><UserIcon className="h-4 w-4" /></div>
                </div>
              ) : (
                <AssistantMessage key={m.id} m={m} />
              ),
            )}
            {pending && (
              <>
                <div className="flex justify-end"><div className="max-w-[85%] rounded-xl rounded-tr-sm bg-brand-600/80 px-4 py-2.5 text-sm text-white">{pending}</div></div>
                <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking your project data...</div>
              </>
            )}
            <div ref={bottom} />
          </div>
          {error && <div className="px-4 pb-2"><Alert tone="red">{error}</Alert></div>}
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); ask(question); }} className="flex items-end gap-2 border-t border-slate-100 p-3">
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={1} maxLength={4000} disabled={!aiReady}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(question); } }}
              placeholder={aiReady ? "Ask about your market, competitors, suppliers or margins..." : "AI is not configured"}
              aria-label="Question"
              className="max-h-40 min-h-[42px] flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50" />
            <Button type="submit" disabled={!question.trim() || !!pending || !aiReady} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
        </Card>
      </div>
    </>
  );
}

export default function CopilotPage() {
  return <RequireProject>{(pid) => <CopilotView projectId={pid} />}</RequireProject>;
}
