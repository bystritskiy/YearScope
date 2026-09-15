const MONTH_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const el = {
  subtitle: document.getElementById('subtitle'),
  sync: document.getElementById('sync'),
  exportRoot: document.getElementById('export'),
  exportToggle: document.getElementById('export-toggle'),
  exportMenu: document.getElementById('export-menu'),
  tabs: document.getElementById('tabs'),
  sourceNav: document.getElementById('source-nav'),
  pageTitle: document.getElementById('page-title'),
  total: document.getElementById('total'),
  totalHours: document.getElementById('total-hours'),
  totalMeta: document.getElementById('total-meta'),
  totalBar: document.getElementById('total-bar'),
  cards: document.getElementById('cards'),
  chartPanel: document.getElementById('chart-panel'),
  chart: document.getElementById('chart'),
  chartLegend: document.getElementById('chart-legend'),
  journalFilters: document.getElementById('journal-filters'),
  journalFeed: document.getElementById('journal-feed'),
  sourceBack: document.getElementById('source-back'),
  sourceHead: document.getElementById('source-head'),
  sourceRanking: document.getElementById('source-ranking'),
  sourceFeed: document.getElementById('source-feed'),
  rankingTitle: document.getElementById('ranking-title'),
  footerTotal: document.getElementById('footer-total'),
  footerVersion: document.getElementById('footer-version'),
  footerSync: document.getElementById('footer-sync'),
  toTop: document.getElementById('to-top'),
  views: {
    summary: document.getElementById('view-summary'),
    journal: document.getElementById('view-journal'),
    source: document.getElementById('view-source'),
  },
};

/** Последняя загруженная сводка: из неё берутся иконки и цвета для ленты. */
let summaryData = null;
let journalFilter = null;
/** Текущий экран, чтобы роутер по хешу не дёргал fetch по кругу. */
let currentView = 'summary';
let currentSource = null;
/** Базовый заголовок вкладки («YearScope 2026: 692 ч»), экраны его дополняют. */
let baseTitle = 'YearScope';

const hours = (seconds) => seconds / 3600;

/** «1 час», «2 часа», «5 часов»: иначе цифры читаются как машинный вывод. */
function pluralHours(value) {
  // Дробные («1,4 часа») всегда идут в родительном единственного, целые по классическому правилу.
  if (!Number.isInteger(Math.round(value * 10) / 10)) return 'часа';
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

/** 293917 сек → «81 ч 38 мин»: для подписей, где округление до часов теряет смысл. */
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

function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { weekday: 'long' });
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const metaOf = (sourceId) =>
  summaryData?.sources.find((source) => source.id === sourceId) ?? {
    icon: '•',
    label: sourceId,
    accent: '#555',
  };

/* --- переключение экранов --- */

function updateTabs() {
  // Вкладка «Сводка» остаётся подсвеченной на экране источника: он её продолжение.
  const activeTab = currentView === 'journal' ? 'journal' : 'summary';
  for (const tab of el.tabs.querySelectorAll('.tab')) {
    const isSource = tab.dataset.source !== undefined;
    tab.classList.toggle(
      'tab--active',
      isSource ? tab.dataset.source === currentSource : tab.dataset.view === activeTab,
    );
  }
}

/** Экраны живут в хеше (#/summary, #/journal, #/source/myshows): работают кнопки
 *  браузера «назад/вперёд», а ссылкой можно поделиться. */
function showView(name, sourceId = null) {
  currentView = name;
  currentSource = sourceId;
  for (const [key, view] of Object.entries(el.views)) view.hidden = key !== name;
  updateTabs();

  if (name !== 'source') {
    el.pageTitle.textContent = name === 'journal' ? 'Журнал' : 'Сводка';
    document.title = baseTitle;
  }

  const hash =
    name === 'source' && sourceId
      ? `#/source/${sourceId}`
      : name === 'journal'
        ? '#/journal'
        : '#/summary';
  if (location.hash !== hash) location.hash = hash;
  window.scrollTo({ top: 0 });
}

function route() {
  const hash = location.hash || '#/summary';
  const match = hash.match(/^#\/source\/([\w-]+)$/);
  if (match) {
    if (currentView !== 'source' || currentSource !== match[1]) openSource(match[1]);
  } else if (hash === '#/journal') {
    if (currentView !== 'journal') {
      showView('journal');
      if (el.journalFeed.childElementCount === 0) loadJournal();
    }
  } else if (hash === '#/summary' || hash === '') {
    if (currentView !== 'summary') showView('summary');
  }
  // Остальное (например, #top у кнопки «Наверх») это обычные якоря, не экраны.
}

window.addEventListener('hashchange', route);

/* --- сводка --- */

function renderTotal(data) {
  const active = data.sources.filter((source) => source.seconds > 0);

  el.total.hidden = false;
  el.totalHours.textContent = formatHours(data.totalSeconds);
  el.total.querySelector('.total__unit').textContent =
    `${pluralHours(hours(data.totalSeconds))} за ${data.year} год`;

  const days = (data.totalSeconds / 86400).toFixed(1);
  el.totalMeta.textContent =
    active.length > 0
      ? `${formatExact(data.totalSeconds)}, это ${days} суток непрерывно, по ${active.length} активностям`
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
  el.totalBar.setAttribute('role', 'img');
  el.totalBar.setAttribute(
    'aria-label',
    `доли активностей: ${active.map((source) => `${source.label} ${Math.round(source.share * 100)}%`).join(', ')}`,
  );
}

function renderCard(source, index = 0) {
  const card = node('article', 'card');
  card.style.setProperty('--accent', source.accent);
  // Каскад появления это единственный авторский момент движения: список собирается сверху вниз.
  card.style.animationDelay = `${Math.min(index * 60, 300)}ms`;
  if (source.seconds === 0) card.classList.add('card--empty');

  // Кликабельны только карточки, внутри которых есть что показать.
  if (source.seconds > 0) {
    card.classList.add('card--link');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${source.label}: ${formatExact(source.seconds)}, открыть всё за год`);
    card.title = `${source.label}: открыть всё за год`;
    const open = () => openSource(source.id);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  }

  const head = node('div', 'card__head');
  const icon = node('span', 'card__icon', source.icon);
  icon.setAttribute('aria-hidden', 'true');
  head.append(icon, node('span', 'card__label', source.label));
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
    card.append(node('div', 'card__note card__note--error', `ошибка: ${source.message ?? 'без описания'}`));
    return card;
  }

  card.append(node('div', 'card__share', `${Math.round(source.share * 100)}% времени`));

  if (source.highlights.length > 0) {
    const list = node('ul', 'card__top');
    for (const item of source.highlights.slice(0, 4)) {
      const row = document.createElement('li');
      row.append(node('span', null, item.title), node('span', null, formatExact(item.seconds)));
      row.title = item.subtitle ? `${item.title}, ${item.subtitle}` : item.title;
      list.append(row);
    }
    card.append(list);
  }

  // Честность про данные важнее красивой цифры: если источник знает только
  // половину года, это написано прямо на карточке, а не подразумевается.
  const caveat =
    source.coversFrom && source.coversFrom > `${summaryData?.year ?? source.coversFrom.slice(0, 4)}-01-02`
      ? `только с ${formatDay(source.coversFrom)}`
      : source.warning;
  if (caveat) card.append(node('div', 'card__note', caveat));

  // Постоянный affordance: кликабельность видна без ховера и тултипа.
  if (source.seconds > 0) card.append(node('div', 'card__more', 'Открыть всё за год →'));

  return card;
}

function renderChart(data) {
  const max = Math.max(...data.months.map((month) => month.total), 1);
  const byId = new Map(data.sources.map((source) => [source.id, source]));

  el.chartPanel.hidden = data.totalSeconds === 0;
  el.chartLegend.replaceChildren(
    ...data.sources
      .filter((source) => source.seconds > 0)
      .map((source) => {
        const item = node('span', 'legend__item', source.label);
        const dot = node('span', 'legend__dot');
        dot.style.background = source.accent;
        dot.setAttribute('aria-hidden', 'true');
        item.prepend(dot);
        return item;
      }),
  );
  el.chart.replaceChildren(
    ...data.months.map((month, index) => {
      const column = node('div', 'col');
      if (month.total === 0) column.classList.add('col--empty');

      column.append(node('div', 'col__value', month.total > 0 ? formatHours(month.total) : ''));

      const stack = node('div', 'col__stack');
      // Высота столбца это доля от самого нагруженного месяца; 150px под самый высокий.
      stack.style.height = `${Math.max((month.total / max) * 150, month.total > 0 ? 3 : 4)}px`;

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
      // Столбец читается без ховера: роль, подпись и легенда выше заменяют одни тултипы.
      const parts = Object.entries(month.bySource)
        .filter(([, seconds]) => seconds > 0)
        .map(([sourceId, seconds]) => `${byId.get(sourceId)?.label ?? sourceId} ${formatExact(seconds)}`);
      column.setAttribute('role', 'img');
      column.setAttribute(
        'aria-label',
        month.total > 0
          ? `${MONTH_LABELS[index]}: ${formatExact(month.total)}, из них ${parts.join(', ')}`
          : `${MONTH_LABELS[index]}: нет данных`,
      );
      return column;
    }),
  );
}

/* --- лента --- */

/** Заголовок события: действие + имя; в подзаголовке контекст (сериал, площадка, год). */
function eventCopy(item) {
  if (item.kind === 'day') {
    return { title: `${metaOf(item.source).label} за день`, subtitle: item.subtitle };
  }

  switch (item.source) {
    case 'myshows':
      // title это серия, subtitle это название сериала
      return {
        title: item.title ? `Смотрел серию «${item.title}»` : 'Смотрел серию',
        subtitle: item.subtitle ? `Сериал ${item.subtitle}` : null,
      };
    case 'gowithme':
      return {
        title: `Играл в «${item.title}»`,
        subtitle: item.subtitle ? `Платформа ${item.subtitle}` : null,
      };
    case 'letterboxd':
      return {
        title: `Смотрел фильм «${item.title}»`,
        // Год оставляем как есть, пока режиссёр ещё не подтянут из TMDB.
        subtitle: item.subtitle
          ? /^\d{4}$/.test(item.subtitle)
            ? item.subtitle
            : `Режиссёр ${item.subtitle}`
          : null,
      };
    case 'koshelf':
      return {
        title: `Читал «${item.title}»`,
        subtitle: item.subtitle ? `Автор ${item.subtitle}` : null,
      };
    case 'intervals':
      return { title: item.title, subtitle: item.subtitle };
    default:
      return { title: item.title, subtitle: item.subtitle };
  }
}

function renderEvent(item) {
  const meta = metaOf(item.source);
  const copy = eventCopy(item);
  const row = node('div', `event${item.kind === 'day' ? ' event--day' : ''}`);

  const eventIcon = node('span', 'event__icon', meta.icon);
  eventIcon.setAttribute('aria-hidden', 'true');
  row.append(eventIcon);

  const body = node('div', 'event__body');
  body.append(node('div', 'event__title', copy.title));
  if (copy.subtitle) body.append(node('div', 'event__sub', copy.subtitle));
  row.append(body);

  const time = node('span', 'event__time', formatExact(item.seconds));
  if (item.estimated) time.title = 'время посчитано оценкой';
  row.append(time);

  return row;
}

function renderFeed(container, days) {
  if (days.length === 0) {
    container.replaceChildren(node('div', 'feed__empty', 'за этот год событий нет'));
    return;
  }

  container.replaceChildren(
    ...days.map((day) => {
      const block = node('div', 'day');

      const head = node('div', 'day__head');
      const date = node('div', 'day__date', formatDay(day.day));
      date.append(node('span', 'day__weekday', weekdayOf(day.day)));
      head.append(date, node('div', 'day__total', formatExact(day.total)));
      block.append(head);

      const items = node('div', 'day__items');
      items.append(...day.items.map(renderEvent));
      block.append(items);

      return block;
    }),
  );
}

function renderJournalFilters() {
  const chips = [{ id: null, label: 'Всё', accent: '#2a3240' }];
  for (const source of summaryData?.sources ?? []) {
    if (source.seconds > 0) chips.push({ id: source.id, label: source.label, accent: source.accent });
  }

  el.journalFilters.replaceChildren(
    ...chips.map((chip) => {
      const button = node('button', 'chip', chip.label);
      button.type = 'button';
      button.style.setProperty('--chip-accent', chip.accent);
      if (chip.id === journalFilter) button.classList.add('chip--active');
      button.addEventListener('click', () => {
        journalFilter = chip.id;
        renderJournalFilters();
        loadJournal();
      });
      return button;
    }),
  );
}

async function loadJournal() {
  const query = journalFilter ? `?source=${encodeURIComponent(journalFilter)}` : '';
  const data = await fetch(`/api/journal${query}`).then((response) => response.json());
  renderFeed(el.journalFeed, data.days);
}

/* --- экран одного источника --- */

async function openSource(id) {
  // Состояние ставим сразу, до fetch: иначе обработчик hashchange устроит повторный заход.
  currentView = 'source';
  currentSource = id;
  updateTabs();

  const detail = await fetch(`/api/source?id=${encodeURIComponent(id)}`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if (!detail?.source) {
    showView('summary');
    return;
  }
  const source = detail.source;

  el.sourceHead.style.setProperty('--accent', source.accent);
  const value = node('div', 'detail__hours');
  value.append(document.createTextNode(formatHours(source.seconds)));
  value.append(node('small', null, pluralHours(hours(source.seconds))));

  const activeDays = detail.journal.length;
  const detailLabel = node('div', 'detail__label');
  const detailIcon = node('span', null, source.icon);
  detailIcon.setAttribute('aria-hidden', 'true');
  detailLabel.append(detailIcon, document.createTextNode(` ${source.label}`));
  el.sourceHead.replaceChildren(
    detailLabel,
    value,
    node(
      'div',
      'detail__meta',
      `${formatExact(source.seconds)}, ${Math.round(source.share * 100)}% всего времени · ${activeDays} активных дней`,
    ),
  );

  const max = detail.ranking[0]?.seconds ?? 1;
  el.rankingTitle.textContent = `Всё за год: ${detail.ranking.length}`;
  el.sourceRanking.replaceChildren(
    ...detail.ranking.map((item) => {
      const row = document.createElement('li');
      const title = node('div', 'ranking__title', item.title);
      if (item.subtitle) title.append(node('span', 'ranking__sub', ` · ${item.subtitle}`));
      row.append(title, node('span', 'ranking__time', formatExact(item.seconds)));

      // Полоска показывает вес позиции относительно первой строки.
      const bar = node('div', 'ranking__bar');
      bar.style.width = `${Math.max((item.seconds / max) * 100, 1)}%`;
      bar.style.background = source.accent;
      row.append(bar);
      return row;
    }),
  );

  renderFeed(el.sourceFeed, detail.journal);
  el.pageTitle.textContent = `${source.icon} ${source.label}`;
  document.title = `${baseTitle}: ${source.label}`;
  showView('source', source.id);
}

/* --- шапка: быстрые ссылки на источники --- */

function renderSourceNav() {
  const items = (summaryData?.sources ?? []).filter((source) => source.seconds > 0);
  el.sourceNav.replaceChildren(
    ...items.map((source) => {
      const button = node('button', 'tab tab--source');
      button.type = 'button';
      const dot = node('span', 'tab__dot');
      dot.style.background = source.accent;
      dot.setAttribute('aria-hidden', 'true');
      button.append(dot, document.createTextNode(source.label));
      button.dataset.source = source.id;
      button.title = `${source.label}: открыть всё за год`;
      button.addEventListener('click', () => openSource(source.id));
      return button;
    }),
  );
  updateTabs();
}

/* --- футер --- */

function renderFooter(data) {
  el.footerTotal.textContent =
    data.totalSeconds > 0
      ? `${formatExact(data.totalSeconds)} за ${data.year} год`
      : 'данных пока нет';
  if (el.footerVersion && data.version) el.footerVersion.textContent = `v${data.version}`;
}

/* --- загрузка --- */

async function load() {
  const response = await fetch('/api/summary');
  if (!response.ok) throw new Error(`сервер ответил ${response.status}`);
  summaryData = await response.json();

  const year = summaryData.year;
  for (const link of document.querySelectorAll('[data-export="json"]')) {
    link.href = `/api/export?year=${year}&format=json`;
  }
  for (const link of document.querySelectorAll('[data-export="csv"]')) {
    link.href = `/api/export?year=${year}&format=csv`;
  }

  baseTitle = `YearScope ${year}: ${formatHours(summaryData.totalSeconds)} ч`;
  document.title = baseTitle;
  el.subtitle.textContent = `сколько времени ушло на активности в ${year} году`;

  renderTotal(summaryData);
  el.cards.replaceChildren(...summaryData.sources.map((source, index) => renderCard(source, index)));
  renderChart(summaryData);
  renderJournalFilters();
  renderSourceNav();
  renderFooter(summaryData);
  route();
}

function setExportOpen(open) {
  el.exportMenu.hidden = !open;
  el.exportToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

el.exportToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  setExportOpen(el.exportMenu.hidden);
});

el.exportMenu.addEventListener('click', () => setExportOpen(false));

document.addEventListener('click', (event) => {
  if (!el.exportRoot.contains(event.target)) setExportOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setExportOpen(false);
});

el.tabs.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  showView(tab.dataset.view);
  if (tab.dataset.view === 'journal' && el.journalFeed.childElementCount === 0) loadJournal();
});

el.sourceBack.addEventListener('click', () => {
  // Возврат по истории бережёт контекст (фильтр журнала, скролл); прямой заход ведёт на сводку.
  if (window.history.length > 1) window.history.back();
  else showView('summary');
});

async function doSync(button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Обновляю…';
  try {
    await fetch('/api/sync', { method: 'POST' });
    // Синхронизация асинхронная: ждём, пока сервер отметит её завершённой.
    // Счётчик секунд в кнопке это честный признак жизни вместо чёрного ящика.
    const started = Date.now();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      button.textContent = `Обновляю… ${Math.round((Date.now() - started) / 1000)}с`;
      const health = await fetch('/api/health').then((response) => response.json());
      if (!health.syncing) break;
    }
    await load();
    if (currentView === 'journal') await loadJournal();
    if (currentView === 'source' && currentSource) await openSource(currentSource);
  } catch (error) {
    el.subtitle.textContent = `не удалось обновить: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

el.sync.addEventListener('click', () => doSync(el.sync));
el.footerSync.addEventListener('click', () => doSync(el.footerSync));

const pagehead = document.getElementById('pagehead');
if (pagehead && 'IntersectionObserver' in window) {
  // Кнопка видна, пока заголовок страницы вне вьюпорта, без обработчика на каждый кадр скролла.
  new IntersectionObserver(([entry]) => {
    el.toTop.hidden = entry.isIntersecting;
  }).observe(pagehead);
} else {
  window.addEventListener('scroll', () => {
    el.toTop.hidden = window.scrollY < 600;
  }, { passive: true });
}

el.toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

load().catch((error) => {
  el.subtitle.textContent = `не удалось загрузить: ${error.message}`;
});
