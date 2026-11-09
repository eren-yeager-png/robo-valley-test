import type { Metadata } from "next";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { listUsers, usersByRole } from "../../../lib/adminStats";
import { ROLE_CODES } from "../../../lib/roles";
import { moderatorFlags, recentModeratorChanges, type ModeratorChangeRow } from "../../../lib/moderators";
import ModeratorToggle from "../_components/ModeratorToggle";
import { DataTable, Notice, PageHeader, Pager, StatCard, when } from "../_components/ui";

export const metadata: Metadata = { title: "Users | RoboValley admin", robots: { index: false, follow: false } };

type SP = { page?: string; q?: string; role?: string };

// Read-only. No passwords, tokens, phone numbers or other private details are ever selected.
export default async function UsersPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const role = typeof sp.role === "string" && (ROLE_CODES.includes(sp.role) || sp.role === "admin") ? sp.role : "";
  const page = /^\d{1,6}$/.test(sp.page ?? "") ? Number(sp.page) : 1;

  let result, roles;
  let mods: { ready: boolean; flags: Map<string, boolean> } = { ready: false, flags: new Map() };
  let changes: ModeratorChangeRow[] = [];
  try {
    [result, roles] = await Promise.all([listUsers(pool, { page, q, role }), usersByRole(pool)]);
    // Moderator flags are optional: without migration 015 the page works as before, with no moderator column.
    mods = await moderatorFlags(pool, result.rows.map((u) => u.id));
    if (mods.ready) changes = await recentModeratorChanges(pool, 10);
  } catch {
    console.error("admin users: could not read the data");
    return (<><PageHeader title="User management" /><Notice kind="error" title="Users could not be loaded">The database did not answer. Please try again.</Notice></>);
  }
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (role) params.role = role;

  return (
    <>
      <PageHeader title="User management" lead={mods.ready ? "Everyone who has registered. Administrators can make someone a moderator or remove the flag; each change is recorded." : "Everyone who has registered. This list is read-only."} />
      <div className="adm-grid">
        <StatCard label="Matching accounts" value={result.total} />
        {roles.slice(0, 3).map((r) => <StatCard key={r.role} label={r.label} value={r.count} />)}
      </div>
      <form className="adm-filters" method="get" action="/admin/users">
        <label>Search name or email<input name="q" defaultValue={q} maxLength={100} /></label>
        <label>Role
          <select name="role" defaultValue={role}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
          </select>
        </label>
        <button className="btn primary" type="submit">Filter</button>
        {(q || role) && <a className="btn" href="/admin/users">Clear</a>}
      </form>
      <DataTable caption="Registered users" head={mods.ready ? ["Name", "Moderator", "Email", "Role", "Joined"] : ["Name", "Email", "Role", "Joined"]} empty="No accounts match."
        rows={result.rows.map((u) => (
          <tr key={u.id}><td className="cell-wrap">{u.name}</td>
          {mods.ready && (
            <td>
              <span className={"adm-pill" + (mods.flags.get(u.id) ? "" : " mute")}>{mods.flags.get(u.id) ? "Moderator" : "No"}</span>
              <ModeratorToggle userId={u.id} name={u.name} moderator={mods.flags.get(u.id) === true} self={u.id === admin.id} />
            </td>
          )}<td className="cell-wrap">{u.email}</td><td><span className={"adm-pill" + (u.role === "admin" ? " warn" : "")}>{u.roleLabel}</span></td><td>{when(u.joined)}</td></tr>
        ))} />
      {mods.ready && changes.length > 0 && (
        <section aria-labelledby="mod-changes">
          <h2 id="mod-changes">Recent moderator changes</h2>
          <DataTable caption="Recent moderator changes" head={["When", "Changed by", "Person", "Change"]}
            rows={changes.map((c, i) => (
              <tr key={i}><td>{when(c.when)}</td><td className="cell-wrap">{c.by}</td><td className="cell-wrap">{c.person}</td><td>{c.granted ? "Made a moderator" : "Moderator flag removed"}</td></tr>
            ))} />
        </section>
      )}
      <Pager base="/admin/users" page={result.page} pages={result.pages} params={params} />
    </>
  );
}
