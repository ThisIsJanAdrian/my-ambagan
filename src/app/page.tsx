"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Rooms } from "./rooms";

type Step = "signup" | "code" | "username" | "done" | "login" | "reset-request" | "reset-code" | "reset-password";

const field = { display: "block", width: "100%", padding: 12, fontSize: 16, margin: "8px 0", boxSizing: "border-box" } as const;
const linkButton = { background: "none", border: 0, padding: 0, color: "#06c", textDecoration: "underline", cursor: "pointer", font: "inherit" } as const;

const SUBMIT_LABEL: Record<Step, string> = {
  signup: "Sign up",
  code: "Verify",
  username: "Continue",
  done: "",
  login: "Log in",
  "reset-request": "Send reset code",
  "reset-code": "Verify code",
  "reset-password": "Set new password",
};

export default function Home() {
  const [step, setStep] = useState<Step>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState("");

  function go(next: Step) {
    // Abandoning a half-finished reset: drop the session its code created.
    if (step === "reset-password") void supabase.auth.signOut();
    setMessage("");
    setNotice("");
    setPassword("");
    setConfirm("");
    setCode("");
    setStep(next);
  }

  /** After a successful sign-in: straight in if the Account has a Username, otherwise choose one first. */
  async function enter(userId: string) {
    const { data } = await supabase.from("accounts").select("username").eq("id", userId).maybeSingle();
    if (data?.username) {
      setUsername(data.username);
      setStep("done");
    } else {
      setStep("username");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setNotice("");
    if (step === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) return setMessage(error.message);
      setStep("code");
    } else if (step === "code") {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
      if (error) return setMessage("That code is wrong or has expired.");
      setStep("username");
    } else if (step === "username") {
      const { error } = await supabase.rpc("set_username", { p_username: username });
      if (error) return setMessage(error.message);
      setStep("done");
    } else if (step === "login") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        // Deliberately the same for a wrong password, an unknown email or an unverified sign-up.
        return setMessage("Email or password is incorrect, or the email has not been verified yet.");
      }
      await enter(data.user.id);
    } else if (step === "reset-request") {
      await supabase.auth.resetPasswordForEmail(email);
      // Same answer whether or not the email is registered.
      setStep("reset-code");
      setNotice(`If ${email} is registered, we emailed it a 6-digit code.`);
    } else if (step === "reset-code") {
      // Accepting the code uses it up and starts a session; the password is set on the next screen.
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });
      if (error) return setMessage("That code is wrong or has expired. Your old password still works.");
      setCode("");
      setStep("reset-password");
    } else if (step === "reset-password") {
      if (password !== confirm) return setMessage("The two passwords do not match.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return setMessage(error.message);
      const { data } = await supabase.auth.getUser();
      if (data.user) await enter(data.user.id);
    }
  }

  async function checkAvailability() {
    if (!username) return;
    const { data } = await supabase.rpc("username_available", { p_username: username });
    if (data === false) setMessage(`Username "${username}" is already taken.`);
  }

  if (step === "done") return <Rooms username={username} />;

  const emailField = (
    <input style={field} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
  );
  const passwordField = (placeholder: string) => (
    <input style={field} type="password" placeholder={placeholder} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
  );

  const emailField = (
    <input style={field} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
  );
  const passwordField = (placeholder: string) => (
    <input style={field} type="password" placeholder={placeholder} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
  );

  return (
    <form onSubmit={submit}>
      <h1>MyAmbagan</h1>
      {step === "signup" && (
        <>
          {emailField}
          {passwordField("Password")}
        </>
      )}
      {step === "login" && (
        <>
          {emailField}
          {passwordField("Password")}
        </>
      )}
      {step === "reset-request" && (
        <>
          <p>Enter your email and we will send you a code to reset your password.</p>
          {emailField}
        </>
      )}
      {step === "reset-code" && (
        <input style={field} inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
      )}
      {step === "reset-password" && (
        <>
          <p>Code accepted. Choose your new password.</p>
          {passwordField("New password")}
          <input style={field} type="password" placeholder="Confirm new password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </>
      )}
      {step === "code" && (
        <>
          <p>We emailed a 6-digit code to {email}.</p>
          <input style={field} inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
        </>
      )}
      {step === "username" && (
        <>
          <p>Choose your Username. It is permanent.</p>
          <input
            style={field}
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={checkAvailability}
            required
          />
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {message && <p role="alert" style={{ color: "#b00020" }}>{message}</p>}
      <button style={{ ...field, background: "#111", color: "#fff", border: 0 }} type="submit">
        {SUBMIT_LABEL[step]}
      </button>
      <p>
        {step === "signup" && (
          <button type="button" style={linkButton} onClick={() => go("login")}>Already have an account? Log in</button>
        )}
        {step === "login" && (
          <>
            <button type="button" style={linkButton} onClick={() => go("signup")}>Create an account</button>
            {" · "}
            <button type="button" style={linkButton} onClick={() => go("reset-request")}>Forgot password?</button>
          </>
        )}
        {(step === "reset-request" || step === "reset-code" || step === "reset-password") && (
          <button type="button" style={linkButton} onClick={() => go("login")}>Back to log in</button>
        )}
      </p>
    </form>
  );
}
