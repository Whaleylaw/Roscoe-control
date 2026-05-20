import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import { getEmailTriageStats, indexFirmVaultContacts, listEmailTriageMessages, processPendingCaseEmailReviews, updateEmailReview, upsertEmailTriageMessage } from '@/lib/law-firm-email-triage'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db?.close()
})

describe('law firm email triage', () => {
  it('indexes unread metadata and classifies obvious junk locally', () => {
    upsertEmailTriageMessage({
      gmail_message_id: 'msg-1',
      gmail_thread_id: 'thread-1',
      from_email: 'deals@example.com',
      subject: 'Half off promo today',
      snippet: 'Big discount deal',
      labels: ['UNREAD'],
    }, db)

    const { emails, total } = listEmailTriageMessages({}, db)
    expect(total).toBe(1)
    expect(emails[0].bucket).toBe('junk')
    expect(emails[0].suggested_action).toBe('mark_read_archive')
  })

  it('keeps account and payment problems visible as ops action', () => {
    upsertEmailTriageMessage({
      gmail_message_id: 'msg-2',
      from_email: 'billing@openrouter.ai',
      subject: 'Auto top-up failed',
      snippet: 'Action required: payment failed',
      labels: ['UNREAD'],
    }, db)

    const stats = getEmailTriageStats(db)
    expect(stats.total).toBe(1)
    expect(stats.byBucket.ops_action).toBe(1)
  })

  it('supports reviewer bulk updates without touching Gmail', () => {
    upsertEmailTriageMessage({ gmail_message_id: 'msg-3', subject: 'Weekly newsletter', from_email: 'news@example.com' }, db)
    const row = listEmailTriageMessages({}, db).emails[0]

    const result = updateEmailReview([row.id], { review_status: 'approved', suggested_action: 'mark_read_archive' }, 'tester', db)

    expect(result.updated).toBe(1)
    const updated = listEmailTriageMessages({}, db).emails[0]
    expect(updated.review_status).toBe('approved')
    expect(updated.suggested_action).toBe('mark_read_archive')
  })

  it('learns exact sender category corrections and applies them to future inventory', () => {
    upsertEmailTriageMessage({
      gmail_message_id: 'msg-4',
      from_email: 'alerts@example.com',
      subject: 'Special discount offer',
      snippet: 'promo deal',
      labels: ['UNREAD'],
    }, db)
    const original = listEmailTriageMessages({}, db).emails[0]
    expect(original.bucket).toBe('junk')

    updateEmailReview([original.id], { bucket: 'ops_action', suggested_action: 'ops_alert' }, 'tester', db)

    upsertEmailTriageMessage({
      gmail_message_id: 'msg-5',
      from_email: 'alerts@example.com',
      subject: 'Special discount offer again',
      snippet: 'promo deal',
      labels: ['UNREAD'],
    }, db)

    const learned = listEmailTriageMessages({ query: 'Special discount offer again' }, db).emails[0]
    expect(learned.bucket).toBe('ops_action')
    expect(learned.suggested_action).toBe('ops_alert')
    expect(learned.reason).toContain('Learned from manual correction')
  })

  it('manual category correction is treated as reviewed so inventory refresh does not overwrite it', () => {
    upsertEmailTriageMessage({ gmail_message_id: 'msg-6', from_email: 'deals@example.com', subject: 'sale deal' }, db)
    const original = listEmailTriageMessages({}, db).emails[0]
    expect(original.bucket).toBe('junk')

    updateEmailReview([original.id], { bucket: 'newsletter', suggested_action: 'mark_read_archive' }, 'tester', db)
    upsertEmailTriageMessage({ gmail_message_id: 'msg-6', from_email: 'deals@example.com', subject: 'sale deal' }, db)

    const refreshed = listEmailTriageMessages({}, db).emails[0]
    expect(refreshed.bucket).toBe('newsletter')
    expect(refreshed.review_status).toBe('approved')
  })

  it('learns personal category corrections for exact senders without defaulting to archive', () => {
    upsertEmailTriageMessage({
      gmail_message_id: 'msg-7',
      from_email: 'friend@example.com',
      subject: 'Weekend plans',
      snippet: 'Can you call me later?',
      labels: ['UNREAD'],
    }, db)
    const original = listEmailTriageMessages({}, db).emails[0]

    updateEmailReview([original.id], { bucket: 'personal', suggested_action: 'none' }, 'tester', db)
    upsertEmailTriageMessage({
      gmail_message_id: 'msg-8',
      from_email: 'friend@example.com',
      subject: 'Another personal note',
      snippet: 'Family update',
      labels: ['UNREAD'],
    }, db)

    const learned = listEmailTriageMessages({ query: 'Another personal note' }, db).emails[0]
    expect(learned.bucket).toBe('personal')
    expect(learned.suggested_action).toBe('none')
    expect(getEmailTriageStats(db).byBucket.personal).toBe(2)
  })

  it('indexes FirmVault contact emails and tags matching case-related messages', () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-contacts-'))
    const caseDir = join(root, 'cases', 'michael-crader', 'documents', 'financial')
    mkdirSync(caseDir, { recursive: true })
    writeFileSync(join(caseDir, 'contacts.md'), [
      'full_name: Michael Crader',
      'email: michael.crader@example.com',
      'phone: (502) 555-1212',
    ].join('\n'))

    const indexed = indexFirmVaultContacts(root, db)
    expect(indexed.indexed).toBeGreaterThanOrEqual(2)

    upsertEmailTriageMessage({
      gmail_message_id: 'msg-case-1',
      from_email: 'michael.crader@example.com',
      subject: 'Case update',
      snippet: 'Please review this case update.',
      labels: ['UNREAD'],
    }, db)

    const row = listEmailTriageMessages({}, db).emails[0]
    expect(row.bucket).toBe('case_related')
    expect(row.case_slug).toBe('michael-crader')
    expect(row.contact_name).toBe('Michael Crader')
    expect(row.tags_json).toContain('case:michael-crader')

    const review = db.prepare('SELECT * FROM email_triage_case_reviews WHERE email_message_id = ?').get(row.id) as any
    expect(review.status).toBe('pending')
    expect(review.case_slug).toBe('michael-crader')
  })

  it('matches RingCentral phone numbers against FirmVault contacts when manually moved to case-related', () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-phone-'))
    const caseDir = join(root, 'cases', 'robin-willis-beck', 'documents', 'financial')
    mkdirSync(caseDir, { recursive: true })
    writeFileSync(join(caseDir, 'contacts.md'), [
      'full_name: Robin Willis-Beck',
      'phone: 502-555-3434',
    ].join('\n'))
    indexFirmVaultContacts(root, db)

    upsertEmailTriageMessage({
      gmail_message_id: 'msg-phone-1',
      from_email: 'noreply@ringcentral.com',
      subject: 'New voicemail from +1 (502) 555-3434',
      snippet: 'Caller ID +1 502 555 3434 left a voicemail.',
      labels: ['UNREAD'],
    }, db)
    const row = listEmailTriageMessages({}, db).emails[0]

    updateEmailReview([row.id], { bucket: 'case_related', suggested_action: 'case_route' }, 'tester', db)

    const updated = listEmailTriageMessages({}, db).emails[0]
    expect(updated.case_slug).toBe('robin-willis-beck')
    expect(updated.contact_name).toBe('Robin Willis-Beck')
    expect(updated.contact_match_type).toBe('phone')
    expect(updated.tags_json).toContain('contact:Robin Willis-Beck')
  })

  it('worker mechanically matches by contact name before saving to FirmVault', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-case-email-'))
    mkdirSync(join(root, 'cases', 'michael-crader', 'Activity Log'), { recursive: true })
    mkdirSync(join(root, 'cases', 'michael-crader', 'contacts'), { recursive: true })
    writeFileSync(join(root, 'cases', 'michael-crader', 'contacts', 'michael-crader.md'), 'full_name: Michael Crader\n')
    indexFirmVaultContacts(root, db)

    upsertEmailTriageMessage({
      gmail_message_id: 'msg-save-1',
      gmail_thread_id: 'thread-save-1',
      from_email: 'adjuster@example.com',
      from_name: 'Claims Adjuster',
      subject: 'Michael Crader claim documents',
      snippet: 'Attached are the requested claim documents.',
      labels: ['UNREAD'],
      has_attachments: false,
    }, db)
    const row = listEmailTriageMessages({}, db).emails[0]
    db.prepare('UPDATE email_triage_messages SET body_text = ?, bucket = ?, suggested_action = ? WHERE id = ?')
      .run('Full email body for the claim update.', 'case_related', 'case_route', row.id)
    updateEmailReview([row.id], { bucket: 'case_related', suggested_action: 'case_route' }, 'tester', db)

    const result = await processPendingCaseEmailReviews({ firmVaultRoot: root, db, fetchMissingBodies: false })

    expect(result.processed).toBe(1)
    expect(result.savedActivityLogs).toHaveLength(1)
    expect(existsSync(result.savedActivityLogs[0])).toBe(true)
    const activityLog = readFileSync(result.savedActivityLogs[0], 'utf8')
    expect(activityLog).toContain('gmail_message_id: "msg-save-1"')
    expect(activityLog).toContain('case_slug: "michael-crader"')
    expect(activityLog).toContain('contact_match_type: "name"')
    expect(activityLog).toContain('Full email body for the claim update.')

    const review = db.prepare('SELECT * FROM email_triage_case_reviews WHERE email_message_id = ?').get(row.id) as any
    expect(review.status).toBe('completed')
    expect(review.firmvault_path).toBe(result.savedActivityLogs[0])
    const updated = listEmailTriageMessages({}, db).emails[0]
    expect(updated.case_slug).toBe('michael-crader')
    expect(updated.contact_match_type).toBe('name')
    expect(updated.paralegal_review_status).toBe('completed')
    expect(updated.action_taken).toBe('saved_to_firmvault')
  })

  it('leaves ambiguous case-related emails for paralegal review instead of guessing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'firmvault-ambiguous-email-'))
    mkdirSync(join(root, 'cases', 'john-smith-a', 'contacts'), { recursive: true })
    mkdirSync(join(root, 'cases', 'john-smith-b', 'contacts'), { recursive: true })
    writeFileSync(join(root, 'cases', 'john-smith-a', 'contacts', 'john-smith.md'), 'full_name: John Smith\n')
    writeFileSync(join(root, 'cases', 'john-smith-b', 'contacts', 'john-smith.md'), 'full_name: John Smith\n')
    indexFirmVaultContacts(root, db)

    upsertEmailTriageMessage({ gmail_message_id: 'msg-ambiguous-1', subject: 'John Smith records', snippet: 'John Smith sent documents', labels: ['UNREAD'] }, db)
    const row = listEmailTriageMessages({}, db).emails[0]
    updateEmailReview([row.id], { bucket: 'case_related', suggested_action: 'case_route' }, 'tester', db)

    const result = await processPendingCaseEmailReviews({ firmVaultRoot: root, db, fetchMissingBodies: false })

    expect(result.processed).toBe(0)
    expect(result.needsParalegal).toBe(1)
    const review = db.prepare('SELECT * FROM email_triage_case_reviews WHERE email_message_id = ?').get(row.id) as any
    expect(review.status).toBe('needs_paralegal_review')
    expect(review.error_message).toContain('Ambiguous')
    const updated = listEmailTriageMessages({}, db).emails[0]
    expect(updated.paralegal_review_status).toBe('needs_paralegal_review')
  })
})
