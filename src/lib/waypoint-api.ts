import { NextResponse } from 'next/server'
import { makeErrorEnvelope, normalizeValidationDetails, type ValidationIssue } from '@waypoint/core'

export function normalizeWaypointRateLimitError(rateCheck: NextResponse | null): NextResponse | null {
  if (!rateCheck || rateCheck.status !== 429) return rateCheck

  return NextResponse.json(
    makeErrorEnvelope('Too many requests. Please try again later.'),
    { status: 429 },
  )
}

export function normalizeWaypointValidationDetails(issues: ValidationIssue[]) {
  return normalizeValidationDetails(issues)
}
