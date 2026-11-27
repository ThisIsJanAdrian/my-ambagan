import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "./harness";

let db: Db;
beforeEach(async () => {
  db = await Db.open();
});
afterEach(async () => {
  await db.close();
});

describe("creating a Room", () => {
  it("a verified Account receives a Room ID of four hyphen-separated five-letter words", async () => {
    const ana = await db.createAccount();
    await ana.setUsername("ana");
    const roomId = await ana.createRoom();
    expect(roomId).toMatch(/^[a-z]{5}(-[a-z]{5}){3}$/);
  });

  it("records the creator as the Room's Creator and as its first Member", async () => {
    const ana = await db.createAccount();
    await ana.setUsername("ana");
    const roomId = await ana.createRoom();
    const room = await ana.run("select creator_id from public.rooms where id = $1", [roomId]);
    expect(room.rows).toEqual([{ creator_id: ana.id }]);
    const members = await ana.run("select account_id from public.room_members where room_id = $1", [roomId]);
    expect(members.rows).toEqual([{ account_id: ana.id }]);
  });

  it("an Account can create more than one Room, each with its own Room ID", async () => {
    const ana = await db.createAccount();
    await ana.setUsername("ana");
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) ids.add(await ana.createRoom());
    expect(ids.size).toBe(25);
  });

  it("refuses an unverified or Username-less Account", async () => {
    const unverified = await db.createAccount({ verified: false });
    await expect(unverified.createRoom()).rejects.toThrow(/./);
    const nameless = await db.createAccount();
    await expect(nameless.createRoom()).rejects.toThrow(/username/i);
    await expect(db.as(null, (q) => q("select public.create_room()"))).rejects.toThrow(/permission denied/i);
  });
});

describe("seeing Rooms", () => {
  it("an Account sees every Room it belongs to, and no Rooms it does not belong to", async () => {
    const ana = await db.createAccount();
    const ben = await db.createAccount();
    await ana.setUsername("ana");
    await ben.setUsername("ben");
    const a1 = await ana.createRoom();
    const a2 = await ana.createRoom();
    const b1 = await ben.createRoom();
    const ids = async (who: typeof ana) =>
      (await who.run("select id from public.rooms")).rows.map((r) => r.id).sort();
    expect(await ids(ana)).toEqual([a1, a2].sort());
    expect(await ids(ben)).toEqual([b1]);
    const others = await ana.run("select * from public.room_members where room_id = $1", [b1]);
    expect(others.rows).toEqual([]);
  });

  it("Rooms and memberships cannot be written directly", async () => {
    const ana = await db.createAccount();
    await ana.setUsername("ana");
    const roomId = await ana.createRoom();
    await expect(ana.run("delete from public.rooms where id = $1", [roomId])).rejects.toThrow(/permission denied/i);
    await expect(ana.run("insert into public.room_members (room_id, account_id) values ($1, $2)", [roomId, ana.id])).rejects.toThrow(/permission denied/i);
  });
});

describe("Room ID words", () => {
  it("come only from the curated list, which holds no offensive words", async () => {
    const ana = await db.createAccount();
    await ana.setUsername("ana");
    const roomId = await ana.createRoom();
    const list = await db.superuser("select word from public.room_words");
    const curated = new Set(list.rows.map((r) => r.word));
    for (const w of roomId.split("-")) expect(curated.has(w)).toBe(true);
    const blocked = ["shit", "fuck", "bitch", "whore", "slut", "dick", "cunt", "nigga", "pussy", "bitchy", "rapes", "pedos", "nazis", "penis", "boobs", "cocks", "damns", "hells", "fagot", "dildo", "anals", "tards"];
    for (const w of curated) expect(blocked).not.toContain(w);
  });

  it("are all distinct five-letter words, enough that Room IDs are practically unguessable", async () => {
    const list = await db.superuser("select word from public.room_words");
    expect(list.rows.length).toBeGreaterThanOrEqual(150);
  });

  it("Room IDs are unique: a second Room can never take an ID already in use", async () => {
    const ana = await db.createAccount();
    await ana.setUsername("ana");
    const roomId = await ana.createRoom();
    await expect(
      db.superuser("insert into public.rooms (id, creator_id) values ($1, $2)", [roomId, ana.id]),
    ).rejects.toThrow(/duplicate key/i);
  });
});
