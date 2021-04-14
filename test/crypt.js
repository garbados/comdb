/* global describe, it */
'use strict'

const assert = require('assert')
const Crypt = require('../lib/crypt')

describe('crypt', function () {
  const plaintext = 'hello world'
  const password = 'password'

  it('should do the crypto dance', async function () {
    const crypt = new Crypt(password)
    const ciphertext = await crypt.encrypt(plaintext)
    const decryptext = await crypt.decrypt(ciphertext)
    assert.strictEqual(decryptext, plaintext)
  })

  it('should do the crypto dance a lot', async function () {
    const TEST_LENGTH = 1e4
    this.timeout(TEST_LENGTH)
    const start = Date.now()
    const crypt = new Crypt(password)
    for (let i = 0; i < TEST_LENGTH; i++) {
      const ciphertext = await crypt.encrypt(plaintext)
      const decryptext = await crypt.decrypt(ciphertext)
      assert.strictEqual(decryptext, plaintext)
    }
    const end = Date.now()
    console.log(`Ran ${TEST_LENGTH} ops in ${end - start} ms.`)
  })
})
