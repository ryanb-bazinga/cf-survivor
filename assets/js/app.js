/* ==========================================================================
   CF Survivor League
   Everything on this page renders from data/config.json and
   data/season<NN>.json. Adding a season means adding a JSON file.
   Turning a section on or off means flipping a flag in config.json.
   ========================================================================== */

const state = {
  config: null,
  season: null,
  archives: [],
  sort: { key: 'rank', dir: 1 },
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  return name
    .replace(/["']/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/* Deterministic hue per castaway so the name cards look intentional
   rather than random, and stay put between builds. */
function hueFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return hash;
}

function tribeColor(tribeName) {
  const tribe = (state.season.tribes || []).find((t) => t.name === tribeName);
  return tribe ? tribe.color : null;
}

/* ------------------------------------------------------------- loading --- */

async function loadJSON(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

async function boot() {
  try {
    state.config = await loadJSON('data/config.json');
    state.season = await loadJSON(`data/season${state.config.currentSeason}.json`);

    const archiveIds = state.config.archiveSeasons || [];
    const archives = await Promise.all(
      archiveIds.map((id) =>
        loadJSON(`data/season${id}.json`).catch(() => null)
      )
    );
    state.archives = archives.filter(Boolean);
  } catch (error) {
    document.body.innerHTML =
      '<div class="empty" style="margin:80px auto;max-width:520px">' +
      '<h3>Could not load the league data</h3>' +
      '<p>Try refreshing. If it keeps happening, let Ryan know.</p></div>';
    console.error(error);
    return;
  }

  renderHero();
  renderNav();
  renderStandings();
  renderDraftBoard();
  renderCast();
  renderRules();
  renderPastSeasons();
  renderFooter();
  startCountdown();
}

/* ---------------------------------------------------------------- hero --- */

function renderHero() {
  const { site } = state.config;
  const season = state.season;

  $('#hero-org').textContent = site.org;
  $('#hero-title').innerHTML = `Survivor <em>${season.season}</em> League`;
  $('#hero-sub').textContent = season.subtitle || site.tagline;
  document.title = `${site.title} · Survivor ${season.season}`;
}

/* ----------------------------------------------------------- countdown --- */

function nextEpisode() {
  const cfg = state.config.seasons[String(state.season.season)] || {};
  const schedule = cfg.episodes || {};
  const now = new Date();

  const upcoming = Object.entries(schedule)
    .filter(([, meta]) => meta.airs)
    .map(([number, meta]) => {
      // Episodes air 8pm Pacific. Stored as a date, resolved here.
      const airs = new Date(`${meta.airs}T20:00:00-07:00`);
      return { number: Number(number), airs, title: meta.title || '' };
    })
    .sort((a, b) => a.airs - b.airs)
    .find((episode) => episode.airs.getTime() + 60 * 60 * 1000 > now.getTime());

  return upcoming || null;
}

function startCountdown() {
  const box = $('#countdown');
  if (!state.config.features.countdown) {
    box.hidden = true;
    return;
  }

  const tick = () => {
    const episode = nextEpisode();
    if (!episode) {
      box.hidden = true;
      return;
    }

    const diff = episode.airs.getTime() - Date.now();
    const label = $('#countdown-label');

    if (diff <= 0) {
      box.classList.add('countdown--live');
      label.textContent = `Episode ${episode.number} is on right now`;
      $('#countdown-units').hidden = true;
      return;
    }

    box.classList.remove('countdown--live');
    $('#countdown-units').hidden = false;
    label.textContent = `Episode ${episode.number}${
      episode.title ? ` · ${episode.title}` : ''
    } airs in`;

    const seconds = Math.floor(diff / 1000);
    const parts = {
      days: Math.floor(seconds / 86400),
      hours: Math.floor((seconds % 86400) / 3600),
      mins: Math.floor((seconds % 3600) / 60),
      secs: seconds % 60,
    };

    Object.entries(parts).forEach(([key, value]) => {
      const node = $(`#cd-${key}`);
      if (node) node.textContent = String(value).padStart(2, '0');
    });
  };

  tick();
  setInterval(tick, 1000);
}

/* ----------------------------------------------------------------- nav --- */

const PANELS = [
  { id: 'standings', label: 'Standings', flag: 'standings' },
  { id: 'draft', label: 'Draft Board', flag: 'draftBoard' },
  { id: 'cast', label: 'Cast', flag: 'castTracker' },
  { id: 'rules', label: 'Scoring', flag: 'scoringRules' },
  { id: 'history', label: 'Past Seasons', flag: 'pastSeasons' },
];

function renderNav() {
  const nav = $('#nav-inner');
  const available = PANELS.filter((panel) => state.config.features[panel.flag]);

  available.forEach((panel, index) => {
    const button = el('button', null, panel.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.dataset.panel = panel.id;
    button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    button.addEventListener('click', () => selectPanel(panel.id));
    nav.appendChild(button);
  });

  PANELS.forEach((panel) => {
    const node = document.getElementById(`panel-${panel.id}`);
    if (!node) return;
    if (!state.config.features[panel.flag]) node.remove();
  });

  if (available.length) selectPanel(available[0].id);
}

function selectPanel(id) {
  $$('#nav-inner button').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.panel === id));
  });
  $$('.panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `panel-${id}`);
  });
}

/* ----------------------------------------------------------- standings --- */

function castawayByName(name) {
  return state.season.castaways.find((c) => c.name === name);
}

function pickChip(name) {
  const castaway = castawayByName(name);
  const chip = el('span', 'pick', name);
  if (castaway) {
    if (castaway.winner) chip.classList.add('pick--winner');
    else if (castaway.status === 'OUT') {
      chip.classList.add('pick--out');
      chip.title = `Voted out in Episode ${castaway.out_episode}`;
    }
  }
  return chip;
}

function scoredEpisodes() {
  return state.season.episodes.filter((episode) => episode.scored);
}

function renderStandings() {
  const panel = $('#panel-standings');
  if (!panel) return;
  const body = $('#standings-body', panel);
  const players = state.season.players;

  const cfg = state.config.seasons[String(state.season.season)] || {};

  if (!players.length) {
    body.innerHTML = '';
    $('#standings-table-wrap').hidden = true;
    const empty = el('div', 'empty');
    empty.appendChild(el('h3', null, 'Draft is still open'));
    empty.appendChild(
      el(
        'p',
        null,
        cfg.draftNote ||
          'Standings appear here once picks are locked in.'
      )
    );
    $('#standings-empty').replaceChildren(empty);
    return;
  }

  $('#standings-empty').replaceChildren();
  $('#standings-table-wrap').hidden = false;

  const episodes = scoredEpisodes();
  const head = $('#standings-head');
  head.replaceChildren();

  const columns = [
    { key: 'rank', label: '#', sortable: true },
    { key: 'name', label: 'Player', sortable: true },
    { key: 'total', label: 'Score', sortable: true, numeric: true },
    { key: 'picks', label: 'Draft Picks', sortable: false },
  ];

  episodes.forEach((episode) => {
    columns.push({
      key: episode.label,
      label: episode.label,
      sortable: true,
      numeric: true,
      episode: true,
    });
  });

  const headRow = el('tr');
  columns.forEach((column) => {
    const th = el('th', column.sortable ? 'sortable' : null, column.label);
    if (column.numeric) th.classList.add('col-num');
    if (column.sortable) {
      th.addEventListener('click', () => {
        if (state.sort.key === column.key) state.sort.dir *= -1;
        else state.sort = { key: column.key, dir: column.key === 'name' ? 1 : -1 };
        if (column.key === 'rank') state.sort.dir = Math.abs(state.sort.dir);
        renderStandingsRows(columns);
        markSort(columns);
      });
    }
    headRow.appendChild(th);
  });
  head.appendChild(headRow);

  renderStandingsRows(columns);
  markSort(columns);

  $('#standings-note').textContent = episodes.length
    ? `Through Episode ${episodes[episodes.length - 1].number} · ${players.length} players`
    : `${players.length} players · no episodes scored yet`;
}

function markSort(columns) {
  $$('#standings-head th').forEach((th, index) => {
    th.removeAttribute('aria-sort');
    const column = columns[index];
    if (column && column.key === state.sort.key) {
      th.setAttribute('aria-sort', state.sort.dir > 0 ? 'ascending' : 'descending');
    }
  });
}

function sortedPlayers() {
  const { key, dir } = state.sort;
  const players = [...state.season.players];

  players.sort((a, b) => {
    let left;
    let right;
    if (key === 'rank') { left = a.rank; right = b.rank; }
    else if (key === 'name') { left = a.name.toLowerCase(); right = b.name.toLowerCase(); }
    else if (key === 'total') { left = a.total; right = b.total; }
    else { left = a.episodes[key] || 0; right = b.episodes[key] || 0; }

    if (left < right) return -1 * dir;
    if (left > right) return 1 * dir;
    return a.name.localeCompare(b.name);
  });

  return players;
}

function movementNode(player) {
  const move = player.movement || 0;
  if (!scoredEpisodes().length) return null;
  if (move > 0) return el('span', 'move move--up', `▲${move}`);
  if (move < 0) return el('span', 'move move--down', `▼${Math.abs(move)}`);
  return el('span', 'move move--flat', '–');
}

function renderStandingsRows(columns) {
  const body = $('#standings-body');
  body.replaceChildren();

  sortedPlayers().forEach((player) => {
    const row = el('tr');

    const rankCell = el('td', `rank rank--${player.rank}`);
    rankCell.appendChild(document.createTextNode(String(player.rank)));
    const move = movementNode(player);
    if (move) rankCell.appendChild(move);
    row.appendChild(rankCell);

    row.appendChild(el('td', 'player-name', player.name));

    const scoreCell = el('td', 'col-num');
    scoreCell.appendChild(el('span', 'score', String(player.total)));
    row.appendChild(scoreCell);

    const picksCell = el('td');
    const picks = el('div', 'picks');
    player.picks.forEach((pick) => picks.appendChild(pickChip(pick)));
    picksCell.appendChild(picks);
    row.appendChild(picksCell);

    columns
      .filter((column) => column.episode)
      .forEach((column) => {
        const points = player.episodes[column.key] || 0;
        let className = 'col-num ep-cell';
        if (points > 0) className += ' ep-cell--pos';
        if (points < 0) className += ' ep-cell--neg';
        row.appendChild(el('td', className, points === 0 ? '·' : String(points)));
      });

    body.appendChild(row);
  });
}

/* --------------------------------------------------------- draft board --- */

function renderDraftBoard() {
  const panel = $('#panel-draft');
  if (!panel) return;
  const players = state.season.players;
  const cfg = state.config.seasons[String(state.season.season)] || {};

  if (!players.length) {
    panel.querySelector('.panel__body').replaceChildren(
      (() => {
        const empty = el('div', 'empty');
        empty.appendChild(el('h3', null, 'No picks yet'));
        empty.appendChild(
          el('p', null, cfg.draftNote || 'The draft board fills in once picks are locked.')
        );
        return empty;
      })()
    );
    return;
  }

  const body = panel.querySelector('.panel__body');
  body.replaceChildren();

  const ownership = el('div', 'card');
  ownership.appendChild(el('h3', null, 'Most drafted'));
  ownership.appendChild(
    el('p', 'panel__note', 'How many people have each castaway on their team.')
  );

  const owned = [...state.season.castaways]
    .filter((castaway) => castaway.drafted_by.length)
    .sort((a, b) => b.drafted_by.length - a.drafted_by.length || a.name.localeCompare(b.name));

  const max = owned.length ? owned[0].drafted_by.length : 1;

  owned.forEach((castaway) => {
    const row = el('div', 'ownership');
    const name = el('div', 'ownership__name', castaway.name);
    if (castaway.status === 'OUT') name.style.opacity = '0.55';
    row.appendChild(name);
    const bar = el('div', 'ownership__bar');
    const fill = el('div', 'ownership__fill');
    fill.style.width = `${(castaway.drafted_by.length / max) * 100}%`;
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el('div', 'ownership__count', String(castaway.drafted_by.length)));
    ownership.appendChild(row);
  });

  body.appendChild(ownership);

  const grid = el('div', 'grid draft-grid');
  grid.style.marginTop = '18px';

  [...players]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const card = el('div', 'card');
      card.appendChild(el('div', 'draft-card__name', player.name));
      const picks = el('div', 'picks');
      player.picks.forEach((pick) => picks.appendChild(pickChip(pick)));
      card.appendChild(picks);
      grid.appendChild(card);
    });

  body.appendChild(grid);
}

/* ---------------------------------------------------------------- cast --- */

function renderCast() {
  const panel = $('#panel-cast');
  if (!panel) return;
  const grid = $('#cast-grid', panel);
  grid.replaceChildren();

  const cast = [...state.season.castaways].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'IN' ? -1 : 1;
    if (b.points !== a.points) return b.points - a.points;
    return a.name.localeCompare(b.name);
  });

  cast.forEach((castaway) => {
    const card = el('div', 'card castaway');
    if (castaway.status === 'OUT') card.classList.add('castaway--out');

    const avatar = el('div', 'castaway__avatar', initials(castaway.name));
    const color = tribeColor(castaway.tribe);
    avatar.style.background = color || `hsl(${hueFor(castaway.name)} 34% 62%)`;
    card.appendChild(avatar);

    card.appendChild(el('div', 'castaway__pts', String(castaway.points)));
    card.appendChild(el('h3', 'castaway__name', castaway.name));

    const meta = el('div', 'castaway__meta');
    if (castaway.tribe) {
      const dot = el('span', 'tribe-dot');
      if (color) dot.style.background = color;
      meta.appendChild(dot);
      meta.appendChild(el('span', null, castaway.tribe));
    }
    if (castaway.winner) meta.appendChild(el('span', 'chip chip--winner', 'Sole Survivor'));
    else if (castaway.status === 'OUT') {
      meta.appendChild(el('span', 'chip chip--out', `Out E${castaway.out_episode}`));
    } else {
      meta.appendChild(el('span', 'chip chip--in', 'Still in'));
    }
    card.appendChild(meta);

    if (castaway.drafted_by.length) {
      card.appendChild(
        el(
          'div',
          'castaway__owners',
          `Drafted by ${castaway.drafted_by.join(', ')}`
        )
      );
    }

    grid.appendChild(card);
  });

  const remaining = cast.filter((c) => c.status === 'IN').length;
  $('#cast-note').textContent = `${remaining} of ${cast.length} still in the game`;
}

/* --------------------------------------------------------------- rules --- */

function renderRules() {
  const panel = $('#panel-rules');
  if (!panel) return;

  const build = (items, kind) => {
    const column = el('div', 'rules__col');
    column.appendChild(
      el(
        'div',
        `rules__head rules__head--${kind}`,
        kind === 'pos' ? 'Points you want' : 'Points you do not'
      )
    );
    items.forEach((item) => {
      const row = el('div', 'rules__row');
      row.appendChild(el('span', null, item.label));
      row.appendChild(
        el(
          'span',
          `rules__pts rules__pts--${kind}`,
          item.points > 0 ? `+${item.points}` : String(item.points)
        )
      );
      column.appendChild(row);
    });
    return column;
  };

  const wrap = $('#rules-grid');
  wrap.replaceChildren();
  wrap.appendChild(build(state.season.scoring.positive, 'pos'));
  wrap.appendChild(build(state.season.scoring.negative, 'neg'));
}

/* -------------------------------------------------------- past seasons --- */

function renderPastSeasons() {
  const panel = $('#panel-history');
  if (!panel) return;
  const grid = $('#history-grid', panel);
  grid.replaceChildren();

  if (!state.archives.length) {
    grid.appendChild(
      (() => {
        const empty = el('div', 'empty');
        empty.appendChild(el('h3', null, 'No archived seasons yet'));
        return empty;
      })()
    );
    return;
  }

  state.archives.forEach((season) => {
    const card = el('div', 'card season-card');
    const top = season.players.slice(0, 5);

    card.appendChild(el('h3', null, season.name));
    if (season.subtitle) card.appendChild(el('p', 'panel__note', season.subtitle));

    if (top.length) {
      card.appendChild(el('div', 'season-card__crown', 'Champion'));
      card.appendChild(el('div', 'season-card__champ', top[0].name));
      card.appendChild(el('div', 'season-card__score', `${top[0].total} points`));

      const list = el('div', 'season-card__list');
      top.slice(1).forEach((player) => {
        list.appendChild(
          el('div', null, `${player.rank}. ${player.name} · ${player.total}`)
        );
      });
      card.appendChild(list);
    } else {
      card.appendChild(el('p', 'panel__note', 'No standings recorded.'));
    }

    grid.appendChild(card);
  });
}

/* -------------------------------------------------------------- footer --- */

function renderFooter() {
  const season = state.season;
  $('#footer-meta').textContent =
    `Standings generated ${season.generated} from ${season.source_workbook}`;
  $('#footer-org').textContent =
    `${state.config.site.org} · ${state.config.site.tagline}`;
}

document.addEventListener('DOMContentLoaded', boot);
