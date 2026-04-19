import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { getDatabase } from './db'
import { hashPassword, verifyPassword, verifyPasswordWithRehashCheck } from './password'
import { logSecurityEvent } from './security-events'
import { extractClientIpFromTrusted } from './request'
import { parseMcSessionCookieHeader } from './session-cookie'
import { getRunnerSecret } from './runner-secret'
import { verifyRunnerToken, RUNNER_TOKEN_ALLOWLIST, type VerifiedRunnerToken } from './runner-tokens'

// Trusted IPs for proxy auth header (comma-separated)
const PROXY_AUTH_TRUSTED_IPS = new Set(
  (process.env.MC_PROXY_AUTH_TRUSTED_IPS || '').split(',').map(s => s.trim()).filter(Boolean)
)

// Log once at startup if proxy auth is misconfigured.
// Deferred to avoid DB access during module initialization.
let _proxyAuthMisconfigWarned = false
function warnProxyAuthMisconfigOnce(): void {
  if (_proxyAuthMisconfigWarned) return
  _proxyAuthMisconfigWarned = true
  try {
    logSecurityEvent({
      event_type: 'proxy_auth_misconfigured',
      severity: 'critical',
      source: 'auth',
      detail: JSON.stringify({
        reason: 'MC_PROXY_AUTH_HEADER is set but MC_PROXY_AUTH_TRUSTED_IPS is empty — proxy auth disabled',
      }),
      workspace_id: 1,
      tenant_id: 1,
    })
  } catch {}
}

// Plugin hook: extensions can register a custom API key resolver without modifying this file.
type AuthResolverHook = (apiKey: string, agentName: string | null) => User | null
let _authResolverHook: AuthResolverHook | null = null
export function registerAuthResolver(hook: AuthResolverHook): void {
  _authResolverHook = hook
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Compare against dummy buffer to avoid timing leak on length mismatch
    const dummy = Buffer.alloc(bufA.length)
    timingSafeEqual(bufA, dummy)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  workspace_id: number
  tenant_id: number
  provider?: 'local' | 'google' | 'proxy'
  email?: string | null
  avatar_url?: string | null
  is_approved?: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  /** Agent name when request is made on behalf of a specific agent (via X-Agent-Name header) */
  agent_name?: string | null
  /** When authenticated via runner-token, the task_id embedded in the token. Handlers MUST verify this matches the :id path param. */
  runner_token_task_id?: number | null
}

export interface UserSession {
  id: number
  token: string
  user_id: number
  workspace_id: number
  tenant_id: number
  expires_at: number
  created_at: number
  ip_address: string | null
  user_agent: string | null
}

interface SessionQueryRow {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider: 'local' | 'google' | null
  email: string | null
  avatar_url: string | null
  is_approved: number
  workspace_id: number
  tenant_id: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  session_id: number
}

interface UserQueryRow {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider: 'local' | 'google' | null
  email: string | null
  avatar_url: string | null
  is_approved: number
  workspace_id: number
  tenant_id?: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  password_hash: string
}

// Session management
const SESSION_DURATION = 7 * 24 * 60 * 60 // 7 days in seconds

function getDefaultWorkspaceContext(): { workspaceId: number; tenantId: number } {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT id, tenant_id
      FROM workspaces
      ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get() as { id?: number; tenant_id?: number } | undefined
    return {
      workspaceId: row?.id || 1,
      tenantId: row?.tenant_id || 1,
    }
  } catch {
    return { workspaceId: 1, tenantId: 1 }
  }
}

export function getWorkspaceIdFromRequest(request: Request): number {
  const user = getUserFromRequest(request)
  return user?.workspace_id || getDefaultWorkspaceContext().workspaceId
}

export function getTenantIdFromRequest(request: Request): number {
  const user = getUserFromRequest(request)
  return user?.tenant_id || getDefaultWorkspaceContext().tenantId
}

function resolveTenantForWorkspace(workspaceId: number): number {
  const db = getDatabase()
  const row = db.prepare(`SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`).get(workspaceId) as { tenant_id?: number } | undefined
  return row?.tenant_id || getDefaultWorkspaceContext().tenantId
}

export function createSession(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  workspaceId?: number
): { token: string; expiresAt: number } {
  const db = getDatabase()
  const token = randomBytes(32).toString('hex')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_DURATION
  const resolvedWorkspaceId = workspaceId ?? ((db.prepare('SELECT workspace_id FROM users WHERE id = ?').get(userId) as { workspace_id?: number } | undefined)?.workspace_id || getDefaultWorkspaceContext().workspaceId)
  const resolvedTenantId = resolveTenantForWorkspace(resolvedWorkspaceId)

  const tokenHash = hashSessionToken(token)
  db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at, ip_address, user_agent, workspace_id, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tokenHash, userId, expiresAt, ipAddress || null, userAgent || null, resolvedWorkspaceId, resolvedTenantId)

  // Update user's last login
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, userId)

  // Clean up expired sessions
  db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(now)

  return { token, expiresAt }
}

export function validateSession(token: string): (User & { sessionId: number }) | null {
  if (!token) return null
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const tokenHash = hashSessionToken(token)

  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.provider, u.email, u.avatar_url, u.is_approved,
           COALESCE(s.workspace_id, u.workspace_id, 1) as workspace_id,
           COALESCE(s.tenant_id, w.tenant_id, 1) as tenant_id,
           u.created_at, u.updated_at, u.last_login_at,
           s.id as session_id
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN workspaces w ON w.id = COALESCE(s.workspace_id, u.workspace_id, 1)
    WHERE s.token = ? AND s.expires_at > ?
  `).get(tokenHash, now) as SessionQueryRow | undefined

  if (!row) return null

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    workspace_id: row.workspace_id || getDefaultWorkspaceContext().workspaceId,
    tenant_id: row.tenant_id || getDefaultWorkspaceContext().tenantId,
    provider: row.provider || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: typeof row.is_approved === 'number' ? row.is_approved : 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
    sessionId: row.session_id,
  }
}

export function destroySession(token: string): void {
  const db = getDatabase()
  const tokenHash = hashSessionToken(token)
  db.prepare('DELETE FROM user_sessions WHERE token = ?').run(tokenHash)
}

export function destroyAllUserSessions(userId: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId)
}

// Dummy hash used for constant-time rejection when user doesn't exist.
// This ensures authenticateUser takes the same time whether or not the username is valid,
// preventing timing-based username enumeration.
const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000'

// User management
export function authenticateUser(username: string, password: string): User | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserQueryRow | undefined
  if (!row) {
    // Always run verifyPassword to prevent timing-based username enumeration
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'user_not_found' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  if ((row.provider || 'local') !== 'local') {
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'wrong_provider' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  if ((row.is_approved ?? 1) !== 1) {
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'not_approved' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  const { valid, needsRehash } = verifyPasswordWithRehashCheck(password, row.password_hash)
  if (!valid) {
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'invalid_password' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  // Progressive rehash: upgrade hash to current scrypt cost on successful login
  if (needsRehash) {
    try {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(hashPassword(password), Math.floor(Date.now() / 1000), row.id)
    } catch { /* non-fatal — will rehash on next login */ }
  }
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    workspace_id: row.workspace_id || getDefaultWorkspaceContext().workspaceId,
    tenant_id: resolveTenantForWorkspace(row.workspace_id || getDefaultWorkspaceContext().workspaceId),
    provider: row.provider || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: row.is_approved ?? 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  }
}

export function getUserById(id: number): User | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id = ?
  `).get(id) as User | undefined
  return row ? { ...row, tenant_id: row.tenant_id || getDefaultWorkspaceContext().tenantId } : null
}

export function getAllUsers(): User[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    ORDER BY u.created_at
  `).all() as User[]
}

export function createUser(
  username: string,
  password: string,
  displayName: string,
  role: User['role'] = 'operator',
  options?: { provider?: 'local' | 'google'; provider_user_id?: string | null; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1; approved_by?: string | null; approved_at?: number | null; workspace_id?: number }
): User {
  const db = getDatabase()
  if (password.length < 12) throw new Error('Password must be at least 12 characters')
  const passwordHash = hashPassword(password)
  const provider = options?.provider || 'local'
  const workspaceId = options?.workspace_id || getDefaultWorkspaceContext().workspaceId
  const result = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, provider, provider_user_id, email, avatar_url, is_approved, approved_by, approved_at, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    username,
    displayName,
    passwordHash,
    role,
    provider,
    options?.provider_user_id || null,
    options?.email || null,
    options?.avatar_url || null,
    typeof options?.is_approved === 'number' ? options.is_approved : 1,
    options?.approved_by || null,
    options?.approved_at || null,
    workspaceId,
  )

  return getUserById(Number(result.lastInsertRowid))!
}

export function updateUser(id: number, updates: { display_name?: string; role?: User['role']; password?: string; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1 }): User | null {
  const db = getDatabase()
  const fields: string[] = []
  const params: any[] = []

  if (updates.display_name !== undefined) { fields.push('display_name = ?'); params.push(updates.display_name) }
  if (updates.role !== undefined) { fields.push('role = ?'); params.push(updates.role) }
  if (updates.password !== undefined) { fields.push('password_hash = ?'); params.push(hashPassword(updates.password)) }
  if (updates.email !== undefined) { fields.push('email = ?'); params.push(updates.email) }
  if (updates.avatar_url !== undefined) { fields.push('avatar_url = ?'); params.push(updates.avatar_url) }
  if (updates.is_approved !== undefined) { fields.push('is_approved = ?'); params.push(updates.is_approved) }

  if (fields.length === 0) return getUserById(id)

  fields.push('updated_at = ?')
  params.push(Math.floor(Date.now() / 1000))
  params.push(id)

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  return getUserById(id)
}

export function deleteUser(id: number): boolean {
  const db = getDatabase()
  destroyAllUserSessions(id)
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Seed admin user from environment variables on first run.
 * If no users exist, creates an admin from AUTH_USER/AUTH_PASS env vars.
 */
/**
 * Get user from request - checks session cookie or API key.
 * For API key auth, returns a synthetic "api" user.
 */
/**
 * Resolve a user by username for proxy auth.
 * If the user does not exist and MC_PROXY_AUTH_DEFAULT_ROLE is set, auto-provisions them.
 * Auto-provisioned users receive a random unusable password — they cannot log in locally.
 */
function resolveOrProvisionProxyUser(username: string): User | null {
  try {
    const db = getDatabase()
    const { workspaceId } = getDefaultWorkspaceContext()

    const row = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.workspace_id,
             COALESCE(w.tenant_id, 1) as tenant_id,
             u.provider, u.email, u.avatar_url, u.is_approved,
             u.created_at, u.updated_at, u.last_login_at
      FROM users u
      LEFT JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.username = ?
    `).get(username) as UserQueryRow | undefined

    if (row) {
      if ((row.is_approved ?? 1) !== 1) return null
      return {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        workspace_id: row.workspace_id || workspaceId,
        tenant_id: resolveTenantForWorkspace(row.workspace_id || workspaceId),
        provider: row.provider || 'local',
        email: row.email ?? null,
        avatar_url: row.avatar_url ?? null,
        is_approved: row.is_approved ?? 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_login_at: row.last_login_at,
      }
    }

    // Auto-provision if MC_PROXY_AUTH_DEFAULT_ROLE is configured
    const defaultRole = (process.env.MC_PROXY_AUTH_DEFAULT_ROLE || '').trim()
    if (!defaultRole || !(['viewer', 'operator', 'admin'] as const).includes(defaultRole as User['role'])) {
      return null
    }

    // Random password — proxy users cannot log in via the local login form
    return createUser(username, randomBytes(32).toString('hex'), username, defaultRole as User['role'])
  } catch {
    return null
  }
}

export function getUserFromRequest(request: Request): User | null {
  // Extract agent identity header (optional, for attribution)
  const agentName = (request.headers.get('x-agent-name') || '').trim() || null

  // Proxy / trusted-header auth (MC_PROXY_AUTH_HEADER)
  // When the gateway has already authenticated the user and injects their username
  // as a trusted header (e.g. X-Auth-Username from Envoy OIDC claimToHeaders),
  // skip the local login form entirely.
  // Requires MC_PROXY_AUTH_TRUSTED_IPS — without it, proxy auth is disabled
  // and a critical security event is logged on the first request.
  const proxyAuthHeader = (process.env.MC_PROXY_AUTH_HEADER || '').trim()
  if (proxyAuthHeader) {
    if (PROXY_AUTH_TRUSTED_IPS.size === 0) {
      warnProxyAuthMisconfigOnce()
    } else {
      const clientIp = extractClientIpFromTrusted(request, PROXY_AUTH_TRUSTED_IPS, '')
      if (clientIp && PROXY_AUTH_TRUSTED_IPS.has(clientIp)) {
        const proxyUsername = (request.headers.get(proxyAuthHeader) || '').trim()
        if (proxyUsername) {
          const user = resolveOrProvisionProxyUser(proxyUsername)
          if (user) return { ...user, agent_name: agentName }
        }
      }
    }
  }

  // Runner principal — auto-generated .data/runner.secret, strictly scoped to /api/runner/*.
  // See RAUTH-01 + .planning/phases/11-runtime-foundation-v1-2/11-CONTEXT.md.
  //
  // IMPORTANT: the url.pathname.startsWith('/api/runner/') gate is the ONLY check —
  // if it fails, we never compare the bearer against the runner secret at all. A
  // request hitting /api/tasks with the runner secret presented as a bearer falls
  // through to the session-cookie / API-key / agent-key branches below and will
  // be rejected there (because none of those will match the runner secret).
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/runner/')) {
    const bearer = extractApiKeyFromHeaders(request.headers)
    const runnerSecret = getRunnerSecret()
    if (bearer && runnerSecret && safeCompare(bearer, runnerSecret)) {
      try {
        logSecurityEvent({
          event_type: 'runner_auth',
          severity: 'info',
          source: 'auth',
          // NEVER include the secret value, a prefix, or a hash of it. CONTEXT.md locks this.
          detail: JSON.stringify({ principal: 'runner', path: url.pathname, method: request.method }),
          ip_address: request.headers.get('x-real-ip') || 'unknown',
          workspace_id: getDefaultWorkspaceContext().workspaceId,
          tenant_id: getDefaultWorkspaceContext().tenantId,
        })
      } catch { /* startup race / DB not ready — non-fatal */ }
      return {
        // Negative sentinel id, well outside the 1..N user range AND outside the
        // -agent_id range used by agent-scoped API keys (agent IDs will never be
        // in the thousands in realistic deployments). Phase 14 claim-route code
        // must treat id === -1000 as the runner principal explicitly.
        id: -1000,
        username: 'runner',
        display_name: 'Runner Daemon',
        // Operator-level: runner needs write access to checkpoints/claim endpoints
        // (Phase 14/15) but is NOT admin.
        role: 'operator',
        workspace_id: getDefaultWorkspaceContext().workspaceId,
        tenant_id: getDefaultWorkspaceContext().tenantId,
        provider: 'local',
        email: null,
        avatar_url: null,
        is_approved: 1,
        created_at: 0,
        updated_at: 0,
        last_login_at: null,
        agent_name: null,
      }
    }
    // Fall through. If the path is /api/runner/* but the bearer is wrong or
    // absent, we intentionally do NOT short-circuit — the request could carry
    // a runner-token (Plan 11-04) or a valid session cookie. The subsequent
    // branches handle those.
  }

  // Runner-token principal — per-task, per-attempt bearer; allowlist-scoped; expiring; revocable.
  // See RAUTH-02..06 + Plan 11-04. Placed adjacent to the runner-secret branch above: a request
  // to /api/runner/tasks/:id/* may carry EITHER the runner secret (admin-path access from the
  // daemon, handled above) OR a runner-token (task-scoped, handled here). The runner-secret
  // branch fell through (no runner bearer match), so we now try the token path.
  //
  // Cross-task 403 is enforced in requireRunnerToken(), NOT here — getUserFromRequest returns
  // null for "no valid principal for this request", and the 401-vs-403 decision is concentrated
  // in the wrapper below so route handlers have a single source of truth.
  if (url.pathname.startsWith('/api/runner/')) {
    const bearer = extractApiKeyFromHeaders(request.headers)
    if (bearer) {
      // (a) Path must match one of the six allowlisted patterns AND method.
      const match = RUNNER_TOKEN_ALLOWLIST.find(
        (rule) => rule.method === request.method && rule.pathPattern.test(url.pathname),
      )
      if (match) {
        const pathIdMatch = url.pathname.match(match.pathPattern)
        const pathTaskId = pathIdMatch ? Number(pathIdMatch[1]) : NaN
        if (Number.isFinite(pathTaskId)) {
          // (b) Verify bearer against DB. verifyRunnerToken returns null on unknown / expired / revoked.
          try {
            const db = getDatabase()
            const verified = verifyRunnerToken(db, bearer)
            if (verified && verified.task_id === pathTaskId) {
              // (c) Happy path: issue principal with task_id attribution.
              const { workspaceId, tenantId } = getDefaultWorkspaceContext()
              return {
                id: -2000,
                username: 'runner-token',
                display_name: 'Runner Token',
                role: 'operator',
                workspace_id: workspaceId,
                tenant_id: tenantId,
                provider: 'local',
                email: null,
                avatar_url: null,
                is_approved: 1,
                created_at: 0,
                updated_at: 0,
                last_login_at: null,
                agent_name: null,
                runner_token_task_id: verified.task_id,
              }
            }
            // Cross-task case (verified && verified.task_id !== pathTaskId): fall through.
            // requireRunnerToken() will re-run verifyRunnerToken and see the mismatch → 403.
          } catch {
            // DB not ready or transient — fall through; no principal issued.
          }
        }
      }
      // Path under /api/runner/ but NOT on allowlist: fall through (non-matching paths go to
      // session / api-key auth below).
    }
  }

  // Check session cookie
  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = parseMcSessionCookieHeader(cookieHeader)
  if (sessionToken) {
    const user = validateSession(sessionToken)
    if (user) return { ...user, agent_name: agentName }
  }

  // Check API key - DB override first, then env var
  const apiKey = extractApiKeyFromHeaders(request.headers)
  const configuredApiKey = resolveActiveApiKey()

  if (configuredApiKey && apiKey && safeCompare(apiKey, configuredApiKey)) {
    // FR-D2: Log warning when global admin API key is used.
    // Prefer agent-scoped keys (POST /api/agents/{id}/keys) for least-privilege access.
    try {
      logSecurityEvent({
        event_type: 'global_api_key_used',
        severity: 'info',
        source: 'auth',
        agent_name: agentName || undefined,
        detail: JSON.stringify({ hint: 'Consider using agent-scoped API keys for least-privilege access' }),
        ip_address: request.headers.get('x-real-ip') || 'unknown',
        workspace_id: getDefaultWorkspaceContext().workspaceId,
        tenant_id: getDefaultWorkspaceContext().tenantId,
      })
    } catch { /* startup race */ }
    return {
      id: 0,
      username: 'api',
      display_name: 'API Access',
      role: 'admin',
      workspace_id: getDefaultWorkspaceContext().workspaceId,
      tenant_id: getDefaultWorkspaceContext().tenantId,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
      agent_name: agentName,
    }
  }

  // Agent-scoped API keys
  if (apiKey) {
    try {
      const db = getDatabase()
      const keyHash = hashApiKey(apiKey)
      const now = Math.floor(Date.now() / 1000)
      const row = db.prepare(`
        SELECT id, agent_id, workspace_id, scopes, expires_at, revoked_at
        FROM agent_api_keys
        WHERE key_hash = ?
        LIMIT 1
      `).get(keyHash) as {
        id: number
        agent_id: number
        workspace_id: number
        scopes: string
        expires_at: number | null
        revoked_at: number | null
      } | undefined

      if (row && !row.revoked_at && (!row.expires_at || row.expires_at > now)) {
        const scopes = parseAgentScopes(row.scopes)
        const agent = db
          .prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?')
          .get(row.agent_id, row.workspace_id) as { id: number; name: string } | undefined

        if (agent) {
          if (agentName && agentName !== agent.name && !scopes.has('admin')) {
            return null
          }

          db.prepare('UPDATE agent_api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id)

          return {
            id: -row.id,
            username: `agent:${agent.name}`,
            display_name: agent.name,
            role: deriveRoleFromScopes(scopes),
            workspace_id: row.workspace_id,
            tenant_id: getDefaultWorkspaceContext().tenantId,
            created_at: 0,
            updated_at: now,
            last_login_at: now,
            agent_name: agent.name,
          }
        }
      }
    } catch {
      // ignore missing table / startup race
    }
  }

  // Plugin hook: allow Pro (or other extensions) to resolve custom API keys
  if (apiKey && _authResolverHook) {
    const resolved = _authResolverHook(apiKey, agentName)
    if (resolved) return resolved
  }

  return null
}

/**
 * Resolve the active API key: check DB settings override first, then env var.
 */
function resolveActiveApiKey(): string {
  try {
    const db = getDatabase()
    const row = db.prepare(
      "SELECT value FROM settings WHERE key = 'security.api_key'"
    ).get() as { value: string } | undefined
    if (row?.value) return row.value
  } catch {
    // DB not ready yet — fall back to env
  }
  return (process.env.API_KEY || '').trim()
}

function extractApiKeyFromHeaders(headers: Headers): string | null {
  const direct = (headers.get('x-api-key') || '').trim()
  if (direct) return direct

  const authorization = (headers.get('authorization') || '').trim()
  if (!authorization) return null

  const [scheme, ...rest] = authorization.split(/\s+/)
  if (!scheme || rest.length === 0) return null

  const normalized = scheme.toLowerCase()
  if (normalized === 'bearer' || normalized === 'apikey' || normalized === 'token') {
    return rest.join(' ').trim() || null
  }

  return null
}

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

function parseAgentScopes(raw: string): Set<string> {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed.map((scope) => String(scope)))
  } catch {
    // ignore parse errors
  }
  return new Set()
}

function deriveRoleFromScopes(scopes: Set<string>): User['role'] {
  if (scopes.has('admin')) return 'admin'
  if (scopes.has('operator')) return 'operator'
  return 'viewer'
}

/**
 * Role hierarchy levels for access control.
 * viewer < operator < admin
 */
const ROLE_LEVELS: Record<string, number> = { viewer: 0, operator: 1, admin: 2 }

/**
 * Check if a user meets the minimum role requirement.
 * Returns { user } on success, or { error, status } on failure (401 or 403).
 */
export function requireRole(
  request: Request,
  minRole: User['role']
): { user: User; error?: never; status?: never } | { user?: never; error: string; status: 401 | 403 } {
  const user = getUserFromRequest(request)
  if (!user) {
    return { error: 'Authentication required', status: 401 }
  }
  if ((ROLE_LEVELS[user.role] ?? -1) < ROLE_LEVELS[minRole]) {
    return { error: `Requires ${minRole} role or higher`, status: 403 }
  }
  return { user }
}

/**
 * Require a valid runner-token bearer for the given taskId.
 *
 * This wrapper exists to distinguish 401 from 403 at the auth substrate layer,
 * per RAUTH-03 + the Phase 11 CONTEXT.md lock "cross-task access blocked → 403".
 * Do NOT use getUserFromRequest() directly for runner-token routes — use this.
 *
 * Returns:
 *   - { user }                            — valid token, matches taskId; handler proceeds
 *   - { error: '...', status: 401 }       — no bearer, invalid bearer, expired, revoked,
 *                                            or path is not in RAUTH-06 allowlist
 *   - { error: '...', status: 403 }       — valid+unexpired+unrevoked bearer, but its
 *                                            embedded task_id does NOT match the taskId
 *                                            the caller is operating on (cross-task block)
 *
 * Phase 14/15 route handlers are the primary callers. They extract `:id` from the path
 * params and pass it in as `taskId`.
 */
export function requireRunnerToken(
  request: Request,
  taskId: number,
):
  | { user: User; error?: never; status?: never }
  | { user?: never; error: string; status: 401 | 403 }
{
  const url = new URL(request.url)
  // Path must be on the RAUTH-06 allowlist. If a caller invokes this from a non-runner
  // path, something is wrong upstream — treat as 401.
  const match = RUNNER_TOKEN_ALLOWLIST.find(
    (rule) => rule.method === request.method && rule.pathPattern.test(url.pathname),
  )
  if (!match) {
    return { error: 'runner-token authentication is not permitted on this endpoint', status: 401 }
  }

  const bearer = extractApiKeyFromHeaders(request.headers)
  if (!bearer) {
    return { error: 'runner-token bearer missing', status: 401 }
  }

  let verified: VerifiedRunnerToken | null = null
  try {
    const db = getDatabase()
    verified = verifyRunnerToken(db, bearer)
  } catch {
    return { error: 'runner-token verification failed', status: 401 }
  }

  if (!verified) {
    // unknown / expired / revoked — all surface as 401. The token IS NOT valid.
    return { error: 'runner-token invalid, expired, or revoked', status: 401 }
  }

  if (verified.task_id !== taskId) {
    // Valid token, wrong task. This is the RAUTH-03 cross-task block — 403.
    return { error: 'cross-task access forbidden', status: 403 }
  }

  // Happy path — construct the same principal shape as the getUserFromRequest branch.
  const { workspaceId, tenantId } = getDefaultWorkspaceContext()
  return {
    user: {
      id: -2000,
      username: 'runner-token',
      display_name: 'Runner Token',
      role: 'operator',
      workspace_id: workspaceId,
      tenant_id: tenantId,
      provider: 'local',
      email: null,
      avatar_url: null,
      is_approved: 1,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
      agent_name: null,
      runner_token_task_id: verified.task_id,
    },
  }
}

