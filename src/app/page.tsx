"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

type Step = "signup" | "code" | "username" | "done";

const field = { display: "block", width: "100%", padding: 12, fontSize: 16, margin: "8px 0", boxSizing: "border-box" } as const;

export default function Home() {
  const [step, setStep] = useState<Step>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
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
    }
  }

  async function checkAvailability() {
    if (!username) return;
    const { data } = await supabase.rpc("username_available", { p_username: username });
    if (data === false) setMessage(`Username "${username}" is already taken.`);
  }

  if (step === "done") return <h1>Welcome, {username}!</h1>;

  return (
    <form onSubmit={submit}>
      <h1>MyAmbagan</h1>
      {step === "signup" && (
        <>
          <input style={field} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input style={field} type="password" placeholder="Password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
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
      {message && <p role="alert" style={{ color: "#b00020" }}>{message}</p>}
      <button style={{ ...field, background: "#111", color: "#fff", border: 0 }} type="submit">
        {step === "signup" ? "Sign up" : step === "code" ? "Verify" : "Continue"}
      </button>
    </form>
  );
}
