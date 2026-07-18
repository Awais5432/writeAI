const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const config = require('../config');
const { getSetting } = require('./settings');

const LANG_RULE =
  'Always respond in the same language as the input text, unless the user explicitly asks for a different language.';

const SYSTEM_PROMPTS = {
  fix_grammar:
    `You are a grammar expert. Fix grammar, spelling, and punctuation only. Do not change meaning or style. ${LANG_RULE} Return ONLY the corrected text as plain text — no markdown, no bullets, no quotes, no explanation.`,
  rephrase:
    `You are a professional editor. Rewrite the text with clearly different wording and sentence structure while keeping the same meaning and tone. Do NOT return text that is nearly identical to the input — change vocabulary and phrasing. ${LANG_RULE} Return ONLY the rephrased text as plain text — no markdown, no bullets, no quotes, no explanation.`,
  translate:
    'You are a professional translator. Translate the user\'s text to the target language they specify. Return ONLY the translated text as plain text — no markdown, no quotes, no explanation.',
  summarize:
    `You are an expert at condensing content. Summarize into 2-4 short lines covering the key ideas. ${LANG_RULE} Return ONLY the summary as plain text lines starting with "- " — no markdown bold/italic, no numbered lists, no explanation.`,
  explain:
    `You are a teacher. Explain the text in simple, plain language. ${LANG_RULE} Return ONLY the explanation as plain text — no markdown, no bullets unless needed for clarity, no quotes around the whole answer.`,
  chat:
    'You are WriteAI, an expert writing assistant. Help users draft, edit, improve, translate, summarize, and brainstorm content. Be clear, helpful, and well-structured. Use markdown formatting when it improves readability. Match the requested tone and length when the user specifies them. Match the user\'s language unless they ask otherwise.'
};

const BUILTIN_MODELS = [
  { id: 'gpt-4o-mini', provider: 'openai', label: 'gpt-4o-mini' },
  { id: 'gpt-4o', provider: 'openai', label: 'gpt-4o' },
  { id: 'gpt-4-turbo', provider: 'openai', label: 'gpt-4-turbo' },
  { id: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash (recommended)' },
  { id: 'gemini-2.5-flash-lite', provider: 'gemini', label: 'Gemini 2.5 Flash Lite' },
  { id: 'gemini-2.5-pro', provider: 'gemini', label: 'Gemini 2.5 Pro' }
];

const LEGACY_GEMINI_MODEL_MAP = {
  'gemini-1.5-flash': 'gemini-2.5-flash',
  'gemini-1.5-flash-latest': 'gemini-2.5-flash',
  'gemini-1.5-flash-002': 'gemini-2.5-flash',
  'gemini-1.5-flash-8b': 'gemini-2.5-flash-lite',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-1.5-pro-latest': 'gemini-2.5-pro',
  'gemini-1.5-pro-002': 'gemini-2.5-pro',
  'gemini-2.0-flash': 'gemini-2.5-flash',
  'gemini-2.0-flash-lite': 'gemini-2.5-flash-lite'
};

const GEMINI_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro'
];

const ACTION_TEMPERATURE = {
  fix_grammar: 0.2,
  rephrase: 0.85,
  translate: 0.3,
  summarize: 0.4,
  explain: 0.5,
  chat: 0.7
};

/** In-memory response cache: identical action+text+extra → instant result */
const resultCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

function cacheKey(action, text, extra) {
  return crypto
    .createHash('sha256')
    .update(`${action}\n${extra || ''}\n${text}`)
    .digest('hex');
}

function getCached(action, text, extra) {
  const key = cacheKey(action, text, extra);
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(action, text, extra, value) {
  if (resultCache.size >= CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    resultCache.delete(oldest);
  }
  resultCache.set(cacheKey(action, text, extra), { at: Date.now(), value });
}

function resolveGeminiModel(modelName) {
  return LEGACY_GEMINI_MODEL_MAP[modelName] || modelName;
}

async function getModelConfig() {
  return getSetting('models');
}

async function getApiKeys() {
  const keys = await getSetting('api_keys');
  return {
    openai: keys.openai || config.openaiApiKey || '',
    gemini: keys.gemini || config.geminiApiKey || ''
  };
}

function resolveModelList(modelsConfig) {
  const custom = (modelsConfig.custom_models || []).map((m) => ({
    id: m.id,
    provider: m.provider,
    label: m.label || m.id
  }));
  const builtinIds = new Set(BUILTIN_MODELS.map((m) => m.id));
  const extra = custom.filter((m) => !builtinIds.has(m.id));
  return [...BUILTIN_MODELS, ...extra];
}

function getProviderForModel(modelName, modelsConfig) {
  const all = resolveModelList(modelsConfig);
  const match = all.find((m) => m.id === modelName);
  if (match) return match.provider;
  if (modelName.includes('gemini')) return 'gemini';
  return 'openai';
}

function stripModelArtifacts(text) {
  if (!text) return text;
  let t = String(text).trim();
  // Strip wrapping quotes the model sometimes adds
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

async function runWithGPT(action, text, extra = '', modelName = 'gpt-4o-mini') {
  const keys = await getApiKeys();
  if (!keys.openai) throw new Error('OpenAI API key not configured');

  const openai = new OpenAI({ apiKey: keys.openai });
  const systemPrompt = SYSTEM_PROMPTS[action];
  const userContent = extra ? `${text}\n\nExtra instruction: ${extra}` : text;
  const maxTokens = action === 'chat' ? 1500 : 800;
  const temperature = ACTION_TEMPERATURE[action] ?? 0.4;

  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    max_tokens: maxTokens,
    temperature
  });

  return {
    result: stripModelArtifacts(response.choices[0].message.content),
    model: modelName,
    input_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.completion_tokens
  };
}

async function runWithGemini(action, text, extra = '', modelName = 'gemini-2.5-flash') {
  const keys = await getApiKeys();
  if (!keys.gemini) throw new Error('Gemini API key not configured');

  const resolvedModel = resolveGeminiModel(modelName);
  const genAI = new GoogleGenerativeAI(keys.gemini);
  const temperature = ACTION_TEMPERATURE[action] ?? 0.4;
  const model = genAI.getGenerativeModel({
    model: resolvedModel,
    generationConfig: {
      temperature,
      maxOutputTokens: action === 'chat' ? 1500 : 800
    }
  });
  const systemPrompt = SYSTEM_PROMPTS[action];
  const prompt = `${systemPrompt}\n\nText:\n${text}${extra ? `\n\nExtra instruction: ${extra}` : ''}`;

  const response = await model.generateContent(prompt);
  const resp = response.response;
  const result = stripModelArtifacts(resp.text());
  const usage = resp.usageMetadata;

  return {
    result,
    model: resolvedModel,
    input_tokens: usage?.promptTokenCount ?? estimateTokens(prompt),
    output_tokens: usage?.candidatesTokenCount ?? estimateTokens(result)
  };
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function isQuotaOrRateLimit(err) {
  return err.status === 429
    || /429|quota|rate.?limit|too many requests/i.test(err.message || '');
}

function isModelUnavailable(err) {
  return isQuotaOrRateLimit(err)
    || err.status === 404
    || /not found|404|is not found for api version/i.test(err.message || '');
}

async function runWithGeminiFallback(action, text, extra, preferredModel) {
  const start = resolveGeminiModel(preferredModel);
  const chain = [start, ...GEMINI_FALLBACK_CHAIN.filter((m) => m !== start)];
  let lastErr;

  for (const modelName of chain) {
    try {
      return await runWithGemini(action, text, extra, modelName);
    } catch (err) {
      lastErr = err;
      if (!isModelUnavailable(err)) throw err;
      console.error(`Gemini ${modelName} unavailable (${err.status || 'error'}), trying next model...`);
    }
  }

  throw lastErr;
}

/**
 * User-facing messages only — never expose Admin → AI Config / model names / billing URLs.
 * Admin details are logged server-side.
 */
function parseAiError(err) {
  const busy = 'AI is temporarily busy. Please try again in a few seconds.';
  const unavailable = 'AI is temporarily unavailable. Please try again later.';

  if (err.message === 'OpenAI API key not configured') {
    console.error('[AI config] OpenAI key missing');
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }
  if (err.message === 'Gemini API key not configured') {
    console.error('[AI config] Gemini key missing');
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }
  if (err.message === 'All AI models are disabled') {
    console.error('[AI config] All models disabled');
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }

  if (isQuotaOrRateLimit(err)) {
    console.error('[AI quota]', err.message);
    return { status: 429, code: 'ai_quota_exceeded', message: busy };
  }

  if (err.status === 403 || /403|permission|api key not valid/i.test(err.message || '')) {
    console.error('[AI auth]', err.message);
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }

  if (err.status === 404 || /not found|404/i.test(err.message || '')) {
    console.error('[AI model]', err.message);
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }

  console.error('[AI error]', err.message || err);
  return { status: 500, code: 'ai_error', message: busy };
}

async function runWithProvider(action, text, extra, modelName, modelsConfig) {
  const provider = getProviderForModel(modelName, modelsConfig);
  if (provider === 'gemini') {
    return runWithGeminiFallback(action, text, extra, modelName);
  }
  return runWithGPT(action, text, extra, modelName);
}

async function runAction(action, text, extra = '', options = {}) {
  if (!options.forceRefresh) {
    const cached = getCached(action, text, extra);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const models = await getModelConfig();
  const primaryProvider = getProviderForModel(models.primary, models);
  const useGeminiFirst = primaryProvider === 'gemini' && models.gemini_enabled;

  let result;
  if (useGeminiFirst) {
    try {
      result = await runWithGeminiFallback(action, text, extra, models.primary);
    } catch (err) {
      if (!models.gpt_enabled) throw err;
      console.error('Gemini failed, falling back to OpenAI:', err.message);
      result = await runWithGPT(action, text, extra, models.fallback);
    }
  } else if (!models.gpt_enabled) {
    if (!models.gemini_enabled) throw new Error('All AI models are disabled');
    result = await runWithGeminiFallback(action, text, extra, models.fallback || 'gemini-2.5-flash-lite');
  } else {
    try {
      result = await runWithGPT(action, text, extra, models.primary || 'gpt-4o-mini');
    } catch (err) {
      if (!models.gemini_enabled) throw err;
      console.error('GPT failed, falling back to Gemini:', err.message);
      result = await runWithGeminiFallback(action, text, extra, models.fallback || 'gemini-2.5-flash-lite');
    }
  }

  setCached(action, text, extra, result);
  return { ...result, cached: false };
}

module.exports = {
  runAction,
  parseAiError,
  SYSTEM_PROMPTS,
  getModelConfig,
  getApiKeys,
  resolveModelList,
  BUILTIN_MODELS
};
