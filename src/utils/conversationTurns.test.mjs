import test from 'node:test';
import assert from 'node:assert/strict';
import { completedResponses, insertTimelineActivity, responseFooterAnchors, responseTimeline, responseTurnKeys, responseWindowStart } from './conversationTurns.ts';

const message = (id, role, text, extra = {}) => ({ id, role, text, turnIndex: 0, turnId: 'turn-0', ...extra });
const activity = (id, kind = 'retry', status = 'inProgress', order = 2) => message(id, 'system', id, {
  messageType: 'commandExecution', timelineOrder: order,
  commandExecution: { command: id, kind, cwd: null, status, aggregatedOutput: 'HTTP 503', exitCode: null },
});

test('retry stays between buffered partial text and recovered response, including lifecycle updates', () => {
  const original = [message('user', 'user', 'work'), message('partial', 'assistant', 'first', { messageType: 'agentMessage.live' })];
  let state = insertTimelineActivity(original, activity('retry-1'), 'partial', 'first complete delta', () => 'resumed');
  assert.equal(state.split, true);
  assert.deepEqual(state.messages.map(m => m.id), ['user', 'partial', 'retry-1', 'resumed']);
  assert.equal(state.messages[1].text, 'first complete delta');
  assert.equal(original[1].text, 'first');
  state.messages.at(-1).text = 'recovered reply';
  state = insertTimelineActivity(state.messages, activity('retry-1', 'retry', 'completed', 20), state.assistantId, 'recovered reply', () => 'unused');
  assert.equal(state.split, false);
  assert.equal(state.assistantId, 'resumed');
  assert.equal(state.messages[2].timelineOrder, 2);
  assert.equal(state.messages.at(-1).text, 'recovered reply');
});

test('five retries retain chronological order and no empty assistant gaps', () => {
  let state = { messages: [message('user', 'user', 'work'), message('initial', 'assistant', '', { messageType: 'agentMessage.live' })], assistantId: 'initial' };
  for (let i = 1; i <= 5; i++) {
    state = insertTimelineActivity(state.messages, activity(`retry-${i}`, 'retry', 'inProgress', i), state.assistantId, '', () => `live-${i}`);
  }
  assert.deepEqual(state.messages.map(m => m.id), ['user', 'retry-1', 'retry-2', 'retry-3', 'retry-4', 'retry-5', 'live-5']);
  state.messages.at(-1).text = 'final';
  state = insertTimelineActivity(state.messages, activity('retry-5', 'retry', 'completed', 30), state.assistantId, 'final', () => 'unused');
  assert.equal(state.messages.at(-1).text, 'final');
  assert.equal(state.messages.at(-2).timelineOrder, 5);
});

test('tool completion interleaved with retry does not split or erase recovered text', () => {
  let state = insertTimelineActivity([message('user', 'user', 'work'), message('intro', 'assistant', 'intro')], activity('tool', 'tool'), 'intro', 'intro', () => 'after-tool');
  state = insertTimelineActivity(state.messages, activity('retry'), state.assistantId, 'before outage', () => 'after-retry');
  const order = state.messages.map(m => m.id);
  state = insertTimelineActivity(state.messages, activity('tool', 'tool', 'completed', 40), state.assistantId, 'after reconnect', () => 'unused');
  assert.deepEqual(state.messages.map(m => m.id), order);
  assert.equal(state.assistantId, 'after-retry');
  assert.equal(state.split, false);
});

test('completed turn hides intermediate content by default and expands in original order', () => {
  const records = [message('user', 'user', 'work'), message('worked', 'system', 'done', { messageType: 'worked', activityDurationMs: 12345 }),
    message('intro', 'assistant', 'checking'), activity('read', 'tool', 'completed'), activity('retry', 'retry', 'completed'),
    message('progress', 'assistant', 'still checking', { messageType: 'agentMessage.commentary' }), message('final', 'assistant', 'done')];
  const group = completedResponses(records, false).get('turn-0');
  assert.equal(group.header.activityDurationMs, 12345);
  assert.equal(group.final.id, 'final');
  assert.deepEqual([...group.processIds], ['intro', 'read', 'retry', 'progress']);
  const expanded = responseTimeline(records, completedResponses(records, false));
  assert.deepEqual(expanded.map(m => m.id), records.map(m => m.id));
  const collapsed = expanded.filter(m => !group.processIds.has(m.id));
  assert.deepEqual(collapsed.map(m => m.id), ['user', 'worked', 'final']);
  assert.equal(responseFooterAnchors(records, new Set(collapsed.map(m => m.id)), false).get('final').id, 'final');
});

test('ongoing turn stays visible while previous turns remain collapsible and queued input is ignored', () => {
  const records = [message('u0', 'user', 'first'), activity('t0', 'tool', 'completed'), message('a0', 'assistant', 'first answer'),
    message('u1', 'user', 'second', { turnId: 'turn-1', turnIndex: 1 }), message('a1', 'assistant', 'streaming', { turnId: 'turn-1', turnIndex: 1, messageType: 'agentMessage.live' }),
    message('queued', 'user', 'later', { turnIndex: 2, messageType: 'queued' })];
  assert.deepEqual([...completedResponses(records, true).keys()], ['turn-0']);
});

test('restored text and activities share a turn despite legacy prefixes and get a disclosure', () => {
  const records = [message('user', 'user', 'work', { turnId: 'restored-0' }), message('intro', 'assistant', 'intro', { turnId: 'restored-0' }),
    activity('retry', 'retry', 'completed'), message('final', 'assistant', 'answer', { turnId: 'restored-0' })];
  assert.equal(new Set(responseTurnKeys(records).values()).size, 1);
  const completed = completedResponses(records, false);
  assert.deepEqual(responseTimeline(records, completed).map(m => m.id), ['user', 'process-turn-0', 'intro', 'retry', 'final']);
});

test('long completed turns keep the disclosure above the render window and never hide the final answer', () => {
  const records = [message('user', 'user', 'work'), ...Array.from({ length: 70 }, (_, i) => activity(`tool-${i}`, 'tool', 'completed')), message('final', 'assistant', 'answer')];
  const completed = completedResponses(records, false);
  assert.equal(responseWindowStart(records, 22, completed), 0);
  const group = completed.get('turn-0');
  assert.deepEqual(responseTimeline(records, completed, 22).filter(m => !group.processIds.has(m.id)).map(m => m.id), ['user', 'process-turn-0', 'final']);
});

test('errors and stops remain visible and waiting approvals are not hidden', () => {
  for (const messageType of ['turnError', 'turnInterrupted']) {
    const records = [message('user', 'user', 'work'), message('partial', 'assistant', 'partial', { messageType: 'assistant.partial' }),
      activity('approval', 'approval', 'waiting'), message('error', 'assistant', 'stopped', { messageType })];
    const group = completedResponses(records, false).get('turn-0');
    assert.equal(group.final.id, 'error');
    assert.equal(group.processIds.has('approval'), false);
    assert.equal(group.processIds.has('partial'), true);
    assert.equal(responseFooterAnchors(records, new Set(records.map(m => m.id)), false).size, 0);
  }
});

test('no formal reply means no automatic hiding of partial output', () => {
  const records = [message('user', 'user', 'work'), activity('tool', 'tool', 'interrupted'), message('partial', 'assistant', 'partial', { messageType: 'assistant.partial' })];
  assert.equal(completedResponses(records, false).size, 0);
});
