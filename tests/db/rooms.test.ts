import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "./harness";

const ROOM_ID_FORMAT = /^[a-z]{5}(-[a-z]{5}){3}$/;
const ROOMS_TO_CREATE = 25;
// Five-letter words that must never appear on the curated list.
const OFFENSIVE_FIVE_LETTER_WORDS = ["bitch", "whore", "pussy", "dildo", "nazis", "pedos", "rapes", "boobs", "penis", "cocks", "slutt", "fagot", "nigga", "wanks", "twats", "dykes", "spics", "chink"];

let db: Db;
beforeEach(async () => {
  db = await Db.open();
});
afterEach(async () => {
  await db.close();
});

describe("creating a Room", () => {
  it("a verified Account receives a Room ID of four hyphen-separated five-letter words", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    expect(roomId).toMatch(ROOM_ID_FORMAT);
  });

  it("records the creator as the Room's Creator and as its first Member", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    const room = await ana.run("select creator_id from public.rooms where id = $1", [roomId]);
    expect(room.rows).toEqual([{ creator_id: ana.id }]);
    const members = await ana.run("select account_id from public.room_members where room_id = $1", [roomId]);
    expect(members.rows).toEqual([{ account_id: ana.id }]);
  });

  it("an Account can create more than one Room, each with its own Room ID", async () => {
    const ana = await db.createAccountNamed("ana");
    const ids = new Set<string>();
    for (let i = 0; i < ROOMS_TO_CREATE; i++) ids.add(await ana.createRoom());
    expect(ids.size).toBe(ROOMS_TO_CREATE);
  });

  it("refuses an unverified Account", async () => {
    const unverified = await db.createAccount({ verified: false });
    await expect(unverified.createRoom()).rejects.toThrow(/verify your email/i);
  });

  it("refuses an Account that has not chosen a Username, and visitors who are not signed in", async () => {
    const nameless = await db.createAccount();
    await expect(nameless.createRoom()).rejects.toThrow(/username/i);
    await expect(db.as(null, (q) => q("select public.create_room()"))).rejects.toThrow(/permission denied/i);
  });
});

describe("seeing Rooms", () => {
  it("an Account sees every Room it belongs to, and no Rooms it does not belong to", async () => {
    const ana = await db.createAccountNamed("ana");
    const ben = await db.createAccountNamed("ben");
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
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    await expect(ana.run("delete from public.rooms where id = $1", [roomId])).rejects.toThrow(/permission denied/i);
    await expect(ana.run("insert into public.room_members (room_id, account_id) values ($1, $2)", [roomId, ana.id])).rejects.toThrow(/permission denied/i);
  });
});

describe("Room ID words", () => {
  it("come only from the curated list, which holds no offensive words", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    const list = await db.superuser("select word from public.room_words");
    const curated = new Set(list.rows.map((r) => r.word));
    for (const w of roomId.split("-")) expect(curated.has(w)).toBe(true);
    for (const w of curated) expect(OFFENSIVE_FIVE_LETTER_WORDS).not.toContain(w);
  });

  it("the curated list is all five-letter lowercase words and large enough that Room IDs are hard to guess", async () => {
    const list = await db.superuser("select word from public.room_words");
    expect(list.rows.length).toBeGreaterThanOrEqual(150);
    for (const { word } of list.rows) expect(word).toMatch(/^[a-z]{5}$/);
    await expect(db.superuser("insert into public.room_words (word) values ('Ab-cd')")).rejects.toThrow(/room_word_format/);
  });

  it("Room IDs are unique: a second Room can never take an ID already in use", async () => {
    const ana = await db.createAccountNamed("ana");
    const roomId = await ana.createRoom();
    await expect(
      db.superuser("insert into public.rooms (id, creator_id) values ($1, $2)", [roomId, ana.id]),
    ).rejects.toThrow(/duplicate key/i);
  });
});
