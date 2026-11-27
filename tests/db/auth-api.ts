import { randomUUID } from "node:crypto";
import pg from "pg";

// Supabase Auth HTTP API + local mail catcher, shared by the Auth-seam tests.
const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const MAIL = process.env.MAIL_URL ?? "http://127.0.0.1:54324";
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const PASSWORD = "correct horse battery";

// Subjects from supabase/config.jsonc.
export const SIGNUP_SUBJECT = "Your MyAmbagan code";
export const RESET_SUBJECT = "Your MyAmbagan reset code";

export const auth = (path: string, body: unknown, opts: { token?: string; method?: string } = {}) =>
  fetch(`${API}/auth/v1/${path}`, {
    method: opts.method ?? "POST",
    headers: {
      apikey: ANON,
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify(body),
  });

type Summary = { ID: string; Subject: string; Created: string };

async function messagesTo(email: string, subject: string): Promise<Summary[]> {
  const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`);
  const list = await res.json();
  return ((list.messages ?? []) as Summary[]).filter((m) => m.Subject === subject);
}

/** How many emails with this subject were sent to `email` (after a short wait for delivery). */
export async function mailsSentTo(email: string, subject: string): Promise<number> {
  await new Promise((r) => setTimeout(r, 500));
  return (await messagesTo(email, subject)).length;
}

/** The 6-digit code in the newest email with this subject sent to `email`. */
export async function codeSentTo(email: string, subject: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const [newest] = (await messagesTo(email, subject)).sort((a, b) => b.Created.localeCompare(a.Created));
    if (newest) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${newest.ID}`)).json();
      // The templates render the code as the only standalone 6-digit number.
      const m = /\b(\d{6})\b/.exec(msg.Text ?? "");
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no "${subject}" email arrived for ${email}`);
}

export const newEmail = (tag: string) => `${tag}-${randomUUID()}@example.test`;

/** Sign up and verify with the emailed code; returns the email of the now-verified sign-up. */
export async function signUpAndVerify(tag = "acct"): Promise<string> {
  const email = newEmail(tag);
  await auth("signup", { email, password: PASSWORD });
  const code = await codeSentTo(email, SIGNUP_SUBJECT);
  const res = await auth("verify", { type: "signup", email, token: code });
  if (res.status !== 200) throw new Error("could not verify test sign-up");
  return email;
}

/** Request a password reset and return the emailed code. */
export async function requestReset(email: string): Promise<string> {
  const before = (await messagesTo(email, RESET_SUBJECT)).length;
  const res = await auth("recover", { email });
  if (res.status !== 200) throw new Error("recover failed");
  for (let i = 0; i < 20; i++) {
    if ((await messagesTo(email, RESET_SUBJECT)).length > before) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return codeSentTo(email, RESET_SUBJECT);
}

/** Make an already-sent reset code look `seconds` old. Committed write on its own connection (outside the rollback harness). */
export async function ageResetCode(email: string, seconds: number) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(
      "update auth.users set recovery_sent_at = now() - make_interval(secs => $2) where email = $1",
      [email, seconds],
    );
  } finally {
    await client.end();
  }
}
