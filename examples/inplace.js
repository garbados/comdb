#!/usr/bin/env node
'use strict'

console.log('# Encrypting an existing decrypted database')

const PouchDB = require('pouchdb')
PouchDB.plugin(require('..'))

const PASSWORD = process.env.COMDB_PASSWORD || 'everything-to-everyone'
const ORIGINAL_DB = process.env.ORIGINAL_COUCH_URL || '.original'
const ENCRYPTED_DB = process.env.ENCRYPTED_COUCH_URL || '.encrypted'
const DECRYPTED_DB = process.env.DECRYPTED_COUCH_URL || '.decrypted'

const NUM_DOCS = 1e2

const db = new PouchDB(ORIGINAL_DB)
const db2 = new PouchDB(DECRYPTED_DB)

Promise.resolve().then(async () => {
  // add some decrypted data
  console.log(`Writing ${NUM_DOCS} docs...`)
  const docs = []
  for (let i = 0; i < NUM_DOCS; i++) {
    docs.push({ hello: 'world', i })
  }
  await db.bulkDocs({ docs })
  // set up the encrypted copy
  console.log('Setting up the encrypted copy...')
  await db.setPassword(PASSWORD, { name: ENCRYPTED_DB })
  console.log('Loading docs into encrypted copy...')
  await db.loadDecrypted()
  // get the export string, because it won't replicate
  console.log('Preparing to export to new database...')
  const exportString = await db.exportComDB()
  // now delete the decrypted copy
  console.log('>> DESTROYING ORIGINAL <<')
  await db.destroy({ unencrypted_only: true })
  // copy the encrypted copy over the original
  console.log('Replicating encrypted copy over original...')
  await PouchDB.replicate(ENCRYPTED_DB, ORIGINAL_DB)
  await db._encrypted.destroy()
  // now you can use the original DB as an encrypted copy
  console.log('Setting up new database to use original as encrypted copy...')
  await db2.importComDB(PASSWORD, exportString, { name: ORIGINAL_DB })
  await db2.loadEncrypted()
  console.log('Verifying that all expected contents have been copied over...')
  const result = await db2.allDocs()
  console.log(`Final DB has ${result.total_rows} decrypted documents in it.`)
  console.log(NUM_DOCS === result.total_rows ? 'OK!' : 'ERROR')
}).catch(console.error).then(async () => {
  await Promise.allSettled([db.destroy(), db2.destroy()])
})
