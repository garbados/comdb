'use strict'

const assert = require('assert')
const crypto = require('crypto')

const ALGORITHM_NAME = 'aes-128-gcm'
const ALGORITHM_NONCE_SIZE = 12
const ALGORITHM_TAG_SIZE = 16
const ALGORITHM_KEY_SIZE = 16
const PBKDF2_NAME = 'sha256'
const PBKDF2_SALT_SIZE = 16
const PBKDF2_ITERATIONS = 10000

module.exports = class Crypt {
  constructor (password, options = {}) {
    assert(password, 'A password is required for encryption or decryption.')
    this.password = password
    this.algorithmName = options.algorithmName || ALGORITHM_NAME
    this.algorithmNonceSize = options.algorithmNonceSize || ALGORITHM_NONCE_SIZE
    this.algorithmTagSize = options.algorithmTagSize || ALGORITHM_TAG_SIZE
    this.algorithmKeySize = options.algorithmKeySize || ALGORITHM_KEY_SIZE
    this.pbkdf2Name = options.pbkdf2Name || PBKDF2_NAME
    this.pbkdf2SaltSize = options.pbkdf2SaltSize || PBKDF2_SALT_SIZE
    this.pbkdf2Iterations = options.pbkdf2Iterations || PBKDF2_ITERATIONS
  }

  encrypt (plaintext) {
    if (typeof plaintext !== 'string') return this.encrypt(JSON.stringify(plaintext))
    const salt = crypto.randomBytes(this.pbkdf2SaltSize)
    return this._pbkdf2(salt).then((key) => {
      const ciphertextAndNonceAndSalt = Buffer.concat([
        salt,
        this._encryptWithKey(Buffer.from(plaintext, 'utf8'), key)
      ])
      return ciphertextAndNonceAndSalt.toString('base64')
    })
  }

  decrypt (base64CiphertextAndNonceAndSalt) {
    const ciphertextAndNonceAndSalt = Buffer.from(base64CiphertextAndNonceAndSalt, 'base64')
    const salt = ciphertextAndNonceAndSalt.slice(0, this.pbkdf2SaltSize)
    const ciphertextAndNonce = ciphertextAndNonceAndSalt.slice(this.pbkdf2SaltSize)
    return this._pbkdf2(salt).then((key) => {
      return this._decryptWithKey(ciphertextAndNonce, key).toString('utf8')
    })
  }

  _pbkdf2 (salt) {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        Buffer.from(this.password, 'utf8'),
        salt,
        this.pbkdf2Iterations,
        this.algorithmKeySize,
        this.pbkdf2Name,
        (err, key) => {
          if (err) return reject(err)
          return resolve(key)
        })
    })
  }

  _encryptWithKey (plaintext, key) {
    const nonce = crypto.randomBytes(this.algorithmNonceSize)
    const cipher = crypto.createCipheriv(this.algorithmName, key, nonce)
    const ciphertext = Buffer.concat([ cipher.update(plaintext), cipher.final() ])
    return Buffer.concat([ nonce, ciphertext, cipher.getAuthTag() ])
  }

  _decryptWithKey (ciphertextAndNonce, key) {
    const nonce = ciphertextAndNonce.slice(0, this.algorithmNonceSize)
    const ciphertext = ciphertextAndNonce.slice(
      this.algorithmNonceSize,
      ciphertextAndNonce.length - this.algorithmTagSize)
    const tag = ciphertextAndNonce.slice(ciphertext.length + this.algorithmNonceSize)
    const cipher = crypto.createDecipheriv(this.algorithmName, key, nonce)
    cipher.setAuthTag(tag)
    return Buffer.concat([ cipher.update(ciphertext), cipher.final() ])
  }
}
