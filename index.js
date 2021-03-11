'use strict'

const isEqual = require('lodash.isequal')
const assert = require('assert')
const Crypt = require('./lib/crypt')

function cbify (promise, callback) {
  return !callback
    ? promise
    : promise.then((result) => {
      return callback(null, result || [])
    }).catch((error) => {
      return callback(error)
    })
}

function processEncryptedChange (decrypted, encrypted, ids = []) {
  if (ids.length === 0) return Promise.resolve()
  const promises = ids.map((id) => {
    return encrypted.get(id).then(({ payload }) => {
      return decrypted.decrypt(payload)
    }).then((newDoc) => {
      return decrypted.get(newDoc._id).then((doc) => {
        return isEqual(newDoc, doc) ? undefined : newDoc
      }).catch((error) => {
        if (error.name === 'not_found') {
          return newDoc
        } else {
          return Promise.reject(error)
        }
      })
    })
  })
  return Promise.all(promises).then((results) => {
    const decryptedDocs = results.filter((x) => { return !!x })
    const deletedDocs = decryptedDocs.filter((doc) => {
      return doc._deleted
    })
    return Promise.all([
      decrypted.bulkDocs(decryptedDocs, { new_edits: false }),
      decrypted.bulkDocs(deletedDocs)
    ]).then(([results1, results2]) => {
      return results1.concat(results2)
    })
  })
}

function processDecryptedChange (decrypted, encrypted, ids) {
  if (ids.length === 0) return Promise.resolve()
  const promises = ids.map((id) => {
    return decrypted.get(id).then((doc) => {
      return decrypted.encrypt(doc)
    }).then((payload) => {
      const encryptedDoc = { payload }
      return encrypted.changes({
        include_docs: true,
        limit: 1
      }).then((result) => {
        if (result.results && result.results.length) {
          if (payload !== result.results[0].doc.payload) {
            return encryptedDoc
          }
        } else {
          return encryptedDoc
        }
      })
    })
  })
  return Promise.all(promises).then((encryptedDocs) => {
    return encrypted.bulkDocs(encryptedDocs)
  })
}

module.exports = function (PouchDB) {
  // save originals
  const destroy = PouchDB.prototype.destroy
  const bulkDocs = PouchDB.prototype.bulkDocs
  const replicate = PouchDB.replicate
  // replication wrapper; handles ComDB instances transparently
  PouchDB.replicate = function (source, target, opts = {}, callback) {
    if (source._encrypted) source = source._encrypted
    if (target._encrypted) target = target._encrypted
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
  PouchDB.prototype.bulkDocs = function (docs, opts = {}, callback) {
    const processChange = processDecryptedChange.bind(null, this, this._encrypted)
    const promise = bulkDocs.call(this, docs, opts).then((results) => {
      const ids = results.map(({ id }) => { return id }).filter((id) => {
        const d = ((docs && docs.docs) || docs)
        return !d.map(({ _id }) => { return _id }).includes(id)
      })
      return processChange(ids).then(() => {
        return results
      })
    })
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
    if (!this._encrypted) {
      promise = destroy.call(this)
    } else {
      promise = Promise.all([
        destroy.call(this._encrypted, opts),
        destroy.call(this, opts)
      ])
    }
    return cbify(promise, callback)
  }
}
