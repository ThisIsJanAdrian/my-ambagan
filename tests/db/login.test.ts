import { describe, expect, it } from "vitest";
import {
  PASSWORD,
  RESET_SUBJECT,
  ageResetCode,
  auth,
  mailsSentTo,
  newEmail,
  requestReset,
  signUpAndVerify,
} from "./auth-api";

const NEW_PASSWORD = "a brand new passphrase";
// otp_expiry in supabase/config.jsonc is 3600s.
const PAST_OTP_EXPIRY = 2 * 3600;

const login = (email: string, password: string) => auth("token?grant_type=password", { email, password });
const verifyReset = (email: string, token: string) => auth("verify", { type: "recovery", email, token });

describe("login", () => {
  it("a verified Account logs in with the correct email and password", async () => {
    const email = await signUpAndVerify("login");
    const res = await login(email, PASSWORD);
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBeTruthy();
  });

  it("wrong password and unknown email are refused identically", async () => {
    const email = await signUpAndVerify("login");
    const wrongPassword = await login(email, "not the password");
    const unknownEmail = await login(newEmail("nobody"), PASSWORD);
    expect(wrongPassword.status).toBe(400);
    const body = await wrongPassword.json();
    expect(body.error_code).toBe("invalid_credentials");
    expect(unknownEmail.status).toBe(400);
    expect(await unknownEmail.json()).toEqual(body);
  });

  it("a sign-up that has not finished verification cannot log in", async () => {
    const email = newEmail("unverified");
    await auth("signup", { email, password: PASSWORD });
    const res = await login(email, PASSWORD);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe("email_not_confirmed");
    expect(body.access_token).toBeUndefined();
  });
});

describe("password reset", () => {
  it("a valid emailed code lets the Account set a new password; the old one stops working", async () => {
    const email = await signUpAndVerify("reset");
    const code = await requestReset(email);

    const verified = await verifyReset(email, code);
    expect(verified.status).toBe(200);
    const { access_token } = await verified.json();

    const changed = await auth("user", { password: NEW_PASSWORD }, { token: access_token, method: "PUT" });
    expect(changed.status).toBe(200);

    expect((await login(email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(email, PASSWORD)).status).toBe(400);
  });

  it("choosing the old password is refused, but the verified session can still set a different one", async () => {
    const email = await signUpAndVerify("reset");
    const code = await requestReset(email);
    const { access_token } = await (await verifyReset(email, code)).json();

    const same = await auth("user", { password: PASSWORD }, { token: access_token, method: "PUT" });
    expect(same.status).toBe(422);
    expect((await same.json()).error_code).toBe("same_password");

    // The code was consumed by verification, so the retry must reuse the session, not the code.
    expect((await verifyReset(email, code)).status).toBe(403);
    const retry = await auth("user", { password: NEW_PASSWORD }, { token: access_token, method: "PUT" });
    expect(retry.status).toBe(200);
    expect((await login(email, NEW_PASSWORD)).status).toBe(200);
  });

  it("a password shorter than 8 characters is refused at sign-up", async () => {
    const res = await auth("signup", { email: newEmail("short"), password: "short12" });
    expect(res.status).toBe(422);
    expect((await res.json()).error_code).toBe("weak_password");
  });

  it("an invalid code is refused and the old password keeps working", async () => {
    const email = await signUpAndVerify("reset");
    const code = await requestReset(email);

    const bad = await verifyReset(email, code === "000000" ? "111111" : "000000");
    expect(bad.status).toBe(403);
    const body = await bad.json();
    expect(body.error_code).toBe("otp_expired");
    expect(body.access_token).toBeUndefined();

    expect((await login(email, PASSWORD)).status).toBe(200);
  });

  it("an expired code is refused, a fresh one works, and the old password keeps working meanwhile", async () => {
    const email = await signUpAndVerify("reset");
    const stale = await requestReset(email);
    await ageResetCode(email, PAST_OTP_EXPIRY);

    const refused = await verifyReset(email, stale);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error_code).toBe("otp_expired");
    expect((await login(email, PASSWORD)).status).toBe(200);

    // Control: a freshly requested code is accepted, so the refusal above was about age.
    await new Promise((r) => setTimeout(r, 1100)); // auth.email.max_frequency is 1s
    const fresh = await requestReset(email);
    expect((await verifyReset(email, fresh)).status).toBe(200);
  });

  it("the response does not reveal whether an email is registered, and nothing is sent to an unknown one", async () => {
    const known = await signUpAndVerify("reset");
    const unverified = newEmail("unverified");
    await auth("signup", { email: unverified, password: PASSWORD });
    const unknown = newEmail("nobody");

    const reference = await auth("recover", { email: known });
    expect(reference.status).toBe(200);
    const referenceBody = await reference.json();

    for (const email of [unverified, unknown]) {
      const res = await auth("recover", { email });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(referenceBody);
    }
    expect(await mailsSentTo(unknown, RESET_SUBJECT)).toBe(0);
  });
});
