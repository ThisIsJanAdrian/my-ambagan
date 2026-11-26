import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Exercises the real local Supabase Auth + mail catcher: sign-up sends a
// 6-digit code and only the right code verifies the Account.
const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const MAIL = process.env.MAIL_URL ?? "http://127.0.0.1:54324";
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const auth = (path: string, body: unknown) =>
  fetch(`${API}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function codeSentTo(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`)).json();
    if (list.messages?.length) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
      const m = /\b(\d{6})\b/.exec(msg.Text + " " + msg.HTML);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no code email arrived");
}

describe("email verification code", () => {
  it("sign-up emails a 6-digit code; a wrong code is refused and the right one verifies", async () => {
    const email = `code-${randomUUID()}@example.test`;
    const signup = await auth("signup", { email, password: "correct horse battery" });
    expect(signup.status).toBe(200);

    const code = await codeSentTo(email);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await auth("verify", { type: "signup", email, token: code === "000000" ? "111111" : "000000" });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const ok = await auth("verify", { type: "signup", email, token: code });
    expect(ok.status).toBe(200);
    expect((await ok.json()).access_token).toBeTruthy();
  });
});
