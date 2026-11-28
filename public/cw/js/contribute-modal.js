// Contribution Portal: the Contributor's short form in a dialog ("+ Contribute to this sector" and every field's "Contribute" on the
// Contributor's Sectors page): Title, Field (filled in from the field's button), Description, Attachment, Submit. It sends a new idea
// through the SAME submission the full "Share Your Idea" form uses (the server checks everything again with the shared rules), so it goes
// to review like every other idea: Submitted -> pending review. One attachment: JPEG, PNG or PDF up to 4 MB (the workflow's limit).
import { esc } from "./utils.js";
import { LIMITS, NEW_IDEA, NOT_SURE } from "./lists.js";
import { noticeHtml, openDrawer } from "./portal-ui.js";

export const MAX_FILE = 4 * 1024 * 1024;
export const FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"];

/** Opens the dialog for one sector. Resolves when it closes; onDone({ id, code, title }) after a successful submit. */
export function openContribute({ adapter, sector, fields = [], field = "", doc = document, host = null, onDone = null }) {
  const opt = (v, l) => `<option value="${esc(v)}"${v === (field || NOT_SURE) ? " selected" : ""}>${esc(l)}</option>`;
  const dr = openDrawer({
    title: `Contribute to ${sector.name}`, modal: true, doc, host,
    body: `<form class="rv-pp-form" data-quickform novalidate>
      <label>Title<input name="title" maxlength="${LIMITS.title}" required aria-required="true" autocomplete="off"></label>
      <label>Field<select name="field">${opt(NOT_SURE, "The whole sector (no particular field)")}${fields.map((f) => opt(f.id, f.title)).join("")}</select></label>
      <label>Description<textarea name="description" rows="5" maxlength="${LIMITS.description}" required aria-required="true"></textarea><span class="rv-pp-hint">What is the problem, the idea or the resource, and who does it help?</span></label>
      <label>Attachment (optional)<input type="file" name="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"><span class="rv-pp-hint">One photo or PDF, up to 4 MB.</span></label>
      <div data-qmsg aria-live="polite"></div></form>`,
    foot: '<button type="button" class="btn" data-x="cancel">Cancel</button><button type="button" class="btn primary" data-x="submit">Submit</button>',
  });
  const f = dr.body.querySelector("[data-quickform]"), msg = f.querySelector("[data-qmsg]"), send = dr.foot.querySelector('[data-x="submit"]');
  dr.foot.querySelector('[data-x="cancel"]').addEventListener("click", dr.close);
  const say = (text) => { msg.innerHTML = noticeHtml("err", esc(text).replace(/\n/g, "<br>")); };
  async function submit() {
    const input = (name) => f.querySelector(`[name="${name}"]`); // never form.title: that is the form's own title attribute
    const title = input("title").value.trim(), description = input("description").value.trim(), file = input("file").files && input("file").files[0];
    if (!title || !description) { say("Please fill in the title and the description."); (title ? input("description") : input("title")).focus(); return; }
    if (file && file.size > MAX_FILE) { say("The attachment is larger than 4 MB."); return; }
    if (file && !FILE_TYPES.includes(file.type)) { say("The attachment must be a JPEG or PNG photo or a PDF."); return; }
    send.disabled = true;
    try {
      const r = await adapter.submit({ kind: NEW_IDEA, refers: false, title, description, sector: sector.slug, robotType: input("field").value || NOT_SURE, categories: [], suitableFor: [], learningPath: "", references: [] }, file || null);
      dr.close();
      if (onDone) await onDone({ id: r.id, code: r.code, title });
    } catch (e) {
      send.disabled = false;
      say(e && e.status === 401 ? "Please sign in again, then send your idea." : (e && e.message) || "Your idea could not be sent. Please try again.");
    }
  }
  send.addEventListener("click", submit);
  f.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  return dr;
}
