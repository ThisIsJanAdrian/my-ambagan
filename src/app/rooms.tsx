"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AuditLog } from "./audit-log";

type Room = { id: string; creator_id: string; created_at: string };

const button = { display: "block", width: "100%", padding: 12, fontSize: 16, margin: "8px 0", boxSizing: "border-box", background: "#111", color: "#fff", border: 0 } as const;

/** The signed-in Account's home: create a Room and see every Room it belongs to. */
export function Rooms({ username }: { username: string }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [me, setMe] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [joined, setJoined] = useState(false);
  const [auditRoom, setAuditRoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data, error }, { data: auth }] = await Promise.all([
      supabase.from("rooms").select("id, creator_id, created_at").order("created_at", { ascending: false }),
      supabase.auth.getUser(),
    ]);
    if (error) return setMessage(error.message);
    setMe(auth.user?.id ?? "");
    setRooms(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("create_room");
    setBusy(false);
    if (error) return setMessage(error.message);
    await load();
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("join_room", { p_room_id: joinId });
    setBusy(false);
    if (error) return setMessage(error.message);
    const result = data?.[0];
    if (result && ["joined", "rejoined", "already_member"].includes(result.outcome)) setJoinId("");
    setJoined(Boolean(result && ["joined", "rejoined", "already_member"].includes(result.outcome)));
    setMessage(result?.message ?? "");
    await load();
  }

  async function leave(roomId: string) {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("leave_room", { p_room_id: roomId });
    setBusy(false);
    if (error) return setMessage(error.message);
    await load();
  }

  if (auditRoom) return <AuditLog roomId={auditRoom} onBack={() => setAuditRoom(null)} />;

  return (
    <main>
      <h1>Welcome, {username}!</h1>
      <button style={button} type="button" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create a Room"}
      </button>
      <form onSubmit={join}>
        <input
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          placeholder="Room ID, e.g. quick-snake-boots-power"
          aria-label="Room ID"
          autoCapitalize="none"
          style={{ display: "block", width: "100%", padding: 12, fontSize: 16, boxSizing: "border-box" }}
        />
        <button style={button} type="submit" disabled={busy || !joinId.trim()}>
          Join a Room
        </button>
      </form>
      {message && <p role="alert" style={{ color: joined ? "#0a6b2d" : "#b00020" }}>{message}</p>}
      <h2>Your Rooms</h2>
      {rooms === null && <p>Loading…</p>}
      {rooms?.length === 0 && <p>You are not in any Room yet.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {rooms?.map((room) => (
          <li key={room.id} style={{ padding: "12px 0", borderBottom: "1px solid #ddd" }}>
            <code style={{ fontSize: 16, wordBreak: "break-all" }}>{room.id}</code>
            {room.creator_id === me ? (
              <small> · you are the Creator</small>
            ) : (
              <button type="button" onClick={() => leave(room.id)} disabled={busy} style={{ marginLeft: 8 }}>
                Leave
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
