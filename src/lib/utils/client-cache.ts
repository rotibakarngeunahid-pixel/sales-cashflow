'use client'

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const inFlight = new Map<string, Promise<unknown>>()

export function getCachedData<T>(key: string): T | null {
  const entry = cache.get(key)

  if (!entry) return null

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }

  return entry.value as T
}

export function setCachedData<T>(key: string, value: T, ttlMs = 60_000) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
}

export async function getOrFetchCached<T>(
  key: string,
  loader: () => Promise<T>,
  options: { ttlMs?: number; force?: boolean } = {}
) {
  const cached = options.force ? null : getCachedData<T>(key)
  if (cached !== null) return cached

  const existingRequest = inFlight.get(key) as Promise<T> | undefined
  if (existingRequest) return existingRequest

  const request = loader()
    .then((value) => {
      setCachedData(key, value, options.ttlMs)
      return value
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, request)
  return request
}

export function invalidateCachedData(match: string | RegExp | ((key: string) => boolean)) {
  const shouldDelete =
    typeof match === 'string'
      ? (key: string) => key.startsWith(match)
      : match instanceof RegExp
        ? (key: string) => match.test(key)
        : match

  for (const key of Array.from(cache.keys())) {
    if (shouldDelete(key)) cache.delete(key)
  }
}
