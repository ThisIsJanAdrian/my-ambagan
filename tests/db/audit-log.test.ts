import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "./harness";

let db: Db;
beforeEach(async () => {
  db = await Db.open();
});
afterEach(async () => {
  await db.close();
});

describe("Audit log", () => {
  it("creating a Room writes a 'Room created' entry with the Creator's Username and a timestamp", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    const log = await ana.auditLog(roomId);
    expect(log).toHaveLength(1);
    expect(log[0].actor_username).toBe("ana");
    expect(log[0].event_type).toBe("room_created");
    expect(log[0].created_at).toBeInstanceOf(Date);
  });

  it("returns entries newest first", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    await db.keep("insert into public.audit_log (room_id, actor_id, event_type, created_at) values ($1, $2, 'later_event', now() + interval '1 hour')", [roomId, ana.id]);
    const log = await ana.auditLog(roomId);
    expect(log.map((e) => e.event_type)).toEqual(["later_event", "room_created"]);
  });

  it("no one, including the Creator, can update or delete an entry through the API", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    await expect(ana.run("update public.audit_log set event_type = 'x' where room_id = $1", [roomId])).rejects.toThrow(/permission denied/i);
    await expect(ana.run("delete from public.audit_log where room_id = $1", [roomId])).rejects.toThrow(/permission denied/i);
    await expect(ana.run("insert into public.audit_log (room_id, actor_id, event_type) values ($1, $2, 'forged')", [roomId, ana.id])).rejects.toThrow(/permission denied/i);
    await expect(ana.run("select public.record_audit_event($1, $2, 'forged')", [roomId, ana.id])).rejects.toThrow(/permission denied/i);
  });

  it("the database refuses updates, deletes and truncates even from the table owner", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    await expect(db.superuser("update public.audit_log set event_type = 'x' where room_id = $1", [roomId])).rejects.toThrow(/append-only/i);
    await expect(db.superuser("delete from public.audit_log where room_id = $1", [roomId])).rejects.toThrow(/append-only/i);
    await expect(db.superuser("truncate public.audit_log")).rejects.toThrow(/append-only/i);
  });

  it("a non-Member and a former Member cannot read the log", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    expect(await ben.auditLog(roomId)).toEqual([]);
    expect(await ben.run("select * from public.audit_log where room_id = $1", [roomId]).then((r) => r.rows)).toEqual([]);
    await db.keep("insert into public.room_members (room_id, account_id) values ($1, $2)", [roomId, ben.id]);
    expect(await ben.auditLog(roomId)).toHaveLength(1);
    await db.keep("delete from public.room_members where room_id = $1 and account_id = $2", [roomId, ben.id]);
    expect(await ben.auditLog(roomId)).toEqual([]);
    await expect(db.as(null, (q) => q("select * from public.room_audit_log($1)", [roomId]))).rejects.toThrow(/permission denied/i);
  });

  it("entries from one Room are never visible in another", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const anaRoom = await ana.createRoom();
    const benRoom = await ben.createRoom();
    expect((await ana.auditLog(anaRoom)).map((e) => e.actor_username)).toEqual(["ana"]);
    expect((await ben.auditLog(benRoom)).map((e) => e.actor_username)).toEqual(["ben"]);
    expect(await ana.auditLog(benRoom)).toEqual([]);
    const all = await ana.run("select room_id from public.audit_log");
    expect(all.rows).toEqual([{ room_id: anaRoom }]);
  });

  it("entries keep showing the actor's Username, which can never be changed", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    await expect(db.superuser("update public.accounts set username = 'renamed' where id = $1", [ana.id])).rejects.toThrow();
    expect((await ana.auditLog(roomId))[0].actor_username).toBe("ana");
  });
});
