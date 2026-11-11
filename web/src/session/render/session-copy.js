// Plain-text session export for the clipboard: a browser port of the
// pi-copy-session extension (/copy-session), so the output matches what the
// TUI copies. "full" keeps the whole execution trail of the active branch
// (thinking, tool calls + results, bash, model changes, summaries, metadata);
// "clean" keeps only user text and final visible assistant text.

import { getPath } from '../tree/session-tree.js';

const RULE = '==============================';
const asObject = (v) => (typeof v === 'object' && v !== null ? v : undefined);
const heading = (title, body) => `${RULE}\n${title}\n${RULE}\n\n${body}`;
const stripHeading = (rendered, title) => rendered.replace(`${RULE}\n${title}\n${RULE}\n\n`, '');

function safe(value, seen = new WeakSet(), key = '') {
  if (value === undefined) return '[undefined]';
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (typeof value === 'string') {
    if (
      (key === 'data' || key.toLowerCase().includes('base64')) &&
      value.length >= 512 &&
      /^[A-Za-z0-9+/=\r\n]+$/.test(value)
    ) {
      return `[BINARY DATA OMITTED: ${value.length} characters]`;
    }
    return value;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => safe(v, seen));
  if (value.type === 'image') {
    return `[IMAGE: ${typeof value.mimeType === 'string' ? value.mimeType : 'unknown'}]`;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v, seen, k)]));
}

function json(value) {
  try {
    return JSON.stringify(safe(value), null, 2) ?? String(value);
  } catch (e) {
    return `[Unserializable value: ${e instanceof Error ? e.message : String(e)}]`;
  }
}

function renderContent(content, title) {
  if (typeof content === 'string') return content ? [heading(title, content)] : [];
  if (!Array.isArray(content))
    return content == null ? [] : [heading('UNKNOWN CONTENT', json(content))];
  const out = [];
  for (const raw of content) {
    const block = asObject(raw);
    if (!block) {
      out.push(heading('UNKNOWN CONTENT', json(raw)));
    } else if (block.type === 'text' && typeof block.text === 'string') {
      out.push(heading(title, block.text));
    } else if (block.type === 'thinking') {
      const thinking = typeof block.thinking === 'string' ? block.thinking : '';
      const redacted = block.redacted === true ? '\n\n[REDACTED BY PROVIDER]' : '';
      out.push(heading('ASSISTANT THINKING', thinking + redacted));
    } else if (block.type === 'toolCall') {
      const lines = [
        `Tool: ${String(block.name ?? '[unknown]')}`,
        `ID: ${String(block.id ?? '[unknown]')}`,
      ];
      if (block.namespace !== undefined) lines.push(`Namespace: ${String(block.namespace)}`);
      lines.push('', 'Arguments:', '```json', json(block.arguments), '```');
      out.push(heading('TOOL CALL', lines.join('\n')));
    } else if (block.type === 'image') {
      out.push(heading(title, `[IMAGE: ${String(block.mimeType ?? 'unknown')}]`));
    } else {
      out.push(heading('UNKNOWN CONTENT', json(block)));
    }
  }
  return out;
}

const ASSISTANT_META_KEYS = [
  'api',
  'provider',
  'model',
  'responseModel',
  'responseId',
  'providerThinkingLevel',
  'thinkingLevel',
  'stopReason',
  'rawStopReason',
  'endTurn',
  'usage',
  'deferred',
];

function pick(source, keys) {
  const out = {};
  for (const k of keys) if (source[k] !== undefined) out[k] = source[k];
  return out;
}

function renderMessage(raw) {
  const m = asObject(raw);
  if (!m) return [heading('UNKNOWN ENTRY', json(raw))];
  if (m.role === 'user') return renderContent(m.content, 'USER');
  if (m.role === 'assistant') {
    const out = renderContent(m.content, 'ASSISTANT');
    if (m.errorMessage !== undefined || m.stopReason === 'error' || m.diagnostics !== undefined) {
      out.push(
        heading(
          'ASSISTANT ERROR',
          json({
            stopReason: m.stopReason,
            errorMessage: m.errorMessage,
            rawStopReason: m.rawStopReason,
            diagnostics: m.diagnostics,
          }),
        ),
      );
    }
    const meta = pick(m, ASSISTANT_META_KEYS);
    if (Object.keys(meta).length) out.push(heading('ASSISTANT METADATA', json(meta)));
    return out;
  }
  if (m.role === 'toolResult') {
    const blocks = renderContent(m.content, 'TOOL RESULT').map((s) =>
      stripHeading(s, 'TOOL RESULT'),
    );
    const body = [
      `Tool: ${String(m.toolName ?? '[unknown]')}`,
      `Tool call ID: ${String(m.toolCallId ?? '[unknown]')}`,
      `Error: ${m.isError === true ? 'yes' : 'no'}`,
      blocks.length ? `\nResult:\n${blocks.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const out = [heading(m.isError === true ? 'TOOL RESULT ERROR' : 'TOOL RESULT', body)];
    const extra = pick(m, ['details', 'nestedCalls', 'usage']);
    if (Object.keys(extra).length) out.push(heading('TOOL RESULT METADATA', json(extra)));
    return out;
  }
  if (m.role === 'bashExecution') {
    return [
      heading(
        'BASH EXECUTION',
        [
          `Command:\n${String(m.command ?? '')}`,
          `\nExit code: ${String(m.exitCode ?? '[undefined]')}`,
          `Cancelled: ${m.cancelled === true ? 'yes' : 'no'}`,
          `Truncated by Pi: ${m.truncated === true ? 'yes' : 'no'}`,
          m.fullOutputPath ? `Full output path: ${String(m.fullOutputPath)}` : '',
          `\nOutput:\n${String(m.output ?? '')}`,
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    ];
  }
  if (m.role === 'custom') {
    const body = renderContent(m.content, 'CUSTOM MESSAGE')
      .map((s) => stripHeading(s, 'CUSTOM MESSAGE'))
      .join('\n');
    return [
      heading(
        'CUSTOM MESSAGE',
        `Type: ${String(m.customType ?? 'unknown')}\nDisplay: ${String(m.display ?? 'unknown')}` +
          (body ? `\n\n${body}` : '') +
          (m.details === undefined ? '' : `\n\nDetails:\n${json(m.details)}`),
      ),
    ];
  }
  if (m.role === 'system') {
    return [
      ...renderContent(m.content, 'SYSTEM'),
      heading(
        'SYSTEM METADATA',
        json({ sections: m.sections, toolsAdded: m.toolsAdded, toolsRemoved: m.toolsRemoved }),
      ),
    ];
  }
  if (m.role === 'branchSummary') return [heading('BRANCH SUMMARY', String(m.summary ?? ''))];
  if (m.role === 'compactionSummary')
    return [heading('COMPACTION SUMMARY', String(m.summary ?? ''))];
  return [heading('UNKNOWN ENTRY', json(m))];
}

function textOnly(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join('');
}

function renderEntry(e) {
  switch (e.type) {
    case 'message':
      return renderMessage(e.message);
    case 'thinking_level_change':
      return [heading('THINKING LEVEL', String(e.thinkingLevel ?? ''))];
    case 'model_change':
      return [heading('MODEL CHANGE', `${String(e.provider ?? '')} / ${String(e.modelId ?? '')}`)];
    case 'compaction':
      return [
        heading(
          'COMPACTION',
          `${String(e.summary ?? '')}\n\nMetadata:\n` +
            json(
              pick(e, [
                'firstKeptEntryId',
                'tokensBefore',
                'details',
                'usage',
                'fromHook',
                'systemMessage',
              ]),
            ),
        ),
      ];
    case 'branch_summary':
      return [
        heading(
          'BRANCH SUMMARY',
          `${String(e.summary ?? '')}\n\nMetadata:\n` +
            json(pick(e, ['fromId', 'details', 'usage', 'fromHook'])),
        ),
      ];
    case 'custom_message':
      return renderMessage({
        role: 'custom',
        customType: e.customType,
        content: e.content,
        display: e.display,
        details: e.details,
      });
    case 'context_edit':
      return [heading('CONTEXT EDIT', json({ targetId: e.targetId, replacement: e.replacement }))];
    case 'custom':
      return [heading('CUSTOM ENTRY', json({ customType: e.customType, data: e.data }))];
    case 'usage':
      return [
        heading(
          'USAGE',
          json({
            kind: e.kind,
            provider: e.provider,
            model: e.model,
            usage: e.usage,
            note: e.note,
          }),
        ),
      ];
    case 'label':
      return [heading('LABEL', json({ targetId: e.targetId, label: e.label }))];
    case 'session_info':
      return [
        heading(
          'SESSION INFO',
          json(
            Object.fromEntries(
              Object.entries(e).filter(
                ([k]) => !['type', 'id', 'parentId', 'timestamp'].includes(k),
              ),
            ),
          ),
        ),
      ];
    default:
      return [heading('UNKNOWN ENTRY', json(e))];
  }
}

export function formatConversation(entries = [], { clean = false } = {}) {
  const out = [];
  let entryCount = 0;
  for (const e of entries) {
    if (!e || e.type === 'session') continue;
    if (clean) {
      if (e.type !== 'message') continue;
      const role = e.message?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = textOnly(e.message.content);
      if (!text) continue;
      out.push(heading(role === 'user' ? 'USER' : 'ASSISTANT', text));
      entryCount++;
      continue;
    }
    const rendered = renderEntry(e);
    if (rendered.length) {
      out.push(...rendered);
      entryCount++;
    }
  }
  return { text: out.join('\n\n'), entryCount };
}

// The active branch: root → leaf. Falls back to the last entry in file order,
// which is where pi itself resumes.
export function activeBranch(entries = [], leafId = '') {
  const byId = new Map(entries.filter((e) => e?.id).map((e) => [e.id, e]));
  const leaf = byId.has(leafId)
    ? leafId
    : entries.findLast((e) => e?.id && e.type !== 'session')?.id;
  return leaf ? getPath(leaf, byId) : [];
}

// Visible text of one user/assistant message, for the per-message copy button.
export function messageCopyText(entry) {
  const message = entry?.type === 'message' ? entry.message : null;
  if (!message || (message.role !== 'user' && message.role !== 'assistant')) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim())
    .map((b) => b.text)
    .join('\n\n');
}
