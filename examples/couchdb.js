#!/usr/bin/env node
'use strict'

const isEqual = require('lodash.isequal')
const assert = require('assert')
const PouchDB = require('pouchdb')
PouchDB.plugin(require('..'))

const COUCH_URL = process.env.COUCH_URL || 'http://localhost:5984'
assert(COUCH_URL, 'This example requires that $COUCH_URL be set to a URL for accessing a CouchDB instance.')

const password = 'scarcity-is-artificial'

// create the database and set a password
const db = new PouchDB('.comdb-example')
let db2

Promise.resolve().then(async () => {
  console.log(`
When you set a password for ComDB, it creates an encrypted database
that maps changes to and from your database. In this example, the
encrypted database exists on a CouchDB instance, while the decrypted
one lives on disk.
  `)
  await db.setPassword(password, {
    name: [COUCH_URL, 'comdb-example'].join('/')
  })
  const { id } = await db.post({ greetings: 'hello world' })
  const doc = await db.get(id)
  console.log(`Documents are decrypted so that you can maintain indexes on them.
The database's methods, except for replication, refer to the
decrypted database. Here is a decrypted document retrieved by ID:
  `)
  assert.strictEqual(doc.greetings, 'hello world')
  console.log(doc)
  return db._encrypted.allDocs({ include_docs: true })
}).then(async ({ rows }) => {
  // reset the context so i can use var names like `doc` again
  const doc = rows[0].doc
  // this doc lives in couchdb and is encrypted
  console.log(`
... and here is that document, encrypted!
This document lives in CouchDB such that your decrypted data never
leaves the local machine.
  `)
  console.log(doc)
  const { _id: id } = JSON.parse(await db._crypt.decrypt(doc.payload))
  return db.get(id)
}).then((doc) => {
  console.log(`
Here is the payload from that document, decrypted:
  `)
  console.log(doc)
}).then(async () => {
  console.log(`
You can even create a different database and replicate encrypted
data to it. As long as you provide the second instance with the same
password, it will transparently decrypt replicated documents. Now I
will replicate our first database to our second...
  `)
  db2 = new PouchDB('.comdb-example-2')
  const keyDoc = await db.get('_local/comdb')
  delete keyDoc._rev
  await db2.put(keyDoc)
  await db2.setPassword(password)
  await db.replicate.to(db2)
  const { rows } = await db2.allDocs({ include_docs: true, limit: 1 })
  const { doc } = rows[0]
  const otherDoc = await db.get(doc._id)
  assert(isEqual(doc, otherDoc))
  console.log(`... replication successful!

The second database, using the password, has automatically decrypted
the remote documents. The encrypted version remains on the server,
unchanged.
  `)
}).then(() => {
  console.log(`Cool, huh?
  `)
}).catch((error) => {
  console.error(error)
}).then(async () => {
  await db.destroy()
  if (db2) { await db2.destroy() }
})
