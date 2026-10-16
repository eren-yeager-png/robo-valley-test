import { describe, expect, it } from "vitest";
import {
  getRoleDashboard, isKnownSectionSlug, RESERVED_SLUGS, ROLE_DASHBOARDS, sectionOf,
} from "../src/lib/dashboardConfig";
import { ROLE_SAMPLES } from "../src/lib/dashboardSamples";
import { ROLE_CODES, ROLE_FIELDS, ROLES } from "../src/lib/roles";

describe("dashboard config covers all 12 roles", () => {
  it("has exactly the 12 documented role codes", () => {
    expect(ROLE_CODES.sort()).toEqual(["AR", "FS", "IP", "KS", "MG", "ME", "PA", "SA", "SP", "ST", "TC", "TR"].sort());
    expect(Object.keys(ROLE_DASHBOARDS).sort()).toEqual([...ROLE_CODES].sort());
  });

  it.each(ROLES.map((r) => r[0]))("%s: label, tagline, tiles, sections and profile fields are defined", (code) => {
    const d = getRoleDashboard(code)!;
    expect(d.code).toBe(code);
    expect(d.label).toBe(ROLES.find((r) => r[0] === code)![1]);
    expect(d.tagline.length).toBeGreaterThan(10);
    expect(d.tiles.length).toBeGreaterThanOrEqual(3);
    expect(d.sections.length).toBeGreaterThanOrEqual(4);
    expect(ROLE_FIELDS[code].length).toBeGreaterThan(0);
    const slugs = d.sections.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // unique within the role
    for (const s of d.sections) {
      expect(s.slug).toMatch(/^[a-z]+$/);
      expect((RESERVED_SLUGS as readonly string[]).includes(s.slug)).toBe(false);
      expect(s.label && s.description && s.needs).toBeTruthy(); // every empty state says what is missing
    }
    for (const q of d.quickActions) {
      expect(q.href === "/dashboard/profile" || slugs.some((sl) => q.href === `/dashboard/${sl}`)).toBe(true); // only links to its own sections
    }
  });

  it("the role requirements from the brief are present", () => {
    const has = (code: string, ...slugs: string[]) => slugs.forEach((s) => expect(sectionOf(code, s), `${code}/${s}`).not.toBeNull());
    has("ST", "projects", "mentors", "clubs", "competitions", "portfolio");
    has("PA", "children", "events", "courses", "consent");
    has("TC", "lessons", "kits", "teams", "mentors", "training", "competitions");
    has("SA", "school", "people", "labs", "reports", "partners");
    has("MG", "schools", "districts", "labs", "programmes");
    has("ME", "requests", "availability", "sessions", "feedback");
    has("TR", "courses", "enquiries", "demand", "ratings");
    has("AR", "portfolio", "projects", "collaborations", "opportunities");
    has("KS", "catalogue", "demand", "matches", "lending", "faults");
    has("FS", "services", "machines", "bookings", "ratings");
    has("SP", "needs", "funded", "outcomes", "reports");
    has("IP", "talent", "problems", "internships", "collaborations", "shortlist");
  });
});

describe("unknown or missing roles get nothing", () => {
  it.each([undefined, null, "", "XX", "st", "ADMIN", "__proto__", "constructor", "toString", 5, {}, ["ST"]])("role %j has no dashboard", (r) => {
    expect(getRoleDashboard(r)).toBeNull();
    expect(sectionOf(r, "projects")).toBeNull();
  });
});

describe("sections are role-scoped", () => {
  it("a section slug that belongs to another role is not accessible", () => {
    expect(sectionOf("ST", "projects")).not.toBeNull();
    expect(sectionOf("KS", "projects")).toBeNull();
    expect(sectionOf("ST", "faults")).toBeNull(); // KS only
    expect(sectionOf("PA", "kits")).toBeNull(); // TC only
    expect(sectionOf("TC", "schools")).toBeNull(); // MG only
    expect(sectionOf("SA", "schools")).toBeNull();
    expect(isKnownSectionSlug("faults")).toBe(true);
    expect(isKnownSectionSlug("does-not-exist")).toBe(false);
  });
});

describe("sample data", () => {
  it("exists only for the 10 roles that Roles.html defines (not AR, FS)", () => {
    expect(Object.keys(ROLE_SAMPLES).sort()).toEqual(["IP", "KS", "MG", "ME", "PA", "SA", "SP", "ST", "TC", "TR"].sort());
    expect(ROLE_SAMPLES.AR).toBeUndefined();
    expect(ROLE_SAMPLES.FS).toBeUndefined();
  });
});
