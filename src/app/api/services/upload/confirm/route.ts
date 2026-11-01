import { requireAdmin } from "../../../../../lib/admin";
import { preflight, withCors } from "../../../../../lib/cors";
import { json, readJson } from "../../../../../lib/http";
import { pool } from "../../../../../lib/db";
import { confirmDataset, DatasetError, writeAudit } from "../../../../../lib/serviceDatasets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "POST, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Admin only. Switches the live dataset to the confirmed staged version in one transaction. */
export async function POST(req: Request) {
  const reply = (body: unknown, status: number) => withCors(req, json(body, status), METHODS);
  const auth = await requireAdmin(req);
  if (auth.response) return withCors(req, auth.response, METHODS);
  const admin = auth.admin;

  const parsed = await readJson(req, 1024);
  if ("error" in parsed) return withCors(req, parsed.error, METHODS);
  const id = (parsed.body as { datasetId?: unknown } | null)?.datasetId;
  if (typeof id !== "string" || !/^\d{1,18}$/.test(id)) return reply({ success: false, error: "VALIDATION_FAILED", message: "datasetId is missing or invalid." }, 400);

  try {
    const done = await confirmDataset(pool, id);
    await writeAudit(pool, { userId: admin.id, action: "confirm", result: "success", datasetId: done.id, filename: done.filename, detail: `${done.rowCount} rows now live` });
    return reply({ success: true, datasetId: done.id, rowCount: done.rowCount, message: "The new data is now live for everyone." }, 200);
  } catch (e) {
    if (e instanceof DatasetError) {
      await writeAudit(pool, { userId: admin.id, action: "confirm", result: "rejected", datasetId: id, detail: e.code });
      return reply({ success: false, error: e.code, message: e.message }, e.status);
    }
    console.error("confirm failed: server error");
    await writeAudit(pool, { userId: admin.id, action: "confirm", result: "error", datasetId: id, detail: "server error" });
    return reply({ success: false, error: "SERVER_ERROR", message: "The switch failed and was rolled back. The previous data is still live." }, 500);
  }
}
