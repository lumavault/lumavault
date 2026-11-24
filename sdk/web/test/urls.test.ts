import { chunkUrl, streamUrl } from '#/urls.js'
import { describe, expect, it } from 'vitest'

describe('urls', () => {
  for (const base of ['http://gw:8080', 'http://gw:8080/']) {
    it(`builds routes from ${base}`, () => {
      expect(chunkUrl(base, 'ab12')).toBe('http://gw:8080/v1/chunks/ab12')
      expect(streamUrl(base, 'obj/1')).toBe('http://gw:8080/v1/stream/obj%2F1')
    })
  }
})
