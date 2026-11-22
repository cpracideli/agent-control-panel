import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBridgeControlCommand,
  getProviderLimitStatus,
  getProviderPickerLimit,
  formatResetInfo,
} from './providerLimits.js';

const NOW = new Date('2026-11-22T21:50:00.000Z').getTime();
const IN_10_MIN = new Date(NOW + 10 * 60 * 1000).toISOString();
const IN_2_HOURS = new Date(NOW + 2 * 3600 * 1000).toISOString();
const IN_2_DAYS = new Date(NOW + 48 * 3600 * 1000).toISOString();
const PAST_5_MIN = new Date(NOW - 5 * 60 * 1000).toISOString();

const PROVIDERS = {
  defaultProvider: 'claude',
  providers: [
    {
      id: 'claude',
      name: 'Claude Code',
      installed: true,
      defaultModel: '',
      models: [
        { id: 'opus', label: 'Opus' },
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'haiku', label: 'Haiku' },
      ],
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      installed: true,
      models: [
        { id: 'gemini-4-neon', label: 'Gemini 4 Neon' },
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
        { id: 'gpt-oss-120b', label: 'GPT-OSS 120B' },
      ],
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot',
      installed: true,
      defaultModel: 'auto',
      models: [{ id: 'auto', label: 'Auto' }],
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      installed: true,
      models: [],
    },
  ],
};

describe('isBridgeControlCommand', () => {
  it('recognizes all internal bridge commands', () => {
    const cmds = [
      '/help',
      '/new',
      '/provider antigravity',
      '/model opus',
      '/effort high',
      '/bot frontend',
      '/stop',
      '/status',
      '/usage',
      '/log',
      '/send 5511999 oi',
      '/schedules',
      '/pause',
      '/resume',
      '/cancel',
      '  /PROVIDER claude  ',
    ];
    for (const c of cmds) {
      assert.equal(isBridgeControlCommand(c), true, `expected true for "${c}"`);
    }
  });

  it('rejects normal prompts, skills, /council, and partial prefix lookalikes', () => {
    const nonCmds = [
      '',
      'oi tudo bem',
      '/council compare os dois',
      '/frontend-design crie um card',
      '/newline teste',
      '/status-check',
      'pode rodar /status depois?',
    ];
    for (const c of nonCmds) {
      assert.equal(isBridgeControlCommand(c), false, `expected false for "${c}"`);
    }
  });
});

describe('getProviderLimitStatus — Claude', () => {
  it('blocks when session limit is at 100% and not expired', () => {
    const usage = {
      claude: {
        stale: false,
        limits: [
          { kind: 'session', percent: 100, resetsAt: IN_10_MIN },
          { kind: 'weekly', percent: 60, resetsAt: IN_2_DAYS },
        ],
        extra: null,
      },
    };
    const res = getProviderLimitStatus(usage, { provider: 'claude' }, PROVIDERS, NOW);
    assert.ok(res);
    assert.equal(res.limited, true);
    assert.equal(res.provider, 'claude');
    assert.equal(res.providerName, 'Claude Code');
    assert.equal(res.kind, 'session');
    assert.equal(res.percent, 100);
    assert.equal(res.resetsAt, IN_10_MIN);
    assert.equal(res.remainingMs, 10 * 60 * 1000);
    assert.equal(res.stale, false);
  });

  it('does NOT block when window is expired (resetsAt <= now)', () => {
    const usage = {
      claude: {
        limits: [{ kind: 'session', percent: 100, resetsAt: PAST_5_MIN }],
      },
    };
    assert.equal(getProviderLimitStatus(usage, { provider: 'claude' }, PROVIDERS, NOW), null);
  });

  it('does NOT block when extra credit has remaining balance', () => {
    const usage = {
      claude: {
        limits: [{ kind: 'session', percent: 100, resetsAt: IN_10_MIN }],
        extra: { used: 4.5, limit: 20 },
      },
    };
    assert.equal(getProviderLimitStatus(usage, { provider: 'claude' }, PROVIDERS, NOW), null);
  });

  it('blocks when extra credit is exhausted (used >= limit)', () => {
    const usage = {
      claude: {
        limits: [{ kind: 'session', percent: 100, resetsAt: IN_10_MIN }],
        extra: { used: 20, limit: 20 },
      },
    };
    const res = getProviderLimitStatus(usage, { provider: 'claude' }, PROVIDERS, NOW);
    assert.ok(res?.limited);
    assert.equal(res.kind, 'session');
  });

  it('chooses the furthest resetsAt when both session and weekly are at 100%', () => {
    const usage = {
      claude: {
        limits: [
          { kind: 'session', percent: 100, resetsAt: IN_10_MIN },
          { kind: 'weekly', percent: 100, resetsAt: IN_2_DAYS },
        ],
      },
    };
    const res = getProviderLimitStatus(usage, { provider: 'claude' }, PROVIDERS, NOW);
    assert.equal(res?.kind, 'weekly');
    assert.equal(res?.resetsAt, IN_2_DAYS);
  });

  it('applies weekly_opus only when effective model contains opus', () => {
    const usage = {
      claude: {
        limits: [
          { kind: 'session', percent: 40, resetsAt: IN_10_MIN },
          { kind: 'weekly_opus', percent: 100, resetsAt: IN_2_DAYS },
        ],
      },
    };
    assert.equal(
      getProviderLimitStatus(usage, { provider: 'claude', model: 'sonnet' }, PROVIDERS, NOW),
      null,
    );
    const opusRes = getProviderLimitStatus(
      usage,
      { provider: 'claude', model: 'claude-opus-4-7' },
      PROVIDERS,
      NOW,
    );
    assert.equal(opusRes?.kind, 'weekly_opus');
    const effOpus = getProviderLimitStatus(
      usage,
      { provider: 'claude', model: '', effModel: 'Opus 4.7' },
      PROVIDERS,
      NOW,
    );
    assert.equal(effOpus?.kind, 'weekly_opus');
  });

  it('applies weekly_sonnet only when effective model contains sonnet', () => {
    const usage = {
      claude: {
        limits: [{ kind: 'weekly_sonnet', percent: 100, resetsAt: IN_2_DAYS }],
      },
    };
    assert.equal(
      getProviderLimitStatus(usage, { provider: 'claude', model: 'haiku' }, PROVIDERS, NOW),
      null,
    );
    const sonnetRes = getProviderLimitStatus(
      usage,
      { provider: 'claude', model: 'sonnet' },
      PROVIDERS,
      NOW,
    );
    assert.equal(sonnetRes?.kind, 'weekly_sonnet');
  });
});

describe('getProviderLimitStatus — Antigravity', () => {
  const agyGroups = [
    {
      label: 'Claude + GPT',
      percent: 100,
      resetsAt: IN_2_HOURS,
      models: ['Claude Opus 5.5 (High)', 'Claude Sonnet 5.5 (Medium)', 'GPT-OSS 120B (Medium)'],
    },
    {
      label: 'Gemini',
      percent: 45,
      resetsAt: IN_10_MIN,
      models: ['Gemini 2.5 Pro', 'gemini-3.8-flash-tiered'],
    },
  ];

  it('matches selected model by normalized name and blocks its exhausted group', () => {
    const usage = { antigravity: { groups: agyGroups } };
    const res = getProviderLimitStatus(
      usage,
      { provider: 'antigravity', agyModel: 'claude-opus-5-5' },
      PROVIDERS,
      NOW,
    );
    assert.ok(res?.limited);
    assert.equal(res.kind, 'group');
    assert.equal(res.groupLabel, 'Claude + GPT');
    assert.equal(res.resetsAt, IN_2_HOURS);
  });

  it('allows model belonging to a non-exhausted group (family match fallback)', () => {
    const usage = { antigravity: { groups: agyGroups } };
    const res = getProviderLimitStatus(
      usage,
      { provider: 'antigravity', agyModel: 'gemini-4-neon' },
      PROVIDERS,
      NOW,
    );
    assert.equal(res, null);
  });

  it('blocks family-matched Gemini model when Gemini group is at 100%', () => {
    const usage = {
      antigravity: {
        groups: [
          { ...agyGroups[0], percent: 10 },
          { ...agyGroups[1], percent: 100, resetsAt: IN_10_MIN },
        ],
      },
    };
    const res = getProviderLimitStatus(
      usage,
      { provider: 'antigravity', agyModel: 'gemini-4-neon' },
      PROVIDERS,
      NOW,
    );
    assert.ok(res?.limited);
    assert.equal(res.groupLabel, 'Gemini');
  });

  it('when no model is selected, does NOT block if at least one group still has quota', () => {
    const usage = { antigravity: { groups: agyGroups } };
    assert.equal(
      getProviderLimitStatus(usage, { provider: 'antigravity', agyModel: '' }, PROVIDERS, NOW),
      null,
    );
  });

  it('when no model is selected and ALL groups are at 100%, blocks with earliest resetsAt', () => {
    const usage = {
      antigravity: {
        groups: [
          { ...agyGroups[0], percent: 100, resetsAt: IN_2_HOURS },
          { ...agyGroups[1], percent: 100, resetsAt: IN_10_MIN },
        ],
      },
    };
    const res = getProviderLimitStatus(
      usage,
      { provider: 'antigravity', agyModel: '' },
      PROVIDERS,
      NOW,
    );
    assert.ok(res?.limited);
    assert.equal(res.kind, 'all_groups');
    assert.equal(res.groupLabel, 'Gemini');
    assert.equal(res.resetsAt, IN_10_MIN);
  });
});

describe('getProviderLimitStatus — generic providers', () => {
  it('supports direct { percent, resetsAt, reason } on usage[providerId]', () => {
    const usage = {
      copilot: { percent: 100, resetsAt: IN_2_HOURS, reason: 'Premium requests exhausted' },
    };
    const res = getProviderLimitStatus(usage, { provider: 'copilot' }, PROVIDERS, NOW);
    assert.ok(res?.limited);
    assert.equal(res.provider, 'copilot');
    assert.equal(res.providerName, 'GitHub Copilot');
    assert.equal(res.reason, 'Premium requests exhausted');
  });

  it('supports usage.providers[providerId].limits array', () => {
    const usage = {
      providers: {
        opencode: {
          limits: [{ kind: 'daily', percent: 100, resetsAt: IN_10_MIN }],
        },
      },
    };
    const res = getProviderLimitStatus(usage, { provider: 'opencode' }, PROVIDERS, NOW);
    assert.ok(res?.limited);
    assert.equal(res.provider, 'opencode');
    assert.equal(res.kind, 'daily');
  });

  it('ignores expired generic provider limit', () => {
    const usage = {
      copilot: { percent: 100, resetsAt: PAST_5_MIN },
    };
    assert.equal(getProviderLimitStatus(usage, { provider: 'copilot' }, PROVIDERS, NOW), null);
  });
});

describe('getProviderPickerLimit', () => {
  it('checks session/weekly for Claude, ignores model-specific opus limit', () => {
    const usage = {
      claude: {
        limits: [
          { kind: 'session', percent: 50, resetsAt: IN_10_MIN },
          { kind: 'weekly_opus', percent: 100, resetsAt: IN_2_DAYS },
        ],
      },
    };
    assert.equal(getProviderPickerLimit(usage, 'claude', PROVIDERS, NOW), null);
  });

  it('flags Antigravity only when all groups are exhausted', () => {
    const partial = {
      antigravity: {
        groups: [
          { label: 'Claude + GPT', percent: 100, resetsAt: IN_2_HOURS, models: [] },
          { label: 'Gemini', percent: 10, resetsAt: IN_10_MIN, models: [] },
        ],
      },
    };
    assert.equal(getProviderPickerLimit(partial, 'antigravity', PROVIDERS, NOW), null);

    const full = {
      antigravity: {
        groups: [
          { label: 'Claude + GPT', percent: 100, resetsAt: IN_2_HOURS, models: [] },
          { label: 'Gemini', percent: 100, resetsAt: IN_10_MIN, models: [] },
        ],
      },
    };
    const res = getProviderPickerLimit(full, 'antigravity', PROVIDERS, NOW);
    assert.ok(res?.limited);
    assert.equal(res.resetsAt, IN_10_MIN);
  });
});

describe('formatResetInfo', () => {
  it('formats minutes + seconds, hours + minutes, and days + hours cleanly', () => {
    const rMin = formatResetInfo(new Date(NOW + (9 * 60 + 42) * 1000).toISOString(), NOW, 'pt-BR');
    assert.equal(rMin.expired, false);
    assert.equal(rMin.countdown, '9 min 42 s');
    assert.equal(rMin.compactCountdown, '10 min');
    assert.match(rMin.resetAtLabel, /^(hoje às|amanhã às)/);

    const rHour = formatResetInfo(new Date(NOW + (2 * 3600 + 15 * 60) * 1000).toISOString(), NOW, 'pt-BR');
    assert.equal(rHour.countdown, '2 h 15 min');
    assert.equal(rHour.compactCountdown, '2 h 15 min');

    const rDay = formatResetInfo(new Date(NOW + (28 * 3600) * 1000).toISOString(), NOW, 'en');
    assert.equal(rDay.countdown, '1 d 4 h');
    assert.equal(rDay.compactCountdown, '1 d 4 h');
  });

  it('handles expired timestamps and missing values', () => {
    const exp = formatResetInfo(PAST_5_MIN, NOW, 'pt-BR');
    assert.equal(exp.expired, true);
    assert.equal(exp.remainingMs, 0);

    const none = formatResetInfo(null, NOW, 'pt-BR');
    assert.equal(none.expired, false);
    assert.equal(none.remainingMs, null);
    assert.equal(none.countdown, '');
  });
});
