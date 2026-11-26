import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatChannel, isLinkedSession, isLiveSession, matchesChannel, linkedChannels, sessionNotice, channelLabel } from './chatChannel.js';

describe('chatChannel', () => {
  it('defaults to web when the bridge omits the field (older versions)', () => {
    assert.equal(chatChannel({ id: 'web:1' }), 'web');
    assert.equal(chatChannel(null), 'web');
    assert.equal(chatChannel({ channel: 'fax' }), 'web');
  });
  it('reads whatsapp/telegram case-insensitively', () => {
    assert.equal(chatChannel({ channel: 'WhatsApp' }), 'whatsapp');
    assert.equal(chatChannel({ channel: 'telegram' }), 'telegram');
  });
  it('live only counts for linked sessions with live === true', () => {
    assert.equal(isLiveSession({ channel: 'whatsapp', live: true }), true);
    assert.equal(isLiveSession({ channel: 'whatsapp', live: false }), false);
    assert.equal(isLiveSession({ channel: 'web', live: true }), false);
    assert.equal(isLinkedSession({ channel: 'whatsapp' }), true);
  });
  it('filters by channel', () => {
    const list = [{ id: 'a' }, { id: 'b', channel: 'whatsapp' }, { id: 'c', channel: 'telegram' }];
    assert.deepEqual(list.filter((c) => matchesChannel(c, 'all')).map((c) => c.id), ['a', 'b', 'c']);
    assert.deepEqual(list.filter((c) => matchesChannel(c, 'web')).map((c) => c.id), ['a']);
    assert.deepEqual(list.filter((c) => matchesChannel(c, 'whatsapp')).map((c) => c.id), ['b']);
    assert.deepEqual(linkedChannels(list), ['whatsapp', 'telegram']);
    assert.deepEqual(linkedChannels([{ id: 'x' }]), []);
  });
  it('notice for live vs archived sessions', () => {
    assert.equal(sessionNotice({ id: 'w' }), null);
    assert.equal(sessionNotice({ channel: 'whatsapp', live: true }).key, 'chat.sessLiveNote');
    assert.equal(sessionNotice({ channel: 'whatsapp', live: false }).key, 'chat.sessArchivedNote');
    assert.equal(channelLabel('telegram'), 'Telegram');
  });
});
