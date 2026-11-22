// Human labels for the bridge providers (ids match /bridge/providers).
export const PROVIDER_NAMES = { claude: 'Claude', antigravity: 'Antigravity', opencode: 'OpenCode', copilot: 'GitHub Copilot', ollama: 'Ollama Cloud', openai_compat: 'API Direta', council: 'Conselho' };

export const provName = (p) => PROVIDER_NAMES[p] || (p ? String(p) : 'Claude');
