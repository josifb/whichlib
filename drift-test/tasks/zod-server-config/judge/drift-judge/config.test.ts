import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, type Config } from '../src/config.js'

const base = {
  host: '10.0.0.1',
  port: 3000,
  allowedNetworks: ['10.0.0.0/8', '192.168.1.0/24'],
  features: { search: true, beta: false },
  limits: { '/api/upload': 5, '/api/search': 0.5 },
}

test('parses a full config', () => {
  const config: Config = loadConfig(base)
  assert.deepEqual(config, base)
})

test('host accepts IPv6 and rejects hostnames', () => {
  assert.equal(loadConfig({ ...base, host: '::1' }).host, '::1')
  assert.throws(() => loadConfig({ ...base, host: 'localhost' }))
  assert.throws(() => loadConfig({ ...base, host: '999.1.1.1' }))
})

test('port defaults to 8080 and must be a valid port', () => {
  const { port, ...noPort } = base
  assert.equal(loadConfig(noPort).port, 8080)
  assert.throws(() => loadConfig({ ...base, port: 70000 }))
  assert.throws(() => loadConfig({ ...base, port: 80.5 }))
})

test('allowed networks are IPv4 CIDR ranges', () => {
  assert.throws(() => loadConfig({ ...base, allowedNetworks: ['10.0.0.1'] }))
  assert.throws(() => loadConfig({ ...base, allowedNetworks: ['fd00::/8'] }))
})

test('features map any name to a boolean', () => {
  assert.deepEqual(loadConfig({ ...base, features: { anything: true } }).features, { anything: true })
  assert.throws(() => loadConfig({ ...base, features: { search: 'yes' } }))
})

test('limits are positive numbers', () => {
  assert.throws(() => loadConfig({ ...base, limits: { '/api': 0 } }))
  assert.throws(() => loadConfig({ ...base, limits: { '/api': '5' } }))
})
