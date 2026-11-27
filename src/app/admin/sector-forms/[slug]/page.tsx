import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { requireAdminPage } from "../../../../lib/adminPage";
import { parseSectorSlug, sectorForm, type SectorForm } from "../../../../lib/sectorForms";
import { logDbError } from "../../../../lib/dbError";
import { Notice, PageHeader } from "../../_components/ui";
import SectorHeader from "../../../_cw/SectorHeader";
import "../../../../../public/cw/sector.css";
import RobotTypesEditor from "./RobotTypesEditor";
import QuestionsEditor from "./QuestionsEditor";
import { QUESTIONS_ON_MAX, REQUIRED_MAX, TEXT_ANSWER_MAX, questionsOf, type Question } from "../../../../lib/sectorQuestions";

export const metadata: Metadata = { title: "Sector form | RoboValley admin", robots: { index: false, follow: false } };

// Admin only. One sector's form: its robot types (P2) and its questions (P5). Add, correct, reorder, switch off/on; never delete.
export default async function SectorFormPage({ params }: { params?: Promise<{ slug?: string }> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const slug = parseSectorSlug((await params)?.slug);
  if (!slug) notFound();

  let form: SectorForm | null, questions: Question[] | null = null;
  try {
    form = await sectorForm(pool as never, slug);
    if (form) questions = await questionsOf(pool as never, slug); // null before migration 026
  } catch (e) {
    const why = logDbError("admin sector form", e);
    return (
      <>
        <p><Link href="/admin/sector-forms">← Sector forms</Link></p>
        <PageHeader title="Sector form" />
        {why === "not_set_up"
          ? <Notice kind="setup" title="Sectors are not set up on this database yet">The sector tables are missing (migration 012). Settings shows which migrations this database has. Nothing was changed.</Notice>
          : <Notice kind="error" title="This form could not be loaded">{why === "unreachable" ? "The database did not answer." : "Something went wrong."} Nothing was changed. Please try again.</Notice>}
      </>
    );
  }
  if (!form) notFound();
  const active = form.robots.filter((r) => r.active);
  const asked = (questions ?? []).filter((q) => q.active);

  return (
    <>
      <p><Link href="/admin/sector-forms">← Sector forms</Link></p>
      <SectorHeader title={`Sector form: ${form.sector.name}`} sub="What the Contribute form asks for this sector: the robot types members can pick, and up to five questions." sector={form.sector.slug} returnPath={`/admin/sector-forms/${form.sector.slug}`} />
      {!form.sector.active && (
        <div style={{ marginBottom: 14 }}>
          <Notice kind="info" title="This sector is not offered on the Contribute form right now">You can still prepare its robot types; they are used once the sector is offered.</Notice>
        </div>
      )}
      {!form.robotsReady ? (
        <Notice kind="setup" title="Robot types are not set up on this database yet">Migration 024 is needed before robot types can be added. Settings shows which migrations this database has.</Notice>
      ) : (
        <>
          <section aria-labelledby="robots-h">
            <h2 id="robots-h" style={{ fontSize: "1.15rem", margin: "0 0 6px" }}>Robot types</h2>
            <p className="muted" style={{ margin: "0 0 12px" }}>Robot types are never deleted. Switch one off to hide it from the form: contributions that already chose it keep showing it. The link code stays the same when you rename one.</p>
            <RobotTypesEditor sector={form.sector.slug} sectorName={form.sector.name} robots={form.robots} />
          </section>
          <section aria-labelledby="preview-h" style={{ marginTop: 22 }}>
            <h2 id="preview-h" style={{ fontSize: "1.15rem", margin: "0 0 6px" }}>What members will pick from</h2>
            <p className="muted" style={{ margin: "0 0 8px" }}>Only robot types that are on, in this order. The question is optional and starts at &quot;Not sure&quot;.</p>
            <div className="adm-filters">
              <label>Which robot is it about? (optional)
                <select disabled defaultValue="" aria-label={`Preview of the robot question for ${form.sector.name}`}>
                  <option value="">Not sure</option>
                  {active.map((r) => <option key={r.id} value={r.slug}>{r.name}</option>)}
                </select>
              </label>
            </div>
            {active.length === 0 && <p className="muted" style={{ margin: 0 }}>No robot type is on yet, so members would only see &quot;Not sure&quot;.</p>}
          </section>
        </>
      )}
      <section aria-labelledby="questions-h" style={{ marginTop: 28 }}>
        <h2 id="questions-h" style={{ fontSize: "1.15rem", margin: "0 0 6px" }}>Questions</h2>
        {questions === null ? (
          <Notice kind="setup" title="Questions are not set up on this database yet">Migration 026 is needed before questions can be added. Settings shows which migrations this database has.</Notice>
        ) : (
          <>
            <p className="muted" style={{ margin: "0 0 12px" }}>Up to {QUESTIONS_ON_MAX} questions on, each optional unless you make it required (at most {REQUIRED_MAX}). Questions are never deleted: switch one off to stop asking it; answers already given keep it. The kind of answer cannot change once a question exists.</p>
            <QuestionsEditor sector={form.sector.slug} sectorName={form.sector.name} questions={questions} />
            <h3 style={{ fontSize: "1rem", margin: "22px 0 6px" }}>What members will be asked</h3>
            {asked.length === 0 ? <p className="muted" style={{ margin: 0 }}>No question is on yet, so members are asked nothing extra for this sector.</p> : (
              <div className="adm-preview" aria-label={`Preview of the questions for ${form.sector.name}`}>
                {asked.map((q) => (
                  <label key={q.id}>{q.label} <small>{q.required ? "(required)" : "(optional)"}</small>
                    {q.kind === "text" ? <input type="text" disabled maxLength={TEXT_ANSWER_MAX} placeholder={`Up to ${TEXT_ANSWER_MAX} characters`} /> : (
                      <select disabled defaultValue=""><option value="">Choose one</option>{(q.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>
                    )}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
