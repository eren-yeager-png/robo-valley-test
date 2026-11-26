// Publishing (spec section 10). Admin only; only from Pending, Resubmitted or Publication Failed; only when the CURRENT version was
// opened in the Publish Preview. Steps, each in its own transaction so the "Publication In Progress" state is real:
//   1-3  lock the row, check, set status = publishing, publish_attempts + 1, history "Clicked Publish (attempt N)."
//   4    upsert the public record BY CONTRIBUTION ID (a retry or a double click never makes a second card)
//   5    nothing to rebuild: the Community Ideas page reads the public API every time it is viewed (no-store)
//   6    verify by reading the record back through the public API's own reader and comparing it with the approved version
//   7    success: status = published (+ published_version, published_at), history by "System"
//   8    any error, timeout or mismatch: the public record is put back exactly as it was (or removed if it was new), status =
//        failed with publish_error, history by "System". Status becomes Published only after the read-back matched.
import * as R from "./shared";
import { loadSectors } from "./lookups";
import { getContribution, guarded, readPublic, type Actor, type Fail, type Pool, type Q } from "./store";

const TIMEOUT = "30s";
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });

// A fault for tests (spec: "a server-side test hook that exists only in non-production environments"). It cannot be armed in production.
let fault: null | { at: "upsert" | "verify"; message: string } = null;
export function armPublishFault(at: "upsert" | "verify", message: string) {
  if (process.env.NODE_ENV === "production") throw new Error("Test hooks are not available in production.");
  fault = { at, message };
}
const takeFault = (at: "upsert" | "verify") => { if (fault?.at === at) { const f = fault; fault = null; throw new Error(f.message); } };

async function tx<T>(pool: Pool, fn: (c: Q) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL statement_timeout = '${TIMEOUT}'`);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function publish(pool: Pool, input: { id: number; actor: Actor; rowVersion: unknown }) {
  const { id, actor } = input;
  if (!actor.isAdmin) return fail(403, "ADMIN_ONLY", R.MESSAGES.adminOnly);
  return guarded(async () => {
    // 1-3: check and mark "Publication In Progress"
    const started = await tx(pool, async (c) => {
      const row = (await c.query("SELECT status, row_version, previewed_version, publish_attempts FROM cw_contributions WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!row) return fail(404, "NOT_FOUND", "We could not find that contribution.");
      if (Number(input.rowVersion) !== Number(row.row_version)) return fail(409, "STALE", R.MESSAGES.stale);
      const versions = Number((await c.query("SELECT count(*)::int AS n FROM cw_contribution_versions WHERE contribution_id = $1", [id])).rows[0].n);
      const step = R.nextStatus("publish", { status: row.status, versions });
      if (!step.ok) return fail(409, "NOT_ALLOWED", R.MESSAGES.notAllowed); // includes a second click while In Progress
      if (versions < 1 || Number(row.previewed_version) !== versions) return fail(409, "PREVIEW_FIRST", R.MESSAGES.previewFirst);
      const attempt = Number(row.publish_attempts) + 1;
      await c.query("UPDATE cw_contributions SET status = $2, publish_attempts = $3, row_version = row_version + 1, updated_at = now() WHERE id = $1", [id, step.to, attempt]);
      await c.query("INSERT INTO cw_contribution_history (contribution_id, actor, actor_user_id, text) VALUES ($1, $2, $3, $4)", [id, actor.name, actor.userId, R.history.publishClick(attempt)]);
      return { ok: true as const, versions };
    });
    if (!started.ok) return started;

    const n = started.versions;
    const sectors = await loadSectors(pool);
    const before = await readPublic(pool, id); // what the public site shows now, to put back on failure
    const detail = (await getContribution(pool, id))!;
    const rec = R.toPublicRecord({ ...detail, version: n }, { sectors, version: n });
    let error: string | null = null;
    try {
      // 4: upsert by contribution id
      await tx(pool, async (c) => {
        takeFault("upsert");
        await c.query(
          `INSERT INTO cw_public_contributions (contribution_id, version, title, description, sector_slug, sector_name, robot_type_name, categories, suitable_for,
             learning_path, kind, resource, reference_links, contributor_first_name, contributor_type, contributor_minor, published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16, now())
           ON CONFLICT (contribution_id) DO UPDATE SET version = EXCLUDED.version, title = EXCLUDED.title, description = EXCLUDED.description,
             sector_slug = EXCLUDED.sector_slug, sector_name = EXCLUDED.sector_name, robot_type_name = EXCLUDED.robot_type_name, categories = EXCLUDED.categories,
             suitable_for = EXCLUDED.suitable_for, learning_path = EXCLUDED.learning_path, kind = EXCLUDED.kind, resource = EXCLUDED.resource,
             reference_links = EXCLUDED.reference_links, contributor_first_name = EXCLUDED.contributor_first_name, contributor_type = EXCLUDED.contributor_type,
             contributor_minor = EXCLUDED.contributor_minor, published_at = EXCLUDED.published_at`,
          [id, n, rec.title, rec.description, rec.sector, rec.sectorName, rec.robotTypeName, JSON.stringify(rec.categories), JSON.stringify(rec.suitableFor),
            rec.learningPath, rec.kind, rec.resource ? JSON.stringify(rec.resource) : null, JSON.stringify(rec.references),
            detail.contributor.firstName, detail.contributor.typeLabel, detail.contributor.minor]);
      });
      // 6: read back through the public API's reader and compare with the approved version
      takeFault("verify");
      const back = await readPublic(pool, id);
      if (!back || back.version !== n || back.title !== detail.proposed.title || back.description !== detail.proposed.description) {
        throw new Error("The public website did not show the approved content after the update.");
      }
    } catch (e) {
      error = String((e as Error)?.message || "The website did not confirm the update.").slice(0, 400);
      await restore(pool, id, before).catch(() => undefined);
    }

    // 7 / 8
    await tx(pool, async (c) => {
      if (error === null) {
        await c.query("UPDATE cw_contributions SET status = 'published', published_version = $2, published_at = now(), publish_error = NULL, row_version = row_version + 1, updated_at = now() WHERE id = $1", [id, n]);
        await c.query("INSERT INTO cw_contribution_history (contribution_id, actor, text) VALUES ($1, 'System', $2)", [id, R.history.published(n, rec.sectorName)]);
      } else {
        await c.query("UPDATE cw_contributions SET status = 'failed', publish_error = $2, row_version = row_version + 1, updated_at = now() WHERE id = $1", [id, error]);
        await c.query("INSERT INTO cw_contribution_history (contribution_id, actor, text) VALUES ($1, 'System', $2)", [id, R.history.failed(error)]);
      }
    });
    return { ok: true as const, published: error === null, detail: (await getContribution(pool, id))! };
  });
}

/** Puts the public record back exactly as it was before this attempt (or removes it if there was none). */
async function restore(pool: Pool, id: number, before: Awaited<ReturnType<typeof readPublic>>) {
  await tx(pool, async (c) => {
    if (!before) { await c.query("DELETE FROM cw_public_contributions WHERE contribution_id = $1", [id]); return; }
    await c.query(
      `UPDATE cw_public_contributions SET version = $2, title = $3, description = $4, sector_slug = $5, sector_name = $6, robot_type_name = $7, categories = $8::jsonb,
         suitable_for = $9::jsonb, learning_path = $10, kind = $11, resource = $12::jsonb, reference_links = $13::jsonb, published_at = $14 WHERE contribution_id = $1`,
      [id, before.version, before.title, before.description, before.sector, before.sectorName, before.robotTypeName, JSON.stringify(before.categories),
        JSON.stringify(before.suitableFor), before.learningPath, before.kind, before.resource ? JSON.stringify(before.resource) : null,
        JSON.stringify(before.references), before.publishedAt]);
  });
}
