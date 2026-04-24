import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Comment, Message, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { validateBody, createCommentSchema } from '@/lib/validation';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { resolveMentionRecipients } from '@/lib/mentions';
import { callOpenClawGateway } from '@/lib/openclaw-gateway';
import { config } from '@/lib/config';
import { eventBus } from '@/lib/event-bus';

type CommentRelayResult = {
  attempted: boolean;
  relayed: boolean;
  channel?: 'dispatch_session' | 'agent_session' | 'hermes_run';
  session_id?: string;
  run_id?: string;
  reason?: string;
  error?: string;
};

type AgentRelayTarget = {
  name: string;
  session_key: string | null;
  runtime_type: string | null;
  config: string | null;
};

type SessionLogResult = {
  recorded: boolean;
  conversation_id?: string;
  message_id?: number;
  reason?: string;
};

function safeParseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseTaskMetadata(rawMetadata: unknown): Record<string, unknown> {
  if (!rawMetadata) return {};
  if (typeof rawMetadata === 'object') return rawMetadata as Record<string, unknown>;
  if (typeof rawMetadata === 'string') {
    try {
      const parsed = JSON.parse(rawMetadata);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseAgentConfig(rawConfig: string | null): Record<string, unknown> {
  if (!rawConfig) return {};
  try {
    const parsed = JSON.parse(rawConfig);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isHermesAgent(agent: AgentRelayTarget | null): boolean {
  if (!agent) return false;
  if ((agent.runtime_type || '').toLowerCase() === 'hermes') return true;
  const cfg = parseAgentConfig(agent.config);
  const cfgType = typeof cfg.type === 'string' ? cfg.type.toLowerCase() : '';
  if (cfgType === 'hermes') return true;
  return typeof cfg.hermesApiUrl === 'string' && cfg.hermesApiUrl.trim().length > 0;
}

function buildTaskCommentRelayMessage(args: {
  task: any;
  commentId: number;
  content: string;
  author: string;
}) {
  const { task, commentId, content, author } = args;
  return [
    '[Mission Control task comment relay]',
    `Task: ${task.title}`,
    `Task ID: ${task.id}`,
    `Comment ID: ${commentId}`,
    `Author: ${author}`,
    '',
    content,
  ].join('\n');
}

function recordTaskCommentInProjectSession(args: {
  task: any;
  commentId: number;
  content: string;
  author: string;
  workspaceId: number;
}): SessionLogResult {
  const { task, commentId, content, author, workspaceId } = args;
  const assignee = typeof task?.assigned_to === 'string' ? task.assigned_to.trim() : '';
  const projectId = Number(task?.project_id);

  if (!assignee) {
    return { recorded: false, reason: 'task_unassigned' };
  }
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return { recorded: false, reason: 'task_without_project' };
  }

  const db = getDatabase();
  const conversationId = `project:${projectId}:agent:${assignee.toLowerCase()}`;
  const metadata = {
    kind: 'task_comment',
    task_id: task.id,
    task_title: task.title,
    comment_id: commentId,
    author,
    project_id: projectId,
  };
  const messageContent = buildTaskCommentRelayMessage({ task, commentId, content, author });
  const toAgent = assignee.toLowerCase() === author.toLowerCase() ? null : assignee;

  const result = db
    .prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, 'text', ?, ?)
    `)
    .run(conversationId, author, toAgent, messageContent, JSON.stringify(metadata), workspaceId);

  const message = db
    .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
    .get(result.lastInsertRowid, workspaceId) as Message;

  eventBus.broadcast('chat.message', {
    ...message,
    metadata: safeParseMetadata(message.metadata),
  });

  return {
    recorded: true,
    conversation_id: conversationId,
    message_id: result.lastInsertRowid as number,
  };
}

function recordAgentReplyToTaskComment(args: {
  task: any;
  commentId: number;
  content: string;
  author: string;
  workspaceId: number;
  runId: string;
}) {
  const { task, commentId, content, author, workspaceId, runId } = args;
  const assignee = typeof task?.assigned_to === 'string' ? task.assigned_to.trim() : '';
  const projectId = Number(task?.project_id);
  if (!assignee || !content.trim()) return;

  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const conversationId = Number.isFinite(projectId) && projectId > 0
    ? `project:${projectId}:agent:${assignee.toLowerCase()}`
    : null;

  if (conversationId) {
    const metadata = {
      kind: 'task_comment_reply',
      task_id: task.id,
      task_title: task.title,
      in_reply_to_comment_id: commentId,
      hermes_run_id: runId,
      project_id: projectId,
    };
    const messageInsert = db
      .prepare(`
        INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
        VALUES (?, ?, ?, ?, 'text', ?, ?)
      `)
      .run(conversationId, assignee, author, content.trim(), JSON.stringify(metadata), workspaceId);
    const message = db
      .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
      .get(messageInsert.lastInsertRowid, workspaceId) as Message;
    eventBus.broadcast('chat.message', {
      ...message,
      metadata: safeParseMetadata(message.metadata),
    });
  }

  const commentInsert = db
    .prepare(`
      INSERT INTO comments (task_id, author, content, created_at, parent_id, mentions, workspace_id)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `)
    .run(task.id, assignee, content.trim(), now, commentId, workspaceId);

  db_helpers.ensureTaskSubscription(task.id, assignee, workspaceId);
  db_helpers.logActivity(
    'comment_added',
    'comment',
    commentInsert.lastInsertRowid as number,
    assignee,
    `Replied to comment on task: ${task.title}`,
    {
      task_id: task.id,
      task_title: task.title,
      parent_id: commentId,
      hermes_run_id: runId,
      content_preview: content.substring(0, 100),
    },
    workspaceId,
  );
}

async function watchHermesRunForTaskCommentReply(args: {
  apiUrl: string;
  headers: Record<string, string>;
  runId: string;
  task: any;
  commentId: number;
  author: string;
  workspaceId: number;
}) {
  const { apiUrl, headers, runId, task, commentId, author, workspaceId } = args;
  try {
    const response = await fetch(`${apiUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      logger.warn(
        { taskId: task.id, commentId, runId, status: response.status, error: errorText.substring(0, 300) },
        'Hermes comment relay run event stream failed',
      );
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = rawEvent
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.startsWith('data:'));
        if (dataLine) {
          try {
            const event = JSON.parse(dataLine.slice(5).trim());
            if (event?.event === 'run.completed') {
              const output = typeof event.output === 'string' ? event.output.trim() : '';
              recordAgentReplyToTaskComment({ task, commentId, content: output, author, workspaceId, runId });
              return;
            }
            if (event?.event === 'run.failed') {
              logger.warn(
                { taskId: task.id, commentId, runId, error: event.error },
                'Hermes comment relay run failed',
              );
              return;
            }
          } catch (error) {
            logger.warn({ taskId: task.id, commentId, runId, err: error }, 'Failed to parse Hermes run event');
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    logger.warn({ taskId: task.id, commentId, runId, err: error }, 'Hermes comment relay run watcher failed');
  }
}

async function relayCommentToAgentSession(args: {
  task: any;
  commentId: number;
  content: string;
  author: string;
  workspaceId: number;
}): Promise<CommentRelayResult> {
  const { task, commentId, content, author, workspaceId } = args;
  const db = getDatabase();

  if (!task?.assigned_to) {
    return { attempted: false, relayed: false, reason: 'task_unassigned' };
  }

  if (String(task.assigned_to) === author) {
    return { attempted: false, relayed: false, reason: 'author_is_assignee' };
  }

  const agent = db
    .prepare('SELECT name, session_key, runtime_type, config FROM agents WHERE name = ? AND workspace_id = ?')
    .get(task.assigned_to, workspaceId) as AgentRelayTarget | undefined;

  if (!agent) {
    return { attempted: false, relayed: false, reason: 'assignee_not_found' };
  }

  const taskMeta = parseTaskMetadata(task.metadata);
  const dispatchSessionId = typeof taskMeta.dispatch_session_id === 'string' && taskMeta.dispatch_session_id.trim().length > 0
    ? taskMeta.dispatch_session_id.trim()
    : null;

  const relayMessage = buildTaskCommentRelayMessage({ task, commentId, content, author });

  if (dispatchSessionId) {
    try {
      const sendResult = await callOpenClawGateway<any>(
        'chat.send',
        {
          sessionKey: dispatchSessionId,
          message: relayMessage,
          idempotencyKey: `task-comment-relay-${task.id}-${commentId}`,
          deliver: false,
        },
        45_000,
      );
      const status = String(sendResult?.status || '').toLowerCase();
      if (status === 'started' || status === 'ok' || status === 'in_flight') {
        return {
          attempted: true,
          relayed: true,
          channel: 'dispatch_session',
          session_id: dispatchSessionId,
        };
      }
    } catch (error) {
      logger.warn({ taskId: task.id, commentId, dispatchSessionId, err: error }, 'Comment relay to dispatch session failed');
    }
  }

  const agentSessionId = agent.session_key?.trim() || null;
  if (agentSessionId) {
    try {
      const sendResult = await callOpenClawGateway<any>(
        'chat.send',
        {
          sessionKey: agentSessionId,
          message: relayMessage,
          idempotencyKey: `task-comment-relay-agent-${task.id}-${commentId}`,
          deliver: false,
        },
        45_000,
      );
      const status = String(sendResult?.status || '').toLowerCase();
      if (status === 'started' || status === 'ok' || status === 'in_flight') {
        return {
          attempted: true,
          relayed: true,
          channel: 'agent_session',
          session_id: agentSessionId,
        };
      }
    } catch (error) {
      logger.warn({ taskId: task.id, commentId, agent: agent.name, err: error }, 'Comment relay to agent session failed');
    }
  }

  if (isHermesAgent(agent)) {
    try {
      const cfg = parseAgentConfig(agent.config);
      const hermesApiUrl = typeof cfg.hermesApiUrl === 'string' && cfg.hermesApiUrl.trim().length > 0
        ? cfg.hermesApiUrl.trim()
        : config.hermesApiUrl;
      const hermesApiKey = typeof cfg.hermesApiKey === 'string' && cfg.hermesApiKey.trim().length > 0
        ? cfg.hermesApiKey.trim()
        : '';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (hermesApiKey) {
        headers.Authorization = `Bearer ${hermesApiKey}`;
      }

      const response = await fetch(`${hermesApiUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: relayMessage,
          session_id: `mc-task-${task.id}`,
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const runId = typeof data?.run_id === 'string' ? data.run_id : null;
        if (runId) {
          void watchHermesRunForTaskCommentReply({
            apiUrl: hermesApiUrl,
            headers,
            runId,
            task,
            commentId,
            author,
            workspaceId,
          });
        }
        return {
          attempted: true,
          relayed: true,
          channel: 'hermes_run',
          run_id: runId ?? undefined,
        };
      }

      const errorText = await response.text().catch(() => '');
      return {
        attempted: true,
        relayed: false,
        reason: 'hermes_direct_non_200',
        error: `Hermes API ${response.status}: ${errorText.substring(0, 200)}`,
      };
    } catch (error: any) {
      return {
        attempted: true,
        relayed: false,
        reason: 'hermes_direct_error',
        error: String(error?.message || error),
      };
    }
  }

  return {
    attempted: true,
    relayed: false,
    reason: agentSessionId
      ? 'agent_session_unavailable'
      : dispatchSessionId
        ? 'dispatch_session_unavailable'
        : 'no_session_target',
  };
}

/**
 * GET /api/tasks/[id]/comments - Get all comments for a task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id);
    const workspaceId = auth.user.workspace_id ?? 1;

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    
    // Verify task exists
    const task = db
      .prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    // Get comments ordered by creation time
    const stmt = db.prepare(`
      SELECT * FROM comments 
      WHERE task_id = ? AND workspace_id = ?
      ORDER BY created_at ASC
    `);
    
    const comments = stmt.all(taskId, workspaceId) as Comment[];
    
    // Parse JSON fields and build thread structure
    const commentsWithParsedData = comments.map(comment => ({
      ...comment,
      mentions: comment.mentions ? JSON.parse(comment.mentions) : []
    }));
    
    // Organize into thread structure (parent comments with replies)
    const commentMap = new Map();
    const topLevelComments: any[] = [];
    
    // First pass: create all comment objects
    commentsWithParsedData.forEach(comment => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });
    
    // Second pass: organize into threads
    commentsWithParsedData.forEach(comment => {
      const commentWithReplies = commentMap.get(comment.id);
      
      if (comment.parent_id) {
        // This is a reply, add to parent's replies
        const parent = commentMap.get(comment.parent_id);
        if (parent) {
          parent.replies.push(commentWithReplies);
        }
      } else {
        // This is a top-level comment
        topLevelComments.push(commentWithReplies);
      }
    });
    
    return NextResponse.json({ 
      comments: topLevelComments,
      total: comments.length
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/[id]/comments - Add a new comment to a task
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id);
    const workspaceId = auth.user.workspace_id ?? 1;

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const result = await validateBody(request, createCommentSchema);
    if ('error' in result) return result.error;
    const { content: rawContent, parent_id } = result.data;
    const author = auth.user.display_name || auth.user.username || 'system';

    // Normalize agent payload JSON — extract text from OpenClaw result format
    let content = rawContent;
    try {
      const stripped = rawContent.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[3[0-9]m/g, '').replace(/\[39m/g, '');
      const parsed = JSON.parse(stripped);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.payloads)) {
        const text = parsed.payloads
          .map((p: any) => (typeof p === 'string' ? p : p?.text || '').trim())
          .filter(Boolean)
          .join('\n');
        if (text) {
          const meta = parsed.meta?.agentMeta;
          const metaLine = meta
            ? `\n\n_${[meta.model, meta.usage?.total ? `${meta.usage.total} tokens` : '', parsed.meta?.durationMs ? `${(parsed.meta.durationMs / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ')}_`
            : '';
          content = text + metaLine;
        }
      }
    } catch {
      // Not JSON — keep original content
    }

    // Verify task exists
    const task = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId) as any;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    // Verify parent comment exists if specified
    if (parent_id) {
      const parentComment = db
        .prepare('SELECT id FROM comments WHERE id = ? AND task_id = ? AND workspace_id = ?')
        .get(parent_id, taskId, workspaceId);
      if (!parentComment) {
        return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 });
      }
    }
    
    const mentionResolution = resolveMentionRecipients(content, db, workspaceId);
    if (mentionResolution.unresolved.length > 0) {
      return NextResponse.json({
        error: `Unknown mentions: ${mentionResolution.unresolved.map((m) => `@${m}`).join(', ')}`,
        missing_mentions: mentionResolution.unresolved
      }, { status: 400 });
    }
    
    const now = Math.floor(Date.now() / 1000);
    
    // Insert comment
    const stmt = db.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, parent_id, mentions, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertResult = stmt.run(
      taskId,
      author,
      content,
      now,
      parent_id || null,
      mentionResolution.tokens.length > 0 ? JSON.stringify(mentionResolution.tokens) : null,
      workspaceId
    );

    const commentId = insertResult.lastInsertRowid as number;
    
    // Log activity
    const activityDescription = parent_id 
      ? `Replied to comment on task: ${task.title}`
      : `Added comment to task: ${task.title}`;
    
    db_helpers.logActivity(
      'comment_added',
      'comment',
      commentId,
      author,
      activityDescription,
      {
        task_id: taskId,
        task_title: task.title,
        parent_id,
        mentions: mentionResolution.tokens,
        content_preview: content.substring(0, 100)
      },
      workspaceId
    );
    
    // Auto-assign: if task is unassigned and a mentioned target is an agent, assign it
    let autoAssignedTo: string | null = null;
    if (!task.assigned_to) {
      const mentionedAgent = mentionResolution.resolved.find((m) => m.type === 'agent');
      if (mentionedAgent) {
        autoAssignedTo = mentionedAgent.recipient;
        const newStatus = task.status === 'inbox' ? 'assigned' : task.status;
        db.prepare('UPDATE tasks SET assigned_to = ?, status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
          .run(autoAssignedTo, newStatus, now, taskId, workspaceId);

        db_helpers.ensureTaskSubscription(taskId, autoAssignedTo, workspaceId);
        db_helpers.createNotification(
          autoAssignedTo,
          'assignment',
          'Task Assigned',
          `You have been assigned to task: ${task.title} (via @mention by ${author})`,
          'task',
          taskId,
          workspaceId
        );

        db_helpers.logActivity(
          'task_assigned',
          'task',
          taskId,
          author,
          `Auto-assigned task "${task.title}" to ${autoAssignedTo} via @mention`,
          { assigned_to: autoAssignedTo, trigger: 'mention' },
          workspaceId
        );
      }
    }

    // Ensure subscriptions for author, mentions, and assignee
    db_helpers.ensureTaskSubscription(taskId, author, workspaceId);
    const mentionRecipients = mentionResolution.recipients;
    mentionRecipients.forEach((mentionedRecipient) => {
      db_helpers.ensureTaskSubscription(taskId, mentionedRecipient, workspaceId);
    });
    const effectiveAssignee = autoAssignedTo || task.assigned_to;
    if (effectiveAssignee) {
      db_helpers.ensureTaskSubscription(taskId, effectiveAssignee, workspaceId);
    }

    // Notify subscribers
    const subscribers = new Set(db_helpers.getTaskSubscribers(taskId, workspaceId));
    subscribers.delete(author);
    const mentionSet = new Set(mentionRecipients);

    for (const subscriber of subscribers) {
      const isMention = mentionSet.has(subscriber);
      db_helpers.createNotification(
        subscriber,
        isMention ? 'mention' : 'comment',
        isMention ? 'You were mentioned' : 'New comment on a subscribed task',
        isMention
          ? `${author} mentioned you in a comment on "${task.title}": ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`
          : `${author} commented on "${task.title}": ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`,
        'comment',
        commentId,
        workspaceId
      );
    }
    
    const relayTask = {
      ...task,
      assigned_to: effectiveAssignee,
    };

    const sessionLog = recordTaskCommentInProjectSession({
      task: relayTask,
      commentId,
      content,
      author,
      workspaceId,
    });

    const relay = await relayCommentToAgentSession({
      task: relayTask,
      commentId,
      content,
      author,
      workspaceId,
    });

    if (relay.relayed) {
      db_helpers.logActivity(
        'task_comment_relayed',
        'comment',
        commentId,
        author,
        `Relayed comment to ${relayTask.assigned_to} via ${relay.channel}`,
        {
          task_id: taskId,
          assignee: relayTask.assigned_to,
          relay_channel: relay.channel,
          relay_session_id: relay.session_id ?? null,
        },
        workspaceId
      );
    }

    // Fetch the created comment
    const createdComment = db
      .prepare('SELECT * FROM comments WHERE id = ? AND workspace_id = ?')
      .get(commentId, workspaceId) as Comment;
    
    return NextResponse.json({
      comment: {
        ...createdComment,
        mentions: createdComment.mentions ? JSON.parse(createdComment.mentions) : [],
        replies: [] // New comments have no replies initially
      },
      session_log: sessionLog,
      relay,
      ...(autoAssignedTo ? { auto_assigned_to: autoAssignedTo } : {}),
    }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
