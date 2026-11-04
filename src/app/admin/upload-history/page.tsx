import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { tableExists } from "../../../lib/adminStats";
import { formatSize, HISTORY_KINDS, HISTORY_RESULTS, listHistory } from "../../../lib/uploadHistory";
import { DataTable, Notice, PageHeader, Pager, SetupNotice, when } from "../_components/ui";

export const metadata: Metadata = { title: "Upload history | RoboValley admin", robots: { index: false, follow: false } };

type SP = { page?: string; kind?: string; result?: string };
const KIND: Record<string, string> = { dataset: "Dataset", attachment: "File" };
const RESULT: Record<string, string> = { success: "Accepted", rejected: "Rejected", error: "Failed" };

export default async function UploadHistoryPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const sp = (await searchParams) ?? {};
  const kind = (HISTORY_KINDS as readonly string[]).includes(sp.kind ?? "") ? sp.kind! : "";
  const result = (HISTORY_RESULTS as readonly string[]).includes(sp.result ?? "") ? sp.result! : "";
  const page = /^\d{1,6}$/.test(sp.page ?? "") ? Number(sp.page) : 1;

  let data, hasAttachments;
  try {
    hasAttachments = await tableExists(pool, "upload_attachments");
    data = await listHistory(pool, { page, kind, result, hasAttachments });
  } catch {
    console.error("admin upload history: could not read the data");
    return (<><PageHeader title="Upload history" /><Notice kind="error" title="The history could not be loaded">The database did not answer. Please try again.</Notice></>);
  }
  const href = (k: string, r: string) => { const q = new URLSearchParams({ ...(k ? { kind: k } : {}), ...(r ? { result: r } : {}) }).toString(); return "/admin/upload-history" + (q ? "?" + q : ""); };
  const params: Record<string, string> = {};
  if (kind) params.kind = kind;
  if (result) params.result = result;

  return (
    <>
      <PageHeader title="Upload history" lead="Every upload and every time a dataset was made live, newest first." />
      {!hasAttachments && <SetupNotice what="Stored files and download" migration="009" />}
      <div className="adm-tabs" aria-label="Type">
        <Link href={href("", result)} aria-current={kind === "" ? "page" : undefined}>All types</Link>
        <Link href={href("dataset", result)} aria-current={kind === "dataset" ? "page" : undefined}>Datasets</Link>
        {hasAttachments && <Link href={href("attachment", result)} aria-current={kind === "attachment" ? "page" : undefined}>Files</Link>}
      </div>
      <div className="adm-tabs" aria-label="Result">
        <Link href={href(kind, "")} aria-current={result === "" ? "page" : undefined}>Any result</Link>
        {HISTORY_RESULTS.map((r) => <Link key={r} href={href(kind, r)} aria-current={result === r ? "page" : undefined}>{RESULT[r]}</Link>)}
      </div>
      <DataTable caption="Upload history" head={["When", "What", "File", "Size", "Result", "By", "Note", ""]} empty="No uploads yet."
        rows={data.rows.map((h) => (
          <tr key={h.id}>
            <td>{when(h.at)}</td>
            <td>{h.action === "confirm" ? "Made live" : KIND[h.kind] ?? h.kind}</td>
            <td className="cell-wrap">{h.filename ?? "—"}</td>
            <td>{formatSize(h.size)}</td>
            <td><span className={"adm-pill" + (h.result === "success" ? "" : h.result === "rejected" ? " warn" : " bad")}>{RESULT[h.result] ?? h.result}</span></td>
            <td className="cell-wrap">{h.by ?? "—"}</td>
            <td className="cell-wrap">{h.detail ?? ""}</td>
            <td>{h.downloadKey ? <a href={`/api/admin/attachments/${h.downloadKey}`}>Download</a> : null}</td>
          </tr>
        ))} />
      <Pager base="/admin/upload-history" page={data.page} pages={data.pages} params={params} />
    </>
  );
}
