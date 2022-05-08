#!/usr/bin/env node
'use strict'

console.log('# Encrypting an existing decrypted database')

const assert = require('assert').strict
const PouchDB = require('pouchdb')
PouchDB.plugin(require('..'))

const PASSWORD = process.env.COMDB_PASSWORD || 'everything-to-everyone'
const ORIGINAL_DB = process.env.ORIGINAL_COUCH_URL || '.original'
const TRANSIENT_DB = process.env.TRANSIENT_COUCH_URL || '.encrypted'
const DECRYPTED_DB = process.env.DECRYPTED_COUCH_URL || '.decrypted'

const NUM_DOCS = 1e3

const db = new PouchDB(ORIGINAL_DB)
const db2 = new PouchDB(DECRYPTED_DB)

console.log('')
console.log(`
You can encrypt a database "in-place" by copying its contents
over to a transient replica, encrypting documents as you go.
Once the replica is finished, empty the original and replicate
the replica onto it. After that, the original will be encrypted.
`.trim())

Promise.resolve().then(async () => {
  const startTime = Date.now()
  // add some decrypted data
  console.log('')
  console.log(`
First, we'll load some docs into our unencrypted original,
to mimic the documents you already have in yours.

Writing ${NUM_DOCS} docs...
  `.trim())
  const docs = []
  for (let i = 0; i < NUM_DOCS; i++) {
    docs.push({ hello: 'world', i })
  }
  await db.bulkDocs({ docs })
  // set up the encrypted copy
  console.log('')
  console.log('Setting up the transient encrypted copy...')
  await db.setPassword(PASSWORD, { name: TRANSIENT_DB })
  console.log('')
  console.log('Encrypting docs and load them into the transient copy...')
  await db.loadDecrypted()
  // get the export string, because it won't replicate
  console.log('')
  console.log('Saving the export string needed for decryption...')
  const exportString = await db.exportComDB()
  // now delete the decrypted copy
  console.log('')
  console.log('>> EMPTYING ORIGINAL <<')
  await db.destroy({ unencrypted_only: true })
  // copy the encrypted copy over the original
  console.log('')
  console.log('Replicating encrypted transient copy to populate emptied original...')
  await PouchDB.replicate(db._encrypted, ORIGINAL_DB)
  await db._encrypted.destroy()
  // now you can use the original DB as an encrypted copy
  console.log('')
  console.log(`
In order to decrypt documents, both a password and an export string are required.
So, we set up the now-encrypted original with the export string from the
transient copy. Then you will be able to decrypt documents.

Using the saved export string to set up decryption with new original...
  `.trim())
  await db2.importComDB(PASSWORD, exportString, { name: ORIGINAL_DB })
  console.log('')
  console.log('Loading docs from original into the new decrypted database...')
  await db2.loadEncrypted()
  console.log('')
  console.log('Verifying that all expected contents have been copied over...')
  const result = await db2.allDocs()
  console.log('')
  console.log(`New decrypted database has ${result.total_rows} documents in it.`)
  assert.equal(NUM_DOCS, result.total_rows)
  const endTime = Date.now()
  console.log('')
  console.log(`Encrypting ${NUM_DOCS} in place took ${endTime - startTime}ms.`)
}).catch(console.error).then(async () => {
  await Promise.allSettled([db.destroy(), db2.destroy()])
})
