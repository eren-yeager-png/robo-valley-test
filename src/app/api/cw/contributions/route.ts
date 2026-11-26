// Share Your Idea: a signed-in MEMBER submits an idea (reviewers review, they do not contribute: 403).
// multipart/form-data: "data" = the answers as JSON, "attachment" = an optional JPEG, PNG or PDF of at most 4 MB (its real type is
// read from its first bytes). The name and stakeholder type come from the profile, never from the form. Everything is checked again
// here with the same rules the form uses (public/cw/js/rules.js). Rate limited; a hidden "website" field filled in by a program is
// answered as if it worked and nothing is stored. The idea is NOT public: it starts as Submitted.
import { createHash } from "node:crypto";
import { preflight } from "../../../../lib/cors";
import { pool } from "../../../../lib/db";
import { guardContributorWrite, isBot } from "../../../../lib/contributorGuard";
import { contributorProfile, loadSectors } from "../../../../lib/cw/lookups";
import { createContribution } from "../../../../lib/cw/store";
import { notifyAfter } from "../../../../lib/cw/notify";
import * as R from "../../../../lib/cw/shared";
import { crashed, failed, ok } from "../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "POST, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);
const MAX_BODY = R.LIMITS.attachmentBytes + 256 * 1024; // the file plus the answers (Vercel refuses bodies over ~4.5 MB anyway)
const bad = (message: string, status = 400) => ({ ok: false as const, status, error: "VALIDATION_FAILED", message });

export async function POST(req: Request) {
  const g = await guardContributorWrite(req, METHODS);
  if ("res" in g) return g.res;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return failed(req, bad(R.MESSAGES.attachmentSize, 413), METHODS);
  try {
    let form: FormData;
    try { form = await req.formData(); } catch { return failed(req, bad(R.MESSAGES.failed), METHODS); }
    let data: unknown;
    try { data = JSON.parse(String(form.get("data") ?? "")); } catch { return failed(req, bad(R.MESSAGES.failed), METHODS); }
    if (isBot(data)) return ok(req, {}, METHODS, 201);

    const profile = await contributorProfile(pool as never, g.userId);
    if (!profile) return failed(req, { ok: false, status: 401, error: "SIGN_IN_REQUIRED", message: R.MESSAGES.signIn }, METHODS);
    const sectors = await loadSectors(pool as never);
    const { errors, value } = R.validateSubmission(data, { sectors, name: profile.fullName });

    let attachment: { fileName: string; mime: string; bytes: Uint8Array; sha256: string } | null = null;
    const file = form.get("attachment");
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as Blob).size > 0) {
      const blob = file as File;
      if (blob.size > R.LIMITS.attachmentBytes) errors.push(R.MESSAGES.attachmentSize);
      else {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mime = R.sniffType(bytes);
        if (!mime || !R.attachmentAllowed(mime)) errors.push(R.MESSAGES.attachmentType);
        else {
          const raw = String(blob.name || "attachment").split(/[\\/]/).pop() ?? "attachment";
          const fileName = raw.replace(/[\u0000-\u001f\u007f"<>]/g, "").trim().slice(-R.LIMITS.fileName) || "attachment";
          attachment = { fileName, mime, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
        }
      }
    }
    if (errors.length) return failed(req, bad(errors.join("\n")), METHODS);

    const created = await createContribution(pool as never, { userId: g.userId, profile, value, attachment });
    notifyAfter("submitted", created.id);
    return ok(req, { id: created.id, code: created.code, kind: value.kind }, METHODS, 201);
  } catch (e) {
    return crashed(req, e, METHODS, "submit");
  }
}
