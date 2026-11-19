// Sector forms, part 2 (P5): each sector's questions, kept by administrators at /admin/sector-forms/<sector> (migration 026).
//
// Rules
//   * Administrators only (the pages call requireAdminPage, the routes requireAdmin; nothing here checks a role by itself).
//   * Up to 5 questions ON per sector; switched-off ones are kept (a question is never deleted; there is no function for it).
//   * Optional by default. At most 2 of the ON questions can be required; switching a question off also makes it not required.
//   * A question is a short text answer (up to 500 characters) or one choice from a list (2 to 10 choices, each up to 60 characters).
//     The kind is chosen when the question is written and cannot change. The wording and the choices can be corrected.
//   * Every change runs in one transaction that first locks the sector's row, so two administrators cannot pass the limits together.
//   * Before migration 026 the page says the questions are not set up yet; changes answer NOT_SET_UP.

import { parseSectorSlug, sectorBySlug } from "./sectorForms";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

export const QUESTIONS_ON_MAX = 5;
export const REQUIRED_MAX = 2;
/** Switched-off questions are kept, so there is a generous cap on all of them together. */
export const QUESTIONS_PER_SECTOR = 30;
export const QUESTION_MIN = 5;
export const QUESTION_MAX = 200;
export const CHOICES_MIN = 2;
export const CHOICES_MAX = 10;
export const CHOICE_MAX = 60;
/** How long a short text answer may be (P6 checks the answers). */
export const TEXT_ANSWER_MAX = 500;
export const QUESTION_KINDS = ["text", "choice"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const code = (e: unknown) => (e as { code?: string } | null)?.code;
export const QUESTIONS_NOT_SET_UP = (): Fail => fail(503, "NOT_SET_UP", "Questions are not set up on this database yet (migration 026 is needed).");
const NO_SECTOR = (): Fail => fail(404, "NOT_FOUND", "We could not find that sector.");
const NO_QUESTION = (): Fail => fail(404, "NOT_FOUND", "We could not find that question in this sector.");
const TOO_MANY_ON = (): Fail => fail(409, "LIMIT", `A sector can have up to ${QUESTIONS_ON_MAX} questions on. Switch one off first.`);
const TOO_MANY_REQUIRED = (): Fail => fail(409, "LIMIT", `At most ${REQUIRED_MAX} questions of a sector can be required. Make another one optional first.`);

export type Question = { id: number; label: string; kind: QuestionKind; options: string[] | null; required: boolean; active: boolean; order: number; updatedAt: string };

const clean = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const badChars = (s: string) => /[\u0000-\u001F\u007F<>]/.test(s);

/** The question's wording as it will be stored, or why it cannot be used. */
export function cleanQuestionLabel(v: unknown): { label: string } | { error: string } {
  if (typeof v !== "string" || !clean(v)) return { error: "Write the question." };
  if (/[\u0000-\u001F\u007F]/.test(v)) return { error: "The question cannot contain line breaks or control characters." };
  const label = clean(v);
  if (/[<>]/.test(label)) return { error: "The question cannot contain < or >." };
  if ([...label].length < QUESTION_MIN) return { error: `The question needs at least ${QUESTION_MIN} characters.` };
  if ([...label].length > QUESTION_MAX) return { error: `The question can have up to ${QUESTION_MAX} characters.` };
  if (!/[\p{L}\p{N}]/u.test(label)) return { error: "The question needs at least one letter or number." };
  return { label };
}

/** The choices of a pick-one question: trimmed, blanks dropped, no repeats (ignoring capitals), 2 to 10, each up to 60 characters. */
export function cleanChoices(v: unknown): { options: string[] } | { error: string } {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return { error: "Give the choices, one per line." };
  const out: string[] = [];
  for (const raw of v as string[]) {
    const c = clean(raw);
    if (!c) continue;
    if (badChars(raw.replace(/[\r\n\t]/g, " "))) return { error: "A choice cannot contain control characters, < or >." };
    if ([...c].length > CHOICE_MAX) return { error: `Each choice can have up to ${CHOICE_MAX} characters.` };
    if (out.some((o) => o.toLowerCase() === c.toLowerCase())) return { error: `"${c}" is in the list twice.` };
    out.push(c);
  }
  if (out.length < CHOICES_MIN) return { error: `A pick-one question needs at least ${CHOICES_MIN} choices.` };
  if (out.length > CHOICES_MAX) return { error: `A pick-one question can have up to ${CHOICES_MAX} choices.` };
  return { options: out };
}

export type NewQuestion = { label: string; kind: QuestionKind; options: string[] | null; required: boolean };
/** Reads a new question from a request body: { label, kind: "text" | "choice", options?: string[], required?: boolean }. */
export function parseNewQuestion(b: unknown): { value: NewQuestion } | { error: string } {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { error: "Write the question." };
  const o = b as Record<string, unknown>;
  const l = cleanQuestionLabel(o.label);
  if ("error" in l) return l;
  if (o.kind !== "text" && o.kind !== "choice") return { error: "Choose the kind of answer: a short text, or one choice from a list." };
  if (o.required !== undefined && typeof o.required !== "boolean") return { error: "Say whether the question is required." };
  let options: string[] | null = null;
  if (o.kind === "choice") {
    const c = cleanChoices(o.options);
    if ("error" in c) return c;
    options = c.options;
  } else if (o.options !== undefined && o.options !== null) return { error: "A short text question has no choices." };
  return { value: { label: l.label, kind: o.kind, options, required: o.required === true } };
}

export type QuestionChange = { label: string } | { options: string[] } | { required: boolean } | { active: boolean } | { move: "up" | "down" };
/** Reads exactly one change: { label }, { options }, { required }, { active } or { move: "up" | "down" }. The kind cannot change. */
export function parseQuestionChange(b: unknown): QuestionChange | null {
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const keys = Object.keys(b as object);
  if (keys.length !== 1) return null;
  const o = b as Record<string, unknown>;
  if (keys[0] === "label" && typeof o.label === "string") return { label: o.label };
  if (keys[0] === "options" && Array.isArray(o.options)) return { options: o.options as string[] };
  if (keys[0] === "required" && typeof o.required === "boolean") return { required: o.required };
  if (keys[0] === "active" && typeof o.active === "boolean") return { active: o.active };
  if (keys[0] === "move" && (o.move === "up" || o.move === "down")) return { move: o.move };
  return null;
}

const toQuestion = (r: any): Question => ({
  id: Number(r.id), label: r.label, kind: r.kind, options: Array.isArray(r.options) ? r.options : null, required: r.is_required === true,
  active: r.is_active === true, order: Number(r.sort_order), updatedAt: new Date(r.updated_at).toISOString(),
});
const LIST_SQL = "SELECT id, label, kind, options, is_required, is_active, sort_order, updated_at FROM sector_questions WHERE sector_id = $1 ORDER BY sort_order, id";

/** How many questions are on in each sector (sector id -> count). null before migration 026. */
export async function questionCounts(db: Db): Promise<Map<number, { on: number; all: number }> | null> {
  try {
    const { rows } = await db.query("SELECT sector_id, count(*) FILTER (WHERE is_active)::int AS a, count(*)::int AS n FROM sector_questions GROUP BY sector_id");
    return new Map(rows.map((r) => [Number(r.sector_id), { on: Number(r.a), all: Number(r.n) }]));
  } catch (e) { if (code(e) === "42P01") return null; throw e; }
}

/** One sector's questions in order (switched-off ones included). null before migration 026. */
export async function questionsOf(db: Db, sectorSlug: string): Promise<Question[] | null> {
  const s = parseSectorSlug(sectorSlug) ? await sectorBySlug(db, sectorSlug) : null;
  if (!s) return [];
  try { return (await db.query(LIST_SQL, [s.id])).rows.map(toQuestion); }
  catch (e) { if (code(e) === "42P01") return null; throw e; }
}

/** Runs fn in one transaction after locking the sector's row (so the limits hold when two administrators change it at once). */
async function inSector<T>(pool: Pool, sectorSlug: string, fn: (db: Db, sectorId: number) => Promise<T | Fail>): Promise<T | Fail> {
  if (!parseSectorSlug(sectorSlug)) return NO_SECTOR();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const s = (await client.query("SELECT id FROM sectors WHERE slug = $1::varchar AND NOT is_demo FOR UPDATE", [sectorSlug])).rows[0];
    if (!s) { await client.query("ROLLBACK"); return NO_SECTOR(); }
    const out = await fn(client, Number(s.id));
    await client.query(out && typeof out === "object" && (out as Fail).ok === false ? "ROLLBACK" : "COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (code(e) === "42P01") return QUESTIONS_NOT_SET_UP();
    throw e;
  } finally { client.release(); }
}

/** Adds a question at the end of the sector's list (on). */
export async function addQuestion(pool: Pool, adminId: number, sectorSlug: string, q: NewQuestion): Promise<{ ok: true; question: Question } | Fail> {
  return inSector(pool, sectorSlug, async (db, sectorId) => {
    const have = (await db.query(LIST_SQL, [sectorId])).rows.map(toQuestion);
    if (have.length >= QUESTIONS_PER_SECTOR) return fail(409, "LIMIT", `A sector can keep up to ${QUESTIONS_PER_SECTOR} questions. Correct a switched-off one instead.`);
    if (have.filter((x) => x.active).length >= QUESTIONS_ON_MAX) return TOO_MANY_ON();
    if (q.required && have.filter((x) => x.active && x.required).length >= REQUIRED_MAX) return TOO_MANY_REQUIRED();
    const order = have.reduce((m, x) => Math.max(m, x.order), 0) + 10;
    const { rows } = await db.query(
      "INSERT INTO sector_questions (sector_id, label, kind, options, is_required, sort_order, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id, label, kind, options, is_required, is_active, sort_order, updated_at",
      [sectorId, q.label, q.kind, q.options === null ? null : JSON.stringify(q.options), q.required, order, adminId]);
    return { ok: true as const, question: toQuestion(rows[0]) };
  });
}

/** Corrects, requires, switches off/on, or moves one question of the sector. Never deletes one. */
export async function changeQuestion(pool: Pool, adminId: number, sectorSlug: string, questionId: number, change: QuestionChange): Promise<{ ok: true; questions: Question[] } | Fail> {
  let label = "", options: string[] = [];
  if ("label" in change) { const l = cleanQuestionLabel(change.label); if ("error" in l) return fail(400, "VALIDATION_FAILED", l.error); label = l.label; }
  if ("options" in change) { const c = cleanChoices(change.options); if ("error" in c) return fail(400, "VALIDATION_FAILED", c.error); options = c.options; }
  return inSector(pool, sectorSlug, async (db, sectorId) => {
    const list = (await db.query(LIST_SQL, [sectorId])).rows.map(toQuestion);
    const at = list.findIndex((x) => x.id === questionId);
    if (at < 0) return NO_QUESTION(); // also when the id belongs to another sector
    const cur = list[at];
    const stamp = "updated_at = now(), updated_by = $2";
    if ("label" in change) {
      await db.query(`UPDATE sector_questions SET label = $1, ${stamp} WHERE id = $3`, [label, adminId, cur.id]);
    } else if ("options" in change) {
      if (cur.kind !== "choice") return fail(400, "VALIDATION_FAILED", "A short text question has no choices.");
      await db.query(`UPDATE sector_questions SET options = $1::jsonb, ${stamp} WHERE id = $3`, [JSON.stringify(options), adminId, cur.id]);
    } else if ("required" in change) {
      if (change.required && !cur.active) return fail(409, "NOT_ON", "Switch the question on before making it required.");
      if (change.required && !cur.required && list.filter((x) => x.active && x.required).length >= REQUIRED_MAX) return TOO_MANY_REQUIRED();
      await db.query(`UPDATE sector_questions SET is_required = $1, ${stamp} WHERE id = $3`, [change.required, adminId, cur.id]);
    } else if ("active" in change) {
      if (change.active && !cur.active && list.filter((x) => x.active).length >= QUESTIONS_ON_MAX) return TOO_MANY_ON();
      // switching a question off also makes it optional (a question that is not asked cannot be required)
      await db.query(`UPDATE sector_questions SET is_active = $1, is_required = CASE WHEN $1 THEN is_required ELSE false END, ${stamp} WHERE id = $3`, [change.active, adminId, cur.id]);
    } else {
      const to = change.move === "up" ? at - 1 : at + 1;
      if (to >= 0 && to < list.length) {
        const ids = list.map((x) => x.id);
        [ids[at], ids[to]] = [ids[to], ids[at]];
        await db.query(
          "UPDATE sector_questions q SET sort_order = v.o, updated_at = CASE WHEN q.id = $3 THEN now() ELSE q.updated_at END, updated_by = CASE WHEN q.id = $3 THEN $4 ELSE q.updated_by END " +
          "FROM unnest($1::int[], $2::int[]) AS v(id, o) WHERE q.id = v.id AND q.sector_id = $5",
          [ids, ids.map((_, i) => (i + 1) * 10), cur.id, adminId, sectorId]);
      }
    }
    return { ok: true as const, questions: (await db.query(LIST_SQL, [sectorId])).rows.map(toQuestion) };
  });
}
