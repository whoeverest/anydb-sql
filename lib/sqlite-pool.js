var url = require('url');
var path = require('path');
var sqlite = require('sqlite3');
var Promise = require('bluebird');
var autowrapQuery = require('./autowrap-query');


function SQLitePool(dbpath, conns) {
    if (!this instanceof SQLitePool)
        return new SQLitePool(dbpath, conns);
    var parsed = url.parse(dbpath), dbfile;
    if (parsed.path)
        dbfile = path.join(parsed.hostname, parsed.path);
    else
        dbfile = ':memory:';
    this.db = new sqlite.Database(dbfile);
    this.db.serialize();
}

var self = SQLitePool.prototype;

self.query = function query(q, args, cb) {
    if (!cb && typeof(args) == 'function') {
        cb = args;
        args = [];
    }
    args = args || [];
    this.db.all(q, args, function (err, res) {
      if (cb) cb(err, {rows: res});
    });
};

self.begin = function (cb) {
    let prom = new Promise((resolve, reject) =>
      this.query('BEGIN TRANSACTION;', (er, res) => er?reject(er):resolve(res)))
    return new SQLiteTransaction(this, prom);
};

self.commit = function (cb) {
    this.query('COMMIT', cb)
};

self.rollback = function(cb) {
    this.query('ROLLBACK', cb);
};

self.close = function(cb) {
    return this.db.close(cb);
}



function SQLiteTransaction(p, prom) {
    this.ready = prom;
    this.db = p;
}

SQLiteTransaction.prototype._queryAsync = function(q, p, cb) {
    return this.ready.then(() => this.db.queryAsync(q, p))
};

SQLiteTransaction.prototype._commitAsync = function() {
    return this._queryAsync('COMMIT')
};

SQLiteTransaction.prototype._rollbackAsync = function() {
    return this._queryAsync('ROLLBACK');
}

SQLiteTransaction.prototype.query = function(q, p, cb) {
    if (!cb) { cb = p; p = null; }
    return this._queryAsync(q, p).then(r => cb(null, r), e => cb(e))
}

SQLiteTransaction.prototype.commit = function(cb) {
  return this._commitAsync().then(r => cb(null, r), e => cb(e))
}
SQLiteTransaction.prototype.rollback = function(cb) {
  return this._rollbackAsync().then(r => cb(null, r), e => cb(e))
}

autowrapQuery(SQLiteTransaction.prototype);
autowrapQuery(SQLitePool.prototype);
Promise.promisifyAll(SQLiteTransaction.prototype);
Promise.promisifyAll(SQLitePool.prototype);

module.exports = SQLitePool;
