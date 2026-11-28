// Contribution Portal: the app's data adapter for the portal screens (production; the demo has the same methods in demo-portal.js).
// The workflow's own calls stay in api.js (RestAdapter: formConfig, detail, act, publish, publicList, mine ...); this adds:
//   portal(view, { sector })  the sector grid and the rows of Moderation ("moderation"), Publish Requests ("requests") and the Admin's
//                             Overview ("overview"), for BOTH kinds of contributions (GET /api/review/portal)
//   formDecision(id, action, note, confirmDuplicate)  a decision on an item sent with the current form (POST /api/review/:id/decision)
//   sectorForms(sector)       Sector Forms: every sector's numbers, one sector's fields and the suggested fields (admins)
//   addField / changeField    add a field (robot type) / rename, switch on or off, move up or down (the existing admin routes)
//   auditLog(query)           the Audit Log (admins)
import { RestAdapter } from "./api.js";

const q = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export class PortalRest extends RestAdapter {
  portal(view, { sector = "" } = {}) { return this.call(`/api/review/portal${q({ view, sector })}`); }
  formDecision(id, action, note = "", confirmDuplicate = false) {
    return this.post(`/api/review/${encodeURIComponent(id)}/decision`, { action, note, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) });
  }
  sectorForms(sector = "") { return this.call(`/api/admin/portal/sector-forms${q({ sector })}`); }
  addField(sector, body) { return this.post(`/api/admin/sector-forms/${encodeURIComponent(sector)}/robots`, body); }
  changeField(sector, id, change) {
    return this.call(`/api/admin/sector-forms/${encodeURIComponent(sector)}/robots/${encodeURIComponent(id)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
  }
  auditLog(query = {}) { return this.call(`/api/admin/audit-log${q(query)}`); }
  sectorCounts() { return this.call("/api/admin/sector-counts"); }
}
