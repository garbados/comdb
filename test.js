/* global describe, it, beforeEach, afterEach */
'use strict'

const isEqual = require('lodash.isequal')
const assert = require('assert')
const PouchDB = require('pouchdb')
const Crypt = require('garbados-crypt')

PouchDB.plugin(require('pouchdb-adapter-memory'))
PouchDB.plugin(require('.'))

const {
  COUCH_URL,
  USE_COUCH
} = process.env

describe('ComDB', function () {
  this.timeout(10 * 1000)

  beforeEach(async function () {
    this.password = 'hello-world'
    this.name = '.comdb-test'
    this.db = new PouchDB(this.name)
    await this.db.setPassword(this.password, {
      name: COUCH_URL && USE_COUCH && `${COUCH_URL}/comdb-test`
    })
  })

  afterEach(function () {
    return this.db.destroy()
  })

  it('should encrypt writes', async function () {
    const { id } = await this.db.post({ hello: 'world' })
    const doc = await this.db.get(id)
    const { rows } = await this.db._encrypted.allDocs({ include_docs: true })
    const { payload } = rows[0].doc
    const json = await this.db._crypt.decrypt(payload)
    const plainDoc = JSON.parse(json)
    assert.equal(doc.hello, plainDoc.hello, 'Unencrypted and decrypted documents differ.')
  })

  it('should decrypt and handle deletions', async function () {
    // delete a document by inserting a payload into the encrypted db
    const { id } = await this.db.post({ hello: 'galaxy' })
    const doc = await this.db.get(id)
    doc._deleted = true
    const { id: encryptedId } = await this.db._encrypted.post(doc)
    const encryptedDoc = await this.db._encrypted.get(encryptedId)
    const json = await this.db._crypt.decrypt(encryptedDoc.payload)
    const plainDoc = JSON.parse(json)
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

  describe('initialization', function () {
    beforeEach(async function () {
      this.db2 = new PouchDB(this.name + '2')
    })

    afterEach(async function () {
      await this.db2.destroy()
    })

    it('should fail without a password', async function () {
      try {
        await this.db2.setPassword()
        throw new Error('fail')
      } catch (err) {
        assert.equal(err.message, 'You must provide a password.')
      }
    })

    it('should fail if password is not a string', async function () {
      try {
        await this.db2.setPassword({ password: 'hello' })
        throw new Error('fail')
      } catch (err) {
        assert.equal(err.message, 'Password must be a string.')
      }
    })
  })

  describe('offline recovery', function () {
    beforeEach(function () {
      this.offline = {
        decrypted: 'offline-decrypted',
        encrypted: 'offline-encrypted'
      }
      this.crypt = new Crypt(this.password)
      this.dbs = {
        decrypted: new PouchDB(this.offline.decrypted),
        encrypted: new PouchDB(this.offline.encrypted)
      }
    })

    afterEach(async function () {
      await this.dbs.decrypted.destroy({ unencrypted_only: true })
      await this.dbs.encrypted.destroy()
    })

    it('should process encrypted writes that happened offline', async function () {
      // 1. write to encrypted db
      await this.dbs.encrypted.post({ _id: 'hello', hello: 'world' })
      // 2. provide encrypted db with necessary auth
      await this.dbs.encrypted.put({
        _id: '_local/comdb',
        exportString: await this.crypt.export()
      })
      await this.dbs.decrypted.setPassword(this.password, { name: this.offline.encrypted })
      // 3. load docs from encrypted db
      await this.dbs.decrypted.loadEncrypted()
      // check for doc in db
      const doc = await this.dbs.decrypted.get('hello')
      assert.equal(doc.hello, 'world')
    })

    it('should process encrypted writes w/o revs', async function () {
      // 1. write to decrypted db
      const { id } = await this.dbs.decrypted.post({ hello: 'world' })
      const { _rev: rev, ...postDoc } = await this.dbs.decrypted.get(id)
      // 2. write encrypted doc to de
      const payload = await this.crypt.encrypt(JSON.stringify(postDoc))
      await this.dbs.encrypted.post({ payload, isEncrypted: true })
      // 3. provide encrypted db with necessary auth
      await this.dbs.encrypted.put({
        _id: '_local/comdb',
        exportString: await this.crypt.export()
      })
      await this.dbs.decrypted.setPassword(this.password, { name: this.offline.encrypted })
      // 4. load docs from encrypted db
      await this.dbs.decrypted.loadEncrypted()
      // check for doc in db
      const doc = await this.dbs.decrypted.get(id)
      assert.equal(doc.hello, 'world')
    })

    it('should process decrypted writes that happened offline', async function () {
      await this.dbs.decrypted.post({ hello: 'world' })
      await this.dbs.decrypted.setPassword(this.password, { name: this.offline.encrypted })
      let result = await this.dbs.encrypted.allDocs()
      assert.equal(result.rows.length, 0)
      await this.dbs.decrypted.loadDecrypted()
      result = await this.dbs.encrypted.allDocs()
      assert.equal(result.rows.length, 1)
    })

    it('should process decrypted writes repeatedly', async function () {
      await this.dbs.decrypted.post({ hello: 'world' })
      await this.dbs.decrypted.setPassword(this.password, { name: this.offline.encrypted })
      let result = await this.dbs.encrypted.allDocs()
      assert.equal(result.rows.length, 0)
      await this.dbs.decrypted.loadDecrypted()
      await this.dbs.decrypted.loadDecrypted()
      await this.dbs.decrypted.loadDecrypted()
      result = await this.dbs.encrypted.allDocs()
      assert.equal(result.rows.length, 1)
    })

    it('should allow persistent loading of decrypted writes', async function () {
      await this.dbs.decrypted.setPassword(this.password, { name: this.offline.encrypted })
      const changes = this.dbs.decrypted.loadDecrypted({ live: true })
      let ok = false
      changes.on('change', () => { ok = true })
      await this.dbs.decrypted.post({ hello: 'world' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert(ok)
      changes.cancel()
    })
  })

  describe('destroy', function () {
    beforeEach(async function () {
      this.db_destroyable_1 = new PouchDB('test-destroy-1')
      this.db_destroyable_2 = new PouchDB('test-destroy-2')
      await this.db_destroyable_1.setPassword('goodpassword')
      await this.db_destroyable_2.setPassword('goodpassword')
    })

    afterEach(async function () {
      await this.db_destroyable_1.destroy()
      await this.db_destroyable_2.destroy()
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
    beforeEach(async function () {
      this.db2 = new PouchDB(`${this.name}-replication`)
      const exportString = await this.db.exportComDB()
      await this.db2.importComDB(this.password, exportString)
      await this.db.post({ hello: 'sol' })
    })

    afterEach(async function () {
      await this.db2.destroy()
    })

    it('should restore data from an encrypted backup', async function () {
      await this.db.replicate.to(this.db2)
      const opts = { include_docs: true }
      const results1 = await this.db.allDocs(opts)
      const results2 = await this.db2.allDocs(opts)
      assert.strictEqual(results1.total_rows, results2.total_rows)
      const doc1 = results1.rows[0].doc
      const doc2 = results2.rows[0].doc
      assert(isEqual(doc1, doc2))
    })

    it('should perform normal replication ok', async function () {
      await this.db.replicate.to(this.db2, { comdb: false })
      const opts = { include_docs: true }
      const results1 = await this.db.allDocs(opts)
      const results2 = await this.db2.allDocs(opts)
      assert.strictEqual(results1.total_rows, results2.total_rows)
      const doc1 = results1.rows[0].doc
      const doc2 = results2.rows[0].doc
      assert(isEqual(doc1, doc2))
    })
  })

  describe('replication w/o setup', async function () {
    beforeEach(async function () {
      this.db2 = new PouchDB(this.name + '2')
      this.db3 = new PouchDB(this.name + '3')
    })

    afterEach(async function () {
      await this.db2.destroy()
      await this.db3.destroy()
    })

    it('should replicate ok w/o setting a password', async function () {
      await this.db2.post({ hello: 'world' })
      await this.db2.replicate.to(this.db3)
      const { rows } = await this.db3.allDocs()
      assert.equal(rows.length, 1)
    })
  })

  describe('concurrency', function () {
    beforeEach(async function () {
      this.db1 = new PouchDB('.test-concurrency')
      this.db2 = new PouchDB('.test-concurrency')
    })

    afterEach(async function () {
      await this.db1.destroy()
    })

    it('should setup ok, concurrently', async function () {
      await Promise.all([
        this.db1.setPassword(this.password),
        this.db2.setPassword(this.password)
      ])
      const doc1 = { _id: 'hello', hello: 'world' }
      await this.db1.put(doc1)
      const doc2 = await this.db2.get(doc1._id)
      assert.equal(doc1.hello, doc2.hello)
    })
  })

  describe('in memory', function () {
    beforeEach(async function () {
      this.tempDb = new PouchDB('in-memory-test', { adapter: 'memory' })
      this.tempEncryptedDbName = 'in-memory-test-backup'
      await this.tempDb.setPassword(this.password, { name: this.tempEncryptedDbName })
    })

    afterEach(async function () {
      try {
        await this.tempDb.destroy()
      } catch (err) {} // FIXME catch? maybe?
    })

    it('can create and recover', async function () {
      const { id } = await this.tempDb.post({ hello: 'world' })
      await this.tempDb.destroy({ unencrypted_only: true })
      const otherDb = new PouchDB('in-memory-test-2', { adapter: 'memory' })
      await otherDb.setPassword(this.password, { name: this.tempEncryptedDbName })
      await otherDb.loadEncrypted()
      const doc = await otherDb.get(id)
      assert.equal(doc.hello, 'world')
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
