import { Code, ConnectError } from '@connectrpc/connect'

import { RANGE_BYTES_PREFIX, RANGE_HEADER } from './constants.js'
import { dataPlaneError, networkError } from './errors.js'
import { chunkUrl, streamUrl } from './urls.js'

/** Uploads one chunk. The gateway re-hashes the body and rejects it if it does not match. */
export async function putChunk(
  baseUrl: string,
  sha256: string,
  body: Blob | Uint8Array<ArrayBuffer>,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  const res = await send(chunkUrl(baseUrl, sha256), {
    method: 'PUT',
    body,
    headers,
    signal,
  })
  const stored = (await res.json()) as { size_bytes?: number }
  const expected = body instanceof Blob ? body.size : body.byteLength
  if (stored.size_bytes !== expected) {
    throw new ConnectError(
      `gateway stored ${stored.size_bytes} bytes for chunk ${sha256}, sent ${expected}`,
      Code.Internal,
    )
  }
}

/** Downloads one whole chunk. The caller verifies its hash. */
export async function getChunk(
  baseUrl: string,
  sha256: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await send(chunkUrl(baseUrl, sha256), {
    method: 'GET',
    headers,
    signal,
  })
  return new Uint8Array(await res.arrayBuffer())
}

/** Downloads length bytes of an object from start, cut short at its end. Not hash-checked. */
export async function getRange(
  baseUrl: string,
  objectId: string,
  start: number,
  length: number,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(length) ||
    length <= 0
  ) {
    throw new ConnectError(
      `invalid range start ${start} length ${length}`,
      Code.InvalidArgument,
    )
  }
  const range = `${RANGE_BYTES_PREFIX}${start}-${start + length - 1}`
  const res = await send(streamUrl(baseUrl, objectId), {
    method: 'GET',
    headers: { ...headers, [RANGE_HEADER]: range },
    signal,
  })
  return new Uint8Array(await res.arrayBuffer())
}

async function send(url: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw networkError(err)
  }
  if (!res.ok) {
    throw await dataPlaneError(res)
  }
  return res
}
