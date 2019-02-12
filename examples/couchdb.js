#!/usr/bin/env node
'use strict'

const assert = require('assert')
const PouchDB = require('pouchdb')
PouchDB.plugin(require('..'))

const COUCH_URL = process.env.COUCH_URL || 'http://localhost:5984'
assert(COUCH_URL, 'This example requires that $COUCH_URL be set to a URL for accessing a CouchDB instance.')

const password = 'scarcity-is-artificial'

// create the database and set a password
const db = new PouchDB('.comdb-example')
console.log(`
When you set a password for ComDB, it creates an encrypted database
that maps changes to and from your database. In this example, the
encrypted database exists on a CouchDB instance, while the decrypted
one lives on disk.
`)
db.setPassword(password, {
  name: [COUCH_URL, 'comdb-example'].join('/')
})
// write a doc
db.post({ greetings: 'hello world' }).then(({ id }) => {
  return db.get(id)
}).then((doc) => {
  console.log(`Documents are decrypted so that you can maintain indexes on them.
The database's methods, except for replication, refer to the
decrypted database. Here is a decrypted document retrieved by ID:
  `)
  assert.strictEqual(doc.greetings, 'hello world')
  console.log(doc)
  // now let's check the encrypted db
  return db._encrypted.allDocs({ include_docs: true })
}).then(({ rows }) => {
  const { doc } = rows[0]
  // this doc lives in couchdb and is encrypted
  console.log(`
... and here is that document, encrypted!
This document lives in CouchDB such that your decrypted data never
leaves the local machine.
  `)
  console.log(doc)
  return db.decrypt(doc.payload)
}).then((doc) => {
  console.log(`
Here is the payload from that document, decrypted:
  `)
  console.log(doc)
}).then(() => {
  console.log(`
You can even create a different database and replicate encrypted
data to it. As long as you provide the second instance with the same
password, it will transparently decrypt replicated documents. Now I
will replicate our first database to our second...
  `)
  const db2 = new PouchDB('.comdb-example-2')
  db2.setPassword(password)
  return db.replicate.to(db2).then(() => {
    return db2.allDocs({ include_docs: true, limit: 1 })
  }).then(({ rows }) => {
    const { doc } = rows[0]
    console.log(`... replication successful!

The second database, using the password, has automatically decrypted
the remote documents. The encrypted version remains on the server,
unchanged.
    `)
    console.log(doc)
    console.log('')
  }).then(() => {
    return db2.destroy()
  })
}).then(() => {
  console.log(`Cool, huh?
  `)
  return db.destroy()
}).catch((error) => {
  console.error(error)
})
