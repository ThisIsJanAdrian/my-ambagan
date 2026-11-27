import { randomUUID } from "node:crypto";

// Supabase Auth HTTP API + local mail catcher, shared by the Auth-seam tests.
const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const MAIL = process.env.MAIL_URL ?? "http://127.0.0.1:54324";
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const PASSWORD = "correct horse battery";

export const auth = (path: string, body: unknown, token?: string, method = "POST") =>
  fetch(`${API}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

/** The 6-digit code in the newest email to `email` whose subject/body matches nothing already seen. */
export async function codeSentTo(email: string, skip = 0): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`)).json();
    // Mailpit lists newest first; `skip` counts messages from the end (oldest = 0).
    const messages = [...(list.messages ?? [])].reverse();
    if (messages.length > skip) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${messages[skip].ID}`)).json();
      const m = /\b(\d{6})\b/.exec(msg.Text + " " + msg.HTML);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no code email arrived");
}

export async function mailCount(email: string): Promise<number> {
  const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`)).json();
  return list.messages?.length ?? 0;
}

export const newEmail = (tag: string) => `${tag}-${randomUUID()}@example.test`;

/** Sign up and verify with the emailed code; returns the verified Account's email. */
export async function verifiedAccount(tag = "acct"): Promise<string> {
  const email = newEmail(tag);
  await auth("signup", { email, password: PASSWORD });
  const code = await codeSentTo(email);
  const res = await auth("verify", { type: "signup", email, token: code });
  if (res.status !== 200) throw new Error("could not verify test account");
  return email;
}
