'use strict'

const Crypt = require('garbados-crypt')
const transform = require('transform-pouch')
const { hash: naclHash } = require('tweetnacl')
const { decodeUTF8, encodeBase64 } = require('tweetnacl-util')
const { v4: uuid } = require('uuid')
const { stringMd5 } = require('pouchdb-md5')

const PASSWORD_REQUIRED = 'You must provide a password.'
const PASSWORD_NOT_STRING = 'Password must be a string.'
const EXPORT_STRING_REQUIRED = 'You must provide an export string.'
const EXPORT_STRING_NOT_STRING = 'Your export string must be a string.'
const LOCAL_ID = '_local/comdb'

async function hash (payload) {
  const bytes = decodeUTF8(payload)
  const hashed = naclHash(bytes)
  return encodeBase64(hashed)
}

module.exports = function (PouchDB) {
  // apply plugins
  PouchDB.plugin(transform)

  // apply class method wrappers
  const replicate = PouchDB.replicate
  PouchDB.replicate = function (source, target, opts = {}) {
    if (opts.comdb !== false) {
      if (source._encrypted) source = source._encrypted
      if (target._encrypted) target = target._encrypted
    }
    return replicate.call(this, source, target, opts)
  }

  // apply instance method wrappers
  const destroy = PouchDB.prototype.destroy
  PouchDB.prototype.destroy = async function (opts = {}) {
    let promise
    if (!this._encrypted || opts.unencrypted_only) {
      // istanbul ignore else
      if (!this._destroyed) { promise = destroy.call(this, opts) }
    } else if (opts.encrypted_only) {
      // istanbul ignore else
      if (!this._encrypted._destroyed) { promise = destroy.call(this._encrypted, opts) }
    } else {
      const promises = []
      if (!this._destroyed) { promises.push(destroy.call(this, opts)) }
      if (!this._encrypted._destroyed) { promises.push(destroy.call(this._encrypted, opts)) }
      promise = Promise.all(promises)
    }
    return promise
  }

  function setupEncrypted (name, opts) {
    const db = new PouchDB(name, opts)

    db.transform({
      // encrypt docs as they go in
      incoming: async (doc) => {
        if (doc.isEncrypted) {
          // feed already-encrypted docs back to the decrypted db
          await this.bulkDocs([doc], { new_edits: false })
          return doc
        } else {
          // encrypt the doc
          const json = JSON.stringify(doc)
          const payload = await this._crypt.encrypt(json)
          // get a deterministic ID
          const id = await hash(json)
          const encrypted = { _id: id, payload, isEncrypted: true }
          // maybe feed back to decrypted db
          if (doc._rev && doc._deleted) {
            await this.bulkDocs([encrypted])
          }
          return encrypted
        }
      }
    })

    return db
  }

  function setupDecrypted () {
    this.transform({
      incoming: async (doc) => {
        if (doc.isEncrypted) {
          // decrypt encrypted payloads being fed back from the encrypted db
          const json = await this._crypt.decrypt(doc.payload)
          const decrypted = JSON.parse(json)
          if (!('_rev' in decrypted)) {
            // construct an artificial rev, predicting what it will be
            decrypted._rev = `1-${stringMd5(JSON.stringify(decrypted))}`
          }
          return decrypted
        } else {
          if (!doc._id) doc._id = uuid()
          await this._encrypted.bulkDocs([doc])
          return doc
        }
      }
    })
  }

  async function setupCrypt (password) {
    // try saving credentials to a local doc
    try {
      // first we try to get saved creds from the local doc
      const { exportString } = await this._encrypted.get(LOCAL_ID)
      this._crypt = await Crypt.import(password, exportString)
    } catch (err) {
      // istanbul ignore else
      if (err.status === 404) {
        // but if the doc doesn't exist, we do first-time setup
        this._crypt = new Crypt(password)
        const exportString = await this._crypt.export()
        try {
          await this._encrypted.put({ _id: LOCAL_ID, exportString })
        } catch (err2) {
          // istanbul ignore else
          if (err2.status === 409) {
            // if the doc was created while we were setting up,
            // try setting up again to retrieve the saved credentials.
            await setupCrypt.call(this, password)
          } else {
            throw err2
          }
        }
      } else {
        throw err
      }
    }
  }

  async function importCrypt (password, exportString) {
    this._crypt = await Crypt.import(password, exportString)
    try {
      await this._encrypted.put({ _id: LOCAL_ID, exportString })
    } catch (err) {
      // istanbul ignore next
      if (err.status !== 409) {
        throw err
      }
    }
  }

  function parseEncryptedOpts (opts) {
    return [
      opts.name || `${this.name}-encrypted`,
      opts.opts || {}
    ]
  }

  function setupComDB (opts) {
    const [encryptedName, encryptedOpts] = parseEncryptedOpts.call(this, opts)
    this._encrypted = setupEncrypted.call(this, encryptedName, encryptedOpts)
    setupDecrypted.call(this)
  }

  // setup function; must call before anything works
  PouchDB.prototype.setPassword = async function (password, opts = {}) {
    if (!password) { throw new Error(PASSWORD_REQUIRED) }
    if (typeof password !== 'string') { throw new Error(PASSWORD_NOT_STRING) }
    setupComDB.call(this, opts)
    await setupCrypt.call(this, password)
  }

  PouchDB.prototype.importComDB = async function (password, exportString, opts = {}) {
    if (!password) { throw new Error(PASSWORD_REQUIRED) }
    if (typeof password !== 'string') { throw new Error(PASSWORD_NOT_STRING) }
    if (!exportString) { throw new Error(EXPORT_STRING_REQUIRED) }
    if (typeof exportString !== 'string') { throw new Error(EXPORT_STRING_NOT_STRING) }
    setupComDB.call(this, opts)
    await importCrypt.call(this, password, exportString)
  }

  PouchDB.prototype.exportComDB = async function () {
    const { exportString } = await this._encrypted.get(LOCAL_ID)
    return exportString
  }

  // load from encrypted db, to catch up to offline writes
  PouchDB.prototype.loadEncrypted = async function (opts = {}) {
    return this._encrypted.replicate.to(this, { ...opts, comdb: false })
  }

  PouchDB.prototype.loadDecrypted = function (opts = {}) {
    const changes = this.changes({
      ...opts,
      include_docs: true,
      return_docs: false
    })
    const promises = []
    let docs = []
    changes.on('change', ({ doc }) => {
      docs.push(doc)
      if (docs.length >= 100) {
        promises.push(this._encrypted.bulkDocs({ docs }))
        docs = []
      }
    })
    if (opts.live) {
      return changes
    } else {
      const closed = new Promise((resolve, reject) => {
        changes.on('complete', () => {
          // istanbul ignore else
          if (docs.length) {
            promises.push(this._encrypted.bulkDocs({ docs }))
          }
          resolve()
        })
        changes.on('error', reject)
      })
      return closed.then(() => {
        return Promise.all(promises)
      })
    }
  }
}
