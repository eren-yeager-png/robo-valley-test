import type { Instrumentation } from "next";

// The Node.js-only part of instrumentation.ts. It lives in its own file so the Edge runtime never analyses it (it uses
// process.on and node:crypto). instrumentation.ts only calls it when NEXT_RUNTIME is "nodejs".
//
// Runs once when the server starts (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// It makes problems visible in the terminal straight away: wrong settings, an unreachable database, migrations that have
// not been applied, and any error that nothing else caught. It never prints a setting's value.
export async function registerNode() {
  const { logError, logWarn } = await import("./lib/logger");
  const { checkEnvironment } = await import("./lib/envCheck");

  for (const i of checkEnvironment()) {
    const entry = { category: "ENV" as const, where: "startup", what: `${i.key} ${i.message}` };
    if (i.level === "ERROR") logError(entry); else logWarn(entry);
  }

  // Errors nothing else caught: report them with context. uncaughtExceptionMonitor only OBSERVES, so the server still stops on a
  // fatal error exactly as before.
  const g = globalThis as typeof globalThis & { __rvProcessHooks?: boolean };
  if (!g.__rvProcessHooks) {
    g.__rvProcessHooks = true;
    process.on("unhandledRejection", (reason) => logError({ category: "PROCESS", where: "process", what: "An unhandled promise rejection (a background task failed and nothing handled it)", err: reason }));
    process.on("uncaughtExceptionMonitor", (err) => logError({ category: "PROCESS", where: "process", what: "An uncaught exception", err }));
  }

  // Development only (a hosted server should not connect to the database just to start): look at which migrations the
  // database has, read-only, and say so in the terminal.
  if (process.env.NODE_ENV !== "production" && process.env.DATABASE_URL) {
    try {
      const { pool } = await import("./lib/db");
      const { migrationStatus, pending } = await import("../scripts/migration-status.mjs");
      const todo = pending(await migrationStatus((sql: string) => pool.query(sql)));
      for (const m of todo) {
        logWarn({
          category: "MIGRATION", where: "startup",
          what: `Migration ${m.id} (${m.title}) is ${m.status === "partial" ? "only partly applied" : "not applied"} on this database. Affects: ${m.feature}.${m.blockedBy.length ? ` It needs ${m.blockedBy.join(", ")} first.` : ""}`,
          hint: `See "npm run db:migrate -- --expect-db <database name> --status". Dry run first: add --only ${m.id}. Applying is a deliberate step; the app only reports it.`,
        });
      }
    } catch (err) {
      logError({ category: "DATABASE", where: "startup", what: "Could not check the database at start-up", err });
    }
  }
}

/** Called by Next for every error it catches while handling a request (pages, routes, server actions). */
export const reportRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { logError } = await import("./lib/logger");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  const path = String(request.path ?? "").split("?")[0].slice(0, 200); // the path only: never the query string or headers
  logError({
    category: context.routeType === "route" ? "API" : context.routeType === "render" ? "RENDER" : "API",
    where: `${request.method} ${path}`,
    what: `The server hit an unexpected error while handling this ${context.routeType ?? "request"}`,
    err,
    context: { routeType: String(context.routeType), routePath: String(context.routePath), ...(digest ? { digest } : {}) },
  });
};
