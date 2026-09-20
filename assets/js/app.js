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
  bios: null,
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

    // Cast bios are optional; a season without them just shows short cards.
    state.bios = await loadJSON(
      `data/bios${state.config.currentSeason}.json`
    ).catch(() => null);

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
  renderWelcome();
  renderPicks();
  renderStandings();
  renderRecaps();
  renderDraftBoard();
  renderBootOrder();
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

  const due = draftDeadlineDate();
  if (!due) return cfg.draftNote || '';

  const hours = draft.hoursBefore || 0;

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

/* Nav order, and the first one available is what the site opens on.
   Make Picks leads while the draft window is open, so the site lands on the
   thing people still owe. It is shown only while the window is open, then it
   takes itself out of the nav, Cast inherits first place, and the Draft
   Board does the job of showing who ended up with whom. */
const PANELS = [
  { id: 'welcome', label: 'Welcome', flag: 'welcome' },
  /* Second in the nav but highlighted, so it reads as the thing to do
     without taking the landing spot from Welcome. Removes itself, and its
     highlight with it, once the deadline passes. */
  { id: 'picks', label: 'Make Picks', flag: 'pickSubmission', when: () => picksAreOpen(), cta: true },
  { id: 'cast', label: 'Cast', flag: 'castTracker' },
  { id: 'recaps', label: 'Episodes', flag: 'episodeRecaps' },
  { id: 'rules', label: 'Rules', flag: 'scoringRules' },
  { id: 'standings', label: 'Standings', flag: 'standings' },
  { id: 'draft', label: 'Draft Board', flag: 'draftBoard' },
  { id: 'history', label: 'Past Seasons', flag: 'pastSeasons' },
];

function renderNav() {
  const nav = $('#nav-inner');
  const available = PANELS.filter(
    (panel) => state.config.features[panel.flag] && (!panel.when || panel.when())
  );

  available.forEach((panel, index) => {
    const button = el('button', null, panel.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.dataset.panel = panel.id;
    if (panel.cta) button.classList.add('nav__cta');
    button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    button.addEventListener('click', () => selectPanel(panel.id));
    nav.appendChild(button);
  });

  PANELS.forEach((panel) => {
    const node = document.getElementById(`panel-${panel.id}`);
    if (!node) return;
    if (!available.includes(panel)) node.remove();
  });

  /* A hash in the URL wins over the default, so #rules can be shared
     directly. Anything that is not an available panel is ignored. */
  const ids = available.map((panel) => panel.id);
  const fromHash = location.hash.replace('#', '');
  selectPanel(ids.includes(fromHash) ? fromHash : ids[0]);

  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (ids.includes(id)) selectPanel(id);
  });
}

function selectPanel(id) {
  /* Read this before the panels swap: once the document height changes the
     scroll position is no longer a reliable answer to "were they partway
     down the page when they clicked?" */
  const wasBelowTop = window.scrollY > panelTopY() + 1;
  let active = null;
  $$('#nav-inner button').forEach((button) => {
    const on = button.dataset.panel === id;
    button.setAttribute('aria-selected', String(on));
    if (on) active = button;
  });
  $$('.panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `panel-${id}`);
  });
  /* replaceState rather than assigning location.hash: it keeps the URL
     copyable without scrolling the page or stacking history entries. */
  if (location.hash !== `#${id}`) {
    history.replaceState(null, '', `#${id}`);
  }
  revealTab(active);
  if (wasBelowTop) {
    /* Hiding one panel and showing another resizes the document, and the
       browser adjusts the scroll position while that settles. Waiting a
       frame means the scroll lands where we asked instead of being undone. */
    requestAnimationFrame(() => window.scrollTo({ top: panelTopY(), behavior: 'auto' }));
  }
}

/* The nav scrolls sideways on a phone, so the tab you just switched to can
   sit off the right edge. Nothing then looks selected and you lose your
   place. Slide the nav until the active tab is on screen. On a desktop the
   nav does not overflow, so this is a no-op. */
function revealTab(button) {
  const nav = $('#nav-inner');
  if (!nav || !button) return;
  const navBox = nav.getBoundingClientRect();
  const tabBox = button.getBoundingClientRect();
  const gutter = 14;
  let left = nav.scrollLeft;
  if (tabBox.left < navBox.left) {
    left -= navBox.left - tabBox.left + gutter;
  } else if (tabBox.right > navBox.right) {
    left += tabBox.right - navBox.right + gutter;
  } else {
    return;
  }
  nav.scrollLeft = left;
}

/* Where the page sits when a panel starts at the top of the screen.
   Measured from <main> rather than the nav: offsetTop on a sticky element
   reports where it is currently pinned, not where it rests, so asking the
   nav directly returns the scroll position back to you and every
   comparison against it is true. */
function panelTopY() {
  const main = $('main');
  const nav = $('.nav');
  if (!main || !nav) return 0;
  let top = 0;
  for (let node = main; node; node = node.offsetParent) top += node.offsetTop;
  return Math.max(0, top - nav.offsetHeight);
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

/** The expanded half of a cast card: their own answers, verbatim. */
function buildBio(castaway, bio, labels) {
  const wrap = el('div', 'castaway__bio');

  /* The full length press shot. src is held back until the card is first
     opened, so twenty-one of these are never downloaded by someone who
     only came to look at the standings. */
  if (castaway.photo_full) {
    const figure = el('figure', 'castaway__full');
    const shot = document.createElement('img');
    shot.dataset.src = castaway.photo_full;
    shot.alt = '';
    // A missing file drops the whole frame rather than leaving a grey
    // rectangle, and the bio text then spreads across the full card.
    shot.addEventListener('error', () => figure.remove());
    figure.appendChild(shot);
    wrap.appendChild(figure);
  }

  const panel = el('div', 'castaway__bio-text');

  if (bio.words) {
    const words = el('div', 'bio-words');
    words.appendChild(el('span', 'bio-words__label', 'Three words'));
    words.appendChild(el('span', 'bio-words__text', bio.words));
    panel.appendChild(words);
  }

  (bio.answers || []).forEach((answer) => {
    const block = el('div', 'bio-qa');
    block.appendChild(el('div', 'bio-qa__q', labels[answer.key] || answer.key));
    block.appendChild(el('p', 'bio-qa__a', answer.text));
    panel.appendChild(block);
  });

  (bio.trivia || []).forEach((line) => {
    const block = el('div', 'bio-qa bio-qa--trivia');
    block.appendChild(el('div', 'bio-qa__q', 'Of note'));
    block.appendChild(el('p', 'bio-qa__a', line));
    panel.appendChild(block);
  });

  if (state.bios && state.bios.source) {
    panel.appendChild(el('p', 'bio-source', state.bios.source));
  }

  wrap.appendChild(panel);
  return wrap;
}

/* ----------------------------------------------------- boot order --- */

/** The name people actually use: a quoted nickname, else the first name. */
function shortName(name) {
  const nickname = name.match(/"([^"]+)"/);
  return nickname ? nickname[1] : name.split(/\s+/)[0];
}

function bootChip(castaway) {
  const chip = el('div', 'boot');
  const color = tribeColor(castaway.tribe);
  const isOut = castaway.status === 'OUT';

  if (isOut) chip.classList.add('boot--out');
  if (castaway.winner) chip.classList.add('boot--winner');

  const detail = [];
  if (castaway.winner) detail.push('Sole Survivor');
  else if (isOut) {
    detail.push(`Out in Episode ${castaway.out_episode}`);
    if (castaway.out_reason) detail.push(castaway.out_reason);
  } else detail.push('Still in the game');
  const teams = (castaway.drafted_by || []).length;
  if (teams) detail.push(`On ${teams} ${teams === 1 ? 'team' : 'teams'}`);
  chip.title = `${castaway.name} \u00b7 ${detail.join(' \u00b7 ')}`;

  const photo = el('div', 'boot__photo');
  if (state.config.features.castPhotos && castaway.photo) {
    const img = document.createElement('img');
    img.src = castaway.photo;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      photo.replaceChildren(document.createTextNode(initials(castaway.name)));
      photo.classList.add('boot__photo--letters');
      photo.style.background = color || `hsl(${hueFor(castaway.name)} 34% 62%)`;
    });
    photo.appendChild(img);
  } else {
    photo.textContent = initials(castaway.name);
    photo.classList.add('boot__photo--letters');
    photo.style.background = color || `hsl(${hueFor(castaway.name)} 34% 62%)`;
  }
  if (color && !isOut) photo.style.borderColor = color;
  chip.appendChild(photo);

  if (castaway.winner) {
    chip.appendChild(el('span', 'boot__badge boot__badge--won', 'WON'));
  } else if (isOut) {
    const badge = el('span', 'boot__badge', `E${castaway.out_episode}`);
    // Quit and medical are not a vote, so they read differently.
    if (/quit|med/i.test(castaway.out_reason || '')) {
      badge.classList.add('boot__badge--exit');
    }
    chip.appendChild(badge);
  }

  chip.appendChild(el('span', 'boot__name', shortName(castaway.name)));
  return chip;
}

function bootGroup(label, list) {
  const group = el('div', 'bootstrip__group');
  group.appendChild(el('h3', 'bootstrip__label', label));
  const row = el('div', 'bootstrip__row');
  list.forEach((castaway) => row.appendChild(bootChip(castaway)));
  group.appendChild(row);
  return group;
}

function renderBootOrder() {
  const wrap = $('#boot-order');
  if (!wrap) return;
  wrap.replaceChildren();

  if (!state.config.features.bootOrder) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const cast = state.season.castaways;
  const out = cast
    .filter((c) => c.status === 'OUT')
    .sort(
      (a, b) =>
        (a.out_episode || 0) - (b.out_episode || 0) || a.name.localeCompare(b.name)
    );
  const alive = cast
    .filter((c) => c.status !== 'OUT')
    .sort((a, b) => {
      if (a.winner !== b.winner) return a.winner ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  if (alive.length) {
    wrap.appendChild(
      bootGroup(
        out.length ? `Still in the game · ${alive.length}` : `The cast · ${cast.length}`,
        alive
      )
    );
  }
  if (out.length) {
    wrap.appendChild(bootGroup('Out of the game · in order', out));
  }
}

function renderCast() {
  const panel = $('#panel-cast');
  if (!panel) return;
  const grid = $('#cast-grid', panel);
  grid.replaceChildren();

  const cast = [...state.season.castaways].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'IN' ? -1 : 1;
    // Everyone who is out sits at the end in boot order, which is the one
    // thing the separate strip above the grid used to be for.
    if (a.status === 'OUT') {
      return (
        (a.out_episode || 0) - (b.out_episode || 0) || a.name.localeCompare(b.name)
      );
    }
    if (b.points !== a.points) return b.points - a.points;
    return a.name.localeCompare(b.name);
  });

  const bios = (state.bios && state.bios.castaways) || {};
  const labels = {};
  ((state.bios && state.bios.questions) || []).forEach((q) => { labels[q.key] = q.label; });

  cast.forEach((castaway) => {
    const bio = bios[castaway.name];

    // With a bio the card becomes expandable; without one it stays a
    // plain card, so a season with no bio file still renders.
    const card = bio
      ? document.createElement('details')
      : document.createElement('div');
    card.className = 'card castaway';
    if (bio) card.classList.add('castaway--expandable');
    if (castaway.status === 'OUT') card.classList.add('castaway--out');

    const head = bio ? document.createElement('summary') : card;
    if (bio) head.className = 'castaway__summary';

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

    head.appendChild(avatar);

    const points = el('div', 'castaway__pts');
    points.appendChild(el('span', 'castaway__pts-num', String(castaway.points)));
    points.appendChild(el('span', 'castaway__pts-label', 'pts'));
    head.appendChild(points);

    head.appendChild(el('h3', 'castaway__name', castaway.name));

    if (castaway.occupation) {
      head.appendChild(el('div', 'castaway__job', castaway.occupation));
    }
    const where = [castaway.age, castaway.residence].filter(Boolean).join(' \u00b7 ');
    if (where) head.appendChild(el('div', 'castaway__where', where));

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
    head.appendChild(meta);

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
      head.appendChild(block);
    } else if (state.season.players.length) {
      // Draft is done and nobody took them.
      head.appendChild(el('div', 'castaway__owners castaway__owners--none', 'Undrafted'));
    }

    if (bio) {
      head.appendChild(el('span', 'castaway__more', 'Read their bio'));
      card.appendChild(head);
      card.appendChild(buildBio(castaway, bio, labels));

      card.addEventListener('toggle', () => {
        if (!card.open) return;

        // One at a time. Two open cards push everything else off screen.
        $$('.castaway[open]', grid).forEach((other) => {
          if (other !== card) other.open = false;
        });

        const shot = $('.castaway__full img[data-src]', card);
        if (shot) {
          shot.src = shot.dataset.src;
          delete shot.dataset.src;
        }

        // Closing the card above this one shifts the page, so make sure
        // the card that was just opened is still in view.
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
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

/**
 * One entry per episode, combining the written recap with the scoring
 * detail pulled from the workbook. An episode shows up here once it has
 * either a recap or scored events, so the tab is never padded with
 * empty weeks.
 */
function episodeEntries() {
  const recaps = state.recaps.episodes || {};
  const byNumber = new Map();

  state.season.episodes.forEach((episode) => {
    if (!episode.scored) return;
    byNumber.set(episode.number, { number: episode.number, episode });
  });

  Object.entries(recaps).forEach(([key, recap]) => {
    const number = Number(key);
    const existing = byNumber.get(number) || { number };
    byNumber.set(number, { ...existing, ...recap, number, recap });
  });

  return [...byNumber.values()].sort((a, b) => b.number - a.number);
}

/** Scoring events for one episode, collapsed to one row per castaway. */
function eventsByCastaway(episode) {
  const grouped = new Map();
  (episode.events || []).forEach((event) => {
    if (!grouped.has(event.castaway)) {
      grouped.set(event.castaway, { name: event.castaway, total: 0, labels: [] });
    }
    const row = grouped.get(event.castaway);
    row.total += event.points;
    row.labels.push({ label: event.label, points: event.points });
  });
  return [...grouped.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name)
  );
}

/**
 * A one-line description of an episode, built from the scoring events.
 * Every scored episode gets one for free, so no week is ever a bare
 * number. A written headline in the recap file takes priority.
 */
function autoSummary(episode) {
  const events = episode.events || [];
  if (!events.length) return '';

  const pick = (label) => events.filter((e) => e.label === label).map((e) => e.castaway);
  const unique = (names) => [...new Set(names)];
  const list = (names) => {
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  };

  const clauses = [];

  const champion = unique(pick('Win Survivor'));
  if (champion.length) clauses.push(`${list(champion)} won the season`);

  const bootedWithIdol = unique(pick('Voted Out WITH Idol'));
  const booted = unique(pick('Lose Vote')).filter((n) => !bootedWithIdol.includes(n));
  const medical = unique([...pick('Med Visit EVAC'), ...pick('Med Visit NO PULL')]);
  const quit = unique([...pick('Quit Game'), ...pick('Quite Game')]);

  if (bootedWithIdol.length) {
    clauses.push(`${list(bootedWithIdol)} went out with an idol still in hand`);
  }
  if (booted.length) clauses.push(`${list(booted)} voted out`);
  if (medical.length) clauses.push(`${list(medical)} pulled from the game`);
  if (quit.length) clauses.push(`${list(quit)} quit`);

  // Good news is grouped by castaway so somebody who wins immunity and
  // an advantage reads as one clause, not their name twice.
  const WON = {
    'Immunity Challenge Win': 'immunity',
    'Reward Challenge Win': 'reward',
    'Win Advantage': 'an advantage',
    'Win  Advantage': 'an advantage',
    'Win Fire Challenge': 'fire-making',
  };
  const FOUND = { 'Immunity Idol Find': 'an idol' };
  const OTHER = {
    'Shot in the Dark SUCCESS': 'survived a Shot in the Dark',
    'Effective REAL Idol': 'played an idol that worked',
    'Effective FAKE Idol': 'got someone to play a fake idol',
  };

  const wins = new Map();
  events.forEach((event) => {
    if (event.points <= 0) return;
    if (champion.includes(event.castaway)) return; // already covered above
    if (!wins.has(event.castaway)) {
      wins.set(event.castaway, { won: [], found: [], other: [] });
    }
    const row = wins.get(event.castaway);
    if (WON[event.label] && !row.won.includes(WON[event.label])) row.won.push(WON[event.label]);
    if (FOUND[event.label] && !row.found.includes(FOUND[event.label])) row.found.push(FOUND[event.label]);
    if (OTHER[event.label] && !row.other.includes(OTHER[event.label])) row.other.push(OTHER[event.label]);
  });

  // Castaways who did exactly the same thing share a clause, so three
  // immunity winners read as one sentence rather than three.
  const byAchievement = new Map();
  wins.forEach((row, name) => {
    const parts = [];
    if (row.won.length) parts.push(`won ${list(row.won)}`);
    if (row.found.length) parts.push(`found ${list(row.found)}`);
    row.other.forEach((phrase) => parts.push(phrase));
    if (!parts.length) return;
    const phrase = list(parts);
    if (!byAchievement.has(phrase)) byAchievement.set(phrase, []);
    byAchievement.get(phrase).push(name);
  });

  byAchievement.forEach((names, phrase) => {
    clauses.push(`${list(names)} ${phrase}`);
  });

  if (!clauses.length) return '';

  const sentence = clauses.slice(0, 3).join('. ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function signed(points) {
  return points > 0 ? `+${points}` : String(points);
}

function pointsClass(points) {
  if (points > 0) return 'pos';
  if (points < 0) return 'neg';
  return 'zero';
}

function renderWhatScored(episode) {
  const section = el('section', 'ep-section');
  section.appendChild(el('h4', 'ep-section__title', 'What scored'));

  const rows = eventsByCastaway(episode);
  if (!rows.length) {
    section.appendChild(el('p', 'ep-empty', 'Nobody scored this episode.'));
    return section;
  }

  const list = el('div', 'ep-scored');
  rows.forEach((row) => {
    const item = el('div', 'ep-scored__row');

    const left = el('div', 'ep-scored__who');
    left.appendChild(el('span', 'ep-scored__name', row.name));
    left.appendChild(
      el('span', 'ep-scored__what', row.labels.map((l) => l.label).join(' · '))
    );
    item.appendChild(left);

    item.appendChild(
      el('span', `ep-scored__pts ep-scored__pts--${pointsClass(row.total)}`,
        signed(row.total))
    );
    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}

function renderPlayerResults(episode) {
  const label = episode.label;
  const players = state.season.players;
  if (!players.length) return null;

  const section = el('section', 'ep-section');
  const head = el('div', 'ep-section__head');
  head.appendChild(el('h4', 'ep-section__title', 'Player results'));

  const scores = players.map((p) => p.episodes[label] || 0);
  const best = Math.max(...scores);
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;
  head.appendChild(
    el('span', 'ep-section__meta',
      `${players.length} players · average ${average.toFixed(1)}`)
  );
  section.appendChild(head);

  const ranked = [...players].sort(
    (a, b) => (b.episodes[label] || 0) - (a.episodes[label] || 0)
      || a.name.localeCompare(b.name)
  );

  // Most weeks the majority of players score nothing. Those get tucked
  // behind one line so the list stays readable on a phone.
  const movers = ranked.filter((p) => (p.episodes[label] || 0) !== 0);
  const flat = ranked.filter((p) => (p.episodes[label] || 0) === 0);

  const list = el('div', 'ep-players');
  movers.forEach((player, index) => {
    const score = player.episodes[label] || 0;

    const row = document.createElement('details');
    row.className = 'ep-player';
    if (score === best && best > 0) row.classList.add('ep-player--best');

    const summary = document.createElement('summary');
    summary.className = 'ep-player__summary';
    summary.appendChild(el('span', 'ep-player__rank', String(index + 1)));
    summary.appendChild(el('span', 'ep-player__name', player.name));
    summary.appendChild(
      el('span', `ep-player__pts ep-player__pts--${pointsClass(score)}`, signed(score))
    );
    row.appendChild(summary);

    const detail = el('div', 'ep-player__detail');
    player.picks.forEach((pick) => {
      const earned = (episode.events || [])
        .filter((event) => event.castaway === pick)
        .reduce((sum, event) => sum + event.points, 0);

      const line = el('div', 'ep-player__pick');
      line.appendChild(el('span', 'ep-player__pick-name', pick));
      line.appendChild(
        el('span', `ep-player__pick-pts ep-player__pick-pts--${pointsClass(earned)}`,
          earned === 0 ? '0' : signed(earned))
      );
      detail.appendChild(line);
    });
    row.appendChild(detail);

    list.appendChild(row);
  });

  if (!movers.length) {
    list.appendChild(el('p', 'ep-empty', 'Nobody gained or lost points this episode.'));
  }

  if (flat.length) {
    const rest = document.createElement('details');
    rest.className = 'ep-player ep-player--rest';

    const summary = document.createElement('summary');
    summary.className = 'ep-player__summary';
    summary.appendChild(
      el('span', 'ep-player__name ep-player__name--muted',
        `${flat.length} ${flat.length === 1 ? 'player' : 'players'} scored nothing`)
    );
    summary.appendChild(el('span', 'ep-player__pts ep-player__pts--zero', '0'));
    rest.appendChild(summary);

    rest.appendChild(
      el('div', 'ep-player__detail ep-player__rest-names',
        flat.map((p) => p.name).join(', '))
    );
    list.appendChild(rest);
  }

  section.appendChild(list);
  return section;
}

function renderRecaps() {
  const panel = $('#panel-recaps');
  if (!panel) return;
  const body = $('#recaps-body', panel);
  body.replaceChildren();

  const entries = episodeEntries();

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

    const airs = recap.episode && recap.episode.airs;
    const when = airs ? prettyDate(airs) : (recap.posted ? prettyDate(recap.posted) : '');
    if (when) head.appendChild(el('span', 'recap__date', when));
    article.appendChild(head);

    const title = recap.title || (recap.episode && recap.episode.title);
    if (title) article.appendChild(el('h3', 'recap__title', title));

    // Written headline wins; otherwise describe the episode from its events.
    const lede = recap.headline || (recap.episode ? autoSummary(recap.episode) : '');
    if (lede) {
      const node = el('p', 'recap__lede', lede);
      if (!recap.headline) node.classList.add('recap__lede--auto');
      article.appendChild(node);
    }

    (recap.paragraphs || []).forEach((text) => {
      article.appendChild(el('p', 'recap__body', text));
    });

    // Scoring detail, for entries that correspond to a scored episode.
    if (recap.episode && recap.episode.scored) {
      article.appendChild(renderWhatScored(recap.episode));
      const results = renderPlayerResults(recap.episode);
      if (results) article.appendChild(results);
    }

    body.appendChild(article);
  });

  buildRecapNav(entries);

  const scoredCount = entries.filter((e) => e.episode && e.episode.scored).length;
  $('#recaps-note').textContent = scoredCount
    ? `${scoredCount} ${scoredCount === 1 ? 'episode' : 'episodes'} scored · newest first`
    : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · newest first`;
}

/* --------------------------------------------------------------- rules --- */

/* -------------------------------------------------------------- welcome --- */

/* A very small subset of markdown so the welcome copy can live in
   config.json: **bold** and [label](#panel). Parsed into real nodes rather
   than dropped in with innerHTML, so nothing in the config file can inject
   markup. An in-page [label](#panel) becomes a tab switch, not a jump. */
function inlineRich(parent, text) {
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    if (match[1] !== undefined) {
      /* Bold can wrap a link, as **[label](#panel)** does throughout the
         welcome copy, so the inside is parsed again rather than taken as
         plain text. */
      parent.appendChild(inlineRich(el('strong'), match[1]));
    } else {
      const link = el('a', 'welcome__link', match[2]);
      link.href = match[3];
      parent.appendChild(link);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
  return parent;
}

function richPara(text, className) {
  return inlineRich(el('p', className || null), text);
}

function renderWelcome() {
  const panel = $('#panel-welcome');
  if (!panel) return;

  const welcome = state.config.welcome || {};
  const note = $('#welcome-note', panel);
  if (note) note.textContent = welcome.tagline || '';

  const body = $('#welcome-body', panel);
  if (!body) return;
  body.replaceChildren();

  (welcome.sections || []).forEach((section) => {
    if (section.type === 'callout') {
      const box = el('div', 'welcome__callout');
      if (section.heading) box.appendChild(el('h3', null, section.heading));
      if (section.text) box.appendChild(richPara(section.text));
      body.appendChild(box);
      return;
    }

    if (section.type === 'image') {
      const figure = el('figure', 'welcome__figure');
      const image = el('img');
      image.src = section.src;
      image.alt = section.alt || '';
      image.loading = 'lazy';
      figure.appendChild(image);
      if (section.caption) {
        figure.appendChild(inlineRich(el('figcaption'), section.caption));
      }
      body.appendChild(figure);
      return;
    }

    const block = el('section', 'welcome__section');
    if (section.heading) block.appendChild(el('h3', null, section.heading));

    if (section.type === 'steps') {
      const list = el('ol', 'steps');
      (section.steps || []).forEach((step) => {
        const item = el('li', 'step');
        item.appendChild(el('h4', null, step.title));
        item.appendChild(richPara(step.text));
        list.appendChild(item);
      });
      block.appendChild(list);
    } else if (section.type === 'dates') {
      const list = el('dl', 'welcome__dates');
      (section.items || []).forEach((entry) => {
        list.appendChild(el('dt', null, entry.when));
        list.appendChild(el('dd', null, entry.what));
      });
      block.appendChild(list);
    } else if (section.type === 'list') {
      if (section.intro) block.appendChild(richPara(section.intro));
      const list = el('ul', 'welcome__bullets');
      (section.items || []).forEach((item) => {
        list.appendChild(inlineRich(el('li'), item));
      });
      block.appendChild(list);
    } else {
      (section.paragraphs || []).forEach((text) => block.appendChild(richPara(text)));
    }

    // Any section can carry a closing line, not just the bullet list. The
    // scoring-changed note uses it to sit under the steps as plain copy
    // instead of needing its own boxed callout.
    if (section.outro) block.appendChild(richPara(section.outro, 'welcome__outro'));

    body.appendChild(block);
  });
}

function renderRules() {
  const panel = $('#panel-rules');
  if (!panel) return;

  const rules = state.config.rules || {};
  const defs = rules.definitions || {};
  const fine = rules.fineprint || {};

  /* --- the three-step explainer ------------------------------------- */

  const steps = $('#rules-steps');
  if (steps) {
    steps.replaceChildren();
    (rules.howItWorks || []).forEach((step) => {
      const item = el('li', 'step');
      item.appendChild(el('h4', null, step.title));
      item.appendChild(el('p', null, step.text));
      steps.appendChild(item);
    });
    steps.hidden = !(rules.howItWorks || []).length;
  }

  /* --- the scoring table -------------------------------------------- */

  const build = (items, kind) => {
    const column = el('div', 'rules__col');
    column.appendChild(
      el(
        'div',
        `rules__head rules__head--${kind}`,
        kind === 'pos'
          ? (rules.columnHeads || {}).positive || 'Points you want'
          : (rules.columnHeads || {}).negative || 'Points that hurt'
      )
    );

    const row = (item) => {
      const line = el('div', 'rules__row');
      const label = el('div', 'rules__label');
      label.appendChild(el('span', 'rules__name', item.label));
      if (defs[item.label]) label.appendChild(el('span', 'rules__def', defs[item.label]));
      if (fine[item.label]) label.appendChild(el('span', 'rules__fine', fine[item.label]));
      line.appendChild(label);
      line.appendChild(
        el(
          'span',
          `rules__pts rules__pts--${kind}`,
          item.points > 0 ? `+${item.points}` : String(item.points)
        )
      );
      return line;
    };

    /* The workbook knows labels and point values. The reading order and the
       group headings live in config.json, because a spreadsheet column order
       is not an argument about what belongs next to what. */
    const remaining = new Map(items.map((item) => [item.label, item]));
    const groups = (rules.scoreGroups || {})[kind === 'pos' ? 'positive' : 'negative'] || [];

    groups.forEach((group) => {
      const found = (group.labels || [])
        .map((label) => remaining.get(label))
        .filter(Boolean);
      if (!found.length) return;
      column.appendChild(el('div', 'rules__group', group.title));
      found.forEach((item) => {
        column.appendChild(row(item));
        remaining.delete(item.label);
      });
    });

    /* A new column added to the workbook shows up here rather than silently
       vanishing because nobody remembered to put it in a group. */
    const ungrouped = [...remaining.values()];
    if (ungrouped.length) {
      if (groups.length) column.appendChild(el('div', 'rules__group', 'Everything else'));
      ungrouped.forEach((item) => column.appendChild(row(item)));
    }

    return column;
  };

  const wrap = $('#rules-grid');
  wrap.replaceChildren();
  wrap.appendChild(build(state.season.scoring.positive, 'pos'));
  wrap.appendChild(build(state.season.scoring.negative, 'neg'));

  /* --- rulings ------------------------------------------------------- */

  const rulings = $('#rules-rulings');
  if (rulings) {
    rulings.replaceChildren();
    (rules.rulings || []).forEach((item) => {
      const card = el('div', 'ruling');
      card.appendChild(el('h4', null, item.title));
      card.appendChild(el('p', null, item.text));
      rulings.appendChild(card);
    });
    rulings.hidden = !(rules.rulings || []).length;
    const heading = rulings.previousElementSibling;
    if (heading && heading.classList.contains('rules__section')) heading.hidden = rulings.hidden;
  }

  /* --- tiebreaker and scorekeeping ----------------------------------- */

  const foot = $('#rules-foot');
  if (foot) {
    foot.replaceChildren();
    const line = (title, text) => {
      if (!text) return;
      const block = el('div', 'rules__note');
      block.appendChild(el('h4', null, title));
      block.appendChild(el('p', null, text));
      foot.appendChild(block);
    };
    if (rules.prize) {
      const block = el('div', 'rules__note');
      block.appendChild(el('h4', null, 'How the pot pays out'));
      block.appendChild(buildPayout());
      foot.appendChild(block);
    }
    line('Ties', rules.tiebreaker);
    line('Who keeps score', rules.scorekeeping);
    foot.hidden = !foot.childElementCount;
  }

  /* --- notices: draft deadline, then any episode that does not count -- */

  const notes = $('#rules-notes');
  notes.replaceChildren();

  const deadline = draftDeadlineText();
  if (deadline) {
    const notice = el('div', 'notice');
    notice.appendChild(el('strong', null, 'Draft deadline. '));
    notice.appendChild(document.createTextNode(deadline));
    notes.appendChild(notice);
  }

  nonScoringNotes().forEach((episode) => {
    const notice = el('div', 'notice');
    notice.appendChild(el('strong', null, `Episode ${episode.number} does not count. `));
    notice.appendChild(document.createTextNode(episode.note));
    notes.appendChild(notice);
  });
}

/* -------------------------------------------------------- past seasons --- */

/* Everyone on the lowest total. Players arrive rank-sorted, so the last
   entry carries the worst score and anyone matching it shares the honour. */
function cellar(season) {
  const players = season.players || [];
  if (!players.length) return null;
  const worst = players[players.length - 1].total;
  return { total: worst, names: players.filter((p) => p.total === worst).map((p) => p.name) };
}

function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* The trophy banner. Archives are newest first, so the first one that has
   standings is the current holder and the rest are the roll behind them.
   Nobody is claimed to have held it twice: the roll is printed and the
   reader does that arithmetic themselves. */
function renderTrophy() {
  const host = $('#trophy');
  if (!host) return;
  host.replaceChildren();

  const trophy = state.config.trophy;
  const held = state.archives
    .map((season) => ({ season, bottom: cellar(season) }))
    .filter((entry) => entry.bottom);
  if (!trophy || !held.length) return;

  const box = el('div', 'trophy');
  box.appendChild(el('div', 'trophy__label', trophy.name));

  const current = held[0];
  box.appendChild(el('div', 'trophy__holder', listNames(current.bottom.names)));
  box.appendChild(
    el('div', 'trophy__meta', `${current.season.name} · ${current.bottom.total} points`)
  );

  if (held.length > 1) {
    const before = held
      .slice(1)
      .map((entry) => `${listNames(entry.bottom.names)} (${entry.season.name})`)
      .join(', ');
    box.appendChild(el('div', 'trophy__roll', `Previously: ${before}`));
  }

  if (trophy.blurb) box.appendChild(el('p', 'trophy__blurb', trophy.blurb));
  host.appendChild(box);
}

function renderPastSeasons() {
  const panel = $('#panel-history');
  if (!panel) return;
  renderTrophy();
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

    /* Last place, which in a league this size is its own kind of fame.
       Skipped when the field is small enough that the bottom is already
       showing in the top five above. */
    const bottom = season.players.length > 5 ? cellar(season) : null;
    if (bottom) {
      const trophy = state.config.trophy || {};
      const block = el('div', 'season-card__block season-card__block--cellar');
      block.appendChild(el('div', 'season-card__label', trophy.name || 'Last place'));
      block.appendChild(el('div', 'season-card__cellar', listNames(bottom.names)));
      block.appendChild(
        el(
          'div',
          'season-card__cellar-score',
          `${bottom.total} ${bottom.total === 1 ? 'point' : 'points'}`
        )
      );
      card.appendChild(block);
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


/* --------------------------------------------------------------- picks --- */

/**
 * Pick submission.
 *
 * The page can write a row and can never read one back: the picks table has
 * an insert policy and no select policy, so a submission goes in and nothing
 * comes out. Every submit is a new row, and the newest row per owner is that
 * owner's real entry, which makes "change my picks" nothing more than filling
 * the form out again.
 *
 * The deadline below only decides what this page shows. The real cutoff lives
 * in the database policy, so a late submit is refused even if this clock is
 * wrong or someone leaves the tab open past the deadline.
 */

const draft = { selected: [] };

/** The moment picks close, derived from the episode schedule in config.json. */
function draftDeadlineDate() {
  const cfg = state.config.seasons[String(state.season.season)] || {};
  const draft = cfg.draft;
  if (!draft) return null;

  const episode = (cfg.episodes || {})[String(draft.closesBeforeEpisode)];
  if (!episode || !episode.airs) return null;

  const airs = new Date(`${episode.airs}T20:00:00-07:00`);
  return new Date(airs.getTime() - (draft.hoursBefore || 0) * 3600 * 1000);
}

function picksAreOpen() {
  if (!state.config.features.pickSubmission) return false;
  const due = draftDeadlineDate();
  return !due || Date.now() < due.getTime();
}

/* Last season's roster, so most people choose their name instead of typing it.
   Typed names are what break the "newest row per owner" rule: Chris one week
   and Chris Stockhaus the next reads as two different owners. */
function knownOwners() {
  const names = new Set();
  (state.season.players || []).forEach((player) => names.add(player.name));
  if (!names.size) {
    const recent = [...state.archives].sort((a, b) => b.season - a.season)[0];
    if (recent) (recent.players || []).forEach((player) => names.add(player.name));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function rememberedOwner() {
  try {
    return localStorage.getItem('cf-survivor-owner') || '';
  } catch (error) {
    return '';
  }
}

function rememberOwner(name) {
  try {
    localStorage.setItem('cf-survivor-owner', name);
  } catch (error) {
    /* private window, or storage is off. Nothing here depends on it. */
  }
}

function pacificTime(date) {
  return date
    .toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
    })
    .replace('AM', 'a.m.')
    .replace('PM', 'p.m.');
}

function ordinal(n) {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

/** The deadline the short way: "7:00 p.m. on the 30th". */
function shortDeadline() {
  const due = draftDeadlineDate();
  if (!due) return '';
  const day = Number(
    due.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/Los_Angeles' })
  );
  return `${pacificTime(due)} on the ${ordinal(day)}`;
}

function pacificDay(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles',
  });
}

function renderPicks() {
  const panel = $('#panel-picks');
  if (!panel) return;

  const body = $('#picks-body', panel);
  body.replaceChildren();
  draft.selected = [];

  const due = draftDeadlineDate();

  if (!picksAreOpen()) {
    $('#picks-note', panel).textContent = 'The draft is closed.';
    body.appendChild(picksClosedCard(due));
    return;
  }

  $('#picks-note', panel).textContent = draftDeadlineText();
  body.appendChild(buildPicksForm());
}

function picksClosedCard(due) {
  const box = el('div', 'empty');
  box.appendChild(el('h3', null, 'The draft is closed'));
  box.appendChild(el('p', null, due
    ? `Picks closed at ${pacificTime(due)} Pacific on ${pacificDay(due)}.`
    : 'Picks are closed for this season.'));
  box.appendChild(el('p', 'empty__aside', 'Every roster is on the Draft Board.'));
  return box;
}

/* ------------------------------------------------------------ the form --- */

function buildPicksForm() {
  const form = el('form', 'draft-form');

  form.appendChild(el('p', 'picks__lede',
    'Pick any three castaways. Other players can take the same people you do, '
    + 'so there is nothing to race for. Changed your mind? Fill this out again '
    + 'before the deadline and your newest entry is the one that counts.'));

  const buyin = (state.config.rules || {}).buyin || {};
  if (buyin.before) {
    const note = el('p', 'picks__buyin');
    note.appendChild(el('span', 'picks__buyin-tag', 'Buy in'));
    note.appendChild(document.createTextNode(buyinText(buyin.before, buyin.venmo)));
    form.appendChild(note);
  }

  form.appendChild(buildNameStep());
  form.appendChild(buildTileStep());

  const foot = el('div', 'picks__foot');
  const submit = el('button', 'picks__submit', 'Submit my picks');
  submit.type = 'submit';
  submit.disabled = true;
  foot.appendChild(submit);

  const status = el('p', 'picks__status');
  status.setAttribute('role', 'status');
  foot.appendChild(status);
  form.appendChild(foot);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handlePicksSubmit(form);
  });

  paintPicks(form);
  return form;
}

function buildNameStep() {
  const step = el('div', 'picks__step');
  const head = el('h3', 'picks__steph', 'Who are you?');
  head.prepend(el('span', 'picks__num', '1'));
  step.appendChild(head);

  const select = el('select', 'picks__select');
  select.setAttribute('aria-label', 'Your name');

  const placeholder = new Option('Choose your name', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  /* Sits above the roster so anyone new sees it straight away instead of
     scrolling past 27 names that are not theirs. */
  select.appendChild(new Option('I am not on this list', '__new'));

  const roster = document.createElement('optgroup');
  roster.label = state.season.players.length
    ? 'Players'
    : 'Last season\u2019s players';
  knownOwners().forEach((name) => roster.appendChild(new Option(name, name)));
  select.appendChild(roster);
  step.appendChild(select);

  const custom = el('input', 'picks__input');
  custom.type = 'text';
  custom.placeholder = 'First and last name';
  custom.autocomplete = 'name';
  custom.hidden = true;
  custom.setAttribute('aria-label', 'Your name');
  step.appendChild(custom);

  /* Someone who has submitted before comes back to their own name filled in. */
  const saved = rememberedOwner();
  if (saved) {
    if (knownOwners().includes(saved)) {
      select.value = saved;
    } else {
      select.value = '__new';
      custom.hidden = false;
      custom.value = saved;
    }
  }

  const sync = () => {
    custom.hidden = select.value !== '__new';
    if (!custom.hidden && !custom.value) custom.focus();
    paintPicks(select.closest('form'));
  };
  select.addEventListener('change', sync);
  custom.addEventListener('input', () => paintPicks(custom.closest('form')));

  return step;
}

function buildTileStep() {
  const step = el('div', 'picks__step');
  const head = el('h3', 'picks__steph', 'Pick three');
  head.prepend(el('span', 'picks__num', '2'));
  head.appendChild(el('span', 'picks__count'));
  step.appendChild(head);

  const grid = el('div', 'tiles');
  [...state.season.castaways]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((castaway) => grid.appendChild(castawayTile(castaway)));
  step.appendChild(grid);

  return step;
}

function castawayTile(castaway) {
  const tile = el('button', 'tile');
  tile.type = 'button';
  tile.dataset.name = castaway.name;
  tile.setAttribute('aria-pressed', 'false');

  const shot = el('div', 'tile__shot');
  if (state.config.features.castPhotos && castaway.photo) {
    const img = document.createElement('img');
    img.src = castaway.photo;
    img.alt = '';
    img.loading = 'lazy';
    /* A missing file falls back to initials rather than a hole in the grid. */
    img.addEventListener('error', () => {
      shot.classList.add('tile__shot--empty');
      shot.replaceChildren(document.createTextNode(initials(castaway.name)));
    });
    shot.appendChild(img);
  } else {
    shot.classList.add('tile__shot--empty');
    shot.textContent = initials(castaway.name);
  }
  tile.appendChild(shot);

  tile.appendChild(el('span', 'tile__badge'));

  /* The quick facts live on the tile so nobody has to bounce to the Cast
     tab and back while deciding. The full bios stay over there. */
  const body = el('div', 'tile__body');
  body.appendChild(el('span', 'tile__name', shortName(castaway.name)));

  const facts = [castaway.age, castaway.occupation].filter(Boolean).join(' \u00b7 ');
  if (facts) body.appendChild(el('span', 'tile__facts', facts));

  const from = castaway.residence || castaway.hometown;
  if (from) body.appendChild(el('span', 'tile__where', from));

  /* Tribes are not public until premiere night, so the line is always
     there and reads "Tribe TBD" until the Cast tab has the assignments. */
  const tribe = el('span', 'tile__tribe');
  const dot = el('span', 'tribe-dot');
  if (castaway.tribe) {
    const color = tribeColor(castaway.tribe);
    if (color) dot.style.background = color;
    tribe.appendChild(dot);
    tribe.appendChild(document.createTextNode(castaway.tribe));
  } else {
    tribe.classList.add('tile__tribe--tbd');
    tribe.appendChild(dot);
    tribe.appendChild(document.createTextNode('Tribe TBD'));
  }
  body.appendChild(tribe);

  tile.appendChild(body);

  tile.addEventListener('click', () => {
    const index = draft.selected.indexOf(castaway.name);
    if (index >= 0) draft.selected.splice(index, 1);
    else if (draft.selected.length < 3) draft.selected.push(castaway.name);
    paintPicks(tile.closest('form'));
  });

  return tile;
}

/** Single place that repaints tiles, counter and the submit button. */
function paintPicks(form) {
  if (!form) return;
  const full = draft.selected.length === 3;

  $$('.tile', form).forEach((tile) => {
    const index = draft.selected.indexOf(tile.dataset.name);
    const chosen = index >= 0;
    tile.classList.toggle('is-picked', chosen);
    tile.classList.toggle('is-muted', full && !chosen);
    tile.setAttribute('aria-pressed', String(chosen));
    $('.tile__badge', tile).textContent = chosen ? String(index + 1) : '';
  });

  const count = $('.picks__count', form);
  if (count) {
    count.textContent = full
      ? 'All three in'
      : `${draft.selected.length} of 3`;
    count.classList.toggle('is-full', full);
  }

  const submit = $('.picks__submit', form);
  if (submit) submit.disabled = !(full && ownerNameFrom(form));
}

function ownerNameFrom(form) {
  const select = $('.picks__select', form);
  const custom = $('.picks__input', form);
  const value = select.value === '__new' ? custom.value : select.value;
  const name = (value || '').trim().replace(/\s+/g, ' ');
  return name.length >= 2 ? name : '';
}

/* ------------------------------------------------------------ sending --- */

async function handlePicksSubmit(form) {
  const owner = ownerNameFrom(form);
  if (!owner || draft.selected.length !== 3) return;

  const submit = $('.picks__submit', form);
  const status = $('.picks__status', form);
  submit.disabled = true;
  submit.textContent = 'Sending...';
  status.textContent = '';
  status.className = 'picks__status';

  const chosen = [...draft.selected];

  try {
    const response = await sendPicks(owner, chosen);

    if (response.ok) {
      rememberOwner(owner);
      const panel = $('#panel-picks');
      $('#picks-body', panel).replaceChildren(picksDoneCard(owner, chosen));
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    /* A row level security refusal means the database shut the window,
       which can happen a minute before this page thinks it did. Say so
       plainly instead of bouncing them back to an empty form. */
    if (response.status === 401 || response.status === 403) {
      const panel = $('#panel-picks');
      $('#picks-note', panel).textContent = 'The draft is closed.';
      $('#picks-body', panel).replaceChildren(picksClosedCard(draftDeadlineDate()));
      return;
    }

    throw new Error(`${response.status} ${await response.text()}`);
  } catch (error) {
    console.error('Pick submission failed', error);
    status.textContent =
      'That did not save. Check your connection and try again, or text Ryan your three.';
    status.classList.add('picks__status--bad');
    submit.disabled = false;
    submit.textContent = 'Submit my picks';
  }
}

function sendPicks(owner, chosen) {
  const cfg = state.config.supabase || {};
  return fetch(`${cfg.url}/rest/v1/picks`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      season: state.season.season,
      owner_name: owner,
      pick1: chosen[0],
      pick2: chosen[1],
      pick3: chosen[2],
    }),
  });
}

/**
 * The payout, answered where they are standing. Sending someone to the Rules
 * tab from the confirmation would throw away the confirmation they just
 * earned, and they would have to submit again to see it.
 */
function buildPayout() {
  const prize = (state.config.rules || {}).prize || {};
  const box = el('div', 'payout');

  if (prize.buyin) box.appendChild(el('p', 'payout__buyin', prize.buyin));

  (prize.places || []).forEach((row) => {
    const line = el('div', 'payout__row');
    line.appendChild(el('span', 'payout__place', row.place));
    line.appendChild(el('span', 'payout__gets', row.gets));
    box.appendChild(line);
  });

  if (prize.note) box.appendChild(el('p', 'payout__note', prize.note));
  return box;
}

function showPotDialog() {
  const rules = state.config.rules || {};

  const dialog = el('dialog', 'modal');
  dialog.setAttribute('aria-labelledby', 'pot-title');

  const card = el('div', 'modal__card');
  const title = el('h3', 'modal__title', 'How the pot pays out');
  title.id = 'pot-title';
  card.appendChild(title);
  card.appendChild(buildPayout());

  const foot = el('div', 'modal__foot');

  const more = el('button', 'picks__link', 'See all the rules');
  more.type = 'button';
  more.addEventListener('click', () => {
    dialog.close();
    selectPanel('rules');
  });
  foot.appendChild(more);

  const done = el('button', 'modal__close', 'Got it');
  done.type = 'button';
  done.addEventListener('click', () => dialog.close());
  foot.appendChild(done);

  card.appendChild(foot);
  dialog.appendChild(card);

  // Clicking the dimmed area around the card closes it, as does Escape,
  // which the dialog element handles on its own.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());

  document.body.appendChild(dialog);
  dialog.showModal();
}

/** Swaps Becky's name for her Venmo handle once one is set in config.json. */
function buyinText(text, venmo) {
  if (!venmo || text.includes(venmo)) return text;
  /* Two phrasings to cover: the form says "Venmo Becky", the confirmation
     card says "get Becky your $10". Either way the handle lands once. */
  if (text.includes('Venmo Becky')) {
    return text.replace('Venmo Becky', `Venmo Becky at ${venmo}`);
  }
  return text.replace('Becky', `Becky (${venmo})`);
}

function picksDoneCard(owner, chosen) {
  const box = el('div', 'picks__done');
  box.appendChild(el('div', 'picks__tick', '✓'));
  box.appendChild(el('h3', null, 'Your picks are in'));
  box.appendChild(el('p', 'picks__doneline', `${shortName(owner)}, you are drafting:`));

  const row = el('div', 'tiles tiles--mini');
  chosen.forEach((name) => {
    const castaway = castawayByName(name) || { name };
    const tile = el('div', 'tile is-picked');

    const shot = el('div', 'tile__shot');
    if (castaway.photo) {
      const img = document.createElement('img');
      img.src = castaway.photo;
      img.alt = '';
      shot.appendChild(img);
    } else {
      shot.classList.add('tile__shot--empty');
      shot.textContent = initials(name);
    }
    tile.appendChild(shot);
    const body = el('div', 'tile__body');
    body.appendChild(el('span', 'tile__name', shortName(name)));
    tile.appendChild(body);
    row.appendChild(tile);
  });
  box.appendChild(row);

  /* The deadline, said like a person rather than a receipt. The heading
     above already told them the picks landed. */
  const copy = (state.config.picks || {}).confirmation;
  const when = shortDeadline();
  if (copy && when) {
    box.appendChild(el('p', 'picks__stamp', copy.replace('{deadline}', when)));
  } else if (copy) {
    box.appendChild(el('p', 'picks__stamp', draftDeadlineText()));
  }

  const buyin = (state.config.rules || {}).buyin || {};
  if (buyin.after) {
    const ask = el('div', 'picks__owe');
    ask.appendChild(el('strong', null, buyinText(buyin.after, buyin.venmo)));

    const link = el('button', 'picks__link', 'How the pot pays out');
    link.type = 'button';
    link.addEventListener('click', showPotDialog);
    ask.appendChild(link);
    box.appendChild(ask);
  }

  const again = el('button', 'picks__again', 'Change my picks');
  again.type = 'button';
  again.addEventListener('click', renderPicks);
  box.appendChild(again);

  return box;
}

document.addEventListener('DOMContentLoaded', boot);
