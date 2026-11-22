"use client";

import { Download, FileUp } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { errorText, upload } from "@/lib/api";
import { Alert, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { titleCase } from "@/lib/format";

type ImportResult = { created: Record<string, number>; errors: { row: number; error: string }[]; error_count: number };

/** Generic CSV import card: template download + upload + per-row error report. */
export function CsvImportCard({
  title,
  description,
  templateKind,
  uploadPath,
  onDone,
  children,
}: {
  title: string;
  description: ReactNode;
  templateKind: "competitors" | "suppliers";
  uploadPath: string;
  onDone?: () => void;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function doUpload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await upload<ImportResult>(uploadPath, file);
      setResult(r);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onDone?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={description}
        icon={<FileUp className="h-4 w-4" />}
        actions={
          <a
            href={`/api/csv-templates/${templateKind}`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download template
          </a>
        }
      />
      <CardBody className="space-y-3">
        {children}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block max-w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200"
            aria-label="CSV file"
          />
          <Button onClick={doUpload} disabled={!file} loading={busy} size="sm">
            Import CSV
          </Button>
        </div>
        <p className="text-[11px] text-slate-500">UTF-8 CSV, up to 2 MB / 2,000 rows. Use semicolons to separate list values (e.g. channels). The template&apos;s example row is illustrative - delete it before importing.</p>
        {error && <Alert tone="red">{error}</Alert>}
        {result && (
          <Alert tone={result.error_count ? "amber" : "blue"} title="Import finished">
            <div>
              Created:{" "}
              {Object.entries(result.created)
                .map(([k, v]) => `${v} ${titleCase(k).toLowerCase()}`)
                .join(", ")}
              {result.error_count ? ` · ${result.error_count} row(s) skipped` : ""}
            </div>
            {result.errors.length > 0 && (
              <ul className="mt-1.5 max-h-40 list-disc overflow-y-auto pl-4 text-xs">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
