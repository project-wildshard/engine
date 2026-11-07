// E7.4: the SQL port. The server speaks `pg` over TCP, and a test speaks PGlite, which is real Postgres in-process.

/** What a query answers. */
export interface SqlResult { readonly rows: readonly unknown[] }
/** Statements on one connection. */
export interface Sql {
  query: (text: string, params?: readonly unknown[]) => Promise<SqlResult>;
  /** Several statements, with no parameters. */
  exec: (text: string) => Promise<void>;
}
/** A database: statements, transactions, and an end. */
export interface Database extends Sql {
  transaction: <Result>(work: (sql: Sql) => Promise<Result>) => Promise<Result>;
  close: () => Promise<void>;
}
