import { randomUUID } from "node:crypto";
import pg from "pg";

const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * The single test seam (ADR 0002): the database API, called as different
 * authenticated Accounts against a real local Postgres.
 * Each test runs in a transaction that is rolled back afterwards.
 */
export class Db {
  private constructor(private client: pg.Client) {}

  static async open(): Promise<Db> {
    const client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    await client.query("begin");
    return new Db(client);
  }

  async close() {
    await this.client.query("rollback");
    await this.client.end();
  }

  /** Create an Account the way Supabase Auth does (row in auth.users). */
  async createAccount(opts: { email?: string; verified?: boolean } = {}): Promise<Account> {
    const id = randomUUID();
    const email = opts.email ?? `${id}@example.test`;
    await this.client.query(
      `insert into auth.users (id, email, aud, role, email_confirmed_at)
       values ($1, $2, 'authenticated', 'authenticated', $3)`,
      [id, email, opts.verified === false ? null : new Date()],
    );
    return new Account(this, id, email);
  }

  /**
   * Run `fn` as the given authenticated Account (or anonymous when null).
   * Changes persist for the rest of the test unless `fn` throws, in which
   * case this call's changes are undone.
   */
  async as<T>(id: string | null, fn: (q: Query) => Promise<T>): Promise<T> {
    const sp = `sp_${randomUUID().replace(/-/g, "")}`;
    await this.client.query(`savepoint ${sp}`);
    try {
      await this.client.query(`set local role ${id ? "authenticated" : "anon"}`);
      await this.client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(id ? { sub: id, role: "authenticated" } : { role: "anon" }),
      ]);
      const result = await fn((text, params) => this.client.query(text, params));
      await this.client.query("reset role");
      await this.client.query(`release savepoint ${sp}`);
      return result;
    } catch (e) {
      await this.client.query(`rollback to savepoint ${sp}`);
      await this.client.query("reset role");
      throw e;
    }
  }
}

export type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

export class Account {
  constructor(
    private db: Db,
    readonly id: string,
    readonly email: string,
  ) {}

  /** Run a statement as this Account. */
  async run(text: string, params?: unknown[]) {
    return this.db.as(this.id, (q) => q(text, params));
  }

  async setUsername(username: string) {
    return this.run("select public.set_username($1)", [username]);
  }
}
