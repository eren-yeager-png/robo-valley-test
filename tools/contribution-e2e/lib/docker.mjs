// Docker, WP-CLI and psql helpers for the end-to-end tools. Programs are run directly (no shell), so paths and quotes behave the same
// on Windows, macOS and Linux.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { APP, C, STATE, secrets } from "./config.mjs";

export const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
export const tryRun = (cmd, args, opts) => { try { return run(cmd, args, opts); } catch { return null; } };
export const docker = (...args) => run("docker", args);
export const exists = (name) => (tryRun("docker", ["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.Names}}"]) || "") === name;
export const running = (name) => (tryRun("docker", ["ps", "--filter", `name=^${name}$`, "--format", "{{.Names}}"]) || "") === name;

/** SQL on a throw-away database, as its owner; returns psql's unaligned output. */
export const sql = (query, db = C.pg.db) => run("docker", ["exec", "-i", C.pg.container, "psql", "-U", C.pg.db, "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", query]);
/** A file of SQL (piped in) on a throw-away database. */
export const sqlFile = (text, db = C.pg.db) => run("docker", ["exec", "-i", C.pg.container, "psql", "-U", C.pg.db, "-d", db, "-v", "ON_ERROR_STOP=1", "-q"], { input: text });

/** wp-config.php additions of the throw-away site: the app address, the current form's switches, no outgoing requests except
 *  wordpress.org (to install the theme). */
export const wpExtra = (appUrl = APP) => [
  "define('RV_CONTRIBUTION_V2', true);", "define('RV_CONTRIBUTE_PUBLIC', true);", `define('RV_CONTRIBUTION_APP_URL', '${appUrl}');`,
  "define('WP_HTTP_BLOCK_EXTERNAL', true);", "define('WP_ACCESSIBLE_HOSTS', 'api.wordpress.org,downloads.wordpress.org');", "define('AUTOMATIC_UPDATER_DISABLED', true);",
].join(" ");

/** WP-CLI against the throw-away site (a one-off container sharing its files and network). */
export function wp(args, appUrl = APP) {
  return run("docker", ["run", "--rm", "--network", C.wp.net, "--volumes-from", C.wp.container, "--user", "33:33",
    "-e", `WORDPRESS_DB_HOST=${C.wp.db}`, "-e", "WORDPRESS_DB_USER=wp", "-e", `WORDPRESS_DB_PASSWORD=${secrets().wpdb}`, "-e", "WORDPRESS_DB_NAME=wp",
    "-e", `WORDPRESS_CONFIG_EXTRA=${wpExtra(appUrl)}`, C.wp.cli, "wp", ...args])
    .split("\n").filter((l) => !/^(Warning|Deprecated|Notice): /.test(l)).join("\n");
}

/** Copies a plugin folder into the throw-away site (replacing an earlier copy) and activates it. */
export function installPlugin(name, dir) {
  const tmp = join(STATE, "plugin-copy", name);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(join(STATE, "plugin-copy"), { recursive: true });
  cpSync(dir, tmp, { recursive: true });
  docker("exec", C.wp.container, "rm", "-rf", `/var/www/html/wp-content/plugins/${name}`);
  docker("cp", tmp, `${C.wp.container}:/var/www/html/wp-content/plugins/`);
  docker("exec", C.wp.container, "chown", "-R", "www-data:www-data", `/var/www/html/wp-content/plugins/${name}`);
  rmSync(tmp, { recursive: true, force: true });
  wp(["plugin", "activate", name]);
}
