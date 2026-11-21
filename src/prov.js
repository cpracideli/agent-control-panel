// Human labels for the bridge providers (ids match /bridge/providers).
export const PROVIDER_NAMES = { claude: 'Claude', antigravity: 'Antigravity', opencode: 'OpenCode', openai_compat: 'API Direta', council: 'Conselho' };

export const provName = (p) => PROVIDER_NAMES[p] || (p ? String(p) : 'Claude');
