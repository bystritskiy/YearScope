const MONTH_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const el = {
  subtitle: document.getElementById('subtitle'),
  stamp: document.getElementById('stamp'),
  sync: document.getElementById('sync'),
  total: document.getElementById('total'),
  totalHours: document.getElementById('total-hours'),
  totalMeta: document.getElementById('total-meta'),
  totalBar: document.getElementById('total-bar'),
  cards: document.getElementById('cards'),
  chartPanel: document.getElementById('chart-panel'),
  chart: document.getElementById('chart'),
  gapsPanel: document.getElementById('gaps-panel'),
  gaps: document.getElementById('gaps'),
};

const hours = (seconds) => seconds / 3600;

/** «1 час», «2 часа», «5 часов» — иначе цифры читаются как машинный вывод. */
function pluralHours(value) {
  const rounded = Math.round(value);
  const mod10 = rounded % 10;
  const mod100 = rounded % 100;
  if (mod10 === 1 && mod100 !== 11) return 'час';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'часа';
  return 'часов';
}

function formatHours(seconds) {
  const value = hours(seconds);
  if (value === 0) return '0';
  if (value < 10) return value.toFixed(1);
  return String(Math.round(value));
}

/** 293917 сек → «81 ч 38 мин»: для точных подписей, где округление до часов теряет смысл. */
function formatExact(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDay(iso) {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderTotal(data) {
  const active = data.sources.filter((source) => source.seconds > 0);

  el.total.hidden = false;
  el.totalHours.textContent = formatHours(data.totalSeconds);
  el.total.querySelector('.total__unit').textContent =
    `${pluralHours(hours(data.totalSeconds))} за ${data.year} год`;

  const days = (data.totalSeconds / 86400).toFixed(1);
  el.totalMeta.textContent =
    active.length > 0
      ? `${formatExact(data.totalSeconds)} — это ${days} суток непрерывно, по ${active.length} активностям`
      : 'данных пока нет';

  el.totalBar.replaceChildren(
    ...active.map((source) => {
      const segment = node('div', 'bar__seg');
      segment.style.background = source.accent;
      segment.style.flexGrow = String(source.seconds);
      segment.title = `${source.label}: ${formatExact(source.seconds)}`;
      return segment;
    }),
  );
}

function renderCard(source) {
  const card = node('article', 'card');
  card.style.setProperty('--accent', source.accent);
  if (source.seconds === 0) card.classList.add('card--empty');

  const head = node('div', 'card__head');
  head.append(node('span', 'card__icon', source.icon), node('span', 'card__label', source.label));
  card.append(head);

  const value = node('div', 'card__hours');
  value.append(document.createTextNode(formatHours(source.seconds)));
  value.append(node('small', null, pluralHours(hours(source.seconds))));
  card.append(value);

  if (!source.configured) {
    card.append(node('div', 'card__note', 'источник ещё не подключён'));
    return card;
  }

  if (source.status === 'error') {
    card.append(node('div', 'card__note card__note--error', `ошибка: ${source.message ?? '—'}`));
    return card;
  }

  card.append(node('div', 'card__share', `${Math.round(source.share * 100)}% времени`));

  if (source.highlights.length > 0) {
    const list = node('ul', 'card__top');
    for (const item of source.highlights.slice(0, 4)) {
      const row = document.createElement('li');
      row.append(node('span', null, item.title), node('span', null, formatExact(item.seconds)));
      row.title = item.subtitle ? `${item.title} — ${item.subtitle}` : item.title;
      list.append(row);
    }
    card.append(list);
  }

  return card;
}

function renderChart(data) {
  const max = Math.max(...data.months.map((month) => month.total), 1);
  const byId = new Map(data.sources.map((source) => [source.id, source]));

  el.chartPanel.hidden = data.totalSeconds === 0;
  el.chart.replaceChildren(
    ...data.months.map((month, index) => {
      const column = node('div', 'col');
      if (month.total === 0) column.classList.add('col--empty');

      column.append(node('div', 'col__value', month.total > 0 ? formatHours(month.total) : ''));

      const stack = node('div', 'col__stack');
      // Высота столбца — доля от самого нагруженного месяца; 150px под самый высокий.
      stack.style.height = `${Math.max((month.total / max) * 150, month.total > 0 ? 3 : 2)}px`;

      for (const [sourceId, seconds] of Object.entries(month.bySource)) {
        if (seconds <= 0) continue;
        const segment = node('div', 'col__seg');
        segment.style.background = byId.get(sourceId)?.accent ?? '#555';
        segment.style.height = `${(seconds / month.total) * 100}%`;
        segment.title = `${byId.get(sourceId)?.label ?? sourceId}: ${formatExact(seconds)}`;
        stack.append(segment);
      }

      column.append(stack, node('div', 'col__label', MONTH_LABELS[index]));
      column.title = month.total > 0 ? `${MONTH_LABELS[index]}: ${formatExact(month.total)}` : '';
      return column;
    }),
  );
}

/**
 * Честность про данные важнее красивой цифры: если источник знает только
 * половину года, это должно быть написано рядом с итогом, а не подразумеваться.
 */
function renderGaps(data) {
  const notes = [];

  for (const source of data.sources) {
    if (!source.configured) {
      notes.push({ level: 'warn', label: source.label, text: 'источник ещё не подключён — время не учтено в сумме' });
      continue;
    }
    if (source.status === 'error') {
      notes.push({ level: 'error', label: source.label, text: `последняя синхронизация не удалась: ${source.message ?? '—'}` });
      continue;
    }
    if (source.status === 'never') {
      notes.push({ level: 'warn', label: source.label, text: 'ещё ни разу не синхронизировался' });
      continue;
    }
    if (source.coversFrom && source.coversFrom > `${data.year}-01-02`) {
      notes.push({
        level: 'warn',
        label: source.label,
        text: `данные есть только с ${formatDay(source.coversFrom)} — раньше источник не вёл учёт`,
      });
    }
  }

  el.gapsPanel.hidden = notes.length === 0;
  el.gaps.replaceChildren(
    ...notes.map((note) => {
      const row = document.createElement('li');
      row.append(node('span', `gaps__mark${note.level === 'error' ? ' gaps__mark--error' : ''}`, '●'));
      const body = document.createElement('span');
      body.append(node('b', null, note.label), document.createTextNode(` — ${note.text}`));
      row.append(body);
      return row;
    }),
  );
}

async function load() {
  const response = await fetch('/api/summary');
  if (!response.ok) throw new Error(`сервер ответил ${response.status}`);
  const data = await response.json();

  document.title = `YearScope ${data.year} — ${formatHours(data.totalSeconds)} ч`;
  el.subtitle.textContent = `сколько времени ушло на активности в ${data.year} году`;
  el.stamp.textContent = `обновлено ${formatDate(data.generatedAt) ?? ''}`;

  renderTotal(data);
  el.cards.replaceChildren(...data.sources.map(renderCard));
  renderChart(data);
  renderGaps(data);
}

el.sync.addEventListener('click', async () => {
  el.sync.disabled = true;
  el.sync.textContent = 'Обновляю…';
  try {
    await fetch('/api/sync', { method: 'POST' });
    // Синхронизация асинхронная: ждём, пока сервер отметит её завершённой.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const health = await fetch('/api/health').then((response) => response.json());
      if (!health.syncing) break;
    }
    await load();
  } catch (error) {
    el.subtitle.textContent = `не удалось обновить: ${error.message}`;
  } finally {
    el.sync.disabled = false;
    el.sync.textContent = 'Обновить';
  }
});

load().catch((error) => {
  el.subtitle.textContent = `не удалось загрузить: ${error.message}`;
});
