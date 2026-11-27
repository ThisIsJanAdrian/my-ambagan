"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AuditLog } from "./audit-log";
import { Members } from "./members";

const link = { background: "none", border: 0, padding: 0, color: "#06c", cursor: "pointer", font: "inherit" } as const;
const menuItem = { display: "block", width: "100%", padding: 12, fontSize: 16, textAlign: "left", background: "none", border: 0, borderBottom: "1px solid #ddd", cursor: "pointer" } as const;

const POLL_MS = 5000;

type View = "room" | "members" | "audit";

/** The place that is the Room: its ID, the viewer's role, a menu of Room-level actions, and (later) the feed. */
export function Room({ roomId, creatorId, me, onBack, onKicked }: {
  roomId: string;
  creatorId: string;
  me: string;
  onBack: () => void;
  onKicked: () => void;
}) {
  const [view, setView] = useState<View>("room");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const left = useRef(false);

  const iAmCreator = me === creatorId;

  // Membership check: reads only my own row, and sends me home if it is gone (kicked while the Room is open).
  const check = useCallback(async () => {
    if (!me) return;
    const { data, error } = await supabase
      .from("room_members")
      .select("is_moderator")
      .eq("room_id", roomId)
      .eq("account_id", me)
      .maybeSingle();
    if (error) return;
    if (!data && !left.current) return onKicked();
    if (!data) return;
    setIsModerator(data.is_moderator);
  }, [roomId, me, onKicked]);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [check]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Could not copy; select the Room ID and copy it by hand.");
    }
  }

  async function leave() {
    if (!window.confirm("Leave this Room? You can rejoin with the Room ID.")) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("leave_room", { p_room_id: roomId });
    setBusy(false);
    if (error) return setMessage(error.message);
    left.current = true;
    onBack();
  }

  function open(next: View) {
    setMenuOpen(false);
    setView(next);
  }

  const backToRoom = () => {
    setView("room");
    void check();
  };

  if (view === "members") return <Members roomId={roomId} creatorId={creatorId} me={me} onBack={backToRoom} />;
  if (view === "audit") return <AuditLog roomId={roomId} onBack={backToRoom} />;

  const role = iAmCreator ? "Creator" : isModerator ? "Moderator" : "Member";

  return (
    <section>
      <button type="button" onClick={onBack} style={link}>
        ← Back to Rooms
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, position: "relative" }}>
        <h1 style={{ fontSize: 20, wordBreak: "break-all" }}>{roomId}</h1>
        <button type="button" aria-label="Room menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} style={{ fontSize: 24, padding: "4px 12px", marginTop: 16 }}>
          ⋯
        </button>
        {menuOpen && (
          <div role="menu" style={{ position: "absolute", right: 0, top: "100%", background: "#fff", border: "1px solid #ddd", minWidth: 180, zIndex: 1 }}>
            <button role="menuitem" type="button" style={menuItem} onClick={() => open("members")}>Members</button>
            <button role="menuitem" type="button" style={menuItem} onClick={() => open("audit")}>Audit log</button>
            {!iAmCreator && (
              <button role="menuitem" type="button" style={{ ...menuItem, color: "#b00020" }} disabled={busy} onClick={() => { setMenuOpen(false); void leave(); }}>
                Leave
              </button>
            )}
          </div>
        )}
      </div>
      <p>
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy Room ID"}</button>
        <small style={{ marginLeft: 8 }}>You are {role === "Member" ? "a regular Member" : `the ${role}`}</small>
      </p>
      {message && <p role="alert" style={{ color: "#b00020" }}>{message}</p>}
      {/* Feed slot: #009 and #012 replace this empty state. */}
      <div data-slot="feed" style={{ padding: "32px 0", textAlign: "center", color: "#666" }}>
        <p>Nothing posted yet</p>
      </div>
    </section>
  );
}
