"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Member = { account_id: string; is_moderator: boolean; accounts: { username: string } | null };

const link = { background: "none", border: 0, padding: 0, color: "#06c", cursor: "pointer", font: "inherit" } as const;

/** A Room's Members, with the role actions each viewer is allowed to use. */
export function Members({ roomId, creatorId, me, onBack }: { roomId: string; creatorId: string; me: string; onBack: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("room_members")
      .select("account_id, is_moderator, accounts(username)")
      .eq("room_id", roomId)
      .order("joined_at");
    if (error) return setMessage(error.message);
    setMembers(data as unknown as Member[]);
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  const iAmCreator = me === creatorId;
  const iAmModerator = Boolean(members?.find((m) => m.account_id === me)?.is_moderator);

  async function act(fn: string, args: Record<string, string>) {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) setMessage(error.message);
    await load();
  }

  function promote(username: string) {
    const ok = window.confirm(
      `Promote ${username} to Moderator?\n\nThis cannot be undone by you. Only ${username} can step down; the only other way to remove a Moderator is to kick them.`,
    );
    if (ok) void act("promote_member", { p_room_id: roomId, p_username: username });
  }

  function kick(username: string) {
    if (window.confirm(`Kick ${username} from the Room? They can rejoin with the Room ID.`)) {
      void act("kick_member", { p_room_id: roomId, p_username: username });
    }
  }

  return (
    <section>
      <button type="button" onClick={onBack} style={link}>
        ← Back to Room
      </button>
      <h1>Members</h1>
      <p><code style={{ wordBreak: "break-all" }}>{roomId}</code></p>
      {message && <p role="alert" style={{ color: "#b00020" }}>{message}</p>}
      {members === null && !message && <p>Loading…</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {members?.map((m) => {
          const username = m.accounts?.username ?? "unknown";
          const isCreator = m.account_id === creatorId;
          const self = m.account_id === me;
          const canKick = !self && !isCreator && (iAmCreator || (iAmModerator && !m.is_moderator));
          return (
            <li key={m.account_id} style={{ padding: "12px 0", borderBottom: "1px solid #ddd" }}>
              <strong>{username}</strong>
              {self && " (you)"}
              {isCreator && <small> · Creator</small>}
              {m.is_moderator && <small> · Moderator</small>}
              <div style={{ marginTop: 6, display: "flex", gap: 16 }}>
                {iAmCreator && !isCreator && !m.is_moderator && (
                  <button type="button" style={link} disabled={busy} onClick={() => promote(username)}>
                    Promote to Moderator
                  </button>
                )}
                {self && m.is_moderator && (
                  <button type="button" style={link} disabled={busy} onClick={() => void act("demote_self", { p_room_id: roomId })}>
                    Step down as Moderator
                  </button>
                )}
                {canKick && (
                  <button type="button" style={{ ...link, color: "#b00020" }} disabled={busy} onClick={() => kick(username)}>
                    Kick
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
