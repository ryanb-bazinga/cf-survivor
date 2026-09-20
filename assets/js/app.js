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
  boots: null,
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

    // Eliminations are not a scoring category, so the workbook does not
    // know who went home. data/boots<NN>.json carries that, written in the
    // same pass as the weekly recap. Missing file is fine.
    state.boots = await loadJSON(
      `data/boots${state.config.currentSeason}.json`
    ).catch(() => null);
    applyBoots();

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
  { id: 'recaps', label: 'Episodes', flag: 'episodeRecaps' },
  { id: 'draft', label: 'Draft Board', flag: 'draftBoard' },
  { id: 'cast', label: 'Cast', flag: 'castTracker' },
  { id: 'rules', label: 'Rules', flag: 'scoringRules' },
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

/** The expanded half of a cast card: their own answers, verbatim. */
function buildBio(castaway, bio, labels) {
  const panel = el('div', 'castaway__bio');

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

  return panel;
}

/* ----------------------------------------------------- boot order --- */

/**
 * Folds data/boots<NN>.json into the castaway list. The workbook wins
 * where it already knows someone is out, because it carries the scoring
 * context (went out holding an idol, quit, medical). Everyone else picks
 * up their exit from this file.
 */
function applyBoots() {
  const boots = (state.boots && state.boots.boots) || [];
  if (!boots.length) return;

  const byName = new Map(state.season.castaways.map((c) => [c.name, c]));
  const missing = [];

  boots.forEach((boot) => {
    const castaway = byName.get(boot.name);
    if (!castaway) {
      missing.push(boot.name);
      return;
    }
    castaway.out_votes = boot.votes || null;
    if (castaway.status === 'OUT') return;
    castaway.status = 'OUT';
    castaway.out_episode = boot.episode;
    castaway.out_reason = boot.reason || 'Voted out';
  });

  // A typo in a name would quietly drop someone from the boot list, so
  // say so in the console rather than rendering a wrong board.
  if (missing.length) {
    console.warn(`boots${state.season.season}.json: no castaway named`, missing);
  }
}

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
    if (castaway.out_votes) detail.push(`Vote ${castaway.out_votes}`);
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

function renderRules() {
  const panel = $('#panel-rules');
  if (!panel) return;

  const rules = state.config.rules || {};
  const defs = rules.definitions || {};

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
        kind === 'pos' ? 'Points you want' : 'Points you do not'
      )
    );
    items.forEach((item) => {
      const row = el('div', 'rules__row');
      const label = el('div', 'rules__label');
      label.appendChild(el('span', 'rules__name', item.label));
      if (defs[item.label]) label.appendChild(el('span', 'rules__def', defs[item.label]));
      row.appendChild(label);
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
