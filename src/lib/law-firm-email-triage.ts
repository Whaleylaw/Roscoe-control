import type Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join, relative } from 'path'
import { getDatabase } from '@/lib/db'

export type EmailTriageBucket = 'case_related' | 'ops_action' | 'receipt' | 'newsletter' | 'junk' | 'personal' | 'spam_review' | 'needs_review'
export type EmailTriageAction = 'none' | 'mark_read' | 'archive' | 'mark_read_archive' | 'label_only' | 'case_route' | 'ops_alert'
export type EmailReviewStatus = 'pending' | 'approved' | 'rejected' | 'applied'

export type EmailTriageMessage = {
  id: number
  gmail_message_id: string
  gmail_thread_id: string | null
  sent_at: number | null
  from_name: string | null
  from_email: string | null
  sender_domain: string | null
  subject: string | null
  snippet: string | null
  body_text?: string | null
  body_fetched_at?: number | null
  labels_json: string
  is_unread: number
  has_attachments: number
  bucket: EmailTriageBucket
  confidence: number | null
  reason: string | null
  suggested_action: EmailTriageAction
  review_status: EmailReviewStatus
  action_taken: string | null
  case_slug: string | null
  contact_name: string | null
  contact_match_type: string | null
  contact_match_value: string | null
  contact_confidence: number | null
  tags_json: string
  paralegal_review_status: string | null
  created_at: number
  updated_at: number
}

export type EmailTriageStats = {
  total: number
  unread: number
  pending: number
  byBucket: Record<string, number>
  topSenders: Array<{ sender: string; count: number }>
  lastInventoryAt: number | null
}

export type EmailTriageListOptions = {
  bucket?: string
  reviewStatus?: string
  query?: string
  limit?: number
  offset?: number
}

const DEFAULT_HELPER = join(homedir(), 'Github/Roscoe-hermes/skills/productivity/google-workspace/scripts/google_api.py')

export function listEmailTriageMessages(opts: EmailTriageListOptions = {}, db: Database.Database = getDatabase()) {
  const limit = clampInt(opts.limit, 1, 500, 100)
  const offset = Math.max(0, Number(opts.offset) || 0)
  const where: string[] = []
  const params: unknown[] = []

  if (opts.bucket && opts.bucket !== 'all') {
    where.push('bucket = ?')
    params.push(opts.bucket)
  }
  if (opts.reviewStatus && opts.reviewStatus !== 'all') {
    where.push('review_status = ?')
    params.push(opts.reviewStatus)
  }
  const q = opts.query?.trim()
  if (q) {
    where.push('(subject LIKE ? OR from_email LIKE ? OR from_name LIKE ? OR snippet LIKE ? OR sender_domain LIKE ?)')
    const needle = `%${q}%`
    params.push(needle, needle, needle, needle, needle)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db.prepare(`
    SELECT * FROM email_triage_messages
    ${whereSql}
    ORDER BY COALESCE(sent_at, created_at) DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as EmailTriageMessage[]
  const total = (db.prepare(`SELECT COUNT(*) as count FROM email_triage_messages ${whereSql}`).get(...params) as { count: number }).count
  return { emails: rows, total, limit, offset }
}

export function getEmailTriageStats(db: Database.Database = getDatabase()): EmailTriageStats {
  const total = (db.prepare('SELECT COUNT(*) as count FROM email_triage_messages').get() as { count: number }).count
  const unread = (db.prepare('SELECT COUNT(*) as count FROM email_triage_messages WHERE is_unread = 1').get() as { count: number }).count
  const pending = (db.prepare("SELECT COUNT(*) as count FROM email_triage_messages WHERE review_status = 'pending'").get() as { count: number }).count
  const byBucketRows = db.prepare('SELECT bucket, COUNT(*) as count FROM email_triage_messages GROUP BY bucket ORDER BY count DESC').all() as Array<{ bucket: string; count: number }>
  const topSenders = db.prepare(`
    SELECT COALESCE(NULLIF(from_email, ''), sender_domain, 'unknown') as sender, COUNT(*) as count
    FROM email_triage_messages
    GROUP BY sender
    ORDER BY count DESC
    LIMIT 25
  `).all() as Array<{ sender: string; count: number }>
  const lastInventoryAt = (db.prepare("SELECT MAX(created_at) as ts FROM email_triage_actions WHERE action = 'inventory'").get() as { ts: number | null }).ts
  return {
    total,
    unread,
    pending,
    byBucket: Object.fromEntries(byBucketRows.map((row) => [row.bucket, row.count])),
    topSenders,
    lastInventoryAt,
  }
}

export function classifyMetadata(input: { from?: string | null; subject?: string | null; snippet?: string | null; labels?: string[] }, db?: Database.Database): {
  bucket: EmailTriageBucket
  confidence: number
  reason: string
  suggested_action: EmailTriageAction
} {
  const from = (input.from || '').toLowerCase()
  const subject = (input.subject || '').toLowerCase()
  const snippet = (input.snippet || '').toLowerCase()
  const text = `${from} ${subject} ${snippet}`

  const learned = db ? findLearnedRule(from, db) : null
  if (learned) {
    return {
      bucket: learned.bucket as EmailTriageBucket,
      confidence: learned.confidence,
      reason: `Learned from manual correction for ${learned.scope} ${learned.pattern}.`,
      suggested_action: learned.suggested_action as EmailTriageAction,
    }
  }

  const contactMatch = db ? matchEmailToFirmVaultContact({ from, subject, snippet }, db) : null
  if (contactMatch) {
    return {
      bucket: 'case_related',
      confidence: contactMatch.confidence,
      reason: `Matched FirmVault contact ${contactMatch.contact_name || contactMatch.match_value} in case ${contactMatch.case_slug}.`,
      suggested_action: 'case_route',
    }
  }

  if (/security alert|new sign-in|password|2-step|verification code/.test(text)) {
    return { bucket: 'ops_action', confidence: 0.92, reason: 'Security/account access language detected.', suggested_action: 'ops_alert' }
  }
  if (/payment failed|auto.?top.?up failed|past due|overdue|action required|requires attention/.test(text)) {
    return { bucket: 'ops_action', confidence: 0.9, reason: 'Payment or account action required language detected.', suggested_action: 'ops_alert' }
  }
  if (/receipt|invoice|statement|payment scheduled|payment confirmation/.test(text)) {
    return { bucket: 'receipt', confidence: 0.86, reason: 'Receipt, invoice, or statement pattern.', suggested_action: 'mark_read_archive' }
  }
  if (/unsubscribe|substack|newsletter|digest|weekly|today's headlines|read more/.test(text)) {
    return { bucket: 'newsletter', confidence: 0.82, reason: 'Newsletter/read-later pattern.', suggested_action: 'mark_read_archive' }
  }
  if (/sale|promo|discount|deal|offer|rewards|casino|flight deals|half off/.test(text)) {
    return { bucket: 'junk', confidence: 0.82, reason: 'Promotional marketing pattern.', suggested_action: 'mark_read_archive' }
  }
  return { bucket: 'needs_review', confidence: 0.5, reason: 'No high-confidence rule matched.', suggested_action: 'none' }
}

export function upsertEmailTriageMessage(input: {
  gmail_message_id: string
  gmail_thread_id?: string | null
  sent_at?: number | null
  from_name?: string | null
  from_email?: string | null
  sender_domain?: string | null
  subject?: string | null
  snippet?: string | null
  labels?: string[]
  is_unread?: boolean
  has_attachments?: boolean
}, db: Database.Database = getDatabase()) {
  const classification = classifyMetadata({ from: input.from_email || input.from_name, subject: input.subject, snippet: input.snippet, labels: input.labels }, db)
  const labelsJson = JSON.stringify(input.labels || [])
  db.prepare(`
    INSERT INTO email_triage_messages (
      gmail_message_id, gmail_thread_id, sent_at, from_name, from_email, sender_domain,
      subject, snippet, labels_json, is_unread, has_attachments,
      bucket, confidence, reason, suggested_action, review_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', unixepoch(), unixepoch())
    ON CONFLICT(gmail_message_id) DO UPDATE SET
      gmail_thread_id = excluded.gmail_thread_id,
      sent_at = excluded.sent_at,
      from_name = excluded.from_name,
      from_email = excluded.from_email,
      sender_domain = excluded.sender_domain,
      subject = excluded.subject,
      snippet = excluded.snippet,
      labels_json = excluded.labels_json,
      is_unread = excluded.is_unread,
      has_attachments = excluded.has_attachments,
      bucket = CASE WHEN email_triage_messages.review_status = 'pending' THEN excluded.bucket ELSE email_triage_messages.bucket END,
      confidence = CASE WHEN email_triage_messages.review_status = 'pending' THEN excluded.confidence ELSE email_triage_messages.confidence END,
      reason = CASE WHEN email_triage_messages.review_status = 'pending' THEN excluded.reason ELSE email_triage_messages.reason END,
      suggested_action = CASE WHEN email_triage_messages.review_status = 'pending' THEN excluded.suggested_action ELSE email_triage_messages.suggested_action END,
      updated_at = unixepoch()
  `).run(
    input.gmail_message_id,
    input.gmail_thread_id || null,
    input.sent_at || null,
    input.from_name || null,
    input.from_email || null,
    input.sender_domain || domainFromEmail(input.from_email || ''),
    input.subject || null,
    input.snippet || null,
    labelsJson,
    input.is_unread === false ? 0 : 1,
    input.has_attachments ? 1 : 0,
    classification.bucket,
    classification.confidence,
    classification.reason,
    classification.suggested_action,
  )
  const row = db.prepare('SELECT id, bucket FROM email_triage_messages WHERE gmail_message_id = ?').get(input.gmail_message_id) as { id: number; bucket: string } | undefined
  if (row?.bucket === 'case_related') applyCaseRoutingForMessages([row.id], db)
}

export async function inventoryUnreadFromGmail(max = 500, query = 'is:unread') {
  const helper = process.env.MISSION_CONTROL_GWS_HELPER || DEFAULT_HELPER
  if (!existsSync(helper)) {
    throw new Error(`Google Workspace helper not found at ${helper}`)
  }
  const result = await runJsonCommand('python3', [helper, 'gmail', 'search', query, '--max', String(max)])
  const messages = normalizeGmailSearchResults(result)
  const db = getDatabase()
  const tx = db.transaction(() => {
    for (const msg of messages) upsertEmailTriageMessage(msg, db)
    db.prepare(`INSERT INTO email_triage_actions (action, actor, message_count, detail_json, created_at) VALUES ('inventory', 'mission-control', ?, ?, unixepoch())`).run(messages.length, JSON.stringify({ query, max }))
  })
  tx()
  return { imported: messages.length, query, max }
}

function normalizeGmailSearchResults(result: unknown) {
  const rawItems = Array.isArray(result)
    ? result
    : Array.isArray((result as any)?.messages)
      ? (result as any).messages
      : Array.isArray((result as any)?.results)
        ? (result as any).results
        : Array.isArray((result as any)?.data)
          ? (result as any).data
          : []
  return rawItems.map((item: any) => {
    const from = String(item.from || item.sender || '')
    const email = extractEmail(from) || from || null
    const labels = Array.isArray(item.labelIds) ? item.labelIds : Array.isArray(item.labels) ? item.labels : []
    return {
      gmail_message_id: String(item.id || item.message_id || item.gmail_message_id),
      gmail_thread_id: item.threadId || item.thread_id || item.gmail_thread_id || null,
      sent_at: parseGmailDate(item.date || item.internalDate || item.sent_at),
      from_name: extractName(from),
      from_email: email,
      sender_domain: domainFromEmail(email || ''),
      subject: item.subject || null,
      snippet: item.snippet || item.body_snippet || null,
      labels,
      is_unread: labels.length > 0 ? labels.includes('UNREAD') : true,
      has_attachments: Boolean(item.has_attachments || item.hasAttachments),
    }
  }).filter((item: any) => item.gmail_message_id && item.gmail_message_id !== 'undefined')
}

export function updateEmailReview(ids: number[], patch: { bucket?: string; review_status?: string; suggested_action?: string }, actor = 'mission-control', db: Database.Database = getDatabase()) {
  if (ids.length === 0) return { updated: 0, learned: 0 }
  const beforeRows = db.prepare(`SELECT id, from_email, sender_domain, bucket, suggested_action FROM email_triage_messages WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<Pick<EmailTriageMessage, 'id' | 'from_email' | 'sender_domain' | 'bucket' | 'suggested_action'>>
  const allowedFields = ['bucket', 'review_status', 'suggested_action'] as const
  const sets: string[] = []
  const params: unknown[] = []
  for (const field of allowedFields) {
    const value = patch[field]
    if (typeof value === 'string' && value.length > 0) {
      sets.push(`${field} = ?`)
      params.push(value)
    }
  }
  if (patch.bucket && !patch.review_status) {
    sets.push(`review_status = 'approved'`)
  }
  if (sets.length === 0) return { updated: 0, learned: 0 }
  sets.push('updated_at = unixepoch()')
  const placeholders = ids.map(() => '?').join(',')
  const result = db.prepare(`UPDATE email_triage_messages SET ${sets.join(', ')} WHERE id IN (${placeholders})`).run(...params, ...ids)
  const learned = learnFromManualCorrections(beforeRows, patch, actor, db)
  if (patch.bucket === 'case_related') applyCaseRoutingForMessages(ids, db)
  db.prepare(`INSERT INTO email_triage_actions (action, actor, message_count, detail_json, created_at) VALUES ('review_update', ?, ?, ?, unixepoch())`)
    .run(actor, result.changes, JSON.stringify({ ids, patch, learned }))
  return { updated: result.changes, learned }
}

export async function fetchEmailBody(id: number, db: Database.Database = getDatabase()) {
  const row = db.prepare('SELECT * FROM email_triage_messages WHERE id = ?').get(id) as EmailTriageMessage | undefined
  if (!row) throw new Error('Email not found')
  if (row.body_text && row.body_text.trim()) return row

  const helper = process.env.MISSION_CONTROL_GWS_HELPER || DEFAULT_HELPER
  if (!existsSync(helper)) {
    throw new Error(`Google Workspace helper not found at ${helper}`)
  }
  const result = await runJsonCommand(gmailPythonCommand(), [helper, 'gmail', 'get', row.gmail_message_id]) as Record<string, unknown>
  const body = String(result.body || '')
  const subject = typeof result.subject === 'string' && result.subject ? result.subject : row.subject
  const labels = Array.isArray(result.labels) ? result.labels : JSON.parse(row.labels_json || '[]')
  db.prepare(`
    UPDATE email_triage_messages
    SET body_text = ?, body_hash = ?, subject = ?, labels_json = ?, body_fetched_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ?
  `).run(body, createHash('sha256').update(body).digest('hex'), subject, JSON.stringify(labels), id)
  const refreshed = db.prepare('SELECT * FROM email_triage_messages WHERE id = ?').get(id) as EmailTriageMessage
  if (refreshed.bucket === 'case_related') applyCaseRoutingForMessages([id], db)
  return db.prepare('SELECT * FROM email_triage_messages WHERE id = ?').get(id) as EmailTriageMessage
}

export type ProcessCaseEmailReviewsOptions = {
  firmVaultRoot: string
  db?: Database.Database
  limit?: number
  fetchMissingBodies?: boolean
  downloadAttachments?: boolean
}

export type ProcessCaseEmailReviewsResult = {
  processed: number
  skipped: number
  failed: number
  needsParalegal: number
  savedActivityLogs: string[]
  savedAttachments: string[]
  errors: Array<{ email_message_id: number; error: string }>
}

export async function processPendingCaseEmailReviews(options: ProcessCaseEmailReviewsOptions): Promise<ProcessCaseEmailReviewsResult> {
  const db = options.db || getDatabase()
  const limit = clampInt(options.limit, 1, 100, 25)
  const rows = db.prepare(`
    SELECT r.id as review_id, r.status as review_status, m.*
    FROM email_triage_case_reviews r
    JOIN email_triage_messages m ON m.id = r.email_message_id
    WHERE r.status = 'pending' AND m.bucket = 'case_related'
    ORDER BY r.created_at ASC, r.id ASC
    LIMIT ?
  `).all(limit) as Array<EmailTriageMessage & { review_id: number; review_status: string }>

  const result: ProcessCaseEmailReviewsResult = { processed: 0, skipped: 0, failed: 0, needsParalegal: 0, savedActivityLogs: [], savedAttachments: [], errors: [] }
  for (const row of rows) {
    try {
      let email = row
      if (options.fetchMissingBodies !== false && (!email.body_text || !email.body_text.trim())) {
        email = await fetchEmailBody(row.id, db) as typeof row
      }

      if (!email.case_slug) {
        applyCaseRoutingForMessages([email.id], db)
        email = db.prepare('SELECT * FROM email_triage_messages WHERE id = ?').get(email.id) as typeof row
      }
      if (!email.case_slug) {
        const resolution = resolveEmailToFirmVaultContact({
          from: email.from_email || email.from_name,
          subject: email.subject,
          snippet: email.snippet,
          body: email.body_text,
        }, db)
        markCaseReviewNeedsParalegal(email.id, resolution.error || 'No mechanical case match available for case-related email review.', db)
        result.needsParalegal += 1
        result.errors.push({ email_message_id: email.id, error: resolution.error || 'No mechanical case match available for case-related email review.' })
        continue
      }

      const caseRoot = join(options.firmVaultRoot, 'cases', email.case_slug)
      if (!existsSync(caseRoot)) {
        markCaseReviewFailed(email.id, `FirmVault case folder not found: ${caseRoot}`, db)
        result.failed += 1
        result.errors.push({ email_message_id: email.id, error: `FirmVault case folder not found: ${caseRoot}` })
        continue
      }

      const existing = findExistingActivityLog(caseRoot, email.gmail_message_id)
      const attachments = options.downloadAttachments === false
        ? []
        : await downloadEmailAttachments(email, caseRoot).catch((error) => {
          result.errors.push({ email_message_id: email.id, error: error instanceof Error ? error.message : String(error) })
          return []
        })
      result.savedAttachments.push(...attachments)

      const activityPath = existing || saveEmailActivityLog(email, caseRoot, attachments)
      completeCaseReview(email.id, activityPath, attachments, existing ? 'already_logged' : 'saved_to_firmvault', db)
      result.processed += 1
      if (!existing) result.savedActivityLogs.push(activityPath)
      else result.skipped += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      markCaseReviewFailed(row.id, message, db)
      result.failed += 1
      result.errors.push({ email_message_id: row.id, error: message })
    }
  }
  return result
}

function findLearnedRule(from: string, db: Database.Database) {
  const email = extractEmail(from) || from.trim().toLowerCase()
  const domain = domainFromEmail(email || '')
  let row: any = null
  if (email) {
    row = db.prepare(`SELECT * FROM email_triage_rules WHERE scope = 'from_email' AND pattern = ? LIMIT 1`).get(email)
  }
  if (!row && domain) {
    row = db.prepare(`SELECT * FROM email_triage_rules WHERE scope = 'sender_domain' AND pattern = ? LIMIT 1`).get(domain)
  }
  if (row) {
    db.prepare('UPDATE email_triage_rules SET hit_count = hit_count + 1, updated_at = unixepoch() WHERE id = ?').run(row.id)
  }
  return row as { scope: string; pattern: string; bucket: string; suggested_action: string; confidence: number } | null
}

function learnFromManualCorrections(rows: Array<Pick<EmailTriageMessage, 'from_email' | 'sender_domain' | 'bucket' | 'suggested_action'>>, patch: { bucket?: string; suggested_action?: string }, actor: string, db: Database.Database): number {
  if (!patch.bucket) return 0
  let learned = 0
  const stmt = db.prepare(`
    INSERT INTO email_triage_rules (scope, pattern, bucket, suggested_action, confidence, source, actor, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0.99, 'manual_correction', ?, unixepoch(), unixepoch())
    ON CONFLICT(scope, pattern) DO UPDATE SET
      bucket = excluded.bucket,
      suggested_action = excluded.suggested_action,
      actor = excluded.actor,
      updated_at = unixepoch()
  `)
  const updateSimilar = db.prepare(`
    UPDATE email_triage_messages
    SET bucket = ?, suggested_action = ?, confidence = 0.99,
        reason = ?, updated_at = unixepoch()
    WHERE review_status = 'pending' AND lower(from_email) = lower(?)
  `)
  for (const row of rows) {
    const pattern = (row.from_email || '').trim().toLowerCase()
    if (!pattern || row.bucket === patch.bucket) continue
    const suggested = patch.suggested_action || defaultActionForBucket(patch.bucket)
    stmt.run('from_email', pattern, patch.bucket, suggested, actor)
    updateSimilar.run(patch.bucket, suggested, `Learned from manual correction for from_email ${pattern}.`, pattern)
    learned += 1
  }
  return learned
}

function defaultActionForBucket(bucket: string): string {
  switch (bucket) {
    case 'case_related': return 'case_route'
    case 'ops_action': return 'ops_alert'
    case 'receipt':
    case 'newsletter':
    case 'junk': return 'mark_read_archive'
    default: return 'none'
  }
}

type ContactMatch = {
  case_slug: string
  contact_name: string | null
  match_type: 'email' | 'phone' | 'name'
  match_value: string
  source_path: string
  confidence: number
}

type ContactResolution = { match: ContactMatch | null; error?: string }

export function indexFirmVaultContacts(root: string, db: Database.Database = getDatabase()) {
  const casesRoot = join(root, 'cases')
  if (!existsSync(casesRoot)) return { indexed: 0, scannedFiles: 0 }
  db.prepare('DELETE FROM law_firm_contact_index').run()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO law_firm_contact_index (case_slug, contact_name, match_type, match_value, source_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `)
  let indexed = 0
  let scannedFiles = 0
  for (const filePath of walkMarkdownFiles(casesRoot)) {
    const caseSlug = caseSlugFromFirmVaultPath(root, filePath)
    if (!caseSlug) continue
    const text = readFileSync(filePath, 'utf8')
    const contactName = extractContactName(text)
    const emails = Array.from(new Set(extractEmails(text)))
    const phones = Array.from(new Set(extractPhoneNumbers(text)))
    if (!contactName && emails.length === 0 && phones.length === 0) continue
    scannedFiles += 1
    const sourcePath = relative(root, filePath)
    if (contactName) {
      indexed += insert.run(caseSlug, contactName, 'name', normalizeName(contactName), sourcePath).changes
    }
    for (const email of emails) {
      indexed += insert.run(caseSlug, contactName, 'email', email, sourcePath).changes
    }
    for (const phone of phones) {
      indexed += insert.run(caseSlug, contactName, 'phone', phone, sourcePath).changes
    }
  }
  return { indexed, scannedFiles }
}

function applyCaseRoutingForMessages(ids: number[], db: Database.Database): void {
  if (ids.length === 0) return
  const rows = db.prepare(`SELECT * FROM email_triage_messages WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as EmailTriageMessage[]
  const update = db.prepare(`
    UPDATE email_triage_messages
    SET case_slug = ?, contact_name = ?, contact_match_type = ?, contact_match_value = ?, contact_confidence = ?,
        tags_json = ?, paralegal_review_status = 'pending', suggested_action = 'case_route', updated_at = unixepoch()
    WHERE id = ?
  `)
  const review = db.prepare(`
    INSERT INTO email_triage_case_reviews (
      email_message_id, gmail_message_id, gmail_thread_id, case_slug, contact_name, match_type, match_value, status, detail_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, unixepoch(), unixepoch())
    ON CONFLICT(email_message_id) DO UPDATE SET
      case_slug = excluded.case_slug,
      contact_name = excluded.contact_name,
      match_type = excluded.match_type,
      match_value = excluded.match_value,
      status = CASE WHEN email_triage_case_reviews.status = 'completed' THEN email_triage_case_reviews.status ELSE 'pending' END,
      detail_json = excluded.detail_json,
      updated_at = unixepoch()
  `)
  for (const row of rows) {
    const resolution = resolveEmailToFirmVaultContact({
      from: row.from_email || row.from_name,
      subject: row.subject,
      snippet: row.snippet,
      body: row.body_text,
    }, db)
    const match = resolution.match
    const tags = buildEmailTags(match)
    update.run(
      match?.case_slug || row.case_slug || null,
      match?.contact_name || null,
      match?.match_type || null,
      match?.match_value || null,
      match?.confidence || null,
      JSON.stringify(tags),
      row.id,
    )
    review.run(
      row.id,
      row.gmail_message_id,
      row.gmail_thread_id,
      match?.case_slug || row.case_slug || null,
      match?.contact_name || null,
      match?.match_type || null,
      match?.match_value || null,
      JSON.stringify({ tags, source_path: match?.source_path || null, mechanical_match_error: resolution.error || null }),
    )
  }
}

function matchEmailToFirmVaultContact(input: { from?: string | null; subject?: string | null; snippet?: string | null; body?: string | null }, db: Database.Database): ContactMatch | null {
  return resolveEmailToFirmVaultContact(input, db).match
}

function resolveEmailToFirmVaultContact(input: { from?: string | null; subject?: string | null; snippet?: string | null; body?: string | null }, db: Database.Database): ContactResolution {
  const emails = new Set<string>()
  for (const part of [input.from, input.subject, input.snippet, input.body]) {
    for (const email of extractEmails(part || '')) emails.add(email)
  }
  for (const email of Array.from(emails)) {
    const row = db.prepare(`SELECT * FROM law_firm_contact_index WHERE match_type = 'email' AND match_value = ? ORDER BY case_slug LIMIT 1`).get(email) as any
    if (row) return { match: contactRowToMatch(row, 0.98) }
  }

  const phones = new Set<string>()
  for (const part of [input.subject, input.snippet, input.body, input.from]) {
    for (const phone of extractPhoneNumbers(part || '')) phones.add(phone)
  }
  for (const phone of Array.from(phones)) {
    const row = db.prepare(`SELECT * FROM law_firm_contact_index WHERE match_type = 'phone' AND match_value = ? ORDER BY case_slug LIMIT 1`).get(phone) as any
    if (row) return { match: contactRowToMatch(row, 0.93) }
  }

  const haystack = normalizeName([input.from, input.subject, input.snippet, input.body].filter(Boolean).join(' '))
  if (haystack) {
    const rows = db.prepare(`SELECT * FROM law_firm_contact_index WHERE match_type = 'name' ORDER BY length(match_value) DESC, case_slug`).all() as any[]
    const matches = rows.filter((row) => nameAppearsInText(String(row.match_value), haystack))
    const distinctCases = Array.from(new Set(matches.map((row) => String(row.case_slug))))
    if (distinctCases.length === 1 && matches[0]) return { match: contactRowToMatch(matches[0], 0.78) }
    if (distinctCases.length > 1) return { match: null, error: `Ambiguous mechanical name match across cases: ${distinctCases.join(', ')}` }
  }

  return { match: null }
}

function contactRowToMatch(row: any, confidence: number): ContactMatch {
  return {
    case_slug: String(row.case_slug),
    contact_name: row.contact_name || null,
    match_type: row.match_type,
    match_value: String(row.match_value),
    source_path: String(row.source_path),
    confidence,
  }
}

function buildEmailTags(match: ContactMatch | null): string[] {
  if (!match) return ['case-review:unmatched']
  return [
    `case:${match.case_slug}`,
    match.contact_name ? `contact:${match.contact_name}` : null,
    `${match.match_type}:${match.match_value}`,
  ].filter(Boolean) as string[]
}

function walkMarkdownFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) results.push(...walkMarkdownFiles(path))
    else if (info.isFile() && /\.(md|txt|json|ya?ml)$/i.test(path)) results.push(path)
  }
  return results
}

function caseSlugFromFirmVaultPath(root: string, filePath: string): string | null {
  const parts = relative(root, filePath).split(/[\\/]+/)
  const idx = parts.indexOf('cases')
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null
}

function extractContactName(text: string): string | null {
  const match = text.match(/(?:full_name|name|contact_name):\s*([^\n]+)/i)
  return match ? match[1].trim().replace(/^[\'"]|[\'"]$/g, '') : null
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:mr|mrs|ms|miss|dr|jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameAppearsInText(normalizedName: string, normalizedText: string): boolean {
  if (!normalizedName || normalizedName.length < 5) return false
  const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(normalizedText)
}

function extractEmails(text: string): string[] {
  return Array.from(text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map((match) => match[0].toLowerCase())
}

function extractPhoneNumbers(text: string): string[] {
  const matches = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) || []
  return matches
    .map((value) => value.replace(/\D/g, ''))
    .map((digits) => digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits)
    .filter((digits) => digits.length === 10)
}

function saveEmailActivityLog(email: EmailTriageMessage, caseRoot: string, attachments: string[]): string {
  const activityDir = join(caseRoot, 'Activity Log')
  mkdirSync(activityDir, { recursive: true })
  const timestamp = formatActivityTimestamp(email.sent_at)
  const senderSlug = slugify(email.from_name || email.from_email || email.sender_domain || 'unknown-sender')
  const activityPath = uniquePath(join(activityDir, `${timestamp}-email-${senderSlug}.md`))
  const labels = safeJsonArray(email.labels_json)
  const tags = safeJsonArray(email.tags_json)
  const body = email.body_text?.trim() || email.snippet || ''
  const content = [
    '---',
    `type: email`,
    `gmail_message_id: ${yamlScalar(email.gmail_message_id)}`,
    `gmail_thread_id: ${yamlScalar(email.gmail_thread_id || '')}`,
    `case_slug: ${yamlScalar(email.case_slug || '')}`,
    `from_name: ${yamlScalar(email.from_name || '')}`,
    `from_email: ${yamlScalar(email.from_email || '')}`,
    `subject: ${yamlScalar(email.subject || '')}`,
    `received_at: ${yamlScalar(email.sent_at ? new Date(email.sent_at * 1000).toISOString() : '')}`,
    `bucket: ${yamlScalar(email.bucket)}`,
    `contact_name: ${yamlScalar(email.contact_name || '')}`,
    `contact_match_type: ${yamlScalar(email.contact_match_type || '')}`,
    `contact_match_value: ${yamlScalar(email.contact_match_value || '')}`,
    `tags: ${JSON.stringify(tags)}`,
    `labels: ${JSON.stringify(labels)}`,
    `attachments: ${JSON.stringify(attachments.map((path) => relative(caseRoot, path)))}`,
    '---',
    '',
    `# Email — ${email.subject || '(no subject)'}`,
    '',
    `- **From:** ${email.from_name ? `${email.from_name} <${email.from_email || ''}>` : email.from_email || 'unknown'}`,
    `- **Gmail message ID:** ${email.gmail_message_id}`,
    `- **Gmail thread ID:** ${email.gmail_thread_id || ''}`,
    `- **Suggested action:** ${email.suggested_action}`,
    `- **Tags:** ${tags.join(', ') || 'none'}`,
    `- **Attachments saved:** ${attachments.length ? attachments.map((path) => relative(caseRoot, path)).join(', ') : 'none'}`,
    '',
    '## Body',
    '',
    body || '_No body text captured._',
  ].join('\n')
  writeFileSync(activityPath, content)
  return activityPath
}

async function downloadEmailAttachments(email: EmailTriageMessage, caseRoot: string): Promise<string[]> {
  if (!email.has_attachments) return []
  const helper = process.env.MISSION_CONTROL_GWS_HELPER || DEFAULT_HELPER
  if (!existsSync(helper)) return []
  const raw = await runJsonCommand(gmailPythonCommand(), [helper, 'gmail', 'attachments', email.gmail_message_id])
  const attachments = normalizeAttachmentList(raw)
  const saved: string[] = []
  const outputDir = join(caseRoot, 'documents', 'email-attachments')
  mkdirSync(outputDir, { recursive: true })
  for (const attachment of attachments) {
    if (!attachment.attachmentId || shouldSkipAttachment(attachment)) continue
    const outputPath = uniquePath(join(outputDir, `${formatActivityTimestamp(email.sent_at)}-${safeFilename(attachment.filename || 'attachment')}`))
    await runJsonCommand(gmailPythonCommand(), [helper, 'gmail', 'attachment-download', email.gmail_message_id, '--attachment-id', attachment.attachmentId, '-o', outputPath])
    if (existsSync(outputPath)) saved.push(outputPath)
  }
  return saved
}

function normalizeAttachmentList(raw: unknown): Array<{ filename: string; mimeType?: string; attachmentId?: string }> {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.attachments)
      ? (raw as any).attachments
      : Array.isArray((raw as any)?.data)
        ? (raw as any).data
        : []
  return items.map((item: any) => ({
    filename: String(item.filename || item.name || ''),
    mimeType: item.mimeType || item.mime_type || item.mime || undefined,
    attachmentId: item.attachmentId || item.attachment_id || item.id || undefined,
  }))
}

function shouldSkipAttachment(attachment: { filename: string; mimeType?: string }): boolean {
  const name = attachment.filename.toLowerCase()
  const mime = (attachment.mimeType || '').toLowerCase()
  return mime.startsWith('image/') || /^(image|logo|signature|facebook|twitter|linkedin)/.test(name) || /\.(png|jpe?g|gif|webp)$/i.test(name)
}

function completeCaseReview(emailMessageId: number, activityPath: string, attachments: string[], actionTaken: string, db: Database.Database): void {
  db.prepare(`
    UPDATE email_triage_case_reviews
    SET status = 'completed', firmvault_path = ?, attachments_json = ?, error_message = NULL, processed_at = unixepoch(), updated_at = unixepoch()
    WHERE email_message_id = ?
  `).run(activityPath, JSON.stringify(attachments), emailMessageId)
  db.prepare(`
    UPDATE email_triage_messages
    SET firmvault_path = ?, paralegal_review_status = 'completed', action_taken = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(activityPath, actionTaken, emailMessageId)
}

function markCaseReviewFailed(emailMessageId: number, message: string, db: Database.Database): void {
  db.prepare(`
    UPDATE email_triage_case_reviews
    SET status = 'failed', error_message = ?, updated_at = unixepoch()
    WHERE email_message_id = ?
  `).run(message, emailMessageId)
  db.prepare(`
    UPDATE email_triage_messages
    SET paralegal_review_status = 'failed', updated_at = unixepoch()
    WHERE id = ?
  `).run(emailMessageId)
}

function markCaseReviewNeedsParalegal(emailMessageId: number, message: string, db: Database.Database): void {
  db.prepare(`
    UPDATE email_triage_case_reviews
    SET status = 'needs_paralegal_review', error_message = ?, updated_at = unixepoch()
    WHERE email_message_id = ?
  `).run(message, emailMessageId)
  db.prepare(`
    UPDATE email_triage_messages
    SET paralegal_review_status = 'needs_paralegal_review', updated_at = unixepoch()
    WHERE id = ?
  `).run(emailMessageId)
}

function findExistingActivityLog(caseRoot: string, gmailMessageId: string): string | null {
  const activityDir = join(caseRoot, 'Activity Log')
  if (!existsSync(activityDir)) return null
  for (const filePath of walkFiles(activityDir)) {
    if (!/\.md$/i.test(filePath)) continue
    const text = readFileSync(filePath, 'utf8')
    if (new RegExp(`(?:message_id|gmail_message_id|Gmail message ID):\\s*${escapeRegExp(gmailMessageId)}`).test(text)) return filePath
  }
  return null
}

function walkFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) results.push(...walkFiles(path))
    else if (info.isFile()) results.push(path)
  }
  return results
}

function gmailPythonCommand(): string {
  const preferred = '/opt/anaconda3/bin/python3'
  return existsSync(preferred) ? preferred : 'python3'
}

function formatActivityTimestamp(sentAt: number | null): string {
  const date = sentAt ? new Date(sentAt * 1000) : new Date()
  return date.toISOString().slice(0, 16).replace('T', '-').replace(':', '')
}

function uniquePath(path: string): string {
  if (!existsSync(path)) return path
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  const ext = dot > 0 ? path.slice(dot) : ''
  let i = 2
  while (existsSync(`${stem}-${i}${ext}`)) i += 1
  return `${stem}-${i}${ext}`
}

function safeFilename(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'attachment'
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'email'
}

function safeJsonArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function yamlScalar(value: string): string {
  return JSON.stringify(value || '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function runJsonCommand(command: string, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Command exited ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error(`Helper returned non-JSON output: ${stdout.slice(0, 200)}`))
      }
    })
  })
}

function extractEmail(value: string): string | null {
  const match = value.match(/<([^>]+)>/) || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match ? match[1] || match[0] : null
}

function extractName(value: string): string | null {
  return value.includes('<') ? value.split('<')[0].trim().replace(/^"|"$/g, '') || null : null
}

function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null
}

function parseGmailDate(value: unknown): number | null {
  if (typeof value === 'number') return value > 10_000_000_000 ? Math.floor(value / 1000) : value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value)
    return n > 10_000_000_000 ? Math.floor(n / 1000) : n
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
  }
  return null
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}
