import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRIBUTION_LIMITS, CONTRIBUTION_STATUSES, CONTRIBUTION_TYPES, STATUS_LABELS, canTransition, contributionDbError, validateContribution } from "../src/lib/contributions";

const SECTORS = ["agriculture-dairy", "education", "healthcare"];
const good = { type: "problem", title: "Shed cleaning by hand", body: "Two workers clean the shed by hand every day.", sectors: ["agriculture-dairy"] };
const errs = (r: any) => (r.ok ? {} : r.errors);

describe("lists", () => {
  it("has the 14 types as drawn, with unique ids", () => {
    expect(CONTRIBUTION_TYPES).toHaveLength(14);
    expect(new Set(CONTRIBUTION_TYPES.map((t) => t.id)).size).toBe(14);
  });
  it("labels the six statuses (rejected and unpublished need migration 017)", () => {
    expect(Object.values(STATUS_LABELS)).toEqual(["Draft", "Pending review", "Changes requested", "Published", "Not accepted", "Taken down"]);
  });
});

describe("status moves", () => {
  it("allows the moves of the status machine and nothing else", () => {
    expect(canTransition("draft", "pending_review")).toBe(true);
    expect(canTransition("pending_review", "changes_requested")).toBe(true);
    expect(canTransition("changes_requested", "pending_review")).toBe(true);
    expect(canTransition("pending_review", "published")).toBe(true);
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("changes_requested", "published")).toBe(false);
    expect(canTransition("published", "draft")).toBe(false);
    expect(canTransition("published", "pending_review")).toBe(true); // the owner edits a published item: back to review
    expect(canTransition("pending_review", "rejected")).toBe(true);
    expect(canTransition("published", "unpublished")).toBe(true);
    expect(canTransition("unpublished", "published")).toBe(true);
    expect(canTransition("unpublished", "pending_review")).toBe(true);
    expect(canTransition("rejected", "pending_review")).toBe(false); // rejected is final
    expect(canTransition("rejected", "published")).toBe(false);
    expect(canTransition("draft", "rejected")).toBe(false);
    expect(canTransition("changes_requested", "rejected")).toBe(false);
  });
});

describe("validateContribution", () => {
  it("accepts a good contribution and trims it", () => {
    const r = validateContribution({ ...good, title: "  Shed cleaning by hand  ", robotType: "shed-cleaning" }, SECTORS);
    expect(r).toEqual({ ok: true, value: { type: "problem", robotType: "shed-cleaning", title: "Shed cleaning by hand", body: good.body, sectors: ["agriculture-dairy"] } });
  });
  it("accepts several sectors and merges duplicates", () => {
    const r: any = validateContribution({ ...good, sectors: ["education", "agriculture-dairy", "education"] }, SECTORS);
    expect(r.value.sectors).toEqual(["education", "agriculture-dairy"]);
  });
  it("treats a missing or empty robot type as none", () => {
    expect((validateContribution(good, SECTORS) as any).value.robotType).toBeNull();
    expect((validateContribution({ ...good, robotType: "" }, SECTORS) as any).value.robotType).toBeNull();
  });
  it("rejects an unknown type, short or long title and body", () => {
    expect(errs(validateContribution({ ...good, type: "spam" }, SECTORS)).type).toBeTruthy();
    expect(errs(validateContribution({ ...good, title: "abc" }, SECTORS)).title).toBeTruthy();
    expect(errs(validateContribution({ ...good, title: "x".repeat(151) }, SECTORS)).title).toBeTruthy();
    expect(errs(validateContribution({ ...good, body: "short" }, SECTORS)).body).toBeTruthy();
    expect(errs(validateContribution({ ...good, body: "y".repeat(4001) }, SECTORS)).body).toBeTruthy();
    expect(validateContribution({ ...good, title: "x".repeat(150), body: "y".repeat(4000) }, SECTORS).ok).toBe(true);
  });
  it("rejects control characters (a NUL would otherwise be a 500) but keeps new lines in the body", () => {
    expect(errs(validateContribution({ ...good, title: "bad\u0000title" }, SECTORS)).title).toBeTruthy();
    expect(errs(validateContribution({ ...good, body: "bad\u0000 body text" }, SECTORS)).body).toBeTruthy();
    expect(validateContribution({ ...good, body: "Line one is here.\nLine two is here." }, SECTORS).ok).toBe(true);
  });
  it("rejects non-text values without throwing", () => {
    for (const v of [null, undefined, 5, "x", [], { title: 5, body: {}, type: [] }]) expect(validateContribution(v, SECTORS).ok).toBe(false);
  });
  it("rejects a bad robot type", () => {
    for (const r of ["Drone Sprayers", "a_b", "-x", "x".repeat(61)]) expect(errs(validateContribution({ ...good, robotType: r }, SECTORS)).robotType).toBeTruthy();
  });
  it("needs a sector to submit, but not for a draft; refuses unknown or inactive sectors either way", () => {
    expect(errs(validateContribution({ ...good, sectors: [] }, SECTORS)).sectors).toBeTruthy();
    expect(errs(validateContribution({ ...good, sectors: undefined }, SECTORS)).sectors).toBeTruthy();
    expect(validateContribution({ ...good, sectors: [] }, SECTORS, { forSubmit: false }).ok).toBe(true);
    expect(errs(validateContribution({ ...good, sectors: ["mining"] }, SECTORS, { forSubmit: false })).sectors).toBeTruthy();
    expect(errs(validateContribution({ ...good, sectors: ["healthcare"] }, ["education"])).sectors).toBeTruthy();
    expect(errs(validateContribution({ ...good, sectors: "education" }, SECTORS)).sectors).toBeTruthy();
    expect(errs(validateContribution({ ...good, sectors: [5] }, SECTORS)).sectors).toBeTruthy();
    expect(errs(validateContribution({ ...good, sectors: Array(21).fill("education") }, SECTORS)).sectors).toBeTruthy();
  });
  it("reports every field at once", () => {
    expect(Object.keys(errs(validateContribution({}, SECTORS))).sort()).toEqual(["body", "sectors", "title", "type"]);
  });
});

describe("contributionDbError", () => {
  it("maps our constraint errors and ignores others", () => {
    expect(contributionDbError({ code: "23505", constraint: "contribution_scopes_pkey" })).toMatchObject({ field: "sectors" });
    expect(contributionDbError({ code: "23503", constraint: "contribution_scopes_sector_id_fkey" })).toMatchObject({ field: "sectors" });
    expect(contributionDbError({ code: "23514", constraint: "contributions_robot_type_ck" })).toMatchObject({ field: "robotType" });
    expect(contributionDbError({ code: "23514", constraint: "contributions_type_ck" })).toMatchObject({ field: "type" });
    expect(contributionDbError({ code: "23514", constraint: "contributions_title_ck" })).toMatchObject({ field: "title" });
    expect(contributionDbError({ code: "08006" })).toBeNull();
    expect(contributionDbError(null)).toBeNull();
  });
});

// CONTRIBUTION_LIMITS is the one place the numbers live in code; this test fails if the migration disagrees with it.
describe("code and database use the same limits", () => {
  const sql = readFileSync("db/migrations/012_contributions.sql", "utf8");
  const L = CONTRIBUTION_LIMITS;
  it("title, body and slug lengths", () => {
    expect(sql).toContain(`char_length(btrim(title)) BETWEEN ${L.titleMin} AND ${L.titleMax}`);
    expect(sql).toContain(`char_length(btrim(body)) BETWEEN ${L.bodyMin} AND ${L.bodyMax}`);
    expect(sql).toContain(`title        varchar(${L.titleMax})`);
    expect(sql).toContain(`robot_type   varchar(${L.slugMax})`);
    expect(sql).toContain(`slug        varchar(${L.slugMax})`);
  });
  it("the 14 types and the first 4 statuses (migration 012; 017 widens the rule to all 6, see migration-017.test.ts)", () => {
    const list = (name: string) => {
      const at = sql.indexOf(name + " CHECK");
      const open = sql.indexOf("IN (", at) + 4;
      return sql.slice(open, sql.indexOf(")", open)).split(",").map((x) => x.trim().replace(/'/g, ""));
    };
    expect(list("contributions_type_ck")).toEqual(CONTRIBUTION_TYPES.map((t) => t.id));
    expect(list("contributions_status_ck")).toEqual(CONTRIBUTION_STATUSES.slice(0, 4));
  });
});
