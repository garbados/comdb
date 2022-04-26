# ComDB

[![CI](https://github.com/garbados/comdb/actions/workflows/ci.yaml/badge.svg)](https://github.com/garbados/comdb/actions/workflows/ci.yaml)
[![Coverage Status](https://img.shields.io/coveralls/github/garbados/comdb/master.svg?style=flat-square)](https://coveralls.io/github/garbados/comdb?branch=master)
[![Stability](https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square)](https://nodejs.org/api/documentation.html#documentation_stability_index)
[![NPM Version](https://img.shields.io/npm/v/comdb.svg?style=flat-square)](https://www.npmjs.com/package/comdb)
[![JS Standard Style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/feross/standard)

A [PouchDB](https://pouchdb.com/) plugin that transparently encrypts and decrypts its data so that only encrypted data is sent during replication, while encrypted data that you receive is automatically decrypted. Uses [TweetNaCl](https://www.npmjs.com/package/tweetnacl) for cryptography.

As an example, here's what happens when you replicate data to a [CouchDB](https://couchdb.apache.org/) cluster:

```javascript
const PouchDB = require('pouchdb')
PouchDB.plugin(require('comdb'))

const password = 'extremely secure value'

const db = new PouchDB(POUCH_PATH)
db.setPassword(password).then(async () => {
  await db.post({
    _id: 'gay-agenda',
    type: 'queerspiracy',
    agenda: ['be gay', 'do crimes']
  })
  // now replicate to a couchdb instance
  await db.replicate.to(`${COUCH_URL}/FALGSC`)
})
```

Now you can check the CouchDB for the encrypted information:

```
$ curl "$COUCH_URL/FALGSC/_all_docs?include_docs=true" | jq .
{
  "total_rows": 1,
  "offset": 0,
  "rows": [
    {
      "id": "...",
      "key": "...",
      "value": {
        "rev": "1-[...]"
      },
      "doc": {
        "_id": "...",
        "_rev": "1-[...]",
        "payload": "...",
      }
    }
}
```

ComDB can also restore encrypted data that it doesn't already have
using your password.

```javascript
// using a different and empty database
const db = new PouchDB(`${POUCH_PATH}-2`)
// but using the same password and encrypted copy
db.setPassword(password, { name: `${COUCH_URL}/FALGSC` })
// you can restore data from a remote source
return db.loadEncrypted().then(async () => {
  return db.allDocs({ include_docs: true })
}).then(({ rows }) => {
  const { doc } = rows[0].doc
  console.log(doc)
})
----
{ _id: 'gay-agenda',
  _rev: '1-[...]',
  type: 'queerspiracy',
  agenda: [ 'be gay', 'do crimes' ] }
```

This way, the server can't (easily) know anything about your data, but you can still maintain query indexes.

In the above example, we replicated data from a local encrypted copy of our data, but you can use a CouchDB instance as your encrypted copy. That way, your documents will be automatically backed up to the remote instance.

```javascript
const db = new PouchDB(POUCH_PATH)
await db.setPassword(password, { name: COUCH_URL })
```

You can also set up encryption on another device by using `db.exportComDB()` and `db.importComDB()`.
This is useful when you want to maintain a separate encrypted copy of your data, for example
because you want that separate copy to live on another device, while retaining the ability to
replicate with the original encrypted copy.

```javascript
// on one machine, get the encryption key. it'll be a long string.
const key = await db.exportComDB()
// then on another machine, use the key with your password to set up encryption
const db = new PouchDB(POUCH_PATH)
await db.importComDB(password, key)
// now you can replicate over from the original encrypted backup
await db.replicate.from(COUCH_URL)
```

Now you can give your data to strangers *with confidence!*

For more examples, check out the [`/examples`](./examples) folder.

## Install

You can get ComDB with [npm](https://www.npmjs.com/):

```bash
$ npm i comdb
```

Now you can `require()` it in your [node.js](https://nodejs.org/en/) projects:

```javascript
const PouchDB = require('pouchdb')
PouchDB.plugin(require('comdb'))

const db = new PouchDB(...)
await db.setPassword(...)
```

You can also use PouchDB and ComDB in the browser using [browserify](http://browserify.org/).

## Usage

ComDB adds and extends several methods to PouchDB and any instances of it:

### `PouchDB.replicate(source, target, [opts], [callback])`

ComDB wraps PouchDB's replicator to check if either the source or the target have an `_encrypted` attribute, reflecting that they are ComDB instances. If it finds the attribute, it changes the parameter to use the encrypted database rather than its decrypted one. If neither the source or target is a ComDB instance, the replicator behaves as normal.

You can also disable this functionality by passing `comdb: false` in the `opts`
parameter:

```javascript
PouchDB.replicate(db1, db2, { comdb: false })
```

The instance methods `db.replicate.to` and `db.replicate.from` automatically use `PouchDB.replicate` so that wrapping the static method causes the instance methods to exhibit the same behavior.

Original: [`PouchDB.replicate`](https://pouchdb.com/api.html#replication)

### `async db.setPassword(password, [opts])`

Mutates the instance with crypto tooling so that it can encrypt and decrypt documents.

```javascript
await db.setPassword('hello world')
// db will now maintain an encrypted copy
```

- `password`: A string used to encrypt and decrypt documents.
- `opts.name`: A name or connection string for the encrypted database.
- `opts.opts`: An options object passed to the encrypted database's constructor. Use this to pass any options accepted by [PouchDB's constructor](https://pouchdb.com/api.html#create_database).

### `async db.destroy([opts], callback)`

ComDB wraps PouchDB's database destruction method so that both the encrypted and decrypted databases are destroyed. ComDB adds two options to the method:

- `encrypted_only`: Destroy only the encrypted database. This is useful when a backup has become compromised and you need to burn it.
- `unencrypted_only`: Destroy only the unencrypted database. This is useful if you are using a remote encrypted backup and want to burn the local device so you can restore from backup on a fresh one.

Original: [db.destroy()](https://pouchdb.com/api.html#delete_database)

### `async db.loadEncrypted(opts = {})`

Load changes from the encrypted database into the decrypted one. Useful if you are restoring from backup:

```javascript
// in-memory database is wiped on restart and so needs to be repopulated
const db = new PouchDB('local', { adapter: 'memory' })
// the encrypted DB lives on remote disk, so we can load docs from it
db.setPassword(PASSWORD, { name: REMOTE_URL }).then(async () => {
  await db.loadEncrypted()
  // all encrypted docs have been loaded into the decrypted database
})
```

Accepts the same options as [PouchDB.replicate()](https://pouchdb.com/api.html#replication).

### `async db.loadDecrypted(opts = {})`

Load changes from the decrypted database into the encrypted one. Useful if you are instrumenting encryption onto a database that already exists.

```javascript
// db already exists, we are just adding encryption
const db = new PouchDB('local')
db.setPassword(PASSWORD).then(async () => {
  await db.loadDecrypted()
  // all decrypted docs have been loaded into the encrypted database
})
```

Accepts the same options as [db.changes()](https://pouchdb.com/api.html#changes).

## Recipe: End-to-End Encryption

ComDB can instrument end-to-end encryption of application data using [pouchdb-adapter-memory](https://www.npmjs.com/package/pouchdb-adapter-memory), so that documents are only decrypted in memory while everything on disk remains encrypted.

Consider this setup:

```javascript
// in-memory database is wiped on restart and so needs to be repopulated
const db = new PouchDB('local', { adapter: 'memory' })
// the encrypted copy lives on local disk, so we can load docs from it
db.setPassword(PASSWORD).then(async () => {
  // repopulate database from encrypted local copy
  await db.loadEncrypted()
  // decrypted database is up to date, app is ready to go
})
```

You can then replicate your encrypted database with a remote CouchDB installation to ensure you can restore your data even if your device is compromised:

```javascript
// create remote db connection
const remoteDb = new PouchDB('http://...') // CouchDB connection string
// sync local encrypted with remote
const sync = PouchDB.sync(db, remoteDb, { live: true, retry: true })
```

Now you'll have three copies of your data:

- One in local memory, decrypted.
- One on local disk, encrypted.
- One on remote disk, encrypted.

The user syncs local disk with remote disk to have a remote encrypted backup, so the user can restore their info when switching devices. The local disk populates the in-memory database on startup, so that the only data that remains on disk remains encrypted. The user retains all their information locally, so they do not require network connectivity to use the app normally.

## Development

To hack on ComDB, check out the [issues page](https://github.com/garbados/comdb/issues). To submit a patch, [submit a pull request](https://github.com/garbados/comdb/pulls).

To run the test suite, use `npm test` in the source directory:

```bash
$ git clone garbados/comdb
$ cd comdb
$ npm i
$ npm test
```

A formal code of conduct is forthcoming. Pending it, contributions will be moderated at the maintainers' discretion.

## License

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0.html)
