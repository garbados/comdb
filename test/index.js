/* global describe, it, before, after */
'use strict'

const isEqual = require('lodash.isequal')
const assert = require('assert')
const PouchDB = require('pouchdb')
const ComDB = require('..')

describe('ComDB', function () {
  before(function () {
    PouchDB.plugin(ComDB)
    this.password = 'hello-world'
    this.name = '.comdb-test'
    this.db = new PouchDB(this.name)
    this.db.setPassword(this.password, {
      name: process.env.COUCH_URL && [process.env.COUCH_URL, 'comdb-test'].join('/')
    })
  })

  after(function () {
    return this.db.destroy()
  })

  it('should encrypt writes', async function () {
    const { id } = await this.db.post({ hello: 'world' })
    const doc = await this.db.get(id)
    const { rows } = await this.db._encrypted.allDocs({ include_docs: true })
    const { payload } = rows[0].doc
    const plainDoc = await this.db.decrypt(payload)
    assert(isEqual(doc, plainDoc), 'Unencrypted and decrypted documents differ.')
  })

  it('should decrypt and handle deletions', async function () {
    // delete a document by inserting a payload into the encrypted db
    const { id } = await this.db.post({ hello: 'galaxy' })
    const doc = await this.db.get(id)
    doc._deleted = true
    const payload = await this.db.encrypt(doc)
    const { id: encryptedId } = await this.db._encrypted.post({ payload })
    const encryptedDoc = await this.db._encrypted.get(encryptedId)
    const plainDoc = await this.db.decrypt(encryptedDoc.payload)
    assert.strictEqual(plainDoc._deleted, true)
    let caught = false
    // now test that it was deleted in the decrypted copy
    try {
      await this.db.get(doc._id)
    } catch (error) {
      assert.strictEqual(error.name, 'not_found')
      caught = true
    }
    assert(caught, 'Document was not deleted!')
  })

  describe('destroy', function () {
    before(function () {
      this.db_destroyable_1 = new PouchDB('test-destroy-1')
      this.db_destroyable_2 = new PouchDB('test-destroy-2')
      this.db_destroyable_1.setPassword('goodpassword')
      this.db_destroyable_2.setPassword('goodpassword')
    })

    after(async function () {
      await this.db_destroyable_1._encrypted.destroy()
      await this.db_destroyable_2.destroy({ unencrypted_only: true })
    })

    it('should optionally not destroy the encrypted copy', async function () {
      await this.db_destroyable_1.destroy({ unencrypted_only: true })
      assert.equal(this.db_destroyable_1._encrypted._destroyed, undefined)
      assert.equal(this.db_destroyable_1._destroyed, true)
    })

    it('should optionally not destroy the unencrypted copy', async function () {
      await this.db_destroyable_2.destroy({ encrypted_only: true })
      assert.equal(this.db_destroyable_2._encrypted._destroyed, true)
      assert.equal(this.db_destroyable_2._destroyed, undefined)
    })
  })

  describe('replication', function () {
    before(function () {
      this.name2 = [this.name, '2'].join('-')
      this.db2 = new PouchDB(this.name2)
      this.db2.setPassword(this.password)
      return this.db.post({ hello: 'sol' })
    })

    after(function () {
      return this.db2.destroy()
    })

    it('should restore data from an encrypted backup', function () {
      return this.db.replicate.to(this.db2).then(() => {
        const opts = { include_docs: true }
        return Promise.all([
          this.db.allDocs(opts),
          this.db2.allDocs(opts)
        ]).then(([results1, results2]) => {
          assert.strictEqual(results1.total_rows, results2.total_rows)
          const doc1 = results1.rows[0].doc
          const doc2 = results2.rows[0].doc
          assert(isEqual(doc1, doc2))
        })
      })
    })
  })

  describe('issues', function () {
    it('should handle destruction without a set password', async function () {
      const db3 = new PouchDB('.test-destruction')
      await db3.destroy()
      assert(true)
    })

    it('should handle calls to bulkDocs', async function () {
      const docs = []
      const k = 10
      for (let i = 0; i < k; i++) {
        docs.push({
          _id: String(Math.floor(Math.random() * Date.now())),
          a: Math.random(),
          b: Math.random() * Date.now()
        })
      }
      const result = await this.db.bulkDocs({ docs })
      assert.equal(result.length, k)
    })
  })
})
