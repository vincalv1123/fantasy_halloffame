// Loads everything the Hall of Fame needs from Sleeper's public API.
// Finished seasons never change, so they are cached in the browser;
// the current season is always fetched fresh.


const API = 'https://api.sleeper.app/v1';
const CACHE_VERSION = 'v3';

async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('Sleeper returned ' + res.status + ' for ' + path);
  return res.json();
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem('hof:' + CACHE_VERSION + ':' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function cacheSet(key, value) {
  try { localStorage.setItem('hof:' + CACHE_VERSION + ':' + key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
}

// Player names and positions. The full list is ~5 MB, so keep a slim copy for a day.
async function loadPlayers() {
  const cached = cacheGet('players');
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000) return cached.players;
  const all = await get('/players/nfl');
  const players = {};
  for (const id in all) {
    const p = all[id];
    const pos = p.position || (p.fantasy_positions && p.fantasy_positions[0]) || '';
    const name = pos === 'DEF' ? (p.last_name ? p.first_name + ' ' + p.last_name : id) : ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    players[id] = [name || id, pos];
  }
  cacheSet('players', { at: Date.now(), players });
  return players;
}

// Find this season's version of the league: start from the visitor's account and pick the league
// whose history chain contains the chosen one, so a renewed league shows up automatically.
async function findCurrentLeagueId(state, leagueId, username) {
  if (!username) return leagueId;
  try {
    const user = await get('/user/' + encodeURIComponent(username));
    if (!user || !user.user_id) return leagueId;
    for (const season of [state.season, String(Number(state.season) + 1)]) {
      const leagues = await get('/user/' + user.user_id + '/leagues/nfl/' + season);
      for (const lg of leagues || []) {
        let id = lg.league_id;
        for (let hops = 0; id && id !== '0' && hops < 20; hops++) {
          if (id === leagueId) return lg.league_id;
          const prev = id === lg.league_id ? lg.previous_league_id : (await get('/league/' + id)).previous_league_id;
          id = prev;
        }
      }
    }
  } catch (e) { /* fall back below */ }
  return leagueId;
}

async function loadSeason(league, state, isCurrent) {
  const id = league.league_id;
  const pstart = league.settings.playoff_week_start || 15;
  const lastWeek = pstart + 2;
  const weeks = [];
  for (let w = 1; w <= lastWeek; w++) weeks.push(w);
  const [users, rosters, winners, losers, picks] = await Promise.all([
    get('/league/' + id + '/users'),
    get('/league/' + id + '/rosters'),
    get('/league/' + id + '/winners_bracket').catch(() => []),
    get('/league/' + id + '/losers_bracket').catch(() => []),
    league.draft_id ? get('/draft/' + league.draft_id + '/picks').catch(() => []) : Promise.resolve([])
  ]);
  const matchups = await Promise.all(weeks.map(w => get('/league/' + id + '/matchups/' + w).catch(() => [])));
  const transactions = await Promise.all(weeks.concat([lastWeek + 1]).map(w => get('/league/' + id + '/transactions/' + w).catch(() => [])));
  // Managers who later left the league drop off the users list; look them up directly.
  const known = new Set(users.map(u => u.user_id));
  const missing = rosters.map(r => r.owner_id).filter(o => o && !known.has(o));
  const extra = await Promise.all(missing.map(o => get('/user/' + o).catch(() => null)));
  extra.forEach(u => { if (u && u.user_id) users.push({ user_id: u.user_id, display_name: u.display_name, metadata: {}, avatar: u.avatar }); });
  const scoredThrough = isCurrent
    ? (league.settings.last_scored_leg || Math.max(0, (state.week || 1) - 1))
    : lastWeek;
  return {
    leagueId: id,
    season: league.season,
    name: league.name,
    status: league.status,
    totalRosters: league.total_rosters,
    rosterPositions: league.roster_positions,
    playoffWeekStart: pstart,
    playoffTeams: league.settings.playoff_teams || 6,
    waiverType: league.settings.waiver_type,
    waiverBudget: league.settings.waiver_budget,
    scoredThrough,
    currentWeek: isCurrent ? state.week : null,
    scoring: league.scoring_settings || {},
    users: users.map(u => ({ user_id: u.user_id, display_name: u.display_name, team_name: u.metadata && u.metadata.team_name, avatar: u.avatar })),
    rosters: rosters.map(r => ({ roster_id: r.roster_id, owner_id: r.owner_id, taxi: r.taxi || [] })),
    winners, losers,
    picks: (picks || []).map(p => ({ round: p.round, pick_no: p.pick_no, player_id: p.player_id, roster_id: p.roster_id, picked_by: p.picked_by, pos: p.metadata && p.metadata.position })),
    matchups: matchups.map(week => (week || []).map(m => ({
      roster_id: m.roster_id, matchup_id: m.matchup_id, points: m.points || 0,
      starters: m.starters || [], players: m.players || [], players_points: m.players_points || {}
    }))),
    transactions: [].concat.apply([], transactions).filter(t => t && t.status === 'complete').map(t => ({
      type: t.type, leg: t.leg, adds: t.adds || {}, drops: t.drops || {}, roster_ids: t.roster_ids || [],
      bid: t.settings && t.settings.waiver_bid, created: t.created,
      picks: (t.draft_picks || []).map(d => ({ season: d.season, round: d.round, from: d.previous_owner_id, to: d.owner_id, orig: d.roster_id }))
    }))
  };
}

export async function loadAll(league, onProgress) {
  const state = await get('/state/nfl');
  const currentId = await findCurrentLeagueId(state, league.leagueId, league.username);
  const chain = [];
  let id = currentId;
  while (id && id !== '0' && chain.length < 30) {
    const lg = await get('/league/' + id);
    if (!lg) break;
    chain.push(lg);
    id = lg.previous_league_id;
  }
  const seasons = [];
  for (let i = 0; i < chain.length; i++) {
    const lg = chain[i];
    const done = lg.status === 'complete';
    onProgress && onProgress('Loading ' + lg.season + ' season…');
    let season = done ? cacheGet('season:' + lg.league_id) : null;
    if (!season) {
      season = await loadSeason(lg, state, !done);
      if (done) cacheSet('season:' + lg.league_id, season);
    }
    seasons.push(season);
  }
  onProgress && onProgress('Loading player names…');
  const players = await loadPlayers();
  return { state, seasons: seasons.sort((a, b) => Number(b.season) - Number(a.season)), players };
}

// Just the current week's scores, for the live tab's refresh.
export async function loadLiveWeek(leagueId, week) {
  return get('/league/' + leagueId + '/matchups/' + week);
}

// ---------- start screen ----------
export async function lookupUser(username) {
  const res = await fetch(API + '/user/' + encodeURIComponent(username.trim()));
  if (!res.ok) return null;
  return res.json();
}

export async function nflState() { return get('/state/nfl'); }

// The visitor's football leagues for this season and last, newest version of each league only.
export async function userLeagues(userId, season) {
  const seasons = [String(season), String(Number(season) - 1)];
  const lists = await Promise.all(seasons.map(s => get('/user/' + userId + '/leagues/nfl/' + s).catch(() => [])));
  const all = [].concat.apply([], lists);
  const superseded = new Set(all.map(l => l.previous_league_id).filter(Boolean));
  return all.filter(l => !superseded.has(l.league_id)).map(l => ({
    id: l.league_id, name: l.name, season: l.season, teams: l.total_rosters, status: l.status, avatar: l.avatar,
    format: l.settings && l.settings.type === 2 ? 'dynasty' : l.settings && l.settings.type === 1 ? 'keeper' : 'redraft',
    superflex: (l.roster_positions || []).indexOf('SUPER_FLEX') >= 0
  })).sort((a, b) => Number(b.season) - Number(a.season) || a.name.localeCompare(b.name));
}

export async function leagueInfo(id) {
  const l = await get('/league/' + id);
  if (!l) return null;
  return { id: l.league_id, name: l.name, season: l.season, format: l.settings && l.settings.type === 2 ? 'dynasty' : l.settings && l.settings.type === 1 ? 'keeper' : 'redraft' };
}

// ---------- live projections ----------
// Sleeper's own weekly projections and NFL schedule. These come from api.sleeper.com, which the
// Sleeper app uses but isn't an official public API, so callers handle failure.
const SITE = 'https://api.sleeper.com';
export async function loadProjections(season, week) {
  const pos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => 'position[]=' + p).join('&');
  const res = await fetch(SITE + '/projections/nfl/' + season + '/' + week + '?season_type=regular&' + pos);
  if (!res.ok) throw new Error('projections ' + res.status);
  const list = await res.json();
  const out = {};
  list.forEach(x => { out[x.player_id] = { stats: x.stats || {}, team: x.team, injury: x.player && x.player.injury_status }; });
  return out;
}
export async function loadSchedule(season) {
  const res = await fetch(SITE + '/schedule/nfl/regular/' + season);
  if (!res.ok) throw new Error('schedule ' + res.status);
  return res.json();
}
