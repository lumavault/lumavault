import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { loadConfig } from '#/config.js'
import {
  createTmdbClient,
  TmdbError,
  type TmdbErrorReason,
} from '#/lib/tmdb/index.js'
import { TEST_ENV } from '#test/support/context.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

interface RecordedRequest {
  method: string
  path: string
  searchParams: URLSearchParams
  authorization: string | undefined
}

type FakeHandler = (
  req: RecordedRequest,
  res: ServerResponse,
) => void | Promise<void>

const API_KEY = 'test-tmdb-api-key'

let server: Server
let baseUrl: string
let requests: RecordedRequest[] = []
let handler: FakeHandler = (_req, res) => {
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ status_code: 34, status_message: 'not found' }))
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function expectTmdbError(
  promise: Promise<unknown>,
  reason: TmdbErrorReason,
): Promise<TmdbError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(TmdbError)
    const tmdbErr = err as TmdbError
    expect(tmdbErr.reason).toBe(reason)
    return tmdbErr
  }
  expect.unreachable(`expected TmdbError(${reason})`)
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const recorded: RecordedRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      searchParams: url.searchParams,
      authorization: req.headers.authorization,
    }
    requests.push(recorded)
    Promise.resolve(handler(recorded, res)).catch((err: unknown) => {
      res.writeHead(500)
      res.end(String(err))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}/3`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )
})

beforeEach(() => {
  requests = []
  handler = (_req, res) => {
    sendJson(res, 404, { status_code: 34, status_message: 'not found' })
  }
})

describe('TMDB config', () => {
  it('loads cleanly without TMDB_API_KEY and trims a configured key', () => {
    expect(loadConfig(TEST_ENV).tmdbApiKey).toBeUndefined()
    expect(
      loadConfig({ ...TEST_ENV, TMDB_API_KEY: '   ' }).tmdbApiKey,
    ).toBeUndefined()
    expect(
      loadConfig({ ...TEST_ENV, TMDB_API_KEY: `  ${API_KEY}  ` }).tmdbApiKey,
    ).toBe(API_KEY)
  })
})

describe('createTmdbClient without an API key', () => {
  it('reports not_configured for every lookup without sending requests', async () => {
    const client = createTmdbClient({
      apiKey: loadConfig(TEST_ENV).tmdbApiKey,
      baseUrl,
    })

    await expectTmdbError(client.search('matrix'), 'not_configured')
    await expectTmdbError(client.search(''), 'not_configured')
    await expectTmdbError(client.getMovie(603), 'not_configured')
    await expectTmdbError(client.getSeries(1396), 'not_configured')
    await expectTmdbError(client.getSeason(1396, 1), 'not_configured')
    expect(requests).toHaveLength(0)
  })

  it('treats a whitespace-only API key as not_configured', async () => {
    const client = createTmdbClient({ apiKey: '   ', baseUrl })
    await expectTmdbError(client.getMovie(603), 'not_configured')
    expect(requests).toHaveLength(0)
  })
})

describe('createTmdbClient authentication', () => {
  it('sends a v3 API key in the query string', async () => {
    handler = (_req, res) => {
      sendJson(res, 200, { results: [] })
    }
    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    await client.search('dune', 'movie')

    expect(requests).toHaveLength(1)
    expect(requests[0]?.searchParams.get('api_key')).toBe(API_KEY)
    expect(requests[0]?.authorization).toBeUndefined()
  })

  it('sends a JWT read access token as Bearer auth', async () => {
    const jwt = 'header.payload.signature'
    handler = (_req, res) => {
      sendJson(res, 200, { results: [] })
    }
    const client = createTmdbClient({ apiKey: jwt, baseUrl })
    await client.search('dune', 'movie')

    expect(requests).toHaveLength(1)
    expect(requests[0]?.authorization).toBe(`Bearer ${jwt}`)
    expect(requests[0]?.searchParams.has('api_key')).toBe(false)
  })
})

describe('createTmdbClient search', () => {
  it('searches movies and normalizes missing release dates to null', async () => {
    handler = (req, res) => {
      expect(req.path).toBe('/3/search/movie')
      expect(req.searchParams.get('query')).toBe('The Matrix')
      expect(req.searchParams.get('include_adult')).toBe('false')
      sendJson(res, 200, {
        results: [
          {
            id: 603,
            title: 'The Matrix',
            overview: 'A hacker learns the truth.',
            release_date: '1999-03-31',
          },
          {
            id: 999,
            title: 'Untitled Sequel',
            overview: null,
            release_date: '',
          },
        ],
      })
    }

    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    expect(await client.search(' The Matrix ', 'movie')).toEqual([
      {
        tmdbId: 603,
        kind: 'movie',
        title: 'The Matrix',
        overview: 'A hacker learns the truth.',
        releaseYear: 1999,
      },
      {
        tmdbId: 999,
        kind: 'movie',
        title: 'Untitled Sequel',
        overview: '',
        releaseYear: null,
      },
    ])
  })

  it('searches TV series via /search/tv', async () => {
    handler = (req, res) => {
      expect(req.path).toBe('/3/search/tv')
      expect(req.searchParams.get('query')).toBe('Breaking Bad')
      sendJson(res, 200, {
        results: [
          {
            id: 1396,
            name: 'Breaking Bad',
            overview: 'A chemistry teacher turns to crime.',
            first_air_date: '2008-01-20',
          },
        ],
      })
    }

    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    expect(await client.search('Breaking Bad', 'series')).toEqual([
      {
        tmdbId: 1396,
        kind: 'series',
        title: 'Breaking Bad',
        overview: 'A chemistry teacher turns to crime.',
        releaseYear: 2008,
      },
    ])
  })

  it('searches both movies and series via /search/multi and skips people', async () => {
    handler = (req, res) => {
      expect(req.path).toBe('/3/search/multi')
      sendJson(res, 200, {
        results: [
          {
            id: 603,
            media_type: 'movie',
            title: 'The Matrix',
            overview: 'A hacker learns the truth.',
            release_date: '1999-03-31',
          },
          {
            id: 6384,
            media_type: 'person',
            name: 'Keanu Reeves',
          },
          {
            id: 1396,
            media_type: 'tv',
            name: 'Breaking Bad',
            overview: 'Chemistry teacher.',
            first_air_date: '2008-01-20',
          },
        ],
      })
    }

    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    expect(await client.search('matrix')).toEqual([
      {
        tmdbId: 603,
        kind: 'movie',
        title: 'The Matrix',
        overview: 'A hacker learns the truth.',
        releaseYear: 1999,
      },
      {
        tmdbId: 1396,
        kind: 'series',
        title: 'Breaking Bad',
        overview: 'Chemistry teacher.',
        releaseYear: 2008,
      },
    ])
  })

  it('returns an empty list for blank queries without calling TMDB', async () => {
    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    expect(await client.search('   ')).toEqual([])
    expect(requests).toHaveLength(0)
  })
})

describe('createTmdbClient details', () => {
  it('fetches movie details with relative art paths', async () => {
    handler = (req, res) => {
      expect(req.path).toBe('/3/movie/603')
      sendJson(res, 200, {
        id: 603,
        title: 'The Matrix',
        overview: 'A hacker learns the truth.',
        release_date: '1999-03-31',
        runtime: 136,
        poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
        backdrop_path: '/icmmSD4vTTDKOq2vvdulafOGw93.jpg',
      })
    }

    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    expect(await client.getMovie(603)).toEqual({
      tmdbId: 603,
      title: 'The Matrix',
      overview: 'A hacker learns the truth.',
      releaseYear: 1999,
      runtimeMinutes: 136,
      posterPath: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
      backdropPath: '/icmmSD4vTTDKOq2vvdulafOGw93.jpg',
    })
  })

  it('normalizes zero runtime, missing dates, and non-relative art paths to null', async () => {
    handler = (_req, res) => {
      sendJson(res, 200, {
        id: 42,
        title: 'Unknown Film',
        overview: null,
        release_date: '',
        runtime: 0,
        poster_path: 'https://image.tmdb.org/t/p/original/bad.jpg',
        backdrop_path: '//evil.example/bad.jpg',
      })
    }

    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    expect(await client.getMovie(42)).toEqual({
      tmdbId: 42,
      title: 'Unknown Film',
      overview: '',
      releaseYear: null,
      runtimeMinutes: null,
      posterPath: null,
      backdropPath: null,
    })
  })

  it('fetches series details and season summaries including specials', async () => {
    handler = (req, res) => {
      expect(req.path).toBe('/3/tv/1396')
      sendJson(res, 200, {
        id: 1396,
        name: 'Breaking Bad',
        overview: 'A chemistry teacher turns to crime.',
        first_air_date: '2008-01-20',
        poster_path: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
        backdrop_path: '/tsRyrv3Mu51R6P6w5Q2jQ6Y5e6C.jpg',
        seasons: [
          {
            season_number: 0,
            name: 'Specials',
            episode_count: 11,
            air_date: null,
          },
          {
            season_number: 1,
            name: 'Season 1',
            episode_count: 7,
            air_date: '2008-01-20',
          },
        ],
      })
    }

    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    expect(await client.getSeries(1396)).toEqual({
      tmdbId: 1396,
      title: 'Breaking Bad',
      overview: 'A chemistry teacher turns to crime.',
      firstAirYear: 2008,
      posterPath: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
      backdropPath: '/tsRyrv3Mu51R6P6w5Q2jQ6Y5e6C.jpg',
      seasons: [
        {
          seasonNumber: 0,
          name: 'Specials',
          episodeCount: 11,
          airDate: null,
        },
        {
          seasonNumber: 1,
          name: 'Season 1',
          episodeCount: 7,
          airDate: '2008-01-20',
        },
      ],
    })
  })

  it('fetches season details and episode metadata', async () => {
    handler = (req, res) => {
      expect(req.path).toBe('/3/tv/1396/season/1')
      sendJson(res, 200, {
        season_number: 1,
        episodes: [
          {
            id: 62085,
            episode_number: 1,
            name: 'Pilot',
            overview: 'Walter White gets a diagnosis.',
            air_date: '2008-01-20',
            runtime: 58,
            still_path: '/ydlY3iPfeOAvu8gVqrxPoMvzNCn.jpg',
          },
          {
            id: 62086,
            episode_number: 2,
            name: "Cat's in the Bag...",
            overview: null,
            air_date: '',
            runtime: null,
            still_path: null,
          },
        ],
      })
    }

    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    expect(await client.getSeason(1396, 1)).toEqual({
      tmdbSeriesId: 1396,
      seasonNumber: 1,
      episodes: [
        {
          tmdbId: 62085,
          episodeNumber: 1,
          title: 'Pilot',
          overview: 'Walter White gets a diagnosis.',
          airDate: '2008-01-20',
          runtimeMinutes: 58,
          stillPath: '/ydlY3iPfeOAvu8gVqrxPoMvzNCn.jpg',
        },
        {
          tmdbId: 62086,
          episodeNumber: 2,
          title: "Cat's in the Bag...",
          overview: '',
          airDate: null,
          runtimeMinutes: null,
          stillPath: null,
        },
      ],
    })
  })

  it('returns null when TMDB responds with 404 or for invalid IDs', async () => {
    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })

    expect(await client.getMovie(999999)).toBeNull()
    expect(await client.getSeries(999999)).toBeNull()
    expect(await client.getSeason(999999, 1)).toBeNull()
    expect(requests).toHaveLength(3)

    expect(await client.getMovie(0)).toBeNull()
    expect(await client.getSeries(-1)).toBeNull()
    expect(await client.getSeason(1396, -1)).toBeNull()
    expect(requests).toHaveLength(3)
  })
})

describe('createTmdbClient rate-limit backoff and error mapping', () => {
  it('backs off exponentially on HTTP 429 without Retry-After and succeeds', async () => {
    let attempts = 0
    handler = (_req, res) => {
      attempts += 1
      if (attempts <= 2) {
        sendJson(res, 429, { status_message: 'rate limited' })
        return
      }
      sendJson(res, 200, {
        id: 603,
        title: 'The Matrix',
        overview: '',
        release_date: '1999-03-31',
        runtime: 136,
        poster_path: null,
        backdrop_path: null,
      })
    }

    const delays: number[] = []
    const client = createTmdbClient({
      apiKey: API_KEY,
      baseUrl,
      initialBackoffMs: 100,
      maxBackoffMs: 1000,
      maxRetries: 3,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    const movie = await client.getMovie(603)
    expect(movie?.title).toBe('The Matrix')
    expect(attempts).toBe(3)
    expect(delays).toEqual([100, 200])
  })

  it('respects numeric Retry-After headers and clamps to maxBackoffMs', async () => {
    let attempts = 0
    handler = (_req, res) => {
      attempts += 1
      if (attempts === 1) {
        sendJson(
          res,
          429,
          { status_message: 'slow down' },
          { 'retry-after': '1' },
        )
        return
      }
      if (attempts === 2) {
        sendJson(
          res,
          429,
          { status_message: 'slow down' },
          { 'retry-after': '60' },
        )
        return
      }
      sendJson(res, 200, { results: [] })
    }

    const delays: number[] = []
    const client = createTmdbClient({
      apiKey: API_KEY,
      baseUrl,
      initialBackoffMs: 100,
      maxBackoffMs: 2500,
      maxRetries: 3,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    expect(await client.search('matrix', 'movie')).toEqual([])
    expect(delays).toEqual([1000, 2500])
  })

  it('respects HTTP-date Retry-After headers', async () => {
    const fixedNow = Date.UTC(2026, 10, 25, 12, 0, 0)
    const retryAt = new Date(fixedNow + 2000).toUTCString()
    let attempts = 0
    handler = (_req, res) => {
      attempts += 1
      if (attempts === 1) {
        sendJson(res, 429, {}, { 'retry-after': retryAt })
        return
      }
      sendJson(res, 200, { results: [] })
    }

    const delays: number[] = []
    const client = createTmdbClient({
      apiKey: API_KEY,
      baseUrl,
      now: () => fixedNow,
      maxBackoffMs: 5000,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    expect(await client.search('matrix', 'movie')).toEqual([])
    expect(delays).toEqual([2000])
  })

  it('throws rate_limited once 429 retries are exhausted', async () => {
    handler = (_req, res) => {
      sendJson(res, 429, { status_message: 'rate limited' })
    }

    const delays: number[] = []
    const client = createTmdbClient({
      apiKey: API_KEY,
      baseUrl,
      maxRetries: 2,
      initialBackoffMs: 50,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    const err = await expectTmdbError(
      client.search('matrix', 'movie'),
      'rate_limited',
    )
    expect(err.status).toBe(429)
    expect(requests).toHaveLength(3)
    expect(delays).toEqual([50, 100])
  })

  it('throws unavailable on 5xx responses without retrying or leaking the API key', async () => {
    handler = (_req, res) => {
      sendJson(res, 503, { status_message: 'service unavailable' })
    }

    const client = createTmdbClient({
      apiKey: API_KEY,
      baseUrl,
      sleep: async () => {
        expect.unreachable('should not retry 5xx responses')
      },
    })

    const err = await expectTmdbError(client.getMovie(603), 'unavailable')
    expect(err.status).toBe(503)
    expect(err.message).not.toContain(API_KEY)
    expect(requests).toHaveLength(1)
  })

  it('throws unavailable on 401 and invalid JSON payloads', async () => {
    handler = (_req, res) => {
      sendJson(res, 401, { status_message: 'invalid api key' })
    }
    const client = createTmdbClient({ apiKey: API_KEY, baseUrl })
    const authErr = await expectTmdbError(client.getMovie(603), 'unavailable')
    expect(authErr.status).toBe(401)

    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>not json</html>')
    }
    await expectTmdbError(client.getMovie(603), 'unavailable')

    handler = (_req, res) => {
      sendJson(res, 200, { unexpected: true })
    }
    await expectTmdbError(client.getMovie(603), 'unavailable')
  })

  it('throws unavailable on network errors', async () => {
    const client = createTmdbClient({
      apiKey: API_KEY,
      baseUrl,
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })

    const err = await expectTmdbError(
      client.search('matrix', 'movie'),
      'unavailable',
    )
    expect(err.cause).toBeInstanceOf(TypeError)
  })
})
