import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { SOURCE_ORDER, config, type SourceId } from './config.ts';
import { getJournal } from './db.ts';
import { buildSourceDetail, buildSummary } from './summary.ts';
import { isSyncRunning, logReports, runSync, startScheduler } from './sync.ts';

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function serveStatic(
  response: import('node:http').ServerResponse,
  pathname: string,
): Promise<void> {
  // normalize + отсечение ".." — чтобы из статики нельзя было выйти за пределы public.
  const relative = normalize(pathname === '/' ? 'index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, relative);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    });
    response.end(file);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Не найдено');
  }
}

/** Год из строки запроса; null — если передана ерунда. */
function parseYear(url: URL): number | null {
  const raw = url.searchParams.get('year');
  if (!raw) return config.year;
  const year = Number.parseInt(raw, 10);
  return Number.isFinite(year) && year > 1970 && year < 3000 ? year : null;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/summary') {
    const year = parseYear(url);
    if (year === null) {
      sendJson(response, 400, { error: 'год указан неверно' });
      return;
    }
    sendJson(response, 200, buildSummary(year));
    return;
  }

  if (url.pathname === '/api/journal') {
    const year = parseYear(url);
    if (year === null) {
      sendJson(response, 400, { error: 'год указан неверно' });
      return;
    }
    const source = url.searchParams.get('source');
    if (source && !SOURCE_ORDER.includes(source as SourceId)) {
      sendJson(response, 404, { error: 'неизвестный источник' });
      return;
    }
    sendJson(response, 200, {
      year,
      days: getJournal(year, (source as SourceId) ?? undefined),
    });
    return;
  }

  if (url.pathname === '/api/source') {
    const year = parseYear(url);
    const id = url.searchParams.get('id');
    if (year === null) {
      sendJson(response, 400, { error: 'год указан неверно' });
      return;
    }
    if (!id || !SOURCE_ORDER.includes(id as SourceId)) {
      sendJson(response, 404, { error: 'неизвестный источник' });
      return;
    }
    const detail = buildSourceDetail(id as SourceId, year);
    if (!detail) {
      sendJson(response, 404, { error: 'нет данных по источнику' });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (url.pathname === '/api/sync' && request.method === 'POST') {
    const already = isSyncRunning();
    runSync().then(
      (reports) => logReports(already ? 'присоединился к текущей' : 'по запросу', reports),
      (error) => console.error('[sync] ошибка:', error),
    );
    sendJson(response, 202, { started: true, alreadyRunning: already });
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, year: config.year, syncing: isSyncRunning() });
    return;
  }

  if (request.method !== 'GET') {
    response.writeHead(405).end('Method Not Allowed');
    return;
  }

  void serveStatic(response, url.pathname);
});

server.listen(config.port, () => {
  console.log(`[yearscope] http://localhost:${config.port} — сводка за ${config.year} год`);

  if (config.syncOnBoot) {
    runSync().then(
      (reports) => logReports('старт', reports),
      (error) => console.error('[sync] ошибка на старте:', error),
    );
  }
  startScheduler();
});
