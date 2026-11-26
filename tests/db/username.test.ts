import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "./harness";

let db: Db;
beforeEach(async () => {
  db = await Db.open();
});
afterEach(async () => {
  await db.close();
});

describe("choosing a Username", () => {
  it("a verified Account can choose a valid Username", async () => {
    const ana = await db.createAccount();
    await ana.setUsername("ana.reyes_01-x");
    const { rows } = await ana.run("select username from public.profiles where id = $1", [ana.id]);
    expect(rows).toEqual([{ username: "ana.reyes_01-x" }]);
  });

  it.each(["Ana", "ana reyes", "ana@home", "", "añá", "ab"])(
    "refuses invalid Username %j with a clear message",
    async (bad) => {
      const ana = await db.createAccount();
      await expect(ana.setUsername(bad)).rejects.toThrow(/username/i);
    },
  );

  it("refuses a taken Username, whatever the letter case of the attempt", async () => {
    const ana = await db.createAccount();
    const ben = await db.createAccount();
    await ana.setUsername("ana");
    await expect(ben.setUsername("ana")).rejects.toThrow(/already taken/i);
    await expect(ben.setUsername("ANA")).rejects.toThrow(/username/i);
  });

  it("tells a visitor immediately whether a Username is available", async () => {
    const ana = await db.createAccount();
    await ana.setUsername("ana");
    const check = (u: string) =>
      db.as(null, (q) => q("select public.username_available($1) as ok", [u])).then((r) => r.rows[0].ok);
    expect(await check("ana")).toBe(false);
    expect(await check("ANA")).toBe(false);
    expect(await check("ben")).toBe(true);
  });

  it("refuses an unverified Account", async () => {
    const ana = await db.createAccount({ verified: false });
    await expect(ana.setUsername("ana")).rejects.toThrow(/verify your email/i);
  });

  it("cannot be changed once set, by the owner or anyone else", async () => {
    const ana = await db.createAccount();
    const ben = await db.createAccount();
    await ana.setUsername("ana");
    await expect(ana.setUsername("ana2")).rejects.toThrow(/cannot be changed/i);
    await ana.run("update public.profiles set username = 'x1x' where id = $1", [ana.id]).catch(() => {});
    await ben.run("update public.profiles set username = 'x1x' where id = $1", [ana.id]).catch(() => {});
    await ana.run("delete from public.profiles where id = $1", [ana.id]).catch(() => {});
    const { rows } = await ben.run("select username from public.profiles where id = $1", [ana.id]);
    expect(rows).toEqual([{ username: "ana" }]);
  });
});

describe("privacy", () => {
  it("another Account can see a Username but never an email address", async () => {
    const ana = await db.createAccount({ email: "ana.secret@example.test" });
    const ben = await db.createAccount();
    await ana.setUsername("ana");
    const seen = await ben.run("select * from public.profiles where id = $1", [ana.id]);
    expect(seen.rows).toHaveLength(1);
    expect(JSON.stringify(seen.rows)).not.toContain("ana.secret");
    await expect(ben.run("select email from auth.users where id = $1", [ana.id])).rejects.toThrow(/permission denied/i);
  });
});
