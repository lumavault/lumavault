import { CHUNKS_PATH, STREAM_PATH, TOKEN_QUERY_PARAM } from './constants.js'

/** Joins a base URL and a relative path whether or not the base ends with a slash. */
export function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.endsWith('/') ? baseUrl + path : `${baseUrl}/${path}`
}

export function chunkUrl(
  baseUrl: string,
  sha256: string,
  ticket?: string,
): string {
  return withTicket(joinUrl(baseUrl, CHUNKS_PATH + sha256), ticket)
}

export function streamUrl(
  baseUrl: string,
  objectId: string,
  ticket?: string,
): string {
  return withTicket(
    joinUrl(baseUrl, STREAM_PATH + encodeURIComponent(objectId)),
    ticket,
  )
}

// Video and image elements cannot send headers, so their URLs carry the ticket instead.
function withTicket(url: string, ticket?: string): string {
  return ticket
    ? `${url}?${TOKEN_QUERY_PARAM}=${encodeURIComponent(ticket)}`
    : url
}
