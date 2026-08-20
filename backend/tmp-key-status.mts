import { readFileSync } from 'node:fs';

function key() {
  const text = readFileSync('/workspace/secrets/API-KEYS.md', 'utf8');
  for (const line of text.split('\n')) {
    if (line.includes('sk-or-v1-') && line.includes('=')) return line.split('=')[1].trim();
  }
  return undefined;
}

const res = await fetch('https://openrouter.ai/api/v1/key', {
  headers: { Authorization: `Bearer ${key()}` },
});
console.log('status', res.status);
console.log(JSON.stringify(await res.json(), null, 2));

const started = Date.now();
const chat = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key()}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:5319',
    'X-Title': 'Lifelog',
  },
  body: JSON.stringify({
    model: 'google/gemma-4-26b-a4b-it:free',
    max_tokens: 40,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  }),
});
const body = await chat.json();
console.log('chat status', chat.status, 'ms', Date.now() - started);
console.log(JSON.stringify(body).slice(0, 500));
