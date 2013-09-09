# anydb-sql

anydb-sql combines [node-anydb](https://github.com/grncdr/node-any-db)
and [node-sql](https://github.com/brianc/node-sql) into a single package full 
of awesomeness.

# examples and usage:

Initializing an instance also creates a connection pool. The url argument is 
the same as in node-anydb

```js
var anydbsql = require('anydb-sql');

var db = anydbsql({
    url: 'postgres://user:pass@host:port/database',
    connections: { min: 2, max: 20 }
});
```

Defining a table is the same as in node-sql:

```js
var user = db.define({
    name: 'users',
    columns: {
        id: {primaryKey: true}, 
        email: {}, 
        password: {}
    }
});
```

But now you can also add properties based on relationships between tables:

```js
var user = db.define({
    name: 'users',
    columns: { ... }
    has: {
        posts: {from: 'posts', many: true},
        group: {from: 'groups'}
    }
});
// user.posts is now a "subtable"
```

Read about [joins and subobjects](#joins-and-subobjects) to see how you can 
use subtables with `selectDeep`

## extra methods

Queries have all the methods as in node-sql, plus the additional methods:

* exec(function(err, rows)) - executes the query and calls the callback 
  with an array of rows
* all - same as exec
* get(function(err, row)) - executes the query and returns the first result
* allObject(keyColumn, function(err, object), [mapper, filter]) - executes the 
  query and maps the result to an object
* execWithin(transaction, function(err, rows)) - execute within a transaction
* selectDeep - deeply select join results (with grouping). More info in
  the section [joins and subobjects](#joins-and-subobjects) below.

If you omit the callback from a querying method, an eventemitter will be 
returned instead (like in anydb).

Use regular node-sql queries then chain one of the querying methods at the 
end:

```js
user.where({email: email}).get(function(err, user) {
  // user.name, 
});
```

## joins and subobjects

Join queries can be constructed using node-sql. The format of the results is 
the same as with anydb

```js
user.select(user.name, post.content)
  .from(user.join(post).on(user.id.equals(post.userId)))
  .where(post.date.gt(yesterday))
  .all(function(err, userposts) {
    // res[0].name and res[0].content
  });
```

When creating join queries, you can generate sub-objects in the result by 
using `selectDeep`
 
```js
user.from(user.join(post).on(user.id.equals(post.userId)))
  .where(post.date.gt(yesterday))
  .selectDeep(user.name, post.content)
  .all(function(err, res) {
    // res[0].user.name and res[0].post.content
  });
```

With selectDeep you can also utilize `has` relationships to get full-blown
result structures:

```js
user.from(user.join(user.posts).on(user.id.equals(user.posts.userId)))
  .where(user.posts.date.gt(yesterday))
  .selectDeep(user.id, user.name, user.posts)
  .all(function(err, res) {
    // res[0] is
    // { id: id, name: name, posts: [postObj, postObj, ...] }
  });
```

## transactions

To create a transaction and execute queries within it, use
`db.begin()`

```js
var tx = db.begin()
user.insert({name: 'blah'}).returning(user.id).execWithin(tx);
user.insert({name: 'bleh'}).returning(user.id).execWithin(tx);
tx.commit();
```

Transactions have the same API as anydb tranactions

# db.close and custom queries

You can close the connection pool

```js
db.close();
```

Or execute custom queries

```js
db.query(...anydb arguments...)
```

# licence

MIT

