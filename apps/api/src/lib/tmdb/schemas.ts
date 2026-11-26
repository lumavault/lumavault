import { z } from 'zod'

export const searchEnvelopeSchema = z.object({
  results: z.array(z.unknown()).default([]),
})

export const movieSearchItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  overview: z.string().nullish(),
  release_date: z.string().nullish(),
})

export const tvSearchItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  overview: z.string().nullish(),
  first_air_date: z.string().nullish(),
})

export const movieDetailsSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  overview: z.string().nullish(),
  release_date: z.string().nullish(),
  runtime: z.number().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
})

export const seasonSummarySchema = z.object({
  season_number: z.number().int().nonnegative(),
  name: z.string().nullish(),
  episode_count: z.number().int().nonnegative().default(0),
  air_date: z.string().nullish(),
})

export const seriesDetailsSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  overview: z.string().nullish(),
  first_air_date: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  seasons: z.array(seasonSummarySchema).default([]),
})

export const episodeDetailsSchema = z.object({
  id: z.number().int().positive(),
  episode_number: z.number().int().positive(),
  name: z.string().nullish(),
  overview: z.string().nullish(),
  air_date: z.string().nullish(),
  runtime: z.number().nullish(),
  still_path: z.string().nullish(),
})

export const seasonDetailsSchema = z.object({
  season_number: z.number().int().nonnegative().optional(),
  episodes: z.array(episodeDetailsSchema).default([]),
})
