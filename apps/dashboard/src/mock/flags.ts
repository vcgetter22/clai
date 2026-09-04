/**
 * URL/env switches that turn on mock mode. Kept dependency-free (no imports from
 * `api.ts` or `engine.ts`) so both can read them without a circular import.
 *
 *   ?mock=1        serve deterministic generated data instead of hitting /api
 *   ?team=1        (mock only) simulate team mode: multi-actor data, seats, and
 *                  the same bearer-token gate the real team server enforces
 *   ?empty=1       (mock only) simulate a freshly-installed clai with zero events
 */

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function isMock(): boolean {
  return params().get('mock') === '1' || import.meta.env.VITE_MOCK === '1';
}

export function isMockTeam(): boolean {
  return isMock() && params().get('team') === '1';
}

export function isMockEmpty(): boolean {
  return isMock() && params().get('empty') === '1';
}
