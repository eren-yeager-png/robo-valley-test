"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import ActivateButton from "./ActivateButton";

type Category = { slug: string; name: string };
type Mode = "dataset" | "file";
type Merged = { sheet?: string; row: number; keptRow: number; reason: string; filled: string[]; conflicts: { column: string; kept: string; skipped: string }[] };
type Possible = { sheet?: string; row: number; otherRow: number; reason: string; similarity?: number };
type Report = {
  rowsRead: number; added: number; duplicatesSkipped: number; rowsFilled: number; conflictRows: number; rejected: number; possibleDuplicates: number;
  hiddenRowsRead: number; repeatedHeaders: number; sheets: string[]; examples: { merged: Merged[]; possible: Possible[] }; url: string;
};
type DatasetResult = { datasetId: string; filename: string; category: { name: string }; rowCount: number; invalidRowCount: number; invalidRows?: { row?: number; rowNumber?: number; sheet?: string; reason: string }[]; preview: { schoolName: string; state: string; district: string; pincode: string }[]; unchanged?: boolean; message?: string; report?: Report };
type FileResult = { filename: string; type: string; size: number; key: string; warning?: string };

const DATASET_EXT = [".xlsx", ".csv"];
const FILE_EXT = [".xlsx", ".csv", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".txt"];
const DATASET_MAX = 4 * 1024 * 1024; // keep equal to MAX_FILE_BYTES in src/lib/spreadsheet/parse.ts (Vercel refuses bodies over 4.5 MB) // the server enforces the real limits; these only give instant feedback
const FILE_MAX = 4 * 1024 * 1024;

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1048576 ? 2 : 1)} MB`;

/** Every row of the file is accounted for: rows read = added + duplicates skipped + rejected. */
function UploadReport({ report: r }: { report: Report }) {
  const where = (x: { sheet?: string }) => (x.sheet ? x.sheet + ", " : "");
  return (
    <div className="adm-note" role="status" aria-label="Upload report" style={{ marginBottom: 12 }}>
      <strong>Upload report</strong>
      <ul>
        <li>Rows read: {r.rowsRead.toLocaleString("en-IN")}</li>
        <li>New unique schools added: {r.added.toLocaleString("en-IN")}</li>
        <li>Duplicates skipped (the same school again): {r.duplicatesSkipped.toLocaleString("en-IN")}{r.rowsFilled > 0 && <> · {r.rowsFilled} filled a blank value in the kept row</>}{r.conflictRows > 0 && <> · {r.conflictRows} had different values (the first row's values were kept)</>}</li>
        <li>Rows rejected (for example a bad PIN code or an empty name): {r.rejected.toLocaleString("en-IN")}</li>
        <li>Possible duplicates to review (not merged): {r.possibleDuplicates.toLocaleString("en-IN")}</li>
        {r.hiddenRowsRead > 0 && <li>{r.hiddenRowsRead.toLocaleString("en-IN")} rows are hidden in the spreadsheet (for example by a filter). They were read like every other row.</li>}
        {r.repeatedHeaders > 0 && <li>{r.repeatedHeaders} repeated header rows were skipped</li>}
        {r.sheets.length > 1 && <li>Sheets read: {r.sheets.join(", ")}</li>}
      </ul>
      {r.examples.merged.length > 0 && (
        <ul>{r.examples.merged.map((m, i) => <li key={"m" + i}>{where(m)}Row {m.row} skipped, kept row {m.keptRow} ({m.reason}){m.conflicts.length > 0 && <>: different {m.conflicts.map((c) => c.column).join(", ")}</>}</li>)}</ul>
      )}
      {r.examples.possible.length > 0 && (
        <ul>{r.examples.possible.map((p, i) => <li key={"p" + i}>{where(p)}Row {p.row} and row {p.otherRow}: {p.reason}</li>)}</ul>
      )}
      <a href={r.url}>Download the full report (CSV)</a>
    </div>
  );
}

export default function UploadForm({ categories, initialCategory, filesReady }: { categories: Category[]; initialCategory: string; filesReady: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("dataset");
  const [category, setCategory] = useState(initialCategory);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [dataset, setDataset] = useState<DatasetResult | null>(null);
  const [stored, setStored] = useState<FileResult | null>(null);
  const [live, setLive] = useState(false);
  const [unchanged, setUnchanged] = useState("");

  const allowed = mode === "dataset" ? DATASET_EXT : FILE_EXT;
  const max = mode === "dataset" ? DATASET_MAX : FILE_MAX;

  function reset(keepMode = true) {
    setFile(null); setProblem(""); setPct(0); setDataset(null); setStored(null); setLive(false); setUnchanged("");
    if (input.current) input.current.value = "";
    if (!keepMode) setMode("dataset");
  }

  function check(f: File | null, m: Mode = mode): string {
    if (!f) return "Choose a file first.";
    const ext = f.name.includes(".") ? "." + f.name.split(".").pop()!.toLowerCase() : "";
    const list = m === "dataset" ? DATASET_EXT : FILE_EXT;
    if (!list.includes(ext)) return `This file type is not allowed. Allowed: ${list.join(", ")}.`;
    if (f.size === 0) return "The file is empty.";
    if (f.size > (m === "dataset" ? DATASET_MAX : FILE_MAX)) return `The file is ${mb(f.size)}, which is more than the ${mb(m === "dataset" ? DATASET_MAX : FILE_MAX)} limit.${m === "dataset" ? " Please remove unused rows or columns, or split it into two files, and try again." : ""}`;
    return "";
  }

  function pick(f: File | null) {
    setDataset(null); setStored(null); setLive(false); setUnchanged("");
    setFile(f);
    setProblem(f ? check(f) : "");
  }

  function send() {
    const err = check(file);
    if (err || !file) { setProblem(err); return; }
    if (mode === "dataset" && !category) { setProblem("Choose which category this data belongs to."); return; }
    setBusy(true); setProblem(""); setPct(0); setDataset(null); setStored(null); setLive(false); setUnchanged("");
    const form = new FormData();
    form.append("file", file);
    if (mode === "dataset") form.append("category", category);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", mode === "dataset" ? "/api/services/upload" : "/api/admin/attachments");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => { setBusy(false); setProblem("Network problem. Nothing was uploaded."); };
    xhr.onload = () => {
      setBusy(false);
      let body: any = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 413 && !body.message) { setProblem("The server refused a file this large."); return; }
      if (xhr.status < 200 || xhr.status >= 300 || !body.success) { setProblem(body.message ?? "The upload failed. Nothing was changed."); return; }
      setPct(100);
      if (mode === "dataset" && body.unchanged) setUnchanged(body.message ?? "This file is identical to the live data. No changes were made.");
      else if (mode === "dataset") setDataset(body as DatasetResult);
      else setStored({ filename: body.attachment.filename, type: body.attachment.type, size: body.attachment.size, key: body.attachment.key, warning: body.warning });
      router.refresh();
    };
    xhr.send(form);
  }

  return (
    <div className="adm-card">
      <div className="adm-tabs" role="tablist" aria-label="What are you uploading?">
        <button type="button" role="tab" aria-selected={mode === "dataset"} className="btn" onClick={() => { setMode("dataset"); reset(); }} disabled={busy}>School data for a category</button>
        <button type="button" role="tab" aria-selected={mode === "file"} className="btn" onClick={() => { setMode("file"); reset(); }} disabled={busy}>Other file (stored only)</button>
      </div>

      {mode === "dataset" ? (
        <p>Spreadsheet (.xlsx or .csv) of schools for ONE category. You will see a preview first; nothing goes live until you confirm, and only that category changes.</p>
      ) : filesReady ? (
        <p>Store a document or image (.xlsx, .csv, .pdf, .docx, .png, .jpg, .txt, up to 4 MB). Stored files never change the Find a Service data.</p>
      ) : (
        <div className="adm-note setup"><strong>File storage is not set up yet</strong>The database needs migration 009 before other files can be stored. Dataset uploads still work.</div>
      )}

      {(mode === "dataset" || filesReady) && (
        <form onSubmit={(e) => { e.preventDefault(); send(); }} noValidate>
          {mode === "dataset" && (
            <div className="adm-filters">
              <label>Category
                <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
                  <option value="">Choose a category…</option>
                  {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
              </label>
            </div>
          )}
          <div className="adm-drop">
            <input ref={input} type="file" accept={allowed.join(",")} aria-label="File to upload" disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <div style={{ color: "var(--muted)", fontSize: ".85rem", marginTop: 8 }}>Allowed: {allowed.join(" ")} · up to {mb(max)}</div>
            {file && !problem && <div style={{ marginTop: 8 }}>{file.name} · {mb(file.size)}</div>}
          </div>
          {busy && (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Upload progress">
              <div className="adm-progress"><i style={{ width: pct + "%" }} /></div>
              <div style={{ fontSize: ".85rem", color: "var(--muted)" }}>{pct < 100 ? `Uploading… ${pct}%` : "Checking the file…"}</div>
            </div>
          )}
          {problem && <div className="adm-note error" role="alert"><strong>Cannot upload</strong>{problem}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="submit" className="btn primary" disabled={busy || !file || Boolean(problem)}>{busy ? "Uploading…" : mode === "dataset" ? "Upload and preview" : "Store file"}</button>
            {(file || dataset || stored) && <button type="button" className="btn" onClick={() => reset()} disabled={busy}>Clear</button>}
          </div>
        </form>
      )}

      {unchanged && (
        <div className="adm-note" role="status" style={{ marginTop: 18 }}><strong>No changes</strong>{unchanged}</div>
      )}

      {dataset && (
        <section aria-live="polite" style={{ marginTop: 18 }}>
          <h3>Preview: {dataset.filename}</h3>
          <p>{dataset.rowCount.toLocaleString("en-IN")} unique schools for <strong>{dataset.category.name}</strong>{dataset.invalidRowCount > 0 && <> · <span className="adm-pill warn">{dataset.invalidRowCount} rows rejected</span></>}</p>
          {dataset.report && <UploadReport report={dataset.report} />}
          {dataset.invalidRows && dataset.invalidRows.length > 0 && (
            <ul>{dataset.invalidRows.slice(0, 5).map((r, i) => <li key={i}>{r.sheet ? r.sheet + ", " : ""}Row {r.rowNumber ?? r.row}: {r.reason}</li>)}</ul>
          )}
          <div className="adm-tablewrap"><table className="adm-table"><thead><tr><th>School</th><th>State</th><th>District</th><th>PIN code</th></tr></thead>
            <tbody>{dataset.preview.map((r, i) => <tr key={i}><td className="cell-wrap">{r.schoolName}</td><td>{r.state}</td><td>{r.district}</td><td>{r.pincode}</td></tr>)}</tbody></table></div>
          {live ? (
            <div className="adm-note" role="status" style={{ marginTop: 12 }}><strong>Now live</strong>This file is the live data for {dataset.category.name}. It may take about a minute to appear on the website.</div>
          ) : (
            <div style={{ marginTop: 12 }}><ActivateButton datasetId={dataset.datasetId} label={dataset.filename} onDone={() => setLive(true)} /></div>
          )}
        </section>
      )}

      {stored && (
        <section aria-live="polite" style={{ marginTop: 18 }}>
          <div className="adm-note" role="status"><strong>Stored</strong>{stored.filename} ({mb(stored.size)}). <a href={`/api/admin/attachments/${stored.key}`}>Download</a></div>
          {stored.warning && <div className="adm-note setup" role="status"><strong>Heads up</strong>{stored.warning}</div>}
        </section>
      )}
    </div>
  );
}
