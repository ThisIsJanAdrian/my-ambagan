import { describe, expect, it } from "vitest";
import { PASSWORD, auth, newEmail, codeSentTo, verifiedAccount } from "./auth-api";

const login = (email: string, password: string) => auth("token?grant_type=password", { email, password });

describe("login", () => {
  it("a verified Account logs in with the correct email and password", async () => {
    const email = await verifiedAccount("login");
    const res = await login(email, PASSWORD);
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBeTruthy();
  });

  it("wrong password and unknown email are refused identically", async () => {
    const email = await verifiedAccount("login");
    const wrongPassword = await login(email, "not the password");
    const unknownEmail = await login(newEmail("nobody"), PASSWORD);
    expect(wrongPassword.status).toBe(400);
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(await unknownEmail.json()).toEqual(await wrongPassword.json());
  });

  it("an Account that has not finished verification cannot log in", async () => {
    const email = newEmail("unverified");
    await auth("signup", { email, password: PASSWORD });
    const res = await login(email, PASSWORD);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).access_token).toBeUndefined();
  });
});

describe("password reset", () => {
  it("a valid emailed code lets the Account set a new password; the old one stops working", async () => {
    const email = await verifiedAccount("reset");
    expect((await auth("recover", { email })).status).toBe(200);
    const code = await codeSentTo(email, 1); // message 0 was the sign-up code

    const verified = await auth("verify", { type: "recovery", email, token: code });
    expect(verified.status).toBe(200);
    const { access_token } = await verified.json();

    const changed = await auth("user", { password: "a brand new passphrase" }, access_token, "PUT");
    expect(changed.status).toBe(200);

    expect((await login(email, "a brand new passphrase")).status).toBe(200);
    expect((await login(email, PASSWORD)).status).toBeGreaterThanOrEqual(400);
  });

  it("an invalid code is refused and the old password keeps working", async () => {
    const email = await verifiedAccount("reset");
    await auth("recover", { email });
    const code = await codeSentTo(email, 1);

    const bad = await auth("verify", { type: "recovery", email, token: code === "000000" ? "111111" : "000000" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((await bad.json()).access_token).toBeUndefined();

    expect((await login(email, PASSWORD)).status).toBe(200);
  });

  it("an expired code is refused and the old password keeps working", async () => {
    const email = await verifiedAccount("reset");
    await auth("recover", { email });
    const code = await codeSentTo(email, 1);

    // Age the code past otp_expiry (3600s) by backdating when it was sent.
    // Needs a committed write, so it uses its own connection rather than the rollback harness.
    const pg = (await import("pg")).default;
    const client = new pg.Client({
      connectionString: process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await client.connect();
    try {
      await client.query(
        "update auth.users set recovery_sent_at = now() - interval '2 hours' where email = $1",
        [email],
      );
    } finally {
      await client.end();
    }

    const res = await auth("verify", { type: "recovery", email, token: code });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await login(email, PASSWORD)).status).toBe(200);
  });

  it("the response does not reveal whether an email is registered", async () => {
    const known = await verifiedAccount("reset");
    const a = await auth("recover", { email: known });
    const b = await auth("recover", { email: newEmail("nobody") });
    expect(b.status).toBe(a.status);
    expect(await b.json()).toEqual(await a.json());
  });
});
