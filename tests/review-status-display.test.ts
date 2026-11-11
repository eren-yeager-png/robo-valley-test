// The display status (portal PR1): stored statuses never change; New / In review / Replied come from the current review round, and
// members see New and In review both as "Pending review". In-process database with the real migrations; no real database.
import { describe, expect, it } from "vitest";
import { testDb } from "./helpers";
import { DISPLAY_LABELS, PORTAL_TABS, displayStatus, memberLabel, portalLabel, roundFacts } from "../src/lib/reviewStatus";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
async function people() {
  await q("insert into users (full_name,email,role,password_hash) values ('Asha Rao','a@example.com','TC','x'),('Ravi Mod','r@example.com','TC','x')");
  const ids = (await q("select id from users order by id")).rows.map((r: any) => Number(r.id));
  await q("update users set is_moderator = true where id = $1", [ids[1]]);
  return { author: ids[0]!, mod: ids[1]! };
}
async function item(author: number, status = "pending_review") {
  const id = Number(((await q("insert into contributions (user_id,type,title,body) values ($1,'problem','Display status item','A body that is long enough.') returning id", [author])).rows[0] as any).id);
  await q("insert into contribution_scopes (contribution_id, sector_id) select $1, id from sectors where slug='agriculture-dairy'", [id]);
  if (status !== "draft") await q("update contributions set status=$2::varchar, submitted_at=now(), published_at = case when $2::varchar='published' then now() end where id=$1", [id, status]);
  return id;
}
const facts = async (id: number) => (await roundFacts(testDb().pool as never, [id])).get(id);
const later = () => q("select pg_sleep(0.01)");

describe("the mapping (one place for every label)", () => {
  it("pending_review: Replied beats In review beats New", () => {
    expect(displayStatus("pending_review")).toBe("new");
    expect(displayStatus("pending_review", { replied: false, viewed: true })).toBe("in_review");
    expect(displayStatus("pending_review", { replied: true, viewed: false })).toBe("replied");
    expect(displayStatus("pending_review", { replied: true, viewed: true })).toBe("replied");
  });
  it("the other statuses keep their own label; an unknown value is never shown as live", () => {
    expect(["changes_requested", "published", "rejected", "unpublished", "draft", "removed"].map((s) => portalLabel(displayStatus(s, { replied: true, viewed: true }))))
      .toEqual(["Changes requested", "Published", "Not accepted", "Unpublished", "Draft", "Removed"]);
    expect(displayStatus("withdrawn")).toBe("draft");
  });
  it("members see New and In review as Pending review, everything else as moderators do", () => {
    expect(memberLabel("new")).toBe("Pending review");
    expect(memberLabel("in_review")).toBe("Pending review");
    expect(memberLabel("replied")).toBe("Replied");
    expect(memberLabel("rejected")).toBe("Not accepted");
    expect(memberLabel("unpublished")).toBe("Unpublished");
  });
  it("the portal tabs: New, In review, Replied, Changes requested, Published, Not accepted, Unpublished (no Draft, no Removed)", () => {
    expect(PORTAL_TABS.map((t) => DISPLAY_LABELS[t])).toEqual(["New", "In review", "Replied", "Changes requested", "Published", "Not accepted", "Unpublished"]);
  });
});

describe("the current review round (database)", () => {
  it("a new item is New; a moderator opening it makes it In review; a reply makes it Replied", async () => {
    const { author, mod } = await people();
    const id = await item(author);
    expect(await facts(id)).toEqual({ replied: false, viewed: false });
    await later();
    await q("insert into contribution_views (contribution_id, viewer_id) values ($1,$2)", [id, mod]);
    expect(await facts(id)).toEqual({ replied: false, viewed: true });
    await q("insert into contribution_replies (contribution_id, author_id, message) values ($1,$2,'Please add a photo.')", [id, mod]);
    expect(displayStatus("pending_review", await facts(id))).toBe("replied");
  });
  it("after changes are requested and the item is resubmitted, it is New again (old views and replies belong to the last round)", async () => {
    const { author, mod } = await people();
    const id = await item(author);
    await later();
    await q("insert into contribution_views (contribution_id, viewer_id) values ($1,$2)", [id, mod]);
    await q("insert into contribution_replies (contribution_id, author_id, message) values ($1,$2,'Please add a photo.')", [id, mod]);
    await q("update contributions set status='changes_requested' where id=$1", [id]);
    await later();
    await q("update contributions set status='pending_review' where id=$1", [id]); // the member resubmits
    expect(displayStatus("pending_review", await facts(id))).toBe("new");
    await later();
    await q("update contribution_views set last_viewed_at = now() where contribution_id=$1 and viewer_id=$2", [id, mod]); // opened again
    expect(displayStatus("pending_review", await facts(id))).toBe("in_review");
  });
  it("without migration 019 the facts are simply empty (no error), so pending items show as New", async () => {
    const failing = { query: async () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); } };
    expect((await roundFacts(failing as never, [1])).size).toBe(0);
    const other = { query: async () => { throw Object.assign(new Error("boom"), { code: "XX000" }); } };
    await expect(roundFacts(other as never, [1])).rejects.toThrow("boom"); // a real failure is not hidden
  });
});
