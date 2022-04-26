#!/usr/bin/env node
'use strict'

const assert = require('assert')
const PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-adapter-memory'))
PouchDB.plugin(require('..'))

const NAME = '.comdb-example'
const ID = 'example'
const PASSWORD = 'do-not-allow-fear-to-goad-you-into-a-life-of-regret'
const NUM_DOCS = 1e3

let db, db2

Promise.resolve().then(async () => {
  console.log(`
You can achieve end-to-end encryption with ComDB by making your decrypted copy
exist only in memory. Thus, only your encrypted copy is ever written to disk.

In PouchDB, you can do this with the 'pouchdb-adapter-memory' module, which
enables the 'memory' adapter.
    `)
  // create an in-memory database
  db = new PouchDB(NAME, { adapter: 'memory' })
  // create an encrypted on-disk copy
  await db.setPassword(PASSWORD)
  console.log(`
When you write and read documents, you will be interacting with the decrypted
database, and thus these operations will be relatively fast.

Let's write a document to our in-memory database.
    `)
  // write a lot of docs
  const startTime = Date.now()
  const docs = [{ _id: ID }]
  for (let i = 0; i < NUM_DOCS; i++) {
    docs.push({ _id: `${ID}-${i}` })
  }
  await db.bulkDocs(docs)
  const endTime = Date.now()
  // destroy the unencrypted copy
  await db.destroy({ unencrypted_only: true })
  console.log(`
Writing ${NUM_DOCS + 1} documents took ${endTime - startTime}ms.

If you are using an in-memory PouchDB in a browser, then it will be wiped out
whenever you reload the page. By loading from the same encrypted copy, you can
restore your data.
    `)
}).then(async () => {
  // user restarts app, refresh the page, etc.
  db2 = new PouchDB(NAME, { adapter: 'memory' })
  // set your password normally. it accesses the same encrypted on-disk copy
  await db2.setPassword(PASSWORD)
  console.log(`
Because the encrypted copy must be decrypted entirely each time the page refreshes,
this approach imposes a significant startup time.
    `)
  // load documents from the encrypted copy
  const startTime = Date.now() // time how long it takes to set up
  await db2.loadEncrypted()
  const endTime = Date.now()
  // get the doc
  const doc = await db2.get(ID)
  // it's the same one
  assert.equal(doc._id, ID)
  console.log(`
For a database with ${NUM_DOCS + 1} documents, initialization took ${endTime - startTime}ms.
    `)
  // clean up
  await db2.destroy()
  // thank you for reading
  console.log(`
And that's all there is to it!
    `)
}).catch((err) => {
  console.error('Something has gone wrong in an example! You should report this as a bug.')
  console.error(err)
}).then(async () => {
  for (const d of [db, db2]) {
    try {
      await d.destroy()
    } catch (err) {
      // ignore
    }
  }
})
