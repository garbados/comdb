'use strict'

const isEqual = require('lodash.isequal')
const assert = require('assert')
const Crypt = require('./lib/crypt')

function cbify (promise, callback) {
  return !callback
    ? promise
    : promise.then((result) => {
      return callback(null, result)
    }).catch((error) => {
      return callback(error)
    })
}

module.exports = function (PouchDB) {
  // save originals
  const destroy = PouchDB.prototype.destroy
  const bulkDocs = PouchDB.prototype.bulkDocs
  const replicate = PouchDB.replicate
  // private helpers
  async function processEncryptedChange (decrypted, encrypted, ids = []) {
    if (ids.length === 0) { return }
    const changes = []
    for (const id of ids) {
      const { payload } = await encrypted.get(id)
      const newDoc = await decrypted.decrypt(payload)
      let change
      try {
        const doc = await decrypted.get(newDoc._id)
        change = isEqual(newDoc, doc) ? undefined : newDoc
      } catch (err) {
        if (err.name === 'not_found') {
          change = newDoc
        } else {
          throw err
        }
      }
      changes.push(change)
    }
    const decryptedDocs = changes.filter(x => !!x)
    const deletedDocs = changes.filter(doc => !!doc._deleted)
    return Promise.all([
      bulkDocs.call(decrypted, decryptedDocs, { new_edits: false }),
      bulkDocs.call(decrypted, deletedDocs)
    ]).then(([results1, results2]) => {
      return [...results1, ...results2]
    })
  }

  async function processDecryptedChange (decrypted, encrypted, ids) {
    if (ids.length === 0) { return }
    const encryptedDocs = []
    for (const id of ids) {
      const doc = await decrypted.get(id)
      const payload = await decrypted.encrypt(doc)
      const encryptedDoc = { payload }
      const latestChanges = await encrypted.changes({ limit: 1, include_docs: true })
      if (latestChanges.results && latestChanges.results.length) {
        const latestChange = latestChanges.results[0].doc
        if (payload !== latestChange.payload) {
          encryptedDocs.push(encryptedDoc)
        }
      } else {
        encryptedDocs.push(encryptedDoc)
      }
    }
    return bulkDocs.call(encrypted, encryptedDocs)
  }
  // replication wrapper; handles ComDB instances transparently
  PouchDB.replicate = function (source, target, opts = {}, callback) {
    if (opts.comdb !== false) {
      if (source._encrypted) source = source._encrypted
      if (target._encrypted) target = target._encrypted
    }
    const promise = replicate(source, target, opts)
    return cbify(promise, callback)
  }
  // setup function; must call before anything works
  PouchDB.prototype.setPassword = function (password, opts = {}) {
    assert(password, 'You must provide a password.')
    assert(typeof password === 'string', 'Password must be a string.')
    const self = this
    this._password = password
    this._crypt = new Crypt(password, opts.crypt || {})
    const encryptedName = opts.name || [this.name, 'encrypted'].join('-')
    const encryptedOpts = opts.opts || {}
    this._encrypted = new PouchDB(encryptedName, encryptedOpts)
    // encrypted changes handler
    // - decrypts docs and maybe saves them to the decrypted db
    this._encrypted.bulkDocs = function (docs, opts = {}, callback) {
      const processChange = processEncryptedChange.bind(null, self, this)
      const promise = bulkDocs.call(this, docs, opts).then((results) => {
        if (!results.length) {
          // sometimes a non-failure elides results,
          // particularly with new_edits:false
          results = (docs && docs.docs) || docs
        }
        const ids = results.map((result) => {
          return result.id || result._id
        })
        return processChange(ids).then(() => {
          return results
        })
      })
      return cbify(promise, callback)
    }
  }
  // decrypted bulkDocs wrapper
  // - encrypts docs and maybe saves them to the encrypted db
  PouchDB.prototype.bulkDocs = async function (docs, opts = {}, callback) {
    if (typeof opts === 'function') {
      opts = {}
      callback = opts
    }
    if (!this._crypt) {
      const promise = bulkDocs.call(this, docs, opts)
      return cbify(promise, callback)
    }
    const processChange = processDecryptedChange.bind(null, this, this._encrypted)
    const results = await bulkDocs.call(this, docs, opts)
    const ids = results.map(({ id }) => { return id })
    await processChange(ids)
    const promise = Promise.resolve(results)
    return cbify(promise, callback)
  }
  // encryption convenience function
  PouchDB.prototype.encrypt = function (doc) {
    assert(this._crypt, 'Must set a password with `.setPassword(password)` before encrypting documents.')
    return this._crypt.encrypt(doc)
  }
  // decryption convenience function; takes the output of .encrypt
  PouchDB.prototype.decrypt = function (payload) {
    assert(this._crypt, 'Must set a password with `.setPassword(password)` before decrypting documents.')
    return this._crypt.decrypt(payload).then((plaintext) => {
      return JSON.parse(plaintext)
    })
  }
  // destroy wrapper that destroys both the encrypted and decrypted DBs
  PouchDB.prototype.destroy = function (opts = {}, callback) {
    let promise
    if (!this._encrypted || opts.unencrypted_only) {
      promise = destroy.call(this, opts)
    } else if (opts.encrypted_only) {
      promise = destroy.call(this._encrypted, opts)
    } else {
      promise = Promise.all([
        destroy.call(this._encrypted, opts),
        destroy.call(this, opts)
      ])
    }
    return cbify(promise, callback)
  }
}
