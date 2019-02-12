/* global describe, it */
'use strict'

const assert = require('assert')
const Crypt = require('../lib/crypt')

describe('crypt', function () {
  it('should do the crypto dance', function () {
    const plaintext = 'hello world'
    const password = 'password'
    const crypt = new Crypt(password)
    return crypt.encrypt(plaintext).then((ciphertext) => {
      return crypt.decrypt(ciphertext)
    }).then((newtext) => {
      assert.strictEqual(newtext, plaintext)
    })
  })
})
