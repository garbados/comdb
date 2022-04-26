#!/usr/bin/env node
'use strict'

const assert = require('assert')
const PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-adapter-memory'))
PouchDB.plugin(require('..'))

const NAME = '.comdb-example'
const ID = 'example'
const PASSWORD = 'do-not-allow-fear-to-goad-you-into-a-life-of-regret'

Promise.resolve().then(async () => {
  // create an in-memory database
  const db = new PouchDB(NAME, { adapter: 'memory' })
  // create an encrypted on-disk copy
  await db.setPassword(PASSWORD)
  // write a doc
  await db.put({ _id: ID })
  // destroy the unencrypted copy
  await db.destroy({ unencrypted_only: true })
  // user restarts app, refresh the page, etc.
  const db2 = new PouchDB(NAME, { adapter: 'memory' })
  // set your password normally. it accesses the same encrypted on-disk copy
  await db2.setPassword(PASSWORD)
  // load documents from the encrypted copy
  await db2.loadEncrypted()
  // get the doc
  const doc = await db2.get(ID)
  // it's the same one
  assert.equal(doc._id, ID)
  // clean up
  await db2.destroy()
  // thank you for reading
  console.log('done')
}).catch((err) => {
  console.error('Something has gone wrong in an example! You should report this as a bug.')
  console.error(err)
})
