function randomName() {
    return 'sp' + Math.random().toString().split('.')[1]
}

module.exports = function(dialect) {
    return function beginSavepoint() {
        var tx = this;
        let rname = randomName()
        var spname = dialect == 'mysql' ? '`' + rname + '`': rname = '"' + rname + '"';

        const ready = tx.queryAsync('SAVEPOINT ' + spname)

        function restore(cb) {
            return tx.query('ROLLBACK TO SAVEPOINT ' + spname, cb);
        }
        function release(cb) {
            return tx.query('RELEASE SAVEPOINT ' + spname, cb);
        }
        return {
            __savepoint: true,
            rollback: restore,
            commit: release,
            restore: restore,
            release: release,
            query: function() {
                return tx.query.apply(tx, arguments);
            },
            queryAsync: function() {
                return ready.then(() => tx.queryAsync.apply(tx, arguments));
            },
            rollbackAsync: function() {
                return ready.then(() => tx.queryAsync('ROLLBACK TO SAVEPOINT ' + spname));
            },
            commitAsync: function() {
                return ready.then(() => tx.queryAsync('RELEASE SAVEPOINT ' + spname));
            }
        };
    }
};
