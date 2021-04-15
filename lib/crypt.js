'use strict'

const assert = require('assert')

const { secretbox, hash, randomBytes } = require('tweetnacl')
const { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 } = require('tweetnacl-util')

module.exports = class Crypt {
  constructor (password) {
    assert(password, 'A password is required for encryption or decryption.')
    this._key = hash(decodeUTF8(password)).slice(0, secretbox.keyLength)
  }

  async encrypt (plaintext) {
    const nonce = randomBytes(secretbox.nonceLength)
    const messageUint8 = decodeUTF8(plaintext)
    const box = secretbox(messageUint8, nonce, this._key)
    const fullMessage = new Uint8Array(nonce.length + box.length)
    fullMessage.set(nonce)
    fullMessage.set(box, nonce.length)
    const base64FullMessage = encodeBase64(fullMessage)
    return base64FullMessage
  }

  async decrypt (messageWithNonce) {
    const messageWithNonceAsUint8Array = decodeBase64(messageWithNonce)
    const nonce = messageWithNonceAsUint8Array.slice(0, secretbox.nonceLength)
    const message = messageWithNonceAsUint8Array.slice(
      secretbox.nonceLength,
      messageWithNonce.length
    )
    const decrypted = secretbox.open(message, nonce, this._key)
    if (!decrypted) {
      throw new Error('Could not decrypt!')
    } else {
      return encodeUTF8(decrypted)
    }
  }
}
