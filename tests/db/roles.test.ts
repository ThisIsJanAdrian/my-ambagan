import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Account, Db } from "./harness";

let db: Db;
beforeEach(async () => {
  db = await Db.open();
});
afterEach(async () => {
  await db.close();
});

const isMember = async (roomId: string, a: Account) =>
  (await db.superuser("select 1 from public.room_members where room_id = $1 and account_id = $2 and left_at is null", [roomId, a.id])).rows.length === 1;

/** A Room with a Creator (ana), a regular Member (ben) and a Moderator (cat). */
async function setup() {
  const ana = await db.createAccountNamed("ana");
  const ben = await db.createAccountNamed("ben");
  const cat = await db.createAccountNamed("cat");
  const roomId = await ana.createRoom();
  await ben.joinRoom(roomId);
  await cat.joinRoom(roomId);
  await ana.promote(roomId, "cat");
  return { ana, ben, cat, roomId };
}

describe("promoting", () => {
  it("the Creator can promote a regular Member to Moderator", async () => {
    const { ana, ben, roomId } = await setup();
    await ana.promote(roomId, "ben");
    // A new Moderator can now kick a regular Member.
    const dan = await db.createAccountNamed("dan");
    await dan.joinRoom(roomId);
    await ben.kick(roomId, "dan");
    expect(await isMember(roomId, dan)).toBe(false);
  });

  it("a regular Member or a Moderator cannot promote", async () => {
    const { ben, cat, roomId } = await setup();
    const dan = await db.createAccountNamed("dan");
    await dan.joinRoom(roomId);
    await expect(ben.promote(roomId, "dan")).rejects.toThrow(/only the creator can promote/i);
    await expect(cat.promote(roomId, "dan")).rejects.toThrow(/only the creator can promote/i);
  });

  it("refuses promoting the Creator, an existing Moderator, a non-Member or an unknown Username", async () => {
    const { ana, roomId } = await setup();
    await db.createAccountNamed("dan");
    await expect(ana.promote(roomId, "ana")).rejects.toThrow(/already/i);
    await expect(ana.promote(roomId, "cat")).rejects.toThrow(/already/i);
    await expect(ana.promote(roomId, "dan")).rejects.toThrow(/not a member/i);
    await expect(ana.promote(roomId, "nobody")).rejects.toThrow(/not a member/i);
  });

  it("someone outside the Room cannot promote", async () => {
    const { roomId } = await setup();
    const eve = await db.createAccountNamed("eve");
    await expect(eve.promote(roomId, "ben")).rejects.toThrow(/only the creator can promote/i);
  });
});

describe("demoting", () => {
  it("a Moderator can demote themselves, and then loses Moderator powers", async () => {
    const { ben, cat, roomId } = await setup();
    await cat.demoteSelf(roomId);
    await expect(cat.kick(roomId, "ben")).rejects.toThrow(/cannot kick/i);
    expect(await isMember(roomId, ben)).toBe(true);
  });

  it("the Creator and regular Members cannot demote anyone; a Moderator stays one", async () => {
    const { ana, ben, roomId } = await setup();
    // demote_self only ever acts on the caller, so there is no way to demote someone else.
    await expect(ana.demoteSelf(roomId)).rejects.toThrow(/only a moderator can demote/i);
    await expect(ben.demoteSelf(roomId)).rejects.toThrow(/only a moderator can demote/i);
    await expect(ana.promote(roomId, "cat")).rejects.toThrow(/already/i);
  });

  it("a demoted Moderator can be promoted again by the Creator", async () => {
    const { ana, cat, roomId } = await setup();
    await cat.demoteSelf(roomId);
    await ana.promote(roomId, "cat");
    await cat.demoteSelf(roomId);
  });
});

describe("kicking", () => {
  it("the Creator can kick a regular Member or a Moderator", async () => {
    const { ana, ben, cat, roomId } = await setup();
    await ana.kick(roomId, "ben");
    await ana.kick(roomId, "cat");
    expect(await isMember(roomId, ben)).toBe(false);
    expect(await isMember(roomId, cat)).toBe(false);
  });

  it("the Creator cannot kick themselves", async () => {
    const { ana, roomId } = await setup();
    await expect(ana.kick(roomId, "ana")).rejects.toThrow(/creator cannot be kicked/i);
    expect(await isMember(roomId, ana)).toBe(true);
  });

  it("a Moderator can kick a regular Member but not the Creator or another Moderator", async () => {
    const { ana, ben, cat, roomId } = await setup();
    const dan = await db.createAccountNamed("dan");
    await dan.joinRoom(roomId);
    await ana.promote(roomId, "dan");
    await expect(cat.kick(roomId, "ana")).rejects.toThrow(/cannot kick/i);
    await expect(cat.kick(roomId, "dan")).rejects.toThrow(/cannot kick/i);
    await expect(cat.kick(roomId, "cat")).rejects.toThrow(/cannot kick/i);
    await cat.kick(roomId, "ben");
    expect(await isMember(roomId, ben)).toBe(false);
    expect(await isMember(roomId, ana)).toBe(true);
  });

  it("a regular Member cannot kick anyone", async () => {
    const { ben, cat, roomId } = await setup();
    const dan = await db.createAccountNamed("dan");
    await dan.joinRoom(roomId);
    await expect(ben.kick(roomId, "dan")).rejects.toThrow(/cannot kick/i);
    await expect(ben.kick(roomId, "cat")).rejects.toThrow(/cannot kick/i);
    expect(await isMember(roomId, dan)).toBe(true);
    expect(await isMember(roomId, cat)).toBe(true);
  });

  it("refuses kicking someone who is not a Member, and an outsider kicking", async () => {
    const { ana, roomId } = await setup();
    const eve = await db.createAccountNamed("eve");
    await expect(ana.kick(roomId, "eve")).rejects.toThrow(/not a member/i);
    await expect(ana.kick(roomId, "nobody")).rejects.toThrow(/not a member/i);
    await expect(eve.kick(roomId, "ben")).rejects.toThrow(/cannot kick/i);
  });

  it("a kicked Member loses access and can rejoin with the Room ID, as a regular Member", async () => {
    const { ana, ben, cat, roomId } = await setup();
    await ana.kick(roomId, "ben");
    expect((await ben.run("select id from public.rooms")).rows).toEqual([]);
    expect(await ben.auditLog(roomId)).toEqual([]);
    expect(await ben.joinRoom(roomId)).toBe("rejoined");
    expect(await isMember(roomId, ben)).toBe(true);
    // A kicked Moderator comes back without Moderator powers.
    await ana.kick(roomId, "cat");
    await cat.joinRoom(roomId);
    await expect(cat.kick(roomId, "ben")).rejects.toThrow(/cannot kick/i);
  });

  it("a full Room refuses a kicked Member's return", async () => {
    const { ana, ben, roomId } = await setup();
    await ana.kick(roomId, "ben");
    for (let i = 0; i < 8; i++) await (await db.createAccountNamed(`mem${i}`)).joinRoom(roomId);
    expect((await ben.tryJoin(roomId)).outcome).toBe("room_full");
  });

  it("a Moderator who leaves and rejoins is a regular Member again", async () => {
    const { cat, roomId } = await setup();
    await cat.leaveRoom(roomId);
    await cat.joinRoom(roomId);
    await expect(cat.kick(roomId, "ben")).rejects.toThrow(/cannot kick/i);
  });
});

describe("direct access", () => {
  it("Members cannot change roles through the tables, and anonymous callers cannot use the functions", async () => {
    const { ben, roomId } = await setup();
    await expect(ben.run("update public.room_members set is_moderator = true where room_id = $1", [roomId])).rejects.toThrow(/permission denied/i);
    await expect(db.as(null, (q) => q("select public.kick_member($1, 'ben')", [roomId]))).rejects.toThrow(/permission denied/i);
    await expect(db.as(null, (q) => q("select public.promote_member($1, 'ben')", [roomId]))).rejects.toThrow(/permission denied/i);
    await expect(db.as(null, (q) => q("select public.demote_self($1)", [roomId]))).rejects.toThrow(/permission denied/i);
  });
});

describe("Audit log", () => {
  it("records promotion, demotion and kick with who acted and who was affected", async () => {
    const { ana, cat, roomId } = await setup();
    await cat.kick(roomId, "ben");
    await cat.demoteSelf(roomId);
    const log = await ana.auditLog(roomId);
    expect(log.slice(0, 3).map((e) => [e.actor_username, e.event_type, e.target_username])).toEqual([
      ["cat", "moderator_demoted", "cat"],
      ["cat", "member_kicked", "ben"],
      ["ana", "member_promoted", "cat"],
    ]);
  });

  it("refused attempts write nothing to the log", async () => {
    const { ben, roomId } = await setup();
    const before = await ben.auditLog(roomId);
    await expect(ben.kick(roomId, "cat")).rejects.toThrow();
    await expect(ben.promote(roomId, "ben")).rejects.toThrow();
    expect(await ben.auditLog(roomId)).toEqual(before);
  });
});
