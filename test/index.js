/* global describe, it, before, after */
'use strict'

const { isEqual } = require('lodash')
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

  it('should encrypt writes', function () {
    return this.db.post({ hello: 'world' }).then(({ id }) => {
      return this.db.get(id)
    }).then((doc) => {
      return this.db._encrypted.allDocs({ include_docs: true }).then(({ rows }) => {
        const { payload } = rows[0].doc
        return this.db.decrypt(payload)
      }).then((plainDoc) => {
        assert(isEqual(doc, plainDoc), 'Unencrypted and decrypted documents differ.')
      })
    })
  })

  it('should decrypt and handle deletions', function () {
    // this test fails for reasons i do not understand
    return this.db.post({ hello: 'galaxy' }).then(({ id }) => {
      return this.db.get(id)
    }).then((doc) => {
      doc._deleted = true
      return this.db.encrypt(doc).then((payload) => {
        return this.db._encrypted.post({ payload }).then(({ id }) => {
          return this.db._encrypted.get(id)
        }).then(({ payload }) => {
          return this.db.decrypt(payload)
        }).then((plainDoc) => {
          assert.equal(plainDoc._deleted, true)
        })
      }).then(() => {
        let caught = false
        return this.db.get(doc._id).catch((error) => {
          assert.equal(error.name, 'not_found')
          caught = true
        }).then((doc) => {
          assert(caught, 'Document was not deleted!')
        })
      })
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
        ]).then(([ results1, results2 ]) => {
          assert.equal(results1.total_rows, results2.total_rows)
          const doc1 = results1.rows[0].doc
          const doc2 = results2.rows[0].doc
          assert(isEqual(doc1, doc2))
        })
      })
    })
  })
})
