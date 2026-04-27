import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const routeMocks = vi.hoisted(() => ({
  db: { label: 'test-db' },
  requireRole: vi.fn(),
  mutationLimiter: vi.fn(),
  reconcileOpenReviewPrs: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => routeMocks.db,
}))

vi.mock('@/lib/auth', () => ({
  requireRole: routeMocks.requireRole,
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: routeMocks.mutationLimiter,
}))

vi.mock('@/lib/review-prs', () => ({
  reconcileOpenReviewPrs: routeMocks.reconcileOpenReviewPrs,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}))

const { POST } = await import('../route')

function request(): NextRequest {
  return new NextRequest('http://localhost/api/review-prs/reconcile', { method: 'POST' })
}

beforeEach(() => {
  routeMocks.requireRole.mockReset()
  routeMocks.mutationLimiter.mockReset()
  routeMocks.reconcileOpenReviewPrs.mockReset()
  routeMocks.requireRole.mockReturnValue({
    user: {
      id: 1,
      username: 'operator',
      display_name: 'Operator',
      role: 'operator',
      workspace_id: 1,
      tenant_id: 1,
    },
  })
  routeMocks.mutationLimiter.mockReturnValue(null)
  routeMocks.reconcileOpenReviewPrs.mockResolvedValue({
    checked: 3,
    merged: [10],
    closed: [11],
    errors: [{ task_id: 12, error: 'not found' }],
  })
})

describe('POST /api/review-prs/reconcile', () => {
  it('requires operator auth, applies mutation rate limiting, and returns reconciliation result', async () => {
    const req = request()

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(routeMocks.requireRole).toHaveBeenCalledWith(req, 'operator')
    expect(routeMocks.mutationLimiter).toHaveBeenCalledWith(req)
    expect(routeMocks.reconcileOpenReviewPrs).toHaveBeenCalledWith(routeMocks.db, { actor: 'operator', workspaceId: 1 })
    expect(body).toEqual({
      success: true,
      checked: 3,
      merged: [10],
      closed: [11],
      errors: [{ task_id: 12, error: 'not found' }],
    })
  })

  it('returns auth failures before rate limiting or reconciliation', async () => {
    routeMocks.requireRole.mockReturnValue({ error: 'Requires operator role or higher', status: 403 })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Requires operator role or higher' })
    expect(routeMocks.mutationLimiter).not.toHaveBeenCalled()
    expect(routeMocks.reconcileOpenReviewPrs).not.toHaveBeenCalled()
  })

  it('returns mutation limiter response before reconciliation', async () => {
    routeMocks.mutationLimiter.mockReturnValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }))

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many requests' })
    expect(routeMocks.reconcileOpenReviewPrs).not.toHaveBeenCalled()
  })
})
