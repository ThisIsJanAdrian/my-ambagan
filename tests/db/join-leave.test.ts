import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "./harness";

let db: Db;
beforeEach(async () => {
  db = await Db.open();
});
afterEach(async () => {
  await db.close();
});

const members = async (db: Db, roomId: string) =>
  (await db.superuser("select account_id from public.room_members where room_id = $1 and left_at is null", [roomId])).rows.length;

describe("joining a Room", () => {
  it("a verified Account entering a valid Room ID becomes a Member immediately", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    expect(await ben.tryJoin(roomId)).toMatchObject({ outcome: "joined" });
    expect((await ben.run("select id from public.rooms")).rows).toEqual([{ id: roomId }]);
    expect(await members(db, roomId)).toBe(2);
  });

  it("accepts a Room ID typed with different case or surrounding spaces", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    await ben.joinRoom(`  ${roomId.toUpperCase()} `);
    expect(await members(db, roomId)).toBe(2);
  });

  it("refuses an unknown Room ID with a clear message", async () => {
    const ben = await db.createAccountNamed("ben");
    expect(await ben.tryJoin("quick-snake-boots-power")).toEqual({
      outcome: "unknown_room",
      message: "No Room has that Room ID.",
    });
    expect((await ben.tryJoin("not a room id")).outcome).toBe("unknown_room");
  });

  it("refuses an unverified Account and an Account without a Username", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    const unverified = await db.createAccount({ verified: false });
    await expect(unverified.tryJoin(roomId)).rejects.toThrow(/verify your email/i);
    const nameless = await db.createAccount();
    await expect(nameless.tryJoin(roomId)).rejects.toThrow(/username/i);
    await expect(db.as(null, (q) => q("select * from public.join_room($1)", [roomId]))).rejects.toThrow(/permission denied/i);
  });

  it("a Room with ten current Members refuses new joiners; the eleventh is turned away", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    for (let i = 1; i < 10; i++) await (await db.createAccountNamed(`member${i}`)).joinRoom(roomId);
    expect(await members(db, roomId)).toBe(10);
    const late = await db.createAccountNamed("late");
    expect(await late.tryJoin(roomId)).toEqual({ outcome: "room_full", message: "This Room already has ten Members." });
    expect(await members(db, roomId)).toBe(10);
  });

  it("Members who left do not count toward the ten", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    const joiners = [];
    for (let i = 1; i < 10; i++) {
      const m = await db.createAccountNamed(`member${i}`);
      await m.joinRoom(roomId);
      joiners.push(m);
    }
    await joiners[0].leaveRoom(roomId);
    const late = await db.createAccountNamed("late");
    expect(await late.joinRoom(roomId)).toBe("joined");
    expect(await members(db, roomId)).toBe(10);
  });

  it("a former Member rejoining a full Room is refused too", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    const first = await db.createAccountNamed("first");
    await first.joinRoom(roomId);
    await first.leaveRoom(roomId);
    for (let i = 1; i < 10; i++) await (await db.createAccountNamed(`member${i}`)).joinRoom(roomId);
    expect((await first.tryJoin(roomId)).outcome).toBe("room_full");
  });

  it("joining a Room you are already in changes nothing", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    await ben.joinRoom(roomId);
    const before = (await db.superuser("select * from public.room_members where room_id = $1 order by account_id", [roomId])).rows;
    const logBefore = await ana.auditLog(roomId);
    expect((await ben.tryJoin(roomId)).outcome).toBe("already_member");
    expect((await ana.tryJoin(roomId)).outcome).toBe("already_member");
    expect((await db.superuser("select * from public.room_members where room_id = $1 order by account_id", [roomId])).rows).toEqual(before);
    expect(await ana.auditLog(roomId)).toEqual(logBefore);
  });
});

describe("leaving and rejoining", () => {
  it("a Member can leave; the Room disappears from their view and they can no longer read it", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    await ben.joinRoom(roomId);
    await ben.leaveRoom(roomId);
    expect((await ben.run("select id from public.rooms")).rows).toEqual([]);
    expect(await ben.auditLog(roomId)).toEqual([]);
    expect(await members(db, roomId)).toBe(1);
  });

  it("rejoining restores the same Member, not a new one", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    await ben.joinRoom(roomId);
    const first = (await db.superuser("select joined_at from public.room_members where room_id = $1 and account_id = $2", [roomId, ben.id])).rows;
    await ben.leaveRoom(roomId);
    expect(await ben.joinRoom(roomId)).toBe("rejoined");
    const all = (await db.superuser("select joined_at, left_at from public.room_members where room_id = $1 and account_id = $2", [roomId, ben.id])).rows;
    expect(all).toHaveLength(1);
    expect(all[0].joined_at).toEqual(first[0].joined_at);
    expect(all[0].left_at).toBeNull();
    expect((await ben.run("select id from public.rooms")).rows).toEqual([{ id: roomId }]);
  });

  it("leaving a Room you are not in is refused", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    await expect(ben.leaveRoom(roomId)).rejects.toThrow(/not a member/i);
    await ben.joinRoom(roomId);
    await ben.leaveRoom(roomId);
    await expect(ben.leaveRoom(roomId)).rejects.toThrow(/not a member/i);
  });

  it("the Creator cannot leave the Room", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    await expect(ana.leaveRoom(roomId)).rejects.toThrow(/creator cannot leave/i);
    expect(await members(db, roomId)).toBe(1);
  });

  it("Members cannot change membership rows directly through the API", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    await expect(ben.run("insert into public.room_members (room_id, account_id) values ($1, $2)", [roomId, ben.id])).rejects.toThrow(/permission denied/i);
    await expect(ana.run("update public.room_members set left_at = now() where room_id = $1", [roomId])).rejects.toThrow(/permission denied/i);
  });
});

describe("rate limiting failed joins", () => {
  it("an Account that keeps entering wrong Room IDs is rate-limited, even for a valid one", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    for (let i = 0; i < 5; i++) expect((await ben.tryJoin("quick-snake-boots-power")).outcome).toBe("unknown_room");
    const limited = await ben.tryJoin(roomId);
    expect(limited.outcome).toBe("rate_limited");
    expect(limited.message).toMatch(/too many/i);
    expect(await members(db, roomId)).toBe(1);
  });

  it("the limit is per Account, and old failures stop counting", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const cat = await db.createAccountNamed("cat");
    const roomId = await ana.createRoom();
    for (let i = 0; i < 5; i++) await ben.tryJoin("quick-snake-boots-power");
    expect((await ben.tryJoin(roomId)).outcome).toBe("rate_limited");
    expect(await cat.joinRoom(roomId)).toBe("joined");
    await db.keep("update public.join_attempts set attempted_at = now() - interval '1 hour' where account_id = $1", [ben.id]);
    expect(await ben.joinRoom(roomId)).toBe("joined");
  });

  it("successful joins do not count against the limit", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    const ben = await db.createAccountNamed("ben");
    for (let i = 0; i < 8; i++) await ben.tryJoin(roomId);
    expect((await ben.tryJoin(roomId)).outcome).toBe("already_member");
  });

  it("Accounts cannot read or write the attempts table", async () => {
    const ben = await db.createAccountNamed("ben");
    await expect(ben.run("select * from public.join_attempts")).rejects.toThrow(/permission denied/i);
  });
});

describe("Audit log", () => {
  it("records joins, leaves and rejoins with the Member's Username, in order", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    await ben.joinRoom(roomId);
    await ben.leaveRoom(roomId);
    await ben.joinRoom(roomId);
    const log = await ana.auditLog(roomId);
    expect(log.map((e) => [e.actor_username, e.event_type])).toEqual([
      ["ben", "member_rejoined"],
      ["ben", "member_left"],
      ["ben", "member_joined"],
      ["ana", "room_created"],
    ]);
  });

  it("failed joins and no-op joins write nothing to the Room's log", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
    const roomId = await ana.createRoom();
    await ben.tryJoin("quick-snake-boots-power");
    await ana.tryJoin(roomId);
    expect((await ana.auditLog(roomId)).map((e) => e.event_type)).toEqual(["room_created"]);
  });
});
