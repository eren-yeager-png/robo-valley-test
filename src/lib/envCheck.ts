// Checks the settings the app needs and says in plain words what is wrong. Pure: it reads only the object it is given
// and NEVER returns or prints a value, only the name of the setting and a description.
export type EnvIssue = { level: "ERROR" | "WARN"; key: string; message: string };

const OTP_PROVIDERS = ["resend", "mock"];

export function checkEnvironment(env: NodeJS.ProcessEnv = process.env): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const prod = env.NODE_ENV === "production";
  const add = (level: EnvIssue["level"], key: string, message: string) => issues.push({ level, key, message });

  const db = env.DATABASE_URL?.trim();
  if (!db) add("ERROR", "DATABASE_URL", "is not set. Nothing that needs the database will work. Add it to .env.local.");
  else {
    try {
      const u = new URL(db);
      if (!/^postgres(ql)?:$/.test(u.protocol)) add("ERROR", "DATABASE_URL", "does not start with postgresql://.");
      else if (!u.pathname.replace(/^\//, "")) add("ERROR", "DATABASE_URL", "has no database name at the end.");
      else if (/-pooler\./i.test(u.hostname)) add("WARN", "DATABASE_URL", 'uses a pooled connection ("-pooler" in the host). That is fine for the app, but migrations need the direct connection string.');
    } catch {
      add("ERROR", "DATABASE_URL", "is not a valid connection string.");
    }
  }

  const secret = env.SESSION_SECRET;
  if (!secret) add("ERROR", "SESSION_SECRET", "is not set. Nobody can sign in and one-time codes will not work.");
  else if (secret.length < 32) add("ERROR", "SESSION_SECRET", "is shorter than 32 characters. Sign-in and one-time codes are refused until it is longer.");

  const provider = env.OTP_PROVIDER?.trim().toLowerCase();
  if (provider && !OTP_PROVIDERS.includes(provider)) add("ERROR", "OTP_PROVIDER", 'is not "resend" or "mock", so one-time codes are switched off.');
  if (provider === "mock" && prod) add("ERROR", "OTP_PROVIDER", "is mock in production. The mock provider can never run in production, so one-time codes are switched off.");
  if (!provider && env.MOCK_OTP === "true" && prod) add("WARN", "MOCK_OTP", "is set in production and is ignored there.");
  if (provider === "resend" && !env.RESEND_API_KEY?.trim()) add("ERROR", "RESEND_API_KEY", "is not set although OTP_PROVIDER is resend. E-mails cannot be sent.");
  if (!provider && env.MOCK_OTP !== "true") add("WARN", "OTP_PROVIDER", "is not set, so one-time codes (sign-up) are switched off.");

  if (env.CRON_SECRET !== undefined && env.CRON_SECRET !== "" && env.CRON_SECRET.length < 16) add("WARN", "CRON_SECRET", "is shorter than 16 characters, so the scheduled clean-up refuses to run.");
  if (prod && !env.CRON_SECRET) add("WARN", "CRON_SECRET", "is not set, so the scheduled login-event clean-up cannot run.");
  if (env.SITE_URL) {
    try { if (!/^https?:$/.test(new URL(env.SITE_URL).protocol)) throw new Error("x"); } catch { add("WARN", "SITE_URL", "is not a valid http(s) address, so the default site address is used.", ); }
  }
  return issues;
}
