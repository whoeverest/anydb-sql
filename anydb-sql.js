var sql = require('node-sql-2');
var url = require('url');
var EventEmitter = require('events').EventEmitter;
var P = require('bluebird');

var AnyDBPool = require('./lib/anydb-pool');
var grouper = require('./lib/grouper');
var savePoint = require('./lib/savepoint');
var TxMonad = require('./lib/tx-monad');

var queryMethods = [
  'select',
  'from',
  'insert',
  'update',
  'delete',
  'create',
  'drop',
  'alter',
  'where',
  'indexes',
  'ifNotExists',
  'addColumn',
  'dropColumn',
  'renameColumn',
  'rename'
];

function extractDialect(adr) {
  var dialect = url.parse(adr).protocol;
  dialect = dialect.substr(0, dialect.length - 1);
  if (dialect == 'sqlite3') dialect = 'sqlite';
  return dialect;
}

module.exports.create = create;
function create(opt) {
  var pool,
    db = {},
    dialect = extractDialect(opt.url);

  sql.setDialect(dialect);

  db.open = function() {
    if (pool != null) return; // already open
    if (dialect == 'sqlite') {
      try {
        var SQLitePool = require('./lib/sqlite-pool');
        pool = new SQLitePool(opt.url, opt.connections);
      } catch (e) {
        throw new Error('Unable to load sqlite pool: ' + e.message);
      }
    } else {
      pool = new AnyDBPool(opt.url, opt.connections);
    }
    pool._mainpool = true;
  };

  db.models = {};

  function extendedTable(table, opt) {
    // inherit everything from a regular table.
    var extTable = Object.create(table);

    // make query methods return extended queries.
    queryMethods.forEach(function(key) {
      extTable[key] = function() {
        return extendedQuery(table[key].apply(table, arguments));
      };
    });

    // make as return extended tables.
    extTable.as = function() {
      return extendedTable(table.as.apply(table, arguments), opt);
    };
    extTable.eventEmitter = new EventEmitter();
    extTable.__isTable = true;

    if (opt.has) defineRelations(extTable, opt.has);
    return extTable;
  }

  function tableName(t) {
    return t.alias || t._name;
  }
  function defineRelations(owner, has) {
    Object.keys(has).forEach(function(name) {
      var what = has[name],
        table = what.from,
        many = what.many ? '[]' : '{}',
        foreign;
      Object.defineProperty(owner, name, {
        get: function() {
          if (!foreign)
            if (typeof table == 'string') foreign = db.models[table];
            else foreign = table;
          var ownerName = tableName(owner);
          var aliased = foreign.as(ownerName + '.' + name + many);
          // Mark that this table is a subtable
          aliased.__isSubtable = true;
          return aliased;
        }
      });
    });
  }

  function extendedQuery(query) {
    var extQuery = Object.create(query);
    var self = extQuery;

    self.__extQuery = true;

    extQuery.execWithin = function(where, fn) {
      var estack;
      if (!where || !where.queryAsync) {
        console.error(where);
        throw new Error('query: Cannot execWithin ' + where);
      }
      if (where._logQueries) estack = new Error();
      var query = self.toQuery(); // {text, params}

      var resPromise = where.queryAsync(query);
      return resPromise
        .then(
          function(res) {
            if (where._logQueries) {
              console.log(
                'anydb-sql query complete: `' + query.text + '` with params',
                query.values,
                'in tx',
                where._id,
                'stack\n',
                estack.stack
                  .split('\n')
                  .slice(2, 7)
                  .join('\n')
              );
            }
            return res && res.rows ? grouper.process(res.rows) : null;
          },
          function(err) {
            err = new Error(err);
            err.message =
              err.message +
              ' in query `' +
              query.text +
              '`' +
              ' in tx ' +
              where._id +
              ' with params ' +
              JSON.stringify(query.values);
            throw err;
          }
        )
        .nodeify(fn);
    };
    extQuery.allWithin = extQuery.execWithin;
    extQuery.exec = (fn) => {
      db.open();
      return extQuery.execWithin(pool, fn);
    };
    extQuery.all = extQuery.exec;

    extQuery.getWithin = function(where, fn) {
      var q = self.execWithin(where);
      return q
        .then(function(rows) {
          return rows && rows.length ? rows[0] : null;
        })
        .nodeify(fn);
    };

    extQuery.get = (fn) => {
      db.open();
      return extQuery.getWithin(pool, fn);
    };

    extQuery.execTx = function() {
      var q = self.toQuery();
      return new TxMonad(q.text, q.values);
    };
    extQuery.allTx = extQuery.execTx;
    extQuery.getTx = function() {
      return self.execTx().chain(function(rows) {
        return rows && rows.length ? rows[0] : null;
      });
    };

    queryMethods.forEach(function(key) {
      extQuery[key] = function extFn() {
        var q = query[key].apply(query, arguments);
        if (q.__extQuery) return q;
        return extendedQuery(q);
      };
    });

    extQuery.selectDeep = function() {
      return extQuery.select(db.allOf.apply(db, arguments));
    };

    return extQuery;
  }

  db.define = function(opt) {
    var t = extendedTable(sql.define.apply(sql, arguments), opt);
    db.models[opt.name] = t;
    return t;
  };

  db.functions = sql.functions;

  db.makeFunction = sql.functionCallCreator;

  db.close = function() {
    if (pool) pool.close.apply(pool, arguments);
    pool = null;
  };

  db.begin = function() {
    db.open();
    var tx = pool.begin();
    return wrapTransaction(tx);
  };

  db.transaction = function(f) {
    return P.try(function() {
      db.open();
      return wrapTransaction(pool.begin());
    }).then(function(tx) {
      return P.try(function() {
        return f(tx);
      }).then(
        function(res) {
          if (tx._logQueries) console.log('Commiting tx', tx._id, res);
          return tx.commitAsync().thenReturn(res);
        },
        function(err) {
          if (tx._logQueries) console.error('Error in tx', tx._id);
          return tx
            .rollbackAsync()
            .catch(function() {})
            .thenThrow(err);
        }
      );
    });
  };

  db.query = function() {
    db.open();
    return pool.query.apply(pool, arguments);
  };
  db.queryAsync = function() {
    db.open();
    return pool.queryAsync.apply(pool, arguments);
  };

  function columnName(c) {
    var name = c.alias || c.name;
    if (c.primaryKey && !c.aggregator) name = name + '##';
    return name;
  }

  function tableTypes(tables) {
    var sub = {},
      normal = {};
    tables.forEach(function(t) {
      if (!(t.__isTable || t.__isSubtable)) t = t.table;
      if (t.__isSubtable) sub[tableName(t)] = true;
      else normal[tableName(t)] = true;
    });

    return {
      sub: Object.keys(sub),
      normal: Object.keys(normal)
    };
  }

  db.allOf = function() {
    var tables = [].slice.call(arguments);
    var ttypes = tableTypes(tables);
    if (ttypes.sub.length > 0 && ttypes.normal.length > 1)
      throw new RangeError(
        'Only one main table is allowed when selecting subtables, ' +
          ttypes.normal.length +
          ' found. ' +
          ttypes.normal
      );

    return tables.reduce(function(all, table) {
      var tableName = table.alias || table._name;
      if (table.columns)
        return all.concat(
          table.columns.map(function(c) {
            return c.as(tableName + '.' + columnName(c));
          })
        );
      else if (table.aggregate) {
        var column = table;
        tableName = column.table.alias || column.table._name;
        return all.concat([column.as(tableName + '.' + columnName(column))]);
      } else if (table.aggregator) {
        var column = table;
        tableName = column.table.alias || column.table._name;
        tableName = tableName
          .split('.')
          .slice(0, -1)
          .join('.');
        return all.concat([column.as(tableName + '.' + columnName(column))]);
      } else {
        return all;
      }
    }, []);
  };

  var txid = 0;
  function wrapTransaction(tx) {
    tx._id = ++txid;
    tx.savepoint = savePoint(dialect);
    tx.begin = tx.savepoint;
    tx.close = function() {
      throw new Error('in anydb close fail tapa');
    };
    tx.__transaction = true;
    tx.logQueries = function(enabled) {
      tx._logQueries = enabled;
    };
    return tx;
  }

  db.getPool = function() {
    return pool;
  };

  db.setPool = function(newPool) {
    pool = newPool;
    return pool;
  };

  let testMode = false;
  let fakeTxnPool = null;
  let oldPool = null;

  /**
   * Transforms a transaction into a savepoint.
   *
   * `commitAsync` and `rollbackAsync` will do nothing when called.
   */
  function txWithoutSavepointCommits(tx) {
    const oldBegin = tx.begin;

    tx.testActive = true;
    tx.begin = function() {
      const savepoint = oldBegin.call(this);
      savepoint.commitAsync = function() {
        return P.resolve();
      };
      savepoint.rollbackAsync = function() {
        return P.resolve();
      };

      let oldQ = savepoint.queryAsync;

      savepoint.queryAsync = function() {
        if (tx.testActive) return oldQ.apply(this, arguments);
        else throw new Error('Test mode was deactivated, but queries are still running!');
      };
      return savepoint;
    };

    return tx;
  }

  let lastTestMode = null;

  /**
   * When the DB is in test mode, `db.begin` doesn't create new transactions.
   * Instead, the pool is replaced with a single transaction, and a new
   * savepoint is created every time begin is called.
   *
   * Here's the math; in test mode:
   * -> pool == transaction
   * -> new transaction == savepoint
   * -> commit: does nothing
   * -> rollback: is translated to RESTORE SAVEPOINT
   */
  db.testMode = function(val) {
    if (val === void 0) val = true;

    if (val === true) {
      if (testMode) {
        console.warn(lastTestMode && lastTestMode.stack);
        let e = new Error('DB is already in test mode!');
        console.warn(e.stack);
        return P.resolve();
      }
      lastTestMode = new Error('Test mode was last activated here, but not de-activated:');
      testMode = true;
      db.open()
      oldPool = pool;
      fakeTxnPool = txWithoutSavepointCommits(wrapTransaction(pool.begin()));
      db.setPool(fakeTxnPool);

      return Promise.resolve();
    } else {
      if (!testMode) {
        console.warn(lastTestMode && lastTestMode.stack);
        let e = new Error('DB not in test mode!');
        console.warn(e.stack);
        return P.resolve();
      }
      lastTestMode = new Error('Test mode deactivated here, but not re-activated');

      return fakeTxnPool.rollbackAsync().finally(() => {
        fakeTxnPool.testActive = false;
        fakeTxnPool = null;
        testMode = false;
        db.setPool(oldPool);
      });
    }
  };

  /**
   * Rolls back the test transaction. Resets the "fake" pool.
   */
  db.testReset = function() {
    if (!testMode) {
      throw new Error('DB is not in test mode');
    }
    fakeTxnPool.testActive = false;
    const rollbackPromise = fakeTxnPool.rollbackAsync().catch(e => {
      if (e.message.indexOf("method 'rollback' unavailable in state 'closed'") >= 0) {
        console.log(
          "anydb, test mode warning: can't reset test. Did you forget to wait for the promise returned by testReset, or send broken SQL to the DB?"
        );
        console.log(e.stack);
      } else {
        throw e;
      }
    });
    return rollbackPromise.then(() => {
      if (oldPool == null) throw new Error('Test was initialized but pool is missing, what?');
      fakeTxnPool = txWithoutSavepointCommits(wrapTransaction(oldPool.begin()));
      db.setPool(fakeTxnPool);
    });
  };

  db.dialect = function() {
    return dialect;
  };

  return db;
}

module.exports.anydbSQL = function(opt) {
  let db = create(opt);
  db.open();
  return db;
};
