import { NextResponse } from 'next/server'

export function normalizeWaypointRateLimitError(rateCheck: NextResponse | null): NextResponse | null {
  if (!rateCheck || rateCheck.status !== 429) return rateCheck

  return NextResponse.json(
    {
      ok: false,
      action: 'error',
      error: 'Too many requests. Please try again later.',
    },
    { status: 429 },
  )
}
