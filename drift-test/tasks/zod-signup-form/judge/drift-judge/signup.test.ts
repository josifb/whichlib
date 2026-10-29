import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signupSchema, validateSignup } from '../src/signup.js'

const valid = { email: 'ada@example.com', password: 'correct horse', age: 36 }

test('accepts a valid signup', () => {
  const result = validateSignup(valid)
  assert.equal(result.success, true)
  assert.deepEqual(signupSchema.parse(valid), valid)
})

test('age is optional', () => {
  assert.equal(validateSignup({ email: 'ada@example.com', password: 'correct horse' }).success, true)
})

function errorsOf(input: unknown): Record<string, string> {
  const result = validateSignup(input)
  assert.equal(result.success, false)
  return (result as { errors: Record<string, string> }).errors
}

test('missing email', () => {
  assert.equal(errorsOf({ password: 'correct horse' }).email, 'Email is required')
})

test('email that is not text', () => {
  assert.equal(errorsOf({ email: 42, password: 'correct horse' }).email, 'Email must be text')
})

test('email that is not an address', () => {
  assert.equal(errorsOf({ email: 'ada', password: 'correct horse' }).email, 'Enter a valid email')
})

test('short password', () => {
  assert.equal(errorsOf({ email: 'ada@example.com', password: 'short' }).password, 'Password must be at least 8 characters')
})

test('age must be a whole number of 13 or more', () => {
  assert.ok(errorsOf({ ...valid, age: 12 }).age)
  assert.ok(errorsOf({ ...valid, age: 20.5 }).age)
})
