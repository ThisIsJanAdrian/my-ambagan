"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Entry = { id: number; actor_username: string; event_type: string; created_at: string };

const EVENT_LABELS: Record<string, string> = {
  room_created: "Room created",
};

/** "some_event" -> "Some event" for event types this screen has no wording for yet. */
function describe(eventType: string) {
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
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
        ← Back to Rooms
      </button>
      <h1>Audit log</h1>
      <p><code style={{ wordBreak: "break-all" }}>{roomId}</code></p>
      {message && <p role="alert" style={{ color: "#b00020" }}>{message}</p>}
      {entries === null && !message && <p>Loading…</p>}
      {entries?.length === 0 && <p>Nothing has happened in this Room yet.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {entries?.map((entry) => (
          <li key={entry.id} style={{ padding: "12px 0", borderBottom: "1px solid #ddd" }}>
            <div>{describe(entry.event_type)}</div>
            <small>
              {entry.actor_username} · {new Date(entry.created_at).toLocaleString()}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
