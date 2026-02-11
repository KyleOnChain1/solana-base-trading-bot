import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'bot.log');
const MAX_SIZE = 5 * 1024 * 1024; // 5MB rotation

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotate() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_SIZE) {
      const old = LOG_FILE + '.old';
      if (fs.existsSync(old)) fs.unlinkSync(old);
      fs.renameSync(LOG_FILE, old);
    }
  } catch {}
}

export function log(level: string, ...args: any[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const line = `[${ts}] [${level}] ${msg}\n`;
  
  // Console
  if (level === 'ERROR') console.error(line.trim());
  else console.log(line.trim());
  
  // File
  try {
    rotate();
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

export const logger = {
  info: (...args: any[]) => log('INFO', ...args),
  warn: (...args: any[]) => log('WARN', ...args),
  error: (...args: any[]) => log('ERROR', ...args),
  debug: (...args: any[]) => log('DEBUG', ...args),
  trade: (...args: any[]) => log('TRADE', ...args),
};
