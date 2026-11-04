import type { Metadata } from "next";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { listUsers, usersByRole } from "../../../lib/adminStats";
import { ROLE_CODES } from "../../../lib/roles";
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
  try {
    [result, roles] = await Promise.all([listUsers(pool, { page, q, role }), usersByRole(pool)]);
  } catch {
    console.error("admin users: could not read the data");
    return (<><PageHeader title="User management" /><Notice kind="error" title="Users could not be loaded">The database did not answer. Please try again.</Notice></>);
  }
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (role) params.role = role;

  return (
    <>
      <PageHeader title="User management" lead="Everyone who has registered. This list is read-only." />
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
      <DataTable caption="Registered users" head={["Name", "Email", "Role", "Joined"]} empty="No accounts match."
        rows={result.rows.map((u) => (
          <tr key={u.id}><td className="cell-wrap">{u.name}</td><td className="cell-wrap">{u.email}</td><td><span className={"adm-pill" + (u.role === "admin" ? " warn" : "")}>{u.roleLabel}</span></td><td>{when(u.joined)}</td></tr>
        ))} />
      <Pager base="/admin/users" page={result.page} pages={result.pages} params={params} />
    </>
  );
}
