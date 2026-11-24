import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth.js'
import { iamObjectClaims } from './iam.js'
import { cinemaSchema } from './namespaces.js'

// Every table in the cinema Postgres schema: matched catalog titles (movies, series, and
// episodes), uploaded media files, and per-user watch progress.

// Enums

export const cinemaMediaFileKind = cinemaSchema.enum('media_file_kind', [
  'original',
])

export const cinemaMediaContainer = cinemaSchema.enum('media_container', [
  'mp4',
  'mov',
])

// Catalog

// One row per TMDB movie ID. Art paths are internal TMDB relative paths for the art worker;
// clients receive signed Gateway URLs built from the stored art object IDs.
export const cinemaMovies = cinemaSchema.table(
  'movies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tmdbId: integer('tmdb_id').notNull().unique(),
    title: text('title').notNull(),
    overview: text('overview').notNull().default(''),
    releaseYear: integer('release_year'),
    runtimeMinutes: integer('runtime_minutes'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    posterObjectId: text('poster_object_id').references(
      () => iamObjectClaims.objectId,
      { onDelete: 'set null' },
    ),
    backdropObjectId: text('backdrop_object_id').references(
      () => iamObjectClaims.objectId,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('movies_tmdb_id_positive', sql`${t.tmdbId} > 0`),
    check(
      'movies_release_year_positive',
      sql`${t.releaseYear} is null or ${t.releaseYear} > 0`,
    ),
    check(
      'movies_runtime_minutes_positive',
      sql`${t.runtimeMinutes} is null or ${t.runtimeMinutes} > 0`,
    ),
    index('movies_created_at_id_idx').on(t.createdAt, t.id),
  ],
)

// One row per TMDB TV series ID. Seasons are numbers on episodes rather than a separate table.
export const cinemaSeries = cinemaSchema.table(
  'series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tmdbId: integer('tmdb_id').notNull().unique(),
    title: text('title').notNull(),
    overview: text('overview').notNull().default(''),
    firstAirYear: integer('first_air_year'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    posterObjectId: text('poster_object_id').references(
      () => iamObjectClaims.objectId,
      { onDelete: 'set null' },
    ),
    backdropObjectId: text('backdrop_object_id').references(
      () => iamObjectClaims.objectId,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('series_tmdb_id_positive', sql`${t.tmdbId} > 0`),
    check(
      'series_first_air_year_positive',
      sql`${t.firstAirYear} is null or ${t.firstAirYear} > 0`,
    ),
    index('series_created_at_id_idx').on(t.createdAt, t.id),
  ],
)

// One row per TMDB episode ID, belonging to a series. Season 0 is allowed for specials.
export const cinemaEpisodes = cinemaSchema.table(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => cinemaSeries.id, { onDelete: 'cascade' }),
    tmdbId: integer('tmdb_id').notNull().unique(),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    title: text('title').notNull(),
    overview: text('overview').notNull().default(''),
    runtimeMinutes: integer('runtime_minutes'),
    airDate: date('air_date', { mode: 'string' }),
    stillPath: text('still_path'),
    stillObjectId: text('still_object_id').references(
      () => iamObjectClaims.objectId,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('episodes_tmdb_id_positive', sql`${t.tmdbId} > 0`),
    check('episodes_season_number_nonnegative', sql`${t.seasonNumber} >= 0`),
    check('episodes_episode_number_positive', sql`${t.episodeNumber} >= 1`),
    check(
      'episodes_runtime_minutes_positive',
      sql`${t.runtimeMinutes} is null or ${t.runtimeMinutes} > 0`,
    ),
    uniqueIndex('episodes_series_season_episode_unique').on(
      t.seriesId,
      t.seasonNumber,
      t.episodeNumber,
    ),
  ],
)

// Media files

// One row per stored video object in the Cinema library. Size and uploader live in
// iam.object_claims. Unmatched files leave both movieId and episodeId null. At most one
// original file is allowed per movie or episode; future transcoded copies add new kinds.
export const cinemaMediaFiles = cinemaSchema.table(
  'media_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectId: text('object_id')
      .notNull()
      .unique()
      .references(() => iamObjectClaims.objectId, { onDelete: 'restrict' }),
    filename: text('filename').notNull(),
    movieId: uuid('movie_id').references(() => cinemaMovies.id, {
      onDelete: 'set null',
    }),
    episodeId: uuid('episode_id').references(() => cinemaEpisodes.id, {
      onDelete: 'set null',
    }),
    kind: cinemaMediaFileKind('kind').notNull().default('original'),
    container: cinemaMediaContainer('container').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'media_files_at_most_one_target',
      sql`not (${t.movieId} is not null and ${t.episodeId} is not null)`,
    ),
    uniqueIndex('media_files_one_original_per_movie')
      .on(t.movieId)
      .where(sql`${t.movieId} is not null and ${t.kind} = 'original'`),
    uniqueIndex('media_files_one_original_per_episode')
      .on(t.episodeId)
      .where(sql`${t.episodeId} is not null and ${t.kind} = 'original'`),
    index('media_files_unmatched_added_at_idx')
      .on(t.addedAt, t.id)
      .where(sql`${t.movieId} is null and ${t.episodeId} is null`),
  ],
)

// Watch progress

// Per-user playback state attached to a movie or episode rather than a file, so replacing a
// file or adding transcoded copies keeps everyone's place.
export const cinemaWatchProgress = cinemaSchema.table(
  'watch_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    movieId: uuid('movie_id').references(() => cinemaMovies.id, {
      onDelete: 'cascade',
    }),
    episodeId: uuid('episode_id').references(() => cinemaEpisodes.id, {
      onDelete: 'cascade',
    }),
    positionMs: bigint('position_ms', { mode: 'bigint' })
      .notNull()
      .default(sql`'0'`),
    durationMs: bigint('duration_ms', { mode: 'bigint' })
      .notNull()
      .default(sql`'0'`),
    finished: boolean('finished').notNull().default(false),
    watchCount: integer('watch_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      'watch_progress_exactly_one_target',
      sql`(${t.movieId} is not null) <> (${t.episodeId} is not null)`,
    ),
    check('watch_progress_position_ms_nonnegative', sql`${t.positionMs} >= 0`),
    check('watch_progress_duration_ms_nonnegative', sql`${t.durationMs} >= 0`),
    check('watch_progress_watch_count_nonnegative', sql`${t.watchCount} >= 0`),
    uniqueIndex('watch_progress_user_movie_unique')
      .on(t.userId, t.movieId)
      .where(sql`${t.movieId} is not null`),
    uniqueIndex('watch_progress_user_episode_unique')
      .on(t.userId, t.episodeId)
      .where(sql`${t.episodeId} is not null`),
    index('watch_progress_user_updated_at_idx').on(t.userId, t.updatedAt),
  ],
)
