'use strict'

const Crypt = require('garbados-crypt')
const transform = require('transform-pouch')
const createHash = require('create-hash')

const PASSWORD_REQUIRED = 'You must provide a password.'
const PASSWORD_NOT_STRING = 'Password must be a string.'

const HASH_ALGO = 'sha256'

async function hash (payload) {
  const hash = createHash(HASH_ALGO)
  hash.update(payload)
  return hash.digest('hex')
}

function cbify (promise, callback) {
  return !callback
    ? promise // no callback. just return the promise.
    : promise // or, delegate to the callback on result and error
      .then((result) => { return callback(null, result) })
      .catch((error) => { return callback(error) })
}

module.exports = function (PouchDB) {
  // apply plugins
  PouchDB.plugin(transform)

  // save originals
  const destroy = PouchDB.prototype.destroy
  const replicate = PouchDB.replicate

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
    if (!password) { throw new Error(PASSWORD_REQUIRED) }
    if (typeof password !== 'string') { throw new Error(PASSWORD_NOT_STRING) }
    this._password = password
    this._crypt = new Crypt(password)
    const encryptedName = opts.name || `${this.name}-encrypted`
    const encryptedOpts = opts.opts || {}
    this._encrypted = new PouchDB(encryptedName, encryptedOpts)
    this._encrypted.transform({
      // encrypt docs as they go in
      incoming: async (doc) => {
        // catch encrypted writes and apply them to the decrypted database
        if (doc.isEncrypted) {
          // first we decrypt the encrypted write
          const json = await this._crypt.decrypt(doc.payload)
          const decryptedDoc = JSON.parse(json)
          // then we put it into the decrypted database
          if (decryptedDoc._deleted) {
            try { await this.remove(decryptedDoc) } catch { /* mimic new_edits: false */ }
          } else {
            await this.bulkDocs({ docs: [decryptedDoc], new_edits: false })
          }
          // finally we put it in the encrypted database unmolested
          return doc
        }
        // encrypt the doc
        const json = JSON.stringify(doc)
        const payload = await this._crypt.encrypt(json)
        // get a deterministic ID
        const id = await hash(payload)
        return { _id: id, payload, isEncrypted: true }
      }
    })
    this._encrypted._decrypted_changes = this.changes({
      live: true,
      descending: true,
      include_docs: true
    })
    this._encrypted._decrypted_changes.on('change', async ({ doc }) => {
      if (this._encrypted._destroyed) { return }
      try { await this._encrypted.put(doc) } catch { /* mimic new_edits:true */ }
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

  // load from encrypted db, to catch up to offline writes
  PouchDB.prototype.loadEncrypted = async function (callback) {
    const changes = this._encrypted.changes({ include_docs: true })
    const promises = []
    changes.on('change', async ({ doc: { payload } }) => {
      const json = await this._crypt.decrypt(payload)
      const doc = JSON.parse(json)
      const promise = this.bulkDocs({ docs: [doc], new_edits: false })
      promises.push(promise)
    })
    await new Promise((resolve, reject) => {
      changes.on('complete', resolve)
      changes.on('error', reject)
    })
    return cbify(Promise.all(promises), callback)
  }
}
