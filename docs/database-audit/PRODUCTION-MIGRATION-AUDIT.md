# RoboValley – Production Database Migration Audit

**Project:** RoboValley
**Repository:** robo-valley-test
**Environment under investigation:** the production database (its details are not recorded in this repository)
**Audit date:** 24 November 2026
**Audited code:** `origin/main` at `1206ef0` (merge of #82, 19 November 2026)
**Status:** audit complete; every confirmed defect below is fixed by the changes prepared on branch `fix/migrations-011-026`; see the pull request and git history for merge status.

> **Production was not accessed.** During this work no migration or rollback was run against any real database, and Vercel, WordPress
> and Hostinger were not touched. Every test ran on in-memory PGlite only.

Line numbers in section 5 refer to `origin/main` at `1206ef0`, before the fixes. Line numbers in section 6 refer to the files on the
branch.

---

## 1. Objectives and safety rules

- Inspect migrations 011–026 and their rollbacks, the migration runner and the status checker, as they are on `origin/main`; later
  extended to 007/009 (name-only constraint lookups) and 016's rollback (seed ownership).
- Compare what the migrations need with the database they are meant for (the result is kept privately, see section 2).
- Identify SQL defects, dependency problems, rollback data-loss risks and runner gaps; fix them and test them locally.

Safety rules followed throughout: no migration or rollback against any real database; no manual creation of production tables; no
production data deleted or modified; nothing committed or pushed without the owner's approval.

## 2. Production database findings

The reported state of the production database was reviewed privately and is not recorded in this repository. Ask the project owner for
access.

To see the state of a database, run the read-only status check against it (section 11). The repository has no migration tracking table:
the status check reads the real schema instead.

## 3. Migration inventory (011–026)

| # | File | Adds | Needs | Rollback refuses while |
|---|---|---|---|---|
| 011 | api_rate_limits | `api_rate_limits` (no personal data) | – | never (counters only) |
| 012 | contributions | `sectors`, `contributions`, `contribution_scopes`, 2 trigger functions, 2 triggers | users | any contribution, sector choice, or sector other than 016's untouched seed (016_down's ownership test) |
| 013 | contribution_photos | `contribution_photos`, `contribution_photo_blobs` (the image bytes, in this database) | 012 | any photo |
| 014 | contribution_contacts | `contribution_contacts` (private) | 012 | any contact record |
| 015 | moderator_flag | `users.is_moderator`, `moderator_audit`, audit function and 2 triggers | users | anyone is a moderator, or any audit row |
| 016 | sector_seed | unique sector-name index, seed row `agriculture-dairy` | 012 | a contribution is filed under the seed sector (and it removes the row only if 016 made it) |
| 017 | review_statuses | statuses `rejected`, `unpublished`; `contribution_reviews` (append-only) | 012 | any rejected/unpublished item, or any review |
| 018 | contribution_dedupe | status `removed`, actions `verify`/`remove`, `contribution_title_keys`, 4 functions, 2 triggers | 017 | any removed item, or any verify/remove decision |
| 019 | moderation_portal | replies, notes, views, categories, links, view `contribution_work_log`, `review_round_at`, 2 functions, 3 triggers | 017 | any reply, note or category |
| 020 | password_reset | `password_reset_tokens`, `users.password_changed_at` | users | any password changed through a reset |
| 021 | contact_share | `contributions.share_contact_with_moderators` | 012 | any box ticked |
| 022 | contribution_origin | `contributions.from_sector_page` | 012 | any value true |
| 023 | contribution_type_chosen | `contributions.type_chosen` | 012 | any value true |
| 024 | sector_robot_types | `sector_robot_types` | 012 | any robot type |
| 025 | contribution_robots | `contribution_scopes.robot_type_id` + link + index, `contributions.from_robot_page`, UNIQUE (id, sector_id) | 012, 024 | any robot chosen, any `from_robot_page` true, or a same-named object 025 did not make |
| 026 | sector_questions | `sector_questions` | 012 | any question |

Every file (migration and rollback) runs as one transaction (`BEGIN` … `COMMIT`) and refuses unless the runner confirmed the target
database (`rv.expected_db`). None uses statements that cannot run in a transaction (`CONCURRENTLY`, `VACUUM`,
`ALTER TYPE … ADD VALUE`). `000_base_schema.sql` is **not** in the repository: it is a local file from closed PRs #75/#76 and must
not be added.

## 4. Corrections to the first version of this audit

| Earlier claim | Finding on `origin/main` |
|---|---|
| 019 references `first_viewed_at` without declaring it | **Not a defect.** Both `first_viewed_at` and `last_viewed_at` are declared (`019:99-100`); the check (102), index (104) and view (164) use them consistently, and 019 applies cleanly in every test run. No change was made to 019. |
| `021_down.sql` also drops `from_sector_page` | **Not on `origin/main`.** 021_down drops only `share_contact_with_moderators`, after a preservation check (`021_down:21-29`). The other version was an unmerged local copy (commit `28f5730`) and was never in the repository. |
| Tests: 3 files / 7 tests failed | Those numbers came from an old local checkout (06-11 code plus copied files). The figures for `origin/main` are in section 9. |
| 000 is the baseline migration | Not in the repository (see section 3). |

## 5. Confirmed defects (all fixed on `fix/migrations-011-026`)

| # | Defect | Where (`1206ef0`) | Fix |
|---|---|---|---|
| D1 | 026 missing from the status list, so Settings and `--status` never showed it and the runner could not skip it or check its prerequisite | `scripts/migration-status.mjs:15-133` (dropped by merge `f8267bc`) | Original entry restored |
| D2 | 026 missing from test file lists (same merge) | `tests/migrations.test.ts:22`, `tests/migrate-cli.test.ts:49`, `tests/migration-status.test.ts:32` | Restored |
| D3 | The 012 rollback test never ran `026_down`, so it failed (same merge) | `tests/migration-012.test.ts:182` | Restored |
| D4 | 022/023/025 rollbacks dropped columns holding `true` values without asking | `022_down:21`, `023_down:21`, `025_down:33` | Refuse while any value is true, with the row count |
| D5 | 025 looked up its two constraints by name in every schema | `025:38`, `025:47` | Looked up on the table it changes, with its structure checked: constraint type and columns in order, and for the link also the referenced table and columns and `ON DELETE RESTRICT` (`ON UPDATE`, match type and deferrability are not compared; section 10). A different same-named constraint stops the migration |
| D6 | Rollback column checks searched every schema | `020_down:23`, `021_down:21`, `025_down:22` | Checks the very table the `ALTER TABLE` changes (`to_regclass`) |
| D7 | `--only` or `--file` without a value ran every migration; `--expect-host` without one skipped the endpoint check | `scripts/migrate.mjs:155-158` | An option without a value is refused |
| D8 | A migration file without a status entry ran unchecked | `scripts/migrate.mjs:124-126` | Refused |
| D9 | Running 017 again after 018 narrowed the status rule (admin "Remove" would then fail) | `017:35-37` | 017 widens the rule only when it is exactly 012's four-status rule (or there is none); its own six and 018's seven are left as they are; any other rule of that name stops it (exact comparison, as in D15) |
| D10 | Duplicate numbers ran twice; misnamed `.sql` files were silently skipped | `scripts/migrate.mjs:45-47` | Both refused |
| D11 | `--file` on a forward migration skipped every status check | `scripts/migrate.mjs:216` | Same checks as `--only <number>` |
| D12 | The status check could not see the 11 functions and 11 triggers of 012–019 (a database missing a safety trigger read as applied) | `scripts/migration-status.mjs:151-161` | Function and trigger checks (section 6) |
| D13 | `--only` matched a name prefix: `--only 01` ran 010–019 | `scripts/migrate.mjs:46` | Exactly one migration number; ambiguous values refused (section 7) |
| D14 | A partly applied prerequisite did not block the migrations that need it | `scripts/migration-status.mjs:191` | A prerequisite must be fully applied (section 7) |
| D15 | 007 and 009 looked up their constraint by name in every schema (same pattern as D5), and their rollbacks removed a same-named constraint they did not make | `007:29`, `009:62`, `007_down:21`, `009_down:24` | Looked up on their own table, and the existing definition must be exactly the migration's rule: PostgreSQL writes out both (`pg_get_constraintdef`), the expected one on a throwaway copy of the columns in a temporary table, and the texts are compared with only spacing ignored. Another definition stops the migration; the rollback refuses a constraint it did not make |
| D16 | `016_down` deleted the `agriculture-dairy` row by slug alone, even when the row existed before 016 (016's insert then did nothing) | `016:31-33`, `016_down:22` | Removed only when 016 made it (section 8) |

Found by the independent review of this branch and fixed before staging:

- `012_down` exempted any `agriculture-dairy` row by slug alone, so a row that `016_down` had kept (edited after 016, or made by the
  owner before 016) was dropped with the table. It now exempts only a row that passes `016_down`'s ownership test, and refuses,
  naming the row, otherwise (section 8).
- 007, 009 (and their rollbacks) and 017 recognised their constraint by substrings of its definition, so a same-named rule with
  another meaning (the opposite attachment rule, an extra category, a status rule forbidding `rejected`) was accepted. They now
  compare the exact definition (D15, D9).
- The status check counted a disabled trigger as present (section 6).

Design change approved by the owner: rollbacks 012–015 deleted members' data with only a warning comment (`012_down:18-20`,
`013_down:20-21`, `014_down:20`, `015_down:23-27`). They now refuse while that data exists (section 8).

026's option rule relied on `AND` evaluation order (`026:52`). Its behaviour was correct and is unchanged (text questions: SQL NULL
only; choice questions: a JSON array of 2–10 items; everything else refused with a check violation; all 20 shape/kind cases recorded
before and after are identical). It now uses `CASE WHEN jsonb_typeof(options) = 'array' THEN … ELSE false END`. A database that
already has 026 keeps the older text, which behaves identically.

## 6. Status check: function and trigger verification

The status check (`scripts/migration-status.mjs`, shown in Admin Portal → Settings and by `--status`) reads the real schema, read-only,
in `current_schema()`. It now also checks functions and triggers:

- **Function:** schema + exact name + exact argument types (`format_type` of each `proargtypes` entry, in order). Another overload of
  the same name, or the same function in another schema, does not count.
- **Trigger:** schema + table + trigger name + the function it calls, including that function's schema and argument types
  (`pg_trigger` → `pg_class` → `pg_namespace`, `tgfoid` → `pg_proc`). Internal triggers (`tgisinternal`, made by PostgreSQL for
  foreign keys) are never counted, and neither is a disabled trigger (`ALTER TABLE … DISABLE TRIGGER`, `tgenabled = 'D'`): it is
  listed as "exists but is disabled".
- **Status:** a missing function, or a missing or disabled trigger, makes its migration **partial** (never applied); with every object
  present it is applied, as before. Running the migration again restores a missing function or trigger (the files only create one that does not
  exist). A trigger of the right name that calls the wrong function, or a disabled one, is reported and **stays** partial after a
  re-run: the file sees a trigger of that name and leaves it, so a person has to look at it (`ALTER TABLE … ENABLE TRIGGER …`).

Registry entries, copied from the migration SQL (file:line on the branch):

| Migration | Functions | Triggers (table: trigger → function) |
|---|---|---|
| 012 | `rv_contribution_needs_scope()` 012:81, `rv_scope_keep_last()` 012:89 | contributions: contributions_needs_scope → rv_contribution_needs_scope() 012:102-103; contribution_scopes: contribution_scopes_keep_last → rv_scope_keep_last() 012:106-107 |
| 013 | `rv_photo_blob_matches()` 013:57 | contribution_photo_blobs: contribution_photo_blobs_match → rv_photo_blob_matches() 013:82-83 |
| 015 | `rv_moderator_audit()` 015:51 | users: users_moderator_audit_upd 015:66-68 and users_moderator_audit_ins 015:71-73 → rv_moderator_audit() |
| 017 | `rv_review_append_only()` 017:102 | contribution_reviews: contribution_reviews_append_only → rv_review_append_only() 017:114-115 |
| 018 | `rv_title_key(text)` 018:51, `rv_sync_title_keys(bigint)` 018:64, `rv_title_keys_from_contribution()` 018:73, `rv_title_keys_from_scope()` 018:79 | contributions: contributions_title_keys → rv_title_keys_from_contribution() 018:93-94; contribution_scopes: contribution_scopes_title_keys → rv_title_keys_from_scope() 018:97-98 |
| 019 | `rv_portal_append_only()` 019:66, `rv_review_round()` 019:137 | contribution_replies: contribution_replies_append_only 019:86-87 and contribution_notes: contribution_notes_append_only 019:90-91 → rv_portal_append_only(); contributions: contributions_review_round → rv_review_round() 019:148-149 |

## 7. Runner safeguards (`scripts/migrate.mjs`)

Unchanged: `--expect-db` is required and checked against the URL and against `current_database()`; `--expect-host` refuses any other
Neon endpoint; a dry run is the default and connects to nothing; each file is one transaction; only Neon's endpoint ID is ever printed.

Added:

- **Options need a value.** `--only`, `--file`, `--expect-host` and `--expect-db` refuse a missing, empty or `--…` value.
- **`--only` selects exactly one migration.** Three digits (`--only 011`), or one or two digits without a leading zero (`11` and `011`
  are the same). Refused, with a clear message and exit code 1, and nothing run: several numbers, letters, four digits, a number with
  no migration file, and an ambiguous short number with a leading zero (`--only 01`, which used to run 010–019).
- **Prerequisites must be fully applied.** A missing or partly applied prerequisite blocks the migration (even with `--allow-gaps`);
  the message names the prerequisite and, for a partly applied one, exactly which objects it is missing. An already applied migration
  is still skipped. In a full run the prerequisite comes first and is completed before its dependants are checked.
- **The migrations folder is checked.** A `.sql` file not named `NNN_name.sql`, or two files with one number, stop every run.
- **No migration runs blind.** A migration without a status entry is refused.
- **`--file` on a migration** in `db/migrations` gets the same checks as `--only <number>`; rollbacks keep their own checks.

## 8. Rollbacks: consequences, protections and order

Rollbacks run only through the runner: `npm run db:migrate -- --expect-db <database name> --file db/rollback/NNN_down.sql --apply`.
Each file is one transaction: a refusal aborts it and nothing is changed. Run **newest first**: 026, 025, 024, 023, 022, 021, 020,
019, 018, 017, 016, 015, 014, 013, 012, 011. Hard dependencies: 025 before 024; 019 before 017 (the work-log view); 026, 025, 024,
019, 018, 017, 014 and 013 before 012.

| Rollback | Removes | Lost if it is run (after the refused data was exported and cleared on purpose) |
|---|---|---|
| 007 | category column, per-category index (restores the single-active index) | the category of each dataset. While more than one category is active it fails, and nothing is changed: re-creating the single-active index fails on the extra active rows and the transaction is rolled back (there is no separate check). Refuses a same-named constraint that is not exactly 007's rule |
| 009 | attachment tables and the four upload-history columns | stored attachment files and their details (unchanged behaviour); refuses a same-named constraint that is not exactly 009's rule |
| 011 | rate-limit table | short-lived counters; searches keep working without a limit |
| 012 | sectors, contributions, scopes, 2 functions | 016's untouched seed sector only (everything else must be cleared first, including an `agriculture-dairy` row that 016_down kept) |
| 013 | photo tables and function | nothing (refuses while any photo exists; the bytes live in this database, nowhere else) |
| 014 | contact table | nothing (refuses while any contact exists) |
| 015 | moderator flag, audit table, triggers | nothing (refuses while anyone is a moderator or any audit row exists); roll back the code too |
| 016 | name index; the seed sector **only if 016 made it** | the seed sector, if unused and still exactly as 016 inserted it |
| 017 | review table; narrows statuses | nothing (refuses while reviews or rejected/unpublished items exist) |
| 018 | title-key safeguard; narrows rules | the derived title keys (rebuilt when 018 is applied again) |
| 019 | replies, notes, categories, views, work log, `review_round_at` | "who opened what" and `review_round_at` (bookkeeping) |
| 020 | reset tokens, `password_changed_at` | short-lived tokens. Refuses once any reset has completed: dropping the column would make sessions signed out by a reset valid again for up to 30 days. Safe only after 30 days, or after rotating `SESSION_SECRET` |
| 021–023 | one column each | nothing (each refuses while any value is true) |
| 024 | robot types | nothing (refuses while any exists) |
| 025 | robot columns, link, index, unique rule | nothing (refuses while answers exist); a same-named object 025 did not make is refused, never removed |
| 026 | questions | nothing (refuses while any exists) |

**016's seed ownership.** 016 inserts `agriculture-dairy` with `ON CONFLICT (slug) DO NOTHING`, so the row may predate it. 016_down
now removes the row only when both hold: it still has exactly the values 016 inserts (slug, name, sort order, active, not demo),
and it was written in the same transaction that created 016's index `sectors_name_lower_uq` (equal `xmin` on the row and on the
index's `pg_class` entry; 016 creates both in one transaction). Otherwise the row is kept with a NOTICE and only the index is removed.
No schema change was needed. After a dump and restore, a `VACUUM FULL` or a `REINDEX` of `sectors` the two `xmin` values differ, so
the row is kept: keeping the seeded row is harmless; deleting someone's row is not.

**012_down uses the same test.** It drops the `sectors` table, so it exempts only a row that passes 016_down's ownership test
(exactly 016's values and the same `xmin` as 016's index). Once that index is gone (016_down always drops it), no remaining
`agriculture-dairy` row can be proven to be the seed, so it counts like any other sector: 012_down refuses, names the row and
changes nothing until the row is exported and deleted on purpose. In the normal order (016_down, then 012_down) an untouched seed is
removed by 016_down and 012_down goes ahead.

## 9. Local test steps and results (PGlite only)

The tests cannot reach a real database: `vitest.config.ts` forces `DATABASE_URL` to an unreachable placeholder, `tests/setup.ts`
refuses to start otherwise and blocks real `pg` connections, and command-line tests give the runner only that placeholder.

```
npx vitest run tests/migration-status.test.ts tests/migration-status-functions.test.ts tests/migrations.test.ts tests/migrate-cli.test.ts tests/migrate-gap-guard.test.ts tests/migration-0*.test.ts tests/migrated-clone.test.ts tests/admin-reports.test.tsx
npx vitest run
```

On Windows, run from a folder path with an upper-case drive letter (`D:\…`); a lower-case `d:\` makes vitest load twice and fail.

| Run | `origin/main` | Branch, first fixes | Branch, final |
|---|---|---|---|
| Migration area | 6 failed, 267 passed (273; 22 files) | 0 failed, 322 passed (322; 23 files) | 0 failed, 368 passed (368; 26 files, 264 s) |
| Full suite (Vitest) | 6 failed, 2357 passed (2363) | 1 failed (timeout), 2398 passed (2399) | 0 failed, 2445 passed (2445; 120 files, 623 s) |

The six failures on `origin/main` were D1–D3; all six pass on the branch.

**The full-suite timeout.** One run of the first fixes hit the 30-second limit in an unchanged 022 test that builds two databases
(35 s; 6 s on its own). Diagnosis: CPU contention, not a slowdown. The migration tests built every database from scratch (base tables
plus up to 26 migrations, about 2.8 s of CPU each), hundreds of times, three files at a time on a 4-CPU machine: the CPU sat at
95–100% for most of the run, and the 22 migration files took 62% of all test time. Applying the chain is not slower than on
`origin/main` (2.76 s against 2.89 s, median of 5), and the same test took 6.5 s in a repeat full run. Fix, without touching the
timeout: each migration test file now builds its migrated database once and gives every test its own clone
(`tests/helpers/migratedClone.ts`; a clone costs 0.66 s). A test checks that a clone is identical to a from-scratch build, including
the next identity values (the template is checkpointed first, otherwise PostgreSQL's 32-value sequence pre-logging would make the
next sector id 34 instead of 2). After the fix, in a full run: that 022 test took 2.0 s (6.5 s before; 35 s in the failed run), the
migration files took 562 s in total instead of 932 s (with three more files and 34 more tests), the whole run 569 s instead of
668 s, and the slowest test 12.1 s against the unchanged 30-second limit. No test timeout or Vitest setting was changed.

Type check (`tsc --noEmit`): no errors. ESLint on the changed files: no problems. Production build (`next build`): passes with the
tests' unreachable placeholder `DATABASE_URL`. `src/lib/db.ts` (unchanged) refuses to load without the variable set, so a build
with no `DATABASE_URL` at all stops while collecting page data; no connection is made during the build.

## 10. Remaining limitations

- `--only` takes one migration number; lists and ranges are not supported (a full run applies everything in order).
- Function checks compare the signature, not the function body. Trigger checks compare table, name and the called function, not the
  timing or events (`BEFORE`/`AFTER`, `INSERT`/`UPDATE OF …`). A disabled trigger (`tgenabled = 'D'`) counts as missing; a trigger
  set to fire only during replication (`ENABLE REPLICA TRIGGER`, `tgenabled = 'R'`) still counts as present, although it does not
  fire in normal sessions.
- The status check's `constraint` and `index` entries are still matched by name within the schema, so a constraint replaced by hand
  after its migration ran still reads as applied. The migrations themselves look up their constraints on their own table:
  - 007, 009 (and their rollbacks) and 017 compare the exact definition as PostgreSQL writes it (`pg_get_constraintdef`), with only
    spacing ignored. The expected text is written by the same server, on a throwaway copy of the columns in a temporary table, so the
    comparison does not depend on the PostgreSQL version (the tests run PostgreSQL 18.6 in PGlite). Being exact, it also treats the
    same values in another order, or a `NOT VALID` constraint, as a mismatch, and stops. The temporary table needs the `TEMPORARY`
    privilege on the database (PostgreSQL grants it to everyone by default). Without it, the comparison fails and nothing is
    changed. That affects every run of 017 (012's rule is always there to compare), 007_down and 009_down whenever their constraint
    exists, and 007 and 009 whenever a constraint of that name already exists: when they are run again, and also on a first run if
    a same-named constraint is already there.
  - 017 knows three rules (012's four statuses, its own six, 018's seven). A migration that changes `contributions_status_ck` again
    must be added to 017's list, or re-running 017 afterwards stops.
  - 025 compares the structure (type, columns, and for the link the referenced table and columns and `ON DELETE`), not `ON UPDATE`,
    match type or deferrability.
- 016_down keeps the seed row after a dump and restore, `VACUUM FULL` or `REINDEX` of `sectors` (see section 8); 012_down then refuses
  until that row is cleared on purpose.
- `information_schema.columns` lists only columns the reading role may see: read the status as the owner role.
- 026's option elements (string type, no repeats, up to 60 characters) and the limits of 5 active and 2 required questions per
  sector are enforced by the application only (`src/lib/sectorQuestions.ts:58-71, 135, 151-153, 180-183`), under a row lock.
- Rollbacks refuse while data exists but do not export it: exporting before clearing is a manual step.
- There is no migration tracking table (by design): when and by whom a migration ran is not recorded.
- `next build` needs `DATABASE_URL` to be set (any value; it does not connect), because `src/lib/db.ts` checks for it when it is
  loaded. This is existing application behaviour and was not changed here.

## 11. Production execution steps (each step needs the owner's approval)

These steps are separate from the local tests above and are not part of this change.

1. Confirm which database branch is production and its endpoint ID; confirm that the live application's `DATABASE_URL` points to it.
2. Create a backup branch of production (put the date and time in its name); make a new one if it is more than an hour old.
3. Create a test branch from production and run, in a terminal where only that window holds the connection string:
   ```
   npm run db:migrate -- --expect-db <database name> --expect-host <test endpoint ID> --status
   npm run db:migrate -- --expect-db <database name> --expect-host <test endpoint ID>            (dry run)
   npm run db:migrate -- --expect-db <database name> --expect-host <test endpoint ID> --apply
   npm run db:migrate -- --expect-db <database name> --expect-host <test endpoint ID> --status
   ```
   Compare row counts of existing tables before and after; they must not change. Before the `--apply` line, run the privilege check
   from step 5 on the test branch too.
4. Owner approval.
5. Before any production run, check on the production target, as the same database user the migration will use, that it may create
   temporary tables (read-only; 007, 009, 017 and the 007/009 rollbacks need it, see section 10). It must return `true`; if it
   returns `false`, stop: those files would fail with a permission error (and change nothing), and the privilege has to be granted
   by the database owner first.
   ```
   SELECT has_database_privilege(current_user, current_database(), 'TEMP');
   ```
6. Repeat step 3 with the production endpoint ID. Check that Admin Portal → Settings shows every migration as applied.
7. Recovery: restore production from the backup branch in the Neon console (this discards writes made after the backup). Rollback
   files are a last resort, run newest first, and refuse while data exists.

## 12. Current safety status

- Real databases accessed during this work: none. Migrations or rollbacks run against any real database during this work: none.
- Vercel, WordPress or Hostinger accessed during this work: none.
- Repository changes: prepared on branch `fix/migrations-011-026`; see the pull request and git history for merge status.
