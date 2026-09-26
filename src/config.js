import { resolve } from 'node:path';

function integer(env, key, fallback, min, max) {
  const raw = env[key] ?? '';
  const n = raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  return n;
}

export function loadConfig(env = process.env) {
  const auth = env.MC_AUTH || 'offline';
  if (!['offline', 'microsoft'].includes(auth)) throw new Error('MC_AUTH must be offline or microsoft.');
  const username = env.MC_USERNAME || 'BroBot';
  if (auth === 'offline' && !/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('MC_USERNAME must be 3–16 letters, numbers or underscores for offline mode.');
  const config = {
    minecraft: {
      host: env.MC_HOST || '127.0.0.1',
      port: integer(env, 'MC_PORT', 25565, 1, 65535),
      version: env.MC_VERSION || '1.21.8',
      username, auth, owner: (env.MC_OWNER || '').trim(),
    },
    ai: {
      apiKey: env.OPENAI_API_KEY || '', model: env.OPENAI_MODEL || 'gpt-6-astra',
      maxRequests: integer(env, 'AI_MAX_REQUESTS', 30, 1, 10000),
      maxInputTokens: integer(env, 'AI_MAX_INPUT_TOKENS', 120000, 1000, 100000000),
      maxOutputTokens: integer(env, 'AI_MAX_OUTPUT_TOKENS', 30000, 1000, 10000000),
      turnOutputTokens: integer(env, 'AI_TURN_OUTPUT_TOKENS', 2000, 256, 16000),
      stepLimit: integer(env, 'AI_STEP_LIMIT', 40, 1, 500),
      intervalMs: integer(env, 'AI_INTERVAL_MS', 3000, 1000, 60000),
    },
    actionTimeoutMs: integer(env, 'ACTION_TIMEOUT_MS', 120000, 1000, 600000),
    webPort: integer(env, 'WEB_PORT', 3000, 1024, 65535),
    dataDir: resolve(env.BROBOT_DATA_DIR || '.brobot'),
  };
  if (config.ai.turnOutputTokens > config.ai.maxOutputTokens) throw new Error('AI_TURN_OUTPUT_TOKENS exceeds AI_MAX_OUTPUT_TOKENS.');
  return config;
}

export function publicConfig(config) {
  return { minecraft: { ...config.minecraft }, model: config.ai.model, aiConfigured: Boolean(config.ai.apiKey), webPort: config.webPort };
}
