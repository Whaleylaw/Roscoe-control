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

type ValidationIssue = { code: string; path: PropertyKey[]; message: string }

export function normalizeWaypointValidationDetails(issues: ValidationIssue[]) {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path.length > 0 ? issue.path.join('.') : '$',
    message: issue.message,
  }))
}
