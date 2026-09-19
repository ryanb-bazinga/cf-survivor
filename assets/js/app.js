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
  recaps: { episodes: {} },
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

/* ---------------------------------------------------------- time travel --- */

/**
 * Rewinds a season to the end of a given episode: totals, ranks, movement,
 * castaway status and points are all recomputed from the stored events.
 * Used by the ?through= preview so a mid-season week can be inspected
 * without touching any data files.
 */
function rewindSeason(season, through) {
  season.episodes = season.episodes.filter((episode) => episode.number <= through);
  const labels = season.episodes.map((episode) => episode.label);

  season.castaways.forEach((castaway) => {
    const events = (castaway.events || []).filter((e) => e.episode <= through);
    castaway.events = events;
    castaway.points = events.reduce((sum, e) => sum + e.points, 0);
    castaway.winner = events.some((e) => e.label === 'Win Survivor');
    const isOut = castaway.out_episode !== null && castaway.out_episode <= through;
    castaway.status = isOut ? 'OUT' : 'IN';
    if (!isOut) {
      castaway.out_episode = null;
      castaway.out_reason = null;
    }
  });

  season.players.forEach((player) => {
    const per = {};
    labels.forEach((label) => { per[label] = player.episodes[label] || 0; });
    player.episodes = per;
    player.total = labels.reduce((sum, label) => sum + per[label], 0);
  });

  const rank = (totalFor) => {
    const ordered = [...season.players].sort(
      (a, b) => totalFor(b) - totalFor(a) || a.name.localeCompare(b.name)
    );
    const out = {};
    let lastTotal = null;
    let lastRank = 0;
    ordered.forEach((player, index) => {
      const total = totalFor(player);
      if (total !== lastTotal) { lastRank = index + 1; lastTotal = total; }
      out[player.name] = lastRank;
    });
    return out;
  };

  const scored = season.episodes.filter((e) => e.scored).map((e) => e.label);
  const now = rank((p) => p.total);
  const before = rank((p) =>
    scored.slice(0, -1).reduce((sum, label) => sum + (p.episodes[label] || 0), 0)
  );

  season.players.forEach((player) => {
    player.rank = now[player.name];
    player.previous_rank = before[player.name];
    player.movement = before[player.name] - now[player.name];
  });

  season.players.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  season.status = 'in_progress';
  return season;
}

function showPreviewBanner(seasonNumber, through) {
  const banner = el('div', 'preview-banner');
  banner.appendChild(el('strong', null, 'Preview mode. '));
  banner.appendChild(
    document.createTextNode(
      `Showing Season ${seasonNumber}` +
      (through ? ` as of Episode ${through}` : '') +
      '. This is not the live season.'
    )
  );
  document.body.prepend(banner);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const wantSeason = params.get('season');
  const through = params.get('through') ? Number(params.get('through')) : null;

  try {
    state.config = await loadJSON('data/config.json');
    if (wantSeason) state.config.currentSeason = Number(wantSeason);
    state.season = await loadJSON(`data/season${state.config.currentSeason}.json`);
    if (through) rewindSeason(state.season, through);
    if (wantSeason || through) {
      state.config.archiveSeasons = (state.config.archiveSeasons || []).filter(
        (id) => id !== state.config.currentSeason
      );
      showPreviewBanner(state.config.currentSeason, through);
    }

    // Recaps live in their own file so rebuilding standings from the
    // workbook never overwrites written content. Missing file is fine.
    state.recaps = await loadJSON(
      `data/recaps${state.config.currentSeason}.json`
    ).catch(() => ({ episodes: {} }));

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
  renderRecaps();
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

/* ------------------------------------------------------- draft window --- */

const HOUR_WORDS = { 1: 'one', 2: 'two', 3: 'three', 6: 'six', 12: 'twelve', 24: 'a day' };

/**
 * The draft deadline is derived from the episode schedule rather than
 * typed out, so moving an air date in config.json moves the deadline too.
 */
function draftDeadlineText() {
  const cfg = state.config.seasons[String(state.season.season)] || {};
  const draft = cfg.draft;
  if (!draft) return cfg.draftNote || '';

  const episode = (cfg.episodes || {})[String(draft.closesBeforeEpisode)];
  if (!episode || !episode.airs) return cfg.draftNote || '';

  const hours = draft.hoursBefore || 0;
  const airs = new Date(`${episode.airs}T20:00:00-07:00`);
  const due = new Date(airs.getTime() - hours * 3600 * 1000);

  const day = due.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles',
  });
  const time = due
    .toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
    })
    .replace('AM', 'a.m.')
    .replace('PM', 'p.m.');

  const lead = HOUR_WORDS[hours] || `${hours}`;
  const unit = hours === 1 ? 'hour' : 'hours';
  const before = hours === 24 ? 'a day before' : `${lead} ${unit} before`;

  return `Picks are due by ${time} Pacific on ${day}, ${before} Episode ${draft.closesBeforeEpisode} airs.`;
}

/** First episode that actually earns points. */
function firstScoringEpisode() {
  return state.season.episodes.find((episode) => episode.counts !== false) || null;
}

function firstStandingsText() {
  const first = firstScoringEpisode();
  if (!first) return 'Standings appear once the first episode is scored.';
  return `Standings appear after Episode ${first.number}, the first episode that earns points.`;
}

/** Episodes explicitly marked as not counting, with their reason. */
function nonScoringNotes() {
  return state.season.episodes.filter((episode) => episode.counts === false && episode.note);
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
  { id: 'recaps', label: 'Recaps', flag: 'episodeRecaps' },
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
      el('p', null, draftDeadlineText() || 'Standings appear here once picks are locked in.')
    );
    empty.appendChild(el('p', 'empty__aside', firstStandingsText()));
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
        empty.appendChild(el('h3', null, 'Draft is still open'));
        empty.appendChild(
          el('p', null, draftDeadlineText() || 'The draft board fills in once picks are locked.')
        );
        empty.appendChild(
          el('p', 'empty__aside', 'Every roster shows up here once the draft closes.')
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

    const color = tribeColor(castaway.tribe);
    let avatar;

    if (state.config.features.castPhotos && castaway.photo) {
      avatar = el('div', 'castaway__avatar castaway__avatar--photo');
      const img = document.createElement('img');
      img.src = castaway.photo;
      img.alt = '';
      img.loading = 'lazy';
      // A missing or broken file falls back to the lettered card rather
      // than leaving a hole in the grid.
      img.addEventListener('error', () => {
        avatar.classList.remove('castaway__avatar--photo');
        avatar.textContent = initials(castaway.name);
        avatar.style.background = color || `hsl(${hueFor(castaway.name)} 34% 62%)`;
      });
      avatar.appendChild(img);
      if (color) avatar.style.borderColor = color;
    } else {
      avatar = el('div', 'castaway__avatar', initials(castaway.name));
      avatar.style.background = color || `hsl(${hueFor(castaway.name)} 34% 62%)`;
    }

    card.appendChild(avatar);

    const points = el('div', 'castaway__pts');
    points.appendChild(el('span', 'castaway__pts-num', String(castaway.points)));
    points.appendChild(el('span', 'castaway__pts-label', 'pts'));
    card.appendChild(points);

    card.appendChild(el('h3', 'castaway__name', castaway.name));

    if (castaway.occupation) {
      card.appendChild(el('div', 'castaway__job', castaway.occupation));
    }
    const where = [castaway.age, castaway.residence].filter(Boolean).join(' · ');
    if (where) card.appendChild(el('div', 'castaway__where', where));

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

    const owners = castaway.drafted_by;
    if (owners.length) {
      const block = el('div', 'castaway__owners');
      block.appendChild(
        el(
          'span',
          'castaway__owners-count',
          `On ${owners.length} ${owners.length === 1 ? 'team' : 'teams'}`
        )
      );
      block.appendChild(document.createTextNode(owners.join(', ')));
      card.appendChild(block);
    } else if (state.season.players.length) {
      // Draft is done and nobody took them.
      card.appendChild(el('div', 'castaway__owners castaway__owners--none', 'Undrafted'));
    }

    grid.appendChild(card);
  });

  const remaining = cast.filter((c) => c.status === 'IN').length;
  $('#cast-note').textContent = `${remaining} of ${cast.length} still in the game`;
}

/* -------------------------------------------------------------- recaps --- */

function prettyDate(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00-07:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}

/** The day after an episode airs, which is when its recap goes up. */
function recapDueDate(episodeNumber) {
  const cfg = state.config.seasons[String(state.season.season)] || {};
  const episode = (cfg.episodes || {})[String(episodeNumber)];
  if (!episode || !episode.airs) return '';
  const airs = new Date(`${episode.airs}T20:00:00-07:00`);
  airs.setDate(airs.getDate() + 1);
  return airs.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}

function recapId(recap) {
  return `recap-${recap.number}`;
}

function recapShortLabel(recap) {
  return recap.label || `Episode ${recap.number}`;
}

/** Sidebar of jump links, with the one you're reading highlighted. */
function buildRecapNav(entries) {
  const nav = $('#recaps-nav');
  nav.replaceChildren();

  if (entries.length < 2) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;

  nav.appendChild(el('div', 'recaps-nav__title', 'Jump to'));
  const list = el('div', 'recaps-nav__list');

  entries.forEach((recap) => {
    const link = el('a', 'recaps-nav__link');
    link.href = `#${recapId(recap)}`;
    link.dataset.target = recapId(recap);
    link.appendChild(el('span', 'recaps-nav__label', recapShortLabel(recap)));
    if (recap.title) link.appendChild(el('span', 'recaps-nav__sub', recap.title));
    list.appendChild(link);
  });

  nav.appendChild(list);

  // Highlight whichever recap is currently in view.
  const links = $$('.recaps-nav__link', nav);
  const setActive = (id) => {
    links.forEach((link) => {
      link.classList.toggle('is-active', link.dataset.target === id);
    });
  };
  setActive(entries[0] && recapId(entries[0]));

  const observer = new IntersectionObserver(
    (records) => {
      const visible = records
        .filter((record) => record.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    },
    { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
  );

  entries.forEach((recap) => {
    const node = document.getElementById(recapId(recap));
    if (node) observer.observe(node);
  });
}

function renderRecaps() {
  const panel = $('#panel-recaps');
  if (!panel) return;
  const body = $('#recaps-body', panel);
  body.replaceChildren();

  const entries = Object.entries(state.recaps.episodes || {})
    .map(([number, recap]) => ({ number: Number(number), ...recap }))
    .sort((a, b) => b.number - a.number);

  if (!entries.length) {
    $('#recaps-nav').hidden = true;
    const empty = el('div', 'empty');
    empty.appendChild(el('h3', null, 'No recaps yet'));
    empty.appendChild(
      el('p', null, `First one posts ${recapDueDate(1) || 'the morning after the premiere'}.`)
    );
    empty.appendChild(
      el('p', 'empty__aside', 'A short read each week: who scored, who went home, what it did to the standings.')
    );
    body.appendChild(empty);
    $('#recaps-note').textContent = '';
    return;
  }

  entries.forEach((recap) => {
    const article = el('article', 'recap');
    article.id = recapId(recap);

    const head = el('div', 'recap__head');
    // `label` lets a non-episode entry (a season preview, a finale
    // wrap-up) sit in the same stream without being called "Episode 0".
    head.appendChild(el('span', 'recap__ep', recap.label || `Episode ${recap.number}`));
    if (recap.posted) {
      head.appendChild(el('span', 'recap__date', prettyDate(recap.posted)));
    }
    article.appendChild(head);

    if (recap.title) article.appendChild(el('h3', 'recap__title', recap.title));
    if (recap.headline) article.appendChild(el('p', 'recap__lede', recap.headline));

    (recap.paragraphs || []).forEach((text) => {
      article.appendChild(el('p', 'recap__body', text));
    });

    body.appendChild(article);
  });

  buildRecapNav(entries);

  $('#recaps-note').textContent =
    `${entries.length} ${entries.length === 1 ? 'recap' : 'recaps'} · newest first`;
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

  const notes = $('#rules-notes');
  notes.replaceChildren();
  nonScoringNotes().forEach((episode) => {
    const notice = el('div', 'notice');
    const label = el('strong', null, `Episode ${episode.number} does not count. `);
    notice.appendChild(label);
    notice.appendChild(document.createTextNode(episode.note));
    notes.appendChild(notice);
  });
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
    const cfg = state.config.seasons[String(season.season)] || {};
    const card = el('div', 'card season-card');
    const top = season.players.slice(0, 5);

    card.appendChild(el('h3', null, season.name));
    if (season.subtitle) {
      card.appendChild(el('p', 'season-card__subtitle', season.subtitle));
    }
    if (cfg.blurb) card.appendChild(el('p', 'season-card__blurb', cfg.blurb));

    // Who won the actual show, as distinct from who won our pool.
    const soleSurvivor = season.castaways.find((castaway) => castaway.winner);
    if (soleSurvivor) {
      const block = el('div', 'season-card__block');
      block.appendChild(el('div', 'season-card__label', 'Sole Survivor'));
      block.appendChild(el('div', 'season-card__winner', soleSurvivor.name));

      const finale = cfg.finale || {};
      if (finale.vote) {
        const over = (finale.over || []).join(' and ');
        block.appendChild(
          el(
            'div',
            'season-card__vote',
            over ? `${finale.vote} over ${over}` : finale.vote
          )
        );
      }
      if (soleSurvivor.drafted_by && soleSurvivor.drafted_by.length) {
        block.appendChild(
          el(
            'div',
            'season-card__owned',
            `Drafted by ${soleSurvivor.drafted_by.join(', ')}`
          )
        );
      }
      card.appendChild(block);
    }

    if (top.length) {
      const block = el('div', 'season-card__block');
      block.appendChild(el('div', 'season-card__label', 'Pool champion'));
      block.appendChild(el('div', 'season-card__champ', top[0].name));
      block.appendChild(el('div', 'season-card__score', `${top[0].total} points`));

      const list = el('div', 'season-card__list');
      top.slice(1).forEach((player) => {
        list.appendChild(
          el('div', null, `${player.rank}. ${player.name} · ${player.total}`)
        );
      });
      block.appendChild(list);
      card.appendChild(block);
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
