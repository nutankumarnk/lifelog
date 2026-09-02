import { loadConfig } from '../config/env.js';
import { OpenRouterProvider } from '../ai/openrouter.provider.js';

async function main() {
  const cfg = loadConfig({ fresh: true });
  console.log('Provider:', cfg.AI_PROVIDER);
  console.log('Model:', cfg.AI_MODEL);
  console.log('OpenRouter Key exists:', Boolean(cfg.OPENROUTER_API_KEY));
  console.log('Base URL:', cfg.OPENROUTER_BASE_URL);

  const p = new OpenRouterProvider({
    apiKey: cfg.OPENROUTER_API_KEY,
    model: cfg.AI_MODEL,
    baseUrl: cfg.OPENROUTER_BASE_URL,
    timeoutMs: 25000,
    temperature: 0.1,
  });

  try {
    const res = await p.analyze({
      instructions: 'Return minified JSON with {"intent":"LOG","summary":"test","entities":[],"items":[]}',
      userMessage: 'I met Rahul yesterday in Delhi',
      text: 'I met Rahul yesterday in Delhi',
      now: new Date(),
      timezone: null,
    });
    console.log('SUCCESS RESULT:', JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error('ERROR OCCURRED:', err.message, 'Kind:', err.kind);
    if (err.cause) console.error('CAUSE:', err.cause);
  }
}

main();
