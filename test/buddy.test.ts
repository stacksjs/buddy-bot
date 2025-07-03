import { beforeAll, describe, expect, it } from 'bun:test'

describe('buddy-bot', () => {
  beforeAll(() => {
    process.env.APP_ENV = 'test'
  })

  it('should work', async () => {
    expect(true).toBe(true)
  })
})
