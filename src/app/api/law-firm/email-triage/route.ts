import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getEmailTriageStats, inventoryUnreadFromGmail, listEmailTriageMessages, updateEmailReview, fetchEmailBody, indexFirmVaultContacts, processPendingCaseEmailReviews } from '@/lib/law-firm-email-triage'
import { getLawFirmRoot } from '@/lib/law-firm'
import { mutationLimiter } from '@/lib/rate-limit'

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('inventory'),
    query: z.string().min(1).max(200).default('is:unread'),
    max: z.number().int().min(1).max(10_000).default(500),
  }),
  z.object({
    action: z.literal('fetch_body'),
    id: z.number().int().positive(),
  }),
  z.object({
    action: z.literal('index_contacts'),
  }),
  z.object({
    action: z.literal('process_case_reviews'),
    limit: z.number().int().min(1).max(100).default(25),
    fetch_missing_bodies: z.boolean().default(true),
    download_attachments: z.boolean().default(true),
  }),
])

const patchSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  bucket: z.string().optional(),
  review_status: z.string().optional(),
  suggested_action: z.string().optional(),
})

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const url = new URL(request.url)
    const result = listEmailTriageMessages({
      bucket: url.searchParams.get('bucket') || 'all',
      reviewStatus: url.searchParams.get('review_status') || 'all',
      query: url.searchParams.get('q') || '',
      limit: Number(url.searchParams.get('limit') || 100),
      offset: Number(url.searchParams.get('offset') || 0),
    })
    return NextResponse.json({ ...result, stats: getEmailTriageStats() })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/law-firm/email-triage failed')
    return NextResponse.json({ error: 'Failed to load email triage inventory' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = postSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }
    let result: unknown
    if (parsed.data.action === 'inventory') {
      const contacts = indexFirmVaultContacts(getLawFirmRoot())
      const inventory = await inventoryUnreadFromGmail(parsed.data.max, parsed.data.query)
      result = { ...inventory, contacts }
    } else if (parsed.data.action === 'fetch_body') {
      result = { email: await fetchEmailBody(parsed.data.id) }
    } else if (parsed.data.action === 'process_case_reviews') {
      result = await processPendingCaseEmailReviews({
        firmVaultRoot: getLawFirmRoot(),
        limit: parsed.data.limit,
        fetchMissingBodies: parsed.data.fetch_missing_bodies,
        downloadAttachments: parsed.data.download_attachments,
      })
    } else {
      result = indexFirmVaultContacts(getLawFirmRoot())
    }
    return NextResponse.json({ result, stats: getEmailTriageStats() })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/law-firm/email-triage failed')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to run Gmail inventory' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }
    const actor = auth.user.display_name || auth.user.username || 'mission-control'
    const result = updateEmailReview(parsed.data.ids, parsed.data, actor)
    return NextResponse.json({ result, stats: getEmailTriageStats() })
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/law-firm/email-triage failed')
    return NextResponse.json({ error: 'Failed to update email review queue' }, { status: 500 })
  }
}
