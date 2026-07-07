const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const { getSetting } = require('./settings');

const SYSTEM_PROMPTS = {
  fix_grammar: 'You are a grammar expert. Fix grammar, spelling, and punctuation errors in the user\'s text. Return only the corrected text with no explanation.',
  rephrase: 'You are a professional editor. Rephrase the user\'s text to be clearer and more professional. Return only the rephrased text with no explanation.',
  translate: 'You are a professional translator. Translate the user\'s text to the target language they specify. Return only the translated text with no explanation.',
  summarize: 'You are an expert at condensing content. Summarize the user\'s text into 2-4 concise bullet points covering the key ideas. Return only the bullet points.',
  explain: 'You are a teacher. Explain the user\'s text in simple, plain language that anyone can understand. Return only the explanation.',
  chat: 'You are WriteAI, an expert writing assistant. Help users draft, edit, improve, translate, summarize, and brainstorm content. Be clear, helpful, and well-structured. Use markdown formatting when it improves readability. Match the requested tone and length when the user specifies them.'
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

async function runWithGPT(action, text, extra = '', modelName = 'gpt-4o-mini') {
  const keys = await getApiKeys();
  if (!keys.openai) throw new Error('OpenAI API key not configured');

  const openai = new OpenAI({ apiKey: keys.openai });
  const systemPrompt = SYSTEM_PROMPTS[action];
  const userContent = extra ? `${text}\n\nExtra instruction: ${extra}` : text;
  const maxTokens = action === 'chat' ? 1500 : 500;

  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    max_tokens: maxTokens,
    temperature: 0.3
  });

  return {
    result: response.choices[0].message.content.trim(),
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
  const model = genAI.getGenerativeModel({ model: resolvedModel });
  const systemPrompt = SYSTEM_PROMPTS[action];
  const prompt = `${systemPrompt}\n\nText: ${text}${extra ? `\n\nExtra instruction: ${extra}` : ''}`;

  const response = await model.generateContent(prompt);
  const resp = response.response;
  const result = resp.text().trim();
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

function parseAiError(err) {
  if (err.message === 'OpenAI API key not configured') {
    return {
      status: 503,
      code: 'no_openai_key',
      message: 'OpenAI is not configured. Add an API key in Admin → AI Config, or set Gemini as primary.'
    };
  }
  if (err.message === 'Gemini API key not configured') {
    return {
      status: 503,
      code: 'no_gemini_key',
      message: 'Gemini API key is missing. Add it in Admin → AI Config → API Keys.'
    };
  }
  if (err.message === 'All AI models are disabled') {
    return {
      status: 503,
      code: 'models_disabled',
      message: 'All AI providers are disabled in Admin → AI Config.'
    };
  }

  if (isQuotaOrRateLimit(err)) {
    const retryInfo = err.errorDetails?.find((d) => String(d['@type'] || '').includes('RetryInfo'));
    const retryRaw = retryInfo?.retryDelay || err.message?.match(/retry in ([\d.]+)s/i)?.[1];
    const retrySec = retryRaw ? parseFloat(String(retryRaw).replace(/s$/i, '')) : null;
    const waitHint = retrySec ? ` Retry in ~${Math.ceil(retrySec)}s.` : '';
    return {
      status: 429,
      code: 'ai_quota_exceeded',
      message: `Gemini free quota exceeded for this model.${waitHint} Try gemini-2.5-flash-lite in Admin → AI Config, or enable billing at ai.google.dev.`
    };
  }

  if (err.status === 403 || /403|permission|api key not valid/i.test(err.message || '')) {
    return {
      status: 403,
      code: 'ai_auth_failed',
      message: 'Invalid or restricted API key. Check your Gemini key in Admin → AI Config.'
    };
  }

  if (err.status === 404 || /not found|404/i.test(err.message || '')) {
    return {
      status: 400,
      code: 'model_not_found',
      message: 'That Gemini model is retired or unavailable. Use gemini-2.5-flash in Admin → AI Config.'
    };
  }

  return {
    status: 500,
    code: 'ai_error',
    message: err.message || 'AI service unavailable. Please try again.'
  };
}

async function runWithProvider(action, text, extra, modelName, modelsConfig) {
  const provider = getProviderForModel(modelName, modelsConfig);
  if (provider === 'gemini') {
    return runWithGeminiFallback(action, text, extra, modelName);
  }
  return runWithGPT(action, text, extra, modelName);
}

async function runAction(action, text, extra = '') {
  const models = await getModelConfig();
  const primaryProvider = getProviderForModel(models.primary, models);
  const useGeminiFirst = primaryProvider === 'gemini' && models.gemini_enabled;

  if (useGeminiFirst) {
    try {
      return await runWithGeminiFallback(action, text, extra, models.primary);
    } catch (err) {
      if (!models.gpt_enabled) throw err;
      console.error('Gemini failed, falling back to OpenAI:', err.message);
      return runWithGPT(action, text, extra, models.fallback);
    }
  }

  if (!models.gpt_enabled) {
    if (!models.gemini_enabled) throw new Error('All AI models are disabled');
    return runWithGeminiFallback(action, text, extra, models.fallback || 'gemini-2.5-flash-lite');
  }

  try {
    return await runWithGPT(action, text, extra, models.primary || 'gpt-4o-mini');
  } catch (err) {
    if (!models.gemini_enabled) throw err;
    console.error('GPT failed, falling back to Gemini:', err.message);
    return runWithGeminiFallback(action, text, extra, models.fallback || 'gemini-2.5-flash-lite');
  }
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
