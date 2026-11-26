// Linked sessions (ticket 15f0c2): WhatsApp/Telegram sessions show up as regular web chats
// with `channel`, `origin` and `live`. Older bridges don't send these fields → treat as 'web'.
export const CHANNELS = ['web', 'whatsapp', 'telegram'];

export function chatChannel(c) {
  const ch = c && typeof c.channel === 'string' ? c.channel.toLowerCase() : '';
  return CHANNELS.includes(ch) ? ch : 'web';
}

export const isLinkedSession = (c) => chatChannel(c) !== 'web';
export const isLiveSession = (c) => isLinkedSession(c) && c.live === true;

// filter: 'all' | 'web' | 'whatsapp' | 'telegram'
export function matchesChannel(c, filter) {
  if (!filter || filter === 'all') return true;
  return chatChannel(c) === filter;
}

// Channels present in the list besides 'web' (to decide whether to show the filter at all).
export function linkedChannels(chats) {
  const s = new Set();
  for (const c of chats || []) if (isLinkedSession(c)) s.add(chatChannel(c));
  return CHANNELS.filter((x) => s.has(x));
}

// i18n key + vars for the notice shown on top of an open linked session (null for web chats).
export function sessionNotice(c) {
  const ch = chatChannel(c);
  if (ch === 'web') return null;
  return { key: isLiveSession(c) ? 'chat.sessLiveNote' : 'chat.sessArchivedNote', channel: ch, live: isLiveSession(c) };
}

// Last activity: the bridge's `updated` (ISO, since 760f0ac) when present, else last run, else creation.
export function chatActivity(c) {
  if (!c) return '';
  return c.updated || (Array.isArray(c.runs) && c.runs.length && c.runs[c.runs.length - 1].at) || c.created || '';
}

// Live sessions share the WhatsApp/Telegram session: the bridge refuses bot switches and resets (use /new there).
export const isSessionLocked = (c) => isLiveSession(c);

export const channelLabel = (ch) => (ch === 'whatsapp' ? 'WhatsApp' : ch === 'telegram' ? 'Telegram' : 'Web');
