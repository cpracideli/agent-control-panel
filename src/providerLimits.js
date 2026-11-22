// Pure provider quota/limit detection and reset countdown formatting.
// Kept free of DOM/React dependencies so it can be unit-tested directly with `node --test`.
import { provName } from './prov.js';

const CONTROL_COMMANDS = new Set([
  '/help',
  '/new',
  '/provider',
  '/model',
  '/effort',
  '/bot',
  '/stop',
  '/status',
  '/usage',
  '/log',
  '/send',
  '/schedules',
  '/pause',
  '/resume',
  '/cancel',
]);

/**
 * Returns true if the message starts with an internal bridge control command
 * (which does not invoke the LLM provider and should always be allowed).
 */
export function isBridgeControlCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return false;
  const cmd = trimmed.split(/\s+/, 1)[0].toLowerCase();
  return CONTROL_COMMANDS.has(cmd);
}

function parseResetMs(resetsAt) {
  if (!resetsAt) return null;
  const ms = new Date(resetsAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isWindowLimited(item, now) {
  if (!item || typeof item !== 'object') return false;
  const pct = Number(item.percent);
  if (!Number.isFinite(pct) || pct < 100) return false;
  const resetMs = parseResetMs(item.resetsAt);
  if (resetMs !== null && resetMs <= now) return false;
  return true;
}

function remainingFor(resetsAt, now) {
  const resetMs = parseResetMs(resetsAt);
  if (resetMs === null) return null;
  return Math.max(0, resetMs - now);
}

function normalizeModelName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeModelFull(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function detectFamily(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  if (s.includes('claude') || s.includes('opus') || s.includes('sonnet') || s.includes('haiku')) return 'claude';
  if (s.includes('gemini')) return 'gemini';
  if (s.includes('gpt')) return 'gpt';
  return null;
}

function matchGroupForModel(groups, candidates) {
  if (!Array.isArray(groups) || !groups.length) return null;
  const cleanCandidates = candidates.map((c) => String(c || '').trim()).filter(Boolean);
  if (!cleanCandidates.length) return null;

  // 1. Normalized match against each group's models list
  for (const raw of cleanCandidates) {
    const normCand = normalizeModelName(raw);
    const fullCand = normalizeModelFull(raw);
    if (!normCand && !fullCand) continue;
    for (const g of groups) {
      const models = Array.isArray(g?.models) ? g.models : [];
      for (const m of models) {
        const normM = normalizeModelName(m);
        const fullM = normalizeModelFull(m);
        if (!normM && !fullM) continue;
        if (
          (normCand && normM === normCand) ||
          (fullCand && fullM === fullCand) ||
          (normCand && normM.startsWith(normCand + ' ')) ||
          (normM && normCand.startsWith(normM + ' '))
        ) {
          return g;
        }
      }
    }
  }

  // 2. Family match (claude, gemini, gpt) against group label and models
  let family = null;
  for (const raw of cleanCandidates) {
    family = detectFamily(raw);
    if (family) break;
  }
  if (!family) return null;

  const byLabel = groups.find((g) => String(g?.label || '').toLowerCase().includes(family));
  if (byLabel) return byLabel;

  const byModels = groups.find(
    (g) => Array.isArray(g?.models) && g.models.some((m) => String(m || '').toLowerCase().includes(family)),
  );
  return byModels || null;
}

function pickFurthestReset(items) {
  let best = items[0];
  let bestTs = parseResetMs(best?.resetsAt) ?? -1;
  for (let i = 1; i < items.length; i++) {
    const ts = parseResetMs(items[i]?.resetsAt) ?? -1;
    if (ts > bestTs) {
      best = items[i];
      bestTs = ts;
    }
  }
  return best;
}

function pickEarliestReset(items) {
  let best = items[0];
  let bestTs = parseResetMs(best?.resetsAt) ?? Infinity;
  for (let i = 1; i < items.length; i++) {
    const ts = parseResetMs(items[i]?.resetsAt) ?? Infinity;
    if (ts < bestTs) {
      best = items[i];
      bestTs = ts;
    }
  }
  return best;
}

function findProviderMeta(providersData, providerId) {
  const list = Array.isArray(providersData?.providers) ? providersData.providers : [];
  return list.find((p) => p?.id === providerId) || null;
}

function evalClaudeLimit(claudeUsage, effModel, providerName, now, { pickerOnly = false } = {}) {
  if (!claudeUsage || typeof claudeUsage !== 'object') return null;

  // Active extra credit overrides plan limits
  const extra = claudeUsage.extra;
  if (extra && Number(extra.limit) > 0 && Number(extra.used || 0) < Number(extra.limit)) {
    return null;
  }

  const limits = Array.isArray(claudeUsage.limits) ? claudeUsage.limits : [];
  const modelLower = String(effModel || '').toLowerCase();

  const active = limits.filter((l) => {
    if (!l || typeof l !== 'object') return false;
    const kind = String(l.kind || '').toLowerCase();
    if (kind === 'session' || kind === 'weekly') {
      return isWindowLimited(l, now);
    }
    if (pickerOnly) return false;
    if (kind === 'weekly_opus') {
      return modelLower.includes('opus') && isWindowLimited(l, now);
    }
    if (kind === 'weekly_sonnet') {
      return modelLower.includes('sonnet') && isWindowLimited(l, now);
    }
    return false;
  });

  if (!active.length) return null;

  const chosen = pickFurthestReset(active);
  return {
    limited: true,
    provider: 'claude',
    providerName,
    kind: chosen.kind,
    groupLabel: null,
    percent: Number(chosen.percent),
    resetsAt: chosen.resetsAt || null,
    remainingMs: remainingFor(chosen.resetsAt, now),
    stale: Boolean(claudeUsage.stale),
  };
}

function evalGroupsLimit(providerId, providerUsage, candidates, providerName, now, { allOnly = false } = {}) {
  const groups = Array.isArray(providerUsage?.groups) ? providerUsage.groups : [];
  if (!groups.length) return null;

  if (!allOnly) {
    const matched = matchGroupForModel(groups, candidates);
    if (matched) {
      if (!isWindowLimited(matched, now)) return null;
      return {
        limited: true,
        provider: providerId,
        providerName,
        kind: 'group',
        groupLabel: matched.label || null,
        percent: Number(matched.percent),
        resetsAt: matched.resetsAt || null,
        remainingMs: remainingFor(matched.resetsAt, now),
        stale: Boolean(providerUsage.stale),
      };
    }
  }

  // No specific model matched (or picker-level check): block only if ALL groups are limited
  if (groups.every((g) => isWindowLimited(g, now))) {
    const earliest = pickEarliestReset(groups);
    return {
      limited: true,
      provider: providerId,
      providerName,
      kind: 'all_groups',
      groupLabel: earliest.label || null,
      percent: Number(earliest.percent),
      resetsAt: earliest.resetsAt || null,
      remainingMs: remainingFor(earliest.resetsAt, now),
      stale: Boolean(providerUsage.stale),
    };
  }

  return null;
}

function evalGenericProvider(providerId, usage, chat, prov, providerName, now) {
  const rec = usage?.[providerId] || usage?.providers?.[providerId];
  if (!rec || typeof rec !== 'object') return null;

  if (Array.isArray(rec.limits) && rec.limits.length) {
    const active = rec.limits.filter((l) => isWindowLimited(l, now));
    if (active.length) {
      const chosen = pickFurthestReset(active);
      return {
        limited: true,
        provider: providerId,
        providerName,
        kind: chosen.kind || 'limit',
        groupLabel: chosen.label || null,
        percent: Number(chosen.percent),
        resetsAt: chosen.resetsAt || null,
        remainingMs: remainingFor(chosen.resetsAt, now),
        stale: Boolean(rec.stale),
        ...(chosen.reason || rec.reason ? { reason: chosen.reason || rec.reason } : {}),
      };
    }
    return null;
  }

  if (Array.isArray(rec.groups) && rec.groups.length) {
    const rawId = chat?.model || '';
    const modelObj = rawId && Array.isArray(prov?.models) ? prov.models.find((m) => m.id === rawId) : null;
    const candidates = [rawId, modelObj?.label, !rawId ? chat?.effModel : '', prov?.defaultModel].filter(Boolean);
    return evalGroupsLimit(providerId, rec, candidates, providerName, now);
  }

  if (isWindowLimited(rec, now)) {
    return {
      limited: true,
      provider: providerId,
      providerName,
      kind: rec.kind || 'limit',
      groupLabel: rec.label || null,
      percent: Number(rec.percent),
      resetsAt: rec.resetsAt || null,
      remainingMs: remainingFor(rec.resetsAt, now),
      stale: Boolean(rec.stale),
      ...(rec.reason ? { reason: rec.reason } : {}),
    };
  }

  return null;
}

/**
 * Evaluates whether the currently selected provider/model for `chat` is at 100% limit
 * with a non-expired window. Returns `null` if sending is allowed.
 */
export function getProviderLimitStatus(usage, chat, providersData, now = Date.now()) {
  if (!usage || typeof usage !== 'object') return null;
  const provider = chat?.provider || providersData?.defaultProvider || 'claude';
  const prov = findProviderMeta(providersData, provider);
  const providerName = prov?.name || provName(provider);

  if (provider === 'claude') {
    const effModel = chat?.model || chat?.effModel || prov?.defaultModel || '';
    return evalClaudeLimit(usage.claude, effModel, providerName, now);
  }

  if (provider === 'antigravity') {
    const rawId = chat?.agyModel || '';
    const modelObj = rawId && Array.isArray(prov?.models) ? prov.models.find((m) => m.id === rawId) : null;
    const candidates = rawId
      ? [rawId, modelObj?.label].filter(Boolean)
      : [chat?.effModel].filter(Boolean);
    return evalGroupsLimit('antigravity', usage.antigravity, candidates, providerName, now);
  }

  return evalGenericProvider(provider, usage, chat, prov, providerName, now);
}

/**
 * Provider-level limit helper for ModelPickerSheet rows.
 * - Claude: checks `session` and `weekly` (respecting active extra credit)
 * - Antigravity: checks if ALL groups are at 100% and non-expired
 * - Other providers: checks generic provider limit
 */
export function getProviderPickerLimit(usage, providerId, providersData, now = Date.now()) {
  if (!usage || typeof usage !== 'object' || !providerId) return null;
  const prov = findProviderMeta(providersData, providerId);
  const providerName = prov?.name || provName(providerId);

  if (providerId === 'claude') {
    return evalClaudeLimit(usage.claude, '', providerName, now, { pickerOnly: true });
  }

  if (providerId === 'antigravity') {
    return evalGroupsLimit('antigravity', usage.antigravity, [], providerName, now, { allOnly: true });
  }

  return evalGenericProvider(providerId, usage, { provider: providerId }, prov, providerName, now);
}

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatResetAtLabel(targetMs, now, lang) {
  const target = new Date(targetMs);
  const current = new Date(now);
  const tomorrow = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
  const locale = lang || 'pt-BR';
  const shortLang = String(locale).toLowerCase();
  const timeStr = target.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  if (sameCalendarDay(target, current)) {
    if (shortLang.startsWith('pt')) return `hoje às ${timeStr}`;
    if (shortLang.startsWith('es')) return `hoy a las ${timeStr}`;
    return `today at ${timeStr}`;
  }
  if (sameCalendarDay(target, tomorrow)) {
    if (shortLang.startsWith('pt')) return `amanhã às ${timeStr}`;
    if (shortLang.startsWith('es')) return `mañana a las ${timeStr}`;
    return `tomorrow at ${timeStr}`;
  }
  return target.toLocaleString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats reset timestamp relative to `now` into friendly live countdown,
 * compact countdown (for badges/subtitles), and localized date/time label.
 */
export function formatResetInfo(resetsAt, now = Date.now(), lang = 'pt-BR') {
  const targetMs = parseResetMs(resetsAt);
  if (targetMs === null) {
    return {
      expired: false,
      remainingMs: null,
      countdown: '',
      compactCountdown: '',
      resetAtLabel: '',
    };
  }

  const diff = targetMs - now;
  const resetAtLabel = formatResetAtLabel(targetMs, now, lang);

  if (diff <= 0) {
    return {
      expired: true,
      remainingMs: 0,
      countdown: '0 s',
      compactCountdown: '0 s',
      resetAtLabel,
    };
  }

  const totalSecs = Math.ceil(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  let countdown;
  if (days > 0) {
    countdown = hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  } else if (hours > 0) {
    countdown = mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  } else if (mins > 0) {
    countdown = `${mins} min ${String(secs).padStart(2, '0')} s`;
  } else {
    countdown = `${secs} s`;
  }

  let compactCountdown;
  if (days > 0) {
    compactCountdown = hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  } else if (hours > 0) {
    compactCountdown = mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  } else if (totalSecs >= 60) {
    const roundedMins = Math.ceil(totalSecs / 60);
    compactCountdown = roundedMins >= 60 ? '1 h' : `${roundedMins} min`;
  } else {
    compactCountdown = `${totalSecs} s`;
  }

  return {
    expired: false,
    remainingMs: diff,
    countdown,
    compactCountdown,
    resetAtLabel,
  };
}
