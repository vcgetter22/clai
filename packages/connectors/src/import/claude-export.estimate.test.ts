import { describe, expect, it } from 'vitest';
import { conversationEvents, estimateClaudeTokens } from './claude-export.js';

const conv = {
  uuid: 'c1',
  name: 'redacted',
  created_at: '2026-08-01T10:00:00Z',
  chat_messages: [
    { uuid: 'h1', sender: 'human', text: 'x'.repeat(360), created_at: '2026-08-01T10:00:00Z' },
    { uuid: 'a1', sender: 'assistant', text: 'y'.repeat(720), created_at: '2026-08-01T10:00:05Z' },
    { uuid: 'h2', sender: 'human', text: 'z'.repeat(36), created_at: '2026-08-01T10:01:00Z' },
    { uuid: 'a2', sender: 'assistant', content: [{ type: 'text', text: 'w'.repeat(180) }], created_at: '2026-08-01T10:01:05Z' },
  ],
};

describe('claude-export estimate opt-in', () => {
  it('emits count-only events by default', () => {
    const out = [...conversationEvents(conv as never, {})];
    expect(out).toHaveLength(2);
    expect(out[0]!.model).toBe('unknown');
    expect(out[0]!.usage).toMatchObject({ input: 0, output: 0, cacheRead: 0, requests: 1 });
  });
  it('estimates chat-turn token usage when asked', () => {
    expect(estimateClaudeTokens('x'.repeat(360))).toBe(100);
    const out = [...conversationEvents(conv as never, { estimate: true })];
    expect(out).toHaveLength(2);
    expect(out[0]!.model).toBe('claude-sonnet-5');
    expect(out[0]!.usage).toMatchObject({ input: 100, output: 200, cacheRead: 0, requests: 1 });
    // second reply: new human message 10 tokens, history 300 tokens cached, output 50
    expect(out[1]!.usage).toMatchObject({ input: 10, output: 50, cacheRead: 300 });
    expect(out[1]!.cost?.confidence).toBe('estimated');
    expect(out[1]!.naturalKey).toEqual(['c1', 'a2']);
  });
  it('honours an explicit model', () => {
    const out = [...conversationEvents(conv as never, { estimate: true, model: 'claude-opus-5' })];
    expect(out[0]!.model).toBe('claude-opus-5');
  });
});
