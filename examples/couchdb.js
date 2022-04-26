#!/usr/bin/env node
'use strict'

console.log('# Using ComDB with CouchDB')

const isEqual = require('lodash.isequal')
const assert = require('assert')
const PouchDB = require('pouchdb')
PouchDB.plugin(require('..'))

const COUCH_URL = process.env.COUCH_URL || 'http://localhost:5984'
assert(COUCH_URL, 'This example requires that $COUCH_URL be set to a URL for accessing a CouchDB instance.')
const COUCH_DB_URL = `${COUCH_URL}/comdb-example`

const password = 'scarcity-is-artificial'

// create the database and set a password
const db = new PouchDB('.comdb-example')
let db2, db3

Promise.resolve().then(async () => {
  console.log(`
When you set a password for ComDB, it creates an encrypted database that maps changes to and from your database. In this example, the encrypted database exists on a CouchDB instance, while the decrypted one lives on disk.
  `)
  await db.setPassword(password, { name: COUCH_DB_URL })
  const { id } = await db.post({ greetings: 'hello world' })
  const doc = await db.get(id)
  console.log(`Documents are decrypted so that you can maintain indexes on them. The database's methods, except for replication, refer to the decrypted database. Here is a decrypted document retrieved by ID:
  `)
  assert.strictEqual(doc.greetings, 'hello world')
  console.log(doc)
  return db._encrypted.allDocs({ include_docs: true })
}).then(async ({ rows }) => {
  // reset the context so i can use var names like `doc` again
  const doc = rows[0].doc
  // this doc lives in couchdb and is encrypted
  console.log(`
The encrypted document lives in CouchDB such that your decrypted data never leaves the local machine. Here's how the encrypted version looks:
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
You can even create a different decrypted database and replicate encrypted data to it. As long as you are using the same encrypted copy, you can do this with just a password.

But perhaps you are maintaining a separate encrypted copy, such as on another device. Then you will need to export your encryption key. First, use \`db.exportComDB()\` to get your encryption key, and then on another device use \`db.importComDB()\` to set up encryption. As long as you provide the second instance with the same password and encryption key, it will transparently decrypt replicated documents. Now I will replicate our first database to our second...
  `)
  db2 = new PouchDB('.comdb-example-2')
  // set up encryption to use a pre-existing encrypted copy
  await db2.setPassword(password, { name: COUCH_DB_URL }) // use same encrypted copy
  await db2.loadEncrypted() // load encrypted docs from pre-existing copy
  const { rows: [{ doc }] } = await db2.allDocs({ include_docs: true, limit: 1 })
  const otherDoc = await db.get(doc._id)
  assert(isEqual(doc, otherDoc))
  // set up encryption to replicate from a pre-existing encrypted copy
  const key = await db2.exportComDB() // get this on one device...
  db3 = new PouchDB('.comdb-example-3')
  await db3.importComDB(password, key) // then use it to set up encryption on another
  await db3.replicate.from(COUCH_DB_URL)
  const { rows: [{ doc: doc2 }] } = await db3.allDocs({ include_docs: true, limit: 1 })
  assert(isEqual(doc2, otherDoc))
  console.log(`... replication successful!

The second database, using the password, has automatically decrypted the remote documents. The encrypted version remains on the server, unchanged.
  `)
}).then(() => {
  console.log(`Cool, huh?
  `)
}).catch((error) => {
  console.error('Something has gone wrong in an example! You should report this as a bug.')
  console.error(error)
}).then(async () => {
  await db.destroy()
  if (db2) { await db2.destroy() }
  if (db3) { await db3.destroy() }
})
