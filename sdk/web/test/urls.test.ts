import { chunkUrl, streamUrl } from '#/urls.js'
import { describe, expect, it } from 'vitest'

describe('urls', () => {
  for (const base of ['http://gw:8080', 'http://gw:8080/']) {
    it(`builds routes from ${base}`, () => {
      expect(chunkUrl(base, 'ab12')).toBe('http://gw:8080/v1/chunks/ab12')
      expect(streamUrl(base, 'obj/1')).toBe('http://gw:8080/v1/stream/obj%2F1')
    })

    it(`builds stream URLs with tickets and download options from ${base}`, () => {
      expect(streamUrl(base, 'obj/1', 't k')).toBe(
        'http://gw:8080/v1/stream/obj%2F1?token=t%20k',
      )
      expect(streamUrl(base, 'obj/1', { ticket: 't k' })).toBe(
        'http://gw:8080/v1/stream/obj%2F1?token=t%20k',
      )
      expect(streamUrl(base, 'obj/1', { download: true })).toBe(
        'http://gw:8080/v1/stream/obj%2F1?download=1',
      )
      expect(streamUrl(base, 'obj/1', { download: false })).toBe(
        'http://gw:8080/v1/stream/obj%2F1',
      )
      expect(streamUrl(base, 'obj/1', { ticket: 't k', download: true })).toBe(
        'http://gw:8080/v1/stream/obj%2F1?token=t%20k&download=1',
      )
      expect(streamUrl(base, 'obj/1', {})).toBe(
        'http://gw:8080/v1/stream/obj%2F1',
      )
      expect(streamUrl(base, 'obj/1', { ticket: '', download: true })).toBe(
        'http://gw:8080/v1/stream/obj%2F1?download=1',
      )

      const signed = new URL(
        streamUrl(base, 'obj/1', { ticket: 'v1.a+b/c', download: true }),
      )
      expect(signed.pathname).toBe('/v1/stream/obj%2F1')
      expect(signed.searchParams.get('token')).toBe('v1.a+b/c')
      expect(signed.searchParams.get('download')).toBe('1')
    })
  }
})
