/* global describe, it */
'use strict'

const assert = require('assert')
const Crypt = require('../lib/crypt')

const PLAINTEXT = 'hello world'
const PASSWORD = 'password'
const TEST_LENGTH = 1e4 // note: 1e4 = 1 and 4 zeroes (10,000)

describe('crypt', function () {
  it('should do the crypto dance', async function () {
    const crypt = new Crypt(PASSWORD)
    const ciphertext = await crypt.encrypt(PLAINTEXT)
    const decryptext = await crypt.decrypt(ciphertext)
    assert.strictEqual(decryptext, PLAINTEXT)
  })

  it('should fail to decrypt ok', async function () {
    const crypt = new Crypt(PASSWORD)
    const crypt2 = new Crypt(PASSWORD + 'a')
    const ciphertext = await crypt.encrypt(PLAINTEXT)
    let failed = false
    try {
      await crypt2.decrypt(ciphertext)
    } catch (e) {
      assert.equal(e.message, 'Could not decrypt!')
      failed = true
    }
    assert(failed)
  })

  it(`should do the crypto dance ${TEST_LENGTH} times`, async function () {
    this.timeout(TEST_LENGTH) // assume each op will take no more than 1ms
    const crypt = new Crypt(PASSWORD)
    for (let i = 0; i < TEST_LENGTH; i++) {
      const ciphertext = await crypt.encrypt(PLAINTEXT)
      const decryptext = await crypt.decrypt(ciphertext)
      assert.strictEqual(decryptext, PLAINTEXT)
    }
  })
})
