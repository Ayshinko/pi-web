import { describe, expect, it } from 'vitest';
import { activeBranch, formatConversation, messageCopyText } from './session-copy.js';

const RULE = '==============================';

const entries = [
  { type: 'session', id: 'hdr' },
  { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: 'hello' } },
  {
    type: 'message',
    id: 'a1',
    parentId: 'u1',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'ponder' },
        { type: 'text', text: 'hi there' },
        { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
      ],
      model: 'm',
    },
  },
  {
    type: 'message',
    id: 't1',
    parentId: 'a1',
    message: { role: 'toolResult', toolName: 'bash', toolCallId: 'c1', content: 'file.txt' },
  },
  { type: 'message', id: 'u2', parentId: 'u1', message: { role: 'user', content: 'other branch' } },
];

describe('session-copy', () => {
  it('follows the requested leaf, falling back to the last entry', () => {
    expect(activeBranch(entries, 't1').map((e) => e.id)).toEqual(['u1', 'a1', 't1']);
    expect(activeBranch(entries, 'missing').map((e) => e.id)).toEqual(['u1', 'u2']);
  });

  it('full mode keeps thinking, tool calls and results like /copy-session', () => {
    const { text, entryCount } = formatConversation(activeBranch(entries, 't1'));
    expect(entryCount).toBe(3);
    expect(text).toContain(`${RULE}\nUSER\n${RULE}\n\nhello`);
    expect(text).toContain(`${RULE}\nASSISTANT THINKING\n${RULE}\n\nponder`);
    expect(text).toContain('Tool: bash\nID: c1');
    expect(text).toContain('"command": "ls"');
    expect(text).toContain('Tool call ID: c1\nError: no\n\nResult:\nfile.txt');
    expect(text).toContain('ASSISTANT METADATA');
  });

  it('clean mode keeps only user and assistant text', () => {
    const { text, entryCount } = formatConversation(activeBranch(entries, 't1'), { clean: true });
    expect(entryCount).toBe(2);
    expect(text).toBe(`${RULE}\nUSER\n${RULE}\n\nhello\n\n${RULE}\nASSISTANT\n${RULE}\n\nhi there`);
  });

  it('omits large base64 payloads and images', () => {
    const big = 'A'.repeat(600);
    const { text } = formatConversation([
      {
        type: 'message',
        id: 'x',
        message: { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: big }] },
      },
      { type: 'custom', id: 'y', customType: 'c', data: { data: big } },
    ]);
    expect(text).toContain('[IMAGE: image/png]');
    expect(text).toContain('[BINARY DATA OMITTED: 600 characters]');
    expect(text).not.toContain(big);
  });

  it('copies only the visible text of one message', () => {
    expect(messageCopyText(entries[2])).toBe('hi there');
    expect(messageCopyText(entries[1])).toBe('hello');
    expect(messageCopyText(entries[3])).toBe('');
  });
});
