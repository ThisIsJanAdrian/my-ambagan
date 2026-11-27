"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Entry = { id: number; actor_username: string; event_type: string; target_username: string | null; created_at: string };

/** One plain sentence per event, e.g. "ana joined". Unknown event types fall back to a readable form of the type. */
function describe({ actor_username: actor, event_type, target_username: target }: Entry) {
  switch (event_type) {
    case "room_created": return `${actor} created the Room`;
    case "member_joined": return `${actor} joined`;
    case "member_rejoined": return `${actor} rejoined`;
    case "member_left": return `${actor} left`;
    case "member_promoted": return `${actor} promoted ${target ?? "a Member"} to Moderator`;
    case "member_kicked": return `${actor} kicked ${target ?? "a Member"}`;
    case "moderator_demoted": return `${actor} stepped down as Moderator`;
    default: return `${actor}: ${event_type.replace(/_/g, " ")}`;
  }
}

/** A Room's Audit log, newest first. Opened from the Room's menu, never part of the main feed. */
export function AuditLog({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("room_audit_log", { p_room_id: roomId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) return setMessage(error.message);
      setEntries(data as Entry[]);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return (
    <section>
      <button type="button" onClick={onBack} style={{ background: "none", border: 0, padding: 0, color: "#06c", cursor: "pointer", font: "inherit" }}>
        ← Back to Room
      </button>
      <h1>Audit log</h1>
      <p><code style={{ wordBreak: "break-all" }}>{roomId}</code></p>
      {message && <p role="alert" style={{ color: "#b00020" }}>{message}</p>}
      {entries === null && !message && <p>Loading…</p>}
      {entries?.length === 0 && <p>Nothing has happened in this Room yet.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {entries?.map((entry) => (
          <li key={entry.id} style={{ padding: "12px 0", borderBottom: "1px solid #ddd" }}>
            <div>{describe(entry)}</div>
            <small>{new Date(entry.created_at).toLocaleString()}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
