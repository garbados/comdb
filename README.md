# ComDB

[![Build Status](https://img.shields.io/travis/garbados/comdb/master.svg?style=flat-square)](https://travis-ci.org/garbados/comdb)
[![Coverage Status](https://img.shields.io/coveralls/github/garbados/comdb/master.svg?style=flat-square)](https://coveralls.io/github/garbados/comdb?branch=master)
[![Stability](https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square)](https://nodejs.org/api/documentation.html#documentation_stability_index)
[![NPM Version](https://img.shields.io/npm/v/comdb.svg?style=flat-square)](https://www.npmjs.com/package/comdb)
[![JS Standard Style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/feross/standard)

A [PouchDB](https://pouchdb.com/) plugin that transparently encrypts and decrypts its data so that only encrypted data is sent during replication, while encrypted data that you receive is automatically decrypted.

As an example, here's what happens when you replicate data to a [CouchDB](https://couchdb.apache.org/) cluster:

```javascript
const PouchDB = require('pouchdb')
PouchDB.plugin(require('comdb'))

const password = 'extremely secure value'

const db = new PouchDB(POUCH_PATH)
db.setPassword(password)

db.post({
  _id: 'gay-agenda',
  type: 'queerspiracy',
  agenda: ['be gay', 'do crimes']
}).then(() => {
  // now replicate to a couchdb instance
  return db.replicate.to(`${COUCH_URL}/FALGSC`)
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

ComDB can also restore encrypted data that it doesn't already have using your password:

```javascript
// using a different and empty database
const db = new PouchDB(`${POUCH_PATH}-2`)
// but using the same password
db.setPassword(password)
// you can restore data from a remote source
return db.replicate.from(COUCH_URL).then(() => {
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
db.setPassword(password, { name: COUCH_URL })
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
db.setPassword(...)
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

### `db.setPassword(password, [opts])`

Mutates the instance with crypto tooling so that it can encrypt and decrypt documents.

Returns nothing.

- `password`: A string used to encrypt and decrypt documents.
- `opts.name`: A name or connection string for the encrypted database.
- `opts.opts`: An options object passed to the encrypted database's constructor. Use this to pass any options accepted by [PouchDB's constructor](https://pouchdb.com/api.html#create_database).
- `opts.crypt`: Options for ComDB's crypto tooling.
- `opts.crypt.algorithmName`: Name of the encryption algorithm.
- `opts.crypt.algorithmNonceSize`: Size of generated nonces.
- `opts.crypt.algorithmTagSize`: Size of the auth tags used.
- `opts.crypt.algorithmKeySize`: Size of generated keys.
- `opts.crypt.pbkdf2Name`: Name of the hashing algorithm.
- `opts.crypt.pbkdf2SaltSize`: Size of generates salts.
- `opts.crypt.pbkdf2Iterations`: Number of iterations to hash data.

### `db.bulkDocs(docs, [opts], [callback])`

ComDB wraps PouchDB's bulk document update method, which is used by all of PouchDB's other document creation and update methods, so that every update -- including deletions! -- is mapped to the encrypted database. ComDB also wraps the encrypted database's `bulkDocs` method in order to map its changes to the decrypted database, in order to (for example) restore data from an encrypted backup.

Original: [`db.bulkDocs`](https://pouchdb.com/api.html#batch_create)

### `db.encrypt(doc)`

A convenience method for encrypting a document using the currently set password. Used internally to encrypt documents before saving them to the encrypted database.

Returns the document as an encrypted string.

- `doc`: Any object, but probably a document.

### `db.decrypt(payload)`

A convenience method for decrypting payloads using the currently set password. Used internally to decrypt documents before saving them to the decrypted database.

Returns the document as an object.

- `payload`: An encrypted string returned by `db.encrypt(doc)`.

### `db.destroy([opts], callback)`

ComDB wraps PouchDB's database destruction method so that both the encrypted and decrypted databases are destroyed. ComDB adds two options to the method:

- `encrypted_only`: Destroy only the encrypted database. This is useful when a backup has become compromised and you need to burn it.
- `unencrypted_only`: Destroy only the unencrypted database. This is useful if you are using a remote encrypted backup and want to burn the local device so you can restore from backup on a fresh one.

Original: [db.destroy](https://pouchdb.com/api.html#delete_database)

### `db.loadEncrypted(callback)`

Load changes from the encrypted database into the decrypted one. Useful if you are restoring from backup:

```javascript
// in-memory database is wiped on restart and so needs to be repopulated
const db = new PouchDB('local', { adapter: 'memory' })
// the encrypted DB lives on remote disk, so we can load docs from it
db.setPassword(PASSWORD, { name: REMOTE_URL })
db.loadEncrypted().then(() => {
  // all encrypted docs have been loaded into the decrypted database
})
```

## Recipe: End-to-End Encryption

ComDB can instrument end-to-end encryption of application data using [pouchdb-adapter-memory](https://www.npmjs.com/package/pouchdb-adapter-memory), so that documents are only decrypted in memory while everything on disk remains encrypted.

Consider this setup:

```javascript
// in-memory database is wiped on restart and so needs to be repopulated
const db = new PouchDB('local', { adapter: 'memory' })
// the encrypted copy lives on local disk, so we can load docs from it
db.setPassword(PASSWORD)
// repopulate database from encrypted local copy
db.loadEncrypted().then(() => {
  // decrypted database is up to date, app is ready to go
})
```

You can then replicate your encrypted database with a remote CouchDB installation to ensure you can restore your data even if your device is compromised:

```javascript
const remoteDb = new PouchDB('http://...') // CouchDB connection string
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
