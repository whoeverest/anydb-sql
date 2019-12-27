import * as Promise from 'bluebird';

export type DBBigInt = string;

export type DBDecimal = string;

interface AnyDBPool extends DatabaseConnection {
  query: (text: string, values: any[], callback: (err: Error, result: any) => void) => void;
  begin: () => Transaction;
  close: (err: Error) => void;
}

export interface OrderByValueNode {}

interface MaybeNamed<Name extends string> {
  name?: Name;
}

interface Named<Name extends string> {
  name: Name;
}

export type CastMappings = {
  text: string;
  bigint: DBBigInt;
  int: number;
  date: Date;
  decimal: DBDecimal;
};

export interface ColumnDefinition<Name extends string, Type> extends MaybeNamed<Name> {
  primaryKey?: boolean;

  /**
   * Datatype as specified by the concrete database dialect
   */
  dataType?: string;
  references?: { table: string; column: string };
  notNull?: boolean;
  unique?: boolean | string;
  defaultValue?: Type;
}

export interface TableDefinition<Name extends string, Row> {
  /**
   * Name of the table as specified in the database
   */
  name: Name;

  /**
   * Object containing all the columns.
   */
  columns: { [CName in keyof Row]: CName extends string ? ColumnDefinition<CName, Row[CName]> : never };
  has?: { [key: string]: { from: string; many?: boolean } };
}

export interface QueryLike {
  query: string;
  values: any[];
  text: string;
}

export interface DatabaseConnection {
  queryAsync<T>(query: string, ...params: any[]): Promise<{ rowCount: number; rows: T[] }>;
  queryAsync<T>(query: QueryLike): Promise<{ rowCount: number; rows: T[] }>;
}

export interface Transaction extends DatabaseConnection {
  rollbackAsync(): Promise<void>;
  commitAsync(): Promise<void>;
}

interface Executable<T> {
  /**
   * Get the first result row from the list, if any.
   * @return a promise of the result, null if a row doesn't exist
   */
  get(): Promise<T>;

  /**
   * Get the first result row from the list from within a transaction.
   * @return a promise of the result, null if a row doesn't exist
   */
  getWithin(tx: DatabaseConnection): Promise<T>;

  /**
   * Run the query, discarding any results if present
   */
  exec(): Promise<void>;

  /**
   * Run the query and get all the results
   * @return a promise for the list of results
   */
  all(): Promise<T[]>;

  /**
   * Execute the query within a transaction, discarding all results
   */
  execWithin(tx: DatabaseConnection): Promise<void>;

  /**
   * Run the query from within a transaction and get all the results
   * @return a promise for the list of results
   */
  allWithin(tx: DatabaseConnection): Promise<T[]>;

  /**
   * Convert the query to a Query object with the SQL text and arguments
   */
  toQuery(): QueryLike;
}
type TupleUnion<C extends any[]> = C[keyof C & number];

type ColumnNames<C extends any[]> = TupleUnion<
  { [K in keyof C]: C[K] extends Column<infer Name, infer Value> ? Name : never }
>;

type FindColumnWithName<Name extends string, C extends Column<any, any>[]> = TupleUnion<
  { [K in keyof C]: C[K] extends Column<Name, infer Value> ? Value : never }
>;

type RowOf<Cols extends any[]> = { [K in ColumnNames<Cols>]: FindColumnWithName<K, Cols> };

type WhereCondition<T> = BinaryNode | BinaryNode[] | Partial<T>;

interface Queryable<T> {
  /**
   * Change the resultset source. You may use a join of multiple tables
   *
   * Note that this method doesn't change the filtering (where) or projection (select) source, so
   * any results returned or filters applied will be of the original table or resultset
   */
  from(table: TableNode): Query<T>;
  from(statement: string): Query<T>;

  /**
   * Filter the results by the specified conditions. If multiple conditions are passed, they will
   * be joined with AND. A condition may either be a BinaryNode SQL expression, or an object that
   * contains the column names and their desired values e.g. `where({ email: "example@test.com" })`
   * @param nodes either boolean-evaluating conditional expressions or an object
   * @example
   * ```
   * users.where({email: "example@test.com"})
   * users.where(user.primaryEmail.equals(user.secondaryEmail))
   * ```
   */
  where(...nodes: WhereCondition<T>[]): Query<T>;
  /**
   * Create a delete query
   */
  delete(): ModifyingQuery<T>;
  /**
   * Get one or more specific columns from the result set.
   *
   * Only use this method only after `from` and `where`, otherwise you will be modifying the result
   * set shape.
   *
   * You may use multiple columns from several different tables as long as those tables have been
   * joined in a previous `from` call.
   *
   * In addition you may pass aggregate columns as well as rename columns to have different names
   * in the final result set.
   */
  select(): Query<T>;
  select<N1 extends string, T1>(n1: Column<N1, T1>): Query<{ [N in N1]: T1 }>;
  select<N1 extends string, T1, N2 extends string, T2>(
    n1: Column<N1, T1>,
    n2: Column<N2, T2>,
  ): Query<{ [N in N1]: T1 } & { [N in N2]: T2 }>;
  select<N1 extends string, T1, N2 extends string, T2, N3 extends string, T3>(
    n1: Column<N1, T1>,
    n2: Column<N2, T2>,
    n3: Column<N3, T3>,
  ): Query<{ [N in N1]: T1 } & { [N in N2]: T2 } & { [N in N3]: T3 }>;

  select<Cols extends Column<any, any>[]>(...cols: Cols): Query<RowOf<Cols>>;
  select<U>(...nodesOrTables: any[]): Query<U>;

  /**
   * Update columns of the table.
   * @params o - a partial row object matching the keys and values of the table row
   */
  update(o: Partial<T>): ModifyingQuery<T>;

  /**
   * Order results by the specified order criteria. You may obtain ordering criteria by accessing
   * the .asc or .desc properties of columns
   * @example
   * ```
   * users.where(...).order(user.dateRegistered.desc)
   * ```
   */
  order(...criteria: OrderByValueNode[]): Query<T>;

  /**
   * Limit number of results
   * @param l the limit
   */
  limit(l: number): Query<T>;
  /**
   * Getthe result starting the specified offset index
   * @param o the offset
   */
  offset(o: number): Query<T>;
}

export interface NonExecutableQuery<T> extends Queryable<T> {
  /**
   * Group by one or more columns
   * @example
   * ```
   * userPoints.where(userPoints.id.in(userIdList)).select(userPoints.point.sum()).group(userPoints.userId)
   * ```
   */
  group(...nodes: Column<any, any>[]): Query<T>;
  group(nodes: Column<any, any>[]): Query<T>;

  /**
   * Get distinct result based on one or more columns. Use after select()
   */
  distinctOn(...columns: Column<any, any>[]): Query<T>; // todo: Column<any, any> can be more specific
}

export interface Query<T> extends Executable<T>, NonExecutableQuery<T> {}

export interface SubQuery<T> extends NonExecutableQuery<T> {
  /**
   * Convert the subquery into an exists (subquery)
   */
  exists(): BinaryNode;

  /**
   * Convert the subquery into an NOT EXISTS (subquery)
   */
  notExists(): BinaryNode;
  notExists(subQuery: SubQuery<any>): BinaryNode;
}

export interface ModifyingQuery<T> extends Executable<T> {
  /**
   * Pick columns to return from the modifying query, or use star to return all rows
   */
  returning<Cols extends Column<any, any>[]>(...cols: Cols): Query<RowOf<Cols>>;
  returning<U = T>(star: '*'): Query<U>;

  /**
   * Filter the modifications by the specified conditions. If multiple conditions are passed, they will
   * be joined with AND. A condition may either be a BinaryNode SQL expression, or an object that
   * contains the column names and their desired values e.g. `where({ email: "example@test.com" })`
   *
   * @param nodes either boolean-evaluating conditional expressions or an object
   *
   * @example
   * ```
   * users.where({email: "example@test.com"})
   * users.where(user.primaryEmail.equals(user.secondaryEmail))
   * ```
   */
  where(...nodes: WhereCondition<T>[]): ModifyingQuery<T>;
}

export interface TableNode {
  /**
   * Within a from condition, join this table node with another table node
   */
  join(table: TableNode): JoinTableNode;
  /**
   * Within a from condition, LEFT JOIN this table node with another table node
   */
  leftJoin(table: TableNode): JoinTableNode;
}

export interface JoinTableNode extends TableNode {
  /**
   * Specify the joining condition for a join table node
   *
   * @param filter a binary expression describing the join condition
   *
   * @example
   * users.from(users.join(posts).on(users.id.equals(posts.userId)))
   */
  on(filter: BinaryNode): TableNode;
  on(filter: string): TableNode;
}

interface CreateQuery extends Executable<void> {
  ifNotExists(): Executable<void>;
}
interface DropQuery extends Executable<void> {
  ifExists(): Executable<void>;
}

type Columns<T> = { [Name in keyof T]: Name extends string ? Column<Name, T[Name]> : never };

export type Table<Name extends string, T> = TableNode &
  Queryable<T> &
  Named<Name> &
  Columns<T> & {
    create(): CreateQuery;
    drop(): DropQuery;
    as<OtherName extends string>(name: OtherName): Table<OtherName, T>;
    insert(row: T): ModifyingQuery<T>;
    insert(rows: T[]): ModifyingQuery<T>;
    select(): Query<T>;
    star(): Column<any, unknown>;
    subQuery(): SubQuery<T>;
    columns: Column<any, any>[];
    sql: SQL;
    alter(): AlterQuery<T>;
    indexes(): IndexQuery;
    count(): Query<DBBigInt>;
  };

type Selectable<Name extends string, T> = Table<Name, T> | Column<Name, T>;

export interface AlterQuery<T> extends Executable<void> {
  addColumn(column: Column<any, any>): AlterQuery<T>;
  addColumn(name: string, options: string): AlterQuery<T>;
  dropColumn(column: Column<any, any> | string): AlterQuery<T>;
  renameColumn(column: Column<any, any>, newColumn: Column<any, any>): AlterQuery<T>;
  renameColumn(column: Column<any, any>, newName: string): AlterQuery<T>;
  renameColumn(name: string, newName: string): AlterQuery<T>;
  rename(newName: string): AlterQuery<T>;
}
export interface IndexQuery {
  create(): IndexCreationQuery;
  create(indexName: string): IndexCreationQuery;
  drop(indexName: string): Executable<void>;
  drop(...columns: Column<any, any>[]): Executable<void>;
}
export interface IndexCreationQuery extends Executable<void> {
  unique(): IndexCreationQuery;
  using(name: string): IndexCreationQuery;
  on(...columns: (Column<any, any> | OrderByValueNode)[]): IndexCreationQuery;
  withParser(parserName: string): IndexCreationQuery;
  fulltext(): IndexCreationQuery;
  spatial(): IndexCreationQuery;
}

export interface SQL {
  functions: {
    LOWER<Name extends string>(c: Column<Name, string>): Column<Name, string>;
  };
}

export interface Column<Name extends string, T> {
  name: Name;

  /**
   * The column value can be found in a given array of items or in a subquery
   *
   * @param arr the Array
   * @returns a binary node that can be used in where expressions
   *
   * @example
   * ```
   * users.where(user.email.in(emailArray))
   * ```
   */
  in(arr: T[]): BinaryNode;
  in(subQuery: SubQuery<T>): BinaryNode;

  /**
   * The column value can NOT be found in a given array of items or in a subquery
   *
   * @param arr the Array
   * @returns a binary node that can be used in where expressions
   *
   * @example
   * ```
   * users.where(user.email.notIn(bannedUserEmails))
   * ```
   */
  notIn(arr: T[]): BinaryNode;

  /**
   * Check if the column value equals another (column) value
   */
  equals<U extends T>(node: U | Column<any, U>): BinaryNode;

  /**
   * Check if the column value does NOT equal another (column) value
   */
  notEquals<U extends T>(node: U | Column<any, U>): BinaryNode;

  /**
   * Check if the column value is greater than or equal to another column value
   */
  gte(node: T | Column<any, T> | number | Column<any, number>): BinaryNode;

  /**
   * Check if the column value is less than or equal to another column value
   */
  lte(node: T | Column<any, T> | number | Column<any, number>): BinaryNode;

  /**
   * Check if the column value is greater than another column value
   */
  gt(node: T | Column<any, T> | number | Column<any, number>): BinaryNode;

  /**
   * Check if the column value is less than another column value
   */
  lt(node: T | Column<any, T> | number | Column<any, number>): BinaryNode;

  /**
   * Check if the node matches a LIKE expression. See the database documentation for LIKE expression syntax
   */
  like(str: string): BinaryNode;

  /**
   * Check if the node does NOT match a LIKE expression. See the database documentation for LIKE expression syntax
   */
  notLike(str: string): BinaryNode;

  /**
   * Check if the node matches a case Insensitive LIKE expression.
   * See the database documentation for LIKE expression syntax
   */
  ilike(str: string): BinaryNode;

  /**
   * Check if the node does NOT match a case Insensitive LIKE expression.
   * See the database documentation for LIKE expression syntax
   */
  notILike(str: string): BinaryNode;

  /**
   * Multiply the node with another node or value
   */
  multiply(node: Column<any, T> | Column<any, number> | T | number): Column<any, T>;

  /**
   * Check if the column is null
   */
  isNull(): BinaryNode;

  /**
   * Check if the column is NOT null
   */
  isNotNull(): BinaryNode;

  /**
   * Compute a sum of the column.
   * @deprecated Please use the named variant!
   */
  sum(): Column<any, T>;

  /**
   * Compute a sum of the column and give it a name
   * @param name the new colum name
   */
  sum<Name extends string>(n: Name): Column<Name, T>;

  /**
   * Compute min of the column and give it a name
   * @param name the new colum name
   */
  min<Name extends string>(n: Name): Column<Name, T>;

  /**
   * Compute maxof the column and give it a name
   * @param name the new colum name
   */
  max<Name extends string>(n: Name): Column<Name, T>;

  /**
   * Compute a count of the column or results
   * @deprecated Please use the named variant!
   */
  count(): Column<any, DBBigInt>;

  /**
   * Compute a count of the column or results and give it a name
   * @param name the new colum name
   */
  count<Name extends string>(name: Name): Column<Name, DBBigInt>;

  /**
   * Get the distinct values of this column (without repetition
   *
   * @example
   * ```
   * users.select(user.email.distinct())
   * ```
   */
  distinct(): Column<Name, T>;

  /**
   * Give this column another name in the result set
   *
   * @param name the new name
   *
   * @example
   * ```
   * users.select(user.email.as('electronicMail'))
   * ```
   */
  as<OtherName extends string>(name: OtherName): Column<OtherName, T>;

  /**
   * Get an ascending ordering direction for this column
   */
  ascending: OrderByValueNode;

  /**
   * Get an descending ordering direction for this column
   */
  descending: OrderByValueNode;

  /**
   * Get an ascending ordering direction for this column
   */
  asc: OrderByValueNode;

  /**
   * Get an descending ordering direction for this column
   */
  desc: OrderByValueNode;

  /**
   * Access a JSON key within the specified column
   */
  key<Key extends keyof T>(key: Key): Column<any, T[Key]>;

  /**
   * Access a JSON key within a specified column and convert it to string
   */
  keyText<Key extends keyof T>(key: Key): Column<any, string>;

  contains(key: any): Column<any, any>;
  cast<T extends keyof CastMappings>(type: T): Column<Name, CastMappings[T]>;
}

export interface BinaryNode {
  and(node: BinaryNode): BinaryNode;
  or(node: BinaryNode): BinaryNode;
}

export interface AnydbSql extends DatabaseConnection {
  /**
   * Define a new table with a given name containing a row of the given type
   * @param map The table definition object
   */
  define<Name extends string, T>(map: TableDefinition<Name, T>): Table<Name, T>;

  /**
   * Run a function as a transaction
   */
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  allOf(...tables: Table<any, any>[]): any;
  models: { [key: string]: Table<any, any> };
  functions: {
    LOWER: <Name extends string>(name: Column<Name, string>) => Column<Name, string>;
    RTRIM: <Name extends string>(name: Column<Name, string>) => Column<Name, string>;
  };
  /**
   * Create a database function with the given name that you can use within queries
   * @param name the function name as it is in the database e.g. `"COUNT"`
   */
  makeFunction(name: string): Function;
  begin(): Transaction;
  open(): void;
  close(): void;
  getPool(): AnyDBPool;
  setPool(pool: AnydbSql): void;
  /**
   * Turn testing mode on or off. Transactions become savepoints and reseting the database rolls back any
   * transactions made during in test mode
   */
  testMode(val: boolean): Promise<void>;

  /**
   * Reset the current testmode transaction, rolling back any changes made during the test
   */
  testReset(): Promise<void>;
  dialect(): string;
}

export function anydbSQL(config: Object): AnydbSql;
export function create(config: Object): AnydbSql;