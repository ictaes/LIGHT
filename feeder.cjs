// feeder.js — polls territorial.io/log/team and pushes new games to the bot's win feed.
// Lives in the root of the territorial-discord-bot folder (next to the "build" folder).
// Needs Node 22+ (built-in fetch and WebSocket). No npm packages required.
const fs = require('fs');
const path = require('path');

const LOG_URL = 'https://territorial.io/log/team';
const WS_URL = 'ws://localhost:34583';
const POLL_MS = 60_000;
const SEEN_FILE = path.join(__dirname, 'feeder-seen.json');

// Secret: uses WSS_SECRET if set, otherwise reads wss_secret from build/config.json
function loadSecret() {
  if (process.env.WSS_SECRET !== undefined) return process.env.WSS_SECRET;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'build', 'config.json'), 'utf8'));
    return cfg.wss_secret || '';
  } catch {
    console.log('Could not read build/config.json, using a blank secret');
    return '';
  }
}
const SECRET = loadSecret();

let seen = [];
try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch {}
// On a fresh start, mark what's already in the log as seen instead of flooding the bot
let priming = seen.length === 0;
let ws = null;
let ready = false;

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'verification', secret: SECRET }));
    ready = true;
    console.log('Connected to bot');
  };
  ws.onclose = () => {
    ready = false;
    console.log('Not connected to bot, retrying in 5s');
    setTimeout(connect, 5000);
  };
  ws.onerror = () => {}; // onclose handles the retry
}

function decode(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/```/g, '')
    .replace(/\r/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseLog(raw) {
  return decode(raw)
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(b => b.startsWith('Time:') && b.includes('Map:'));
}

function keyOf(block) {
  const time = (block.match(/^Time:.*$/m) || [''])[0];
  const map = (block.match(/^Map:.*$/m) || [''])[0];
  return `${time}|${map}`;
}

async function poll() {
  if (!ready) return; // don't mark games seen while the bot isn't listening

  let raw;
  try {
    raw = await (await fetch(LOG_URL)).text();
  } catch (e) {
    console.log('Fetch failed:', e.message);
    return;
  }

  // Log is newest-first; send oldest-first
  for (const block of parseLog(raw).reverse()) {
    const key = keyOf(block);
    if (seen.includes(key)) continue;
    seen.push(key);
    if (!priming) {
      // No newline before the closing fence — the bot's regex requires it this way
      ws.send(JSON.stringify({ data: '```\n' + block + '```' }));
    }
  }

  if (priming) console.log('Feeder ready, watching for new games');
  priming = false;
  seen = seen.slice(-1000);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen));
}

connect();
setInterval(poll, POLL_MS);
