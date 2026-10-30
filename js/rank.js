// Ranking questions: "best season ever by manager score", "worst 1st round pick by points per game",
// "most points in a loss", "luckiest manager", "best QB pickup 2025"…
// Works out what is being ranked (entity), by what (metric), which way, and any filters.

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = x => (Math.round((x || 0) * 10) / 10).toFixed(1);
const f2 = x => (Math.round((x || 0) * 100) / 100).toFixed(2);
const pct = x => (x * 100).toFixed(1) + '%';
const p3 = x => x.toFixed(3).replace(/^0/, '');
const sgn = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1);
const wl = (w, l, t) => w + '–' + l + (t ? '–' + t : '');
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

const POS = { qb: 'QB', qbs: 'QB', quarterback: 'QB', quarterbacks: 'QB', rb: 'RB', rbs: 'RB', 'running back': 'RB', 'running backs': 'RB',
  wr: 'WR', wrs: 'WR', receiver: 'WR', receivers: 'WR', 'wide receiver': 'WR', te: 'TE', tes: 'TE', 'tight end': 'TE', 'tight ends': 'TE',
  k: 'K', kicker: 'K', kickers: 'K', def: 'DEF', dst: 'DEF', defense: 'DEF', defenses: 'DEF' };
const ROUND_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

// ---------- parsing ----------
export function parseRank(t) {
  const best = /\b(best|greatest|top|highest|most|biggest|luckiest|largest|leading|mvp|steal)\b/.test(t);
  const worst = /\b(worst|lowest|fewest|least|smallest|unluckiest|bust|weakest|closest)\b/.test(t);
  if (!best && !worst) return null;
  const goodness = /\b(best|worst|greatest|luckiest|unluckiest|steal|bust|weakest)\b/.test(t);
  const desc = best && !worst;
  const sup = (t.match(/\b(best|greatest|top|highest|most|biggest|luckiest|largest|leading|worst|lowest|fewest|least|smallest|unluckiest|weakest|closest)\b/) || [])[1] || '';

  let entity = null;
  if (/\b(draft picks?|picks?|drafted|selections?)\b/.test(t) || /\bround\b/.test(t)) entity = 'pick';
  else if (/\btrades?\b/.test(t)) entity = 'trade';
  else if (/\b(pickups?|waiver|waivers|adds?|free agents?|faab)\b/.test(t)) entity = 'pickup';
  else if ((/\b(player|players)\b/.test(t) || Object.keys(POS).some(k => new RegExp('\\b' + k + '\\b').test(t))) && /\bseasons?\b/.test(t)) entity = 'playerSeason';
  else if (/\b(blowout|blowouts|closest|margin)\b/.test(t)) entity = 'game';
  else if (/\b(in a loss|in a win)\b/.test(t)) entity = 'score';
  else if (/\bseasons?\b|\byears?\b/.test(t)) entity = 'season';
  else if (/\b(managers?|owners?|careers?|ever had|of all time|all-time)\b/.test(t) && !/\b(player|performance|score|week|game)\b/.test(t)) entity = 'manager';
  else if (/\b(player|players|performance|performances|starter|scorer)\b/.test(t) || Object.keys(POS).some(k => new RegExp('\\b' + k + '\\b').test(t))) entity = 'perf';
  else if (/\b(score|scores|scored|week|weeks|game|games|team)\b/.test(t)) entity = 'score';
  else if (/\b(luck|luckiest|unluckiest|clutch|titles?|championships?|win %|win percentage|record)\b/.test(t)) entity = 'manager';
  if (!entity) return null;

  let metric = null;
  if (/\b(manager score|manager rating|rating|manager scores)\b/.test(t)) metric = 'score';
  else if (/\b(points per game|per game|ppg|average|avg)\b/.test(t)) metric = 'ppg';
  else if (/\b(luck|luckiest|unluckiest)\b/.test(t)) metric = 'luck';
  else if (/\bclutch\b/.test(t)) metric = 'clutch';
  else if (/\b(titles?|championships?|rings?)\b/.test(t)) metric = 'titles';
  else if (/\b(win %|win percentage|winning percentage|win pct)\b/.test(t)) metric = 'winPct';
  else if (/\bwins\b/.test(t)) metric = 'wins';
  else if (/\b(all-play|all play)\b/.test(t)) metric = 'allPlay';
  else if (/\b(start\/sit|start sit|lineup|efficiency)\b/.test(t)) metric = 'startSit';
  else if (/\bbench\b/.test(t)) metric = 'bench';
  else if (/\b(points against|pa)\b/.test(t)) metric = 'pa';
  else if (/\b(value|vs slot|steal|bust)\b/.test(t)) metric = 'value';
  else if (entity === 'season' && /\btrades?\b/.test(t)) metric = 'trades';
  else if (entity === 'season' && /\b(waivers?|pickups?)\b/.test(t)) metric = 'waivers';
  else if (/\b(points|pts|scoring|scored|score)\b/.test(t)) metric = 'points';

  const r = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?[- ]round\b/) || t.match(/\bround (\d{1,2})\b/);
  const rw = t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[- ]round\b/);
  const round = r ? Number(r[1]) : rw ? ROUND_WORDS[rw[1]] : null;
  let pos = null;
  Object.keys(POS).sort((a, b) => b.length - a.length).some(k => { if (new RegExp('\\b' + k + '\\b').test(t)) { pos = POS[k]; return true; } return false; });
  const playoffs = /\bplayoffs?\b/.test(t);
  const inLoss = /\bin a loss\b/.test(t); const inWin = /\bin a win\b/.test(t);
  const blowout = /\bblowouts?\b/.test(t); const closest = /\bclosest\b/.test(t);
  return { desc, sup, goodness, entity, metric, round, pos, playoffs, inLoss, inWin, blowout, closest };
}

// ---------- helpers over the model ----------
function playerSeasonStats(S) {
  if (S._pss) return S._pss;
  const out = {};
  S.regWeeks.forEach(w => Object.values(S.byWeek[w]).forEach(m => Object.keys(m.players_points).forEach(pid => {
    const p = m.players_points[pid] || 0;
    const x = out[pid] = out[pid] || { pts: 0, games: 0 };
    x.pts += p; if (p !== 0) x.games++;
  })));
  S._pss = out;
  return out;
}

// ---------- ranking ----------
export function rankAnswer(M, P, R) {
  const link = id => `<a href="${M.px}m-${encodeURIComponent(id)}">${esc(M.nameOf(id))}</a>`;
  const seasons = M.seasons.filter(S => !P.season || S.season === P.season);
  if (!seasons.length) return null;
  const mgr = P.managers[0] || null;
  const pid = P.players[0] || null;
  const rows = [];
  let metric = R.metric; let entityLabel = ''; let metricLabel = ''; let lowerIsBetter = false; let fmt = f1; let note = '';
  const ok = (S, r) => !mgr || S.ownerOf[r] === mgr;

  if (R.entity === 'season') {
    metric = metric || 'score';
    const M2 = {
      score: ['Manager Score', (S, r) => S.scores[r].total, f1], wins: ['wins', (S, r) => S.st[r].wins, String], winPct: ['win %', (S, r) => S.st[r].winPct, p3],
      points: ['points for', (S, r) => S.st[r].pf, f1], ppg: ['points per game', (S, r) => S.st[r].games ? S.st[r].pf / S.st[r].games : 0, f2],
      pa: ['points against', (S, r) => S.st[r].pa, f1], allPlay: ['all-play win %', (S, r) => S.st[r].allPlayPct, p3], luck: ['luck', (S, r) => S.st[r].luck, sgn],
      startSit: ['start/sit %', (S, r) => S.efficiency[r].pct, pct], bench: ['bench points left', (S, r) => S.efficiency[r].benchLeft, f1],
      waivers: ['waiver pts above replacement', (S, r) => S.waivers[r].pts, f1], trades: ['trade net', (S, r) => S.tradeNet[r].net, sgn], value: ['draft value', (S, r) => S.draftValue[r], sgn]
    }[metric] || null;
    if (!M2) return null;
    entityLabel = 'season'; metricLabel = M2[0]; fmt = M2[2]; lowerIsBetter = metric === 'pa' || metric === 'bench';
    seasons.forEach(S => S.rids.forEach(r => { if (!ok(S, r)) return; const st = S.st[r];
      rows.push({ v: M2[1](S, r), label: link(S.ownerOf[r]) + ' · ' + S.season + (S.isCurrent ? ' <span class="note">so far</span>' : ''), sub: wl(st.wins, st.losses, st.ties) + ' · ' + ordinal(st.rank) + (S.champion === r ? ' · champion' : S.lastPlace === r ? ' · last place' : '') }); }));
  } else if (R.entity === 'manager') {
    metric = metric || 'score';
    const M2 = {
      score: ['career Manager Score', c => c.score, f1], titles: ['titles', c => c.titles, String], wins: ['wins', c => c.wins, String], winPct: ['win %', c => c.winPct, p3],
      points: ['points for', c => c.pf, f1], ppg: ['points per game', c => c.ppg, f2], luck: ['luck', c => c.luck, sgn], clutch: ['clutch rating', c => (c.clutch == null ? null : c.clutch * 100), x => sgn(x) + '%'],
      startSit: ['start/sit %', c => c.effPct, pct], bench: ['bench points left', c => c.benchLeft, f1], trades: ['trade net', c => c.tradeNet, sgn], waivers: ['waiver pts above replacement', c => c.waiverPts, f1]
    }[metric] || null;
    if (!M2) return null;
    entityLabel = 'manager'; metricLabel = M2[0]; fmt = M2[2]; lowerIsBetter = metric === 'bench';
    M.leaderboard.forEach(c => { const v = M2[1](c); if (v == null) return; rows.push({ v, label: link(c.id), sub: wl(c.wins, c.losses, c.ties) + ' · ' + c.titles + ' title' + (c.titles === 1 ? '' : 's') }); });
    if (P.season) note = 'Career stats cover every season.';
  } else if (R.entity === 'pick') {
    metric = metric === 'ppg' || metric === 'points' ? metric : 'value';
    entityLabel = (R.round ? ordinal(R.round) + '-round ' : '') + (R.pos ? R.pos + ' ' : '') + 'pick';
    metricLabel = metric === 'ppg' ? 'points per game' : metric === 'points' ? 'season points' : 'positional value vs. slot';
    fmt = metric === 'value' ? sgn : metric === 'ppg' ? f2 : f1;
    const minGames = metric === 'ppg' ? 4 : 0;
    seasons.forEach(S => { const ps = playerSeasonStats(S);
      S.picks.forEach(p => {
        if (R.round && p.round !== R.round) return; if (R.pos && p.pos !== R.pos) return; if (!ok(S, p.roster_id)) return;
        const st = ps[p.player_id] || { pts: 0, games: 0 };
        if (st.games < Math.min(minGames, S.isCurrent ? 2 : minGames)) return;
        const v = metric === 'ppg' ? (st.games ? st.pts / st.games : 0) : metric === 'points' ? st.pts : p.value;
        const slot = p.round + '.' + String(((p.pick_no - 1) % S.rids.length) + 1).padStart(2, '0');
        rows.push({ v, label: esc(M.playerName(p.player_id)) + ' <span class="note">' + esc(p.pos) + (S.posRank[p.player_id] ? S.posRank[p.player_id] : '') + '</span>',
          sub: link(S.ownerOf[p.roster_id]) + ' · ' + S.season + ' pick ' + slot + ' · ' + f1(st.pts) + ' pts in ' + st.games + ' games' + (S.isCurrent ? ' so far' : '') });
      }); });
    if (metric === 'ppg') note = 'Points per game counts weeks the player scored, regular season only, with at least 4 games (2 for the current season).';
  } else if (R.entity === 'trade') {
    entityLabel = 'trade'; metricLabel = 'net trade value'; fmt = sgn;
    M.allTrades.forEach(t => { if (P.season && t.season !== P.season) return;
      t.sides.forEach(s => { if (mgr && s.owner !== mgr) return;
        const others = t.sides.filter(x => x !== s).map(x => link(x.owner)).join(' & ');
        rows.push({ v: s.net, label: link(s.owner) + ' with ' + others, sub: t.season + ' · Week ' + t.week + ' · got ' + (s.got.map(g => esc(M.playerName(g.pid))).join(', ') || 'picks') + ' for ' + (s.sent.map(g => esc(M.playerName(g.pid))).join(', ') || 'picks') }); }); });
  } else if (R.entity === 'pickup') {
    entityLabel = (R.pos ? R.pos + ' ' : '') + 'pickup'; metricLabel = 'points above replacement after the pickup'; fmt = f1;
    seasons.forEach(S => S.rids.forEach(r => { if (!ok(S, r)) return; (S.waivers[r].list || []).forEach(a => {
      if (R.pos && S.posOf(a.pid) !== R.pos) return;
      rows.push({ v: a.pts, label: esc(M.playerName(a.pid)) + ' <span class="note">' + esc(S.posOf(a.pid)) + '</span>', sub: link(S.ownerOf[r]) + ' · ' + S.season + ' Week ' + a.week + ' · ' + f1(a.raw != null ? a.raw : a.pts) + ' pts in ' + a.starts + ' starts' + (a.bid ? ' · $' + a.bid : '') }); }); }));
  } else if (R.entity === 'playerSeason') {
    metric = metric === 'ppg' ? 'ppg' : 'points';
    entityLabel = (R.pos ? R.pos + ' ' : 'player ') + 'season'; metricLabel = metric === 'ppg' ? 'starter points per start' : 'starter points for one team';
    fmt = metric === 'ppg' ? f2 : f1;
    seasons.forEach(S => S.rids.forEach(r => { if (!ok(S, r)) return;
      const tot = {};
      for (let w = 1; w <= S.scoredThrough; w++) { const m = S.byWeek[w] && S.byWeek[w][r]; if (!m) continue;
        m.starters.forEach(p => { if (!p || p === '0') return; const x = tot[p] = tot[p] || { pts: 0, starts: 0 }; x.pts += m.players_points[p] || 0; x.starts++; }); }
      Object.keys(tot).forEach(p => { if (R.pos && S.posOf(p) !== R.pos) return; if (pid && p !== pid) return; const x = tot[p];
        if (metric === 'ppg' && x.starts < 6) return;
        rows.push({ v: metric === 'ppg' ? x.pts / x.starts : x.pts, label: esc(M.playerName(p)) + ' <span class="note">' + esc(S.posOf(p)) + '</span>', sub: link(S.ownerOf[r]) + ' · ' + S.season + ' · ' + x.starts + ' starts' + (S.isCurrent ? ' so far' : '') }); }); }));
    if (metric === 'ppg') note = 'At least 6 starts.';
  } else if (R.entity === 'perf') {
    entityLabel = (R.pos ? R.pos + ' ' : 'player ') + 'game'; metricLabel = 'points as a starter'; fmt = f2;
    seasons.forEach(S => S.rids.forEach(r => { if (!ok(S, r)) return;
      for (let w = 1; w <= S.scoredThrough; w++) { const m = S.byWeek[w] && S.byWeek[w][r]; if (!m) continue;
        const po = w >= S.playoffWeekStart; if (R.playoffs && !(po && S.games.some(g => g.week === w && (g.a === r || g.b === r)))) continue;
        if (w >= S.playoffWeekStart && !R.playoffs && !S.games.some(g => g.week === w && (g.a === r || g.b === r))) continue;
        m.starters.forEach(p => { if (!p || p === '0') return; if (R.pos && S.posOf(p) !== R.pos) return; if (pid && p !== pid) return;
          rows.push({ v: m.players_points[p] || 0, label: esc(M.playerName(p)) + ' <span class="note">' + esc(S.posOf(p)) + '</span>', sub: link(S.ownerOf[r]) + ' · ' + S.season + ' Week ' + w + (po ? ' · playoffs' : '') }); }); } }));
  } else if (R.entity === 'score' || R.entity === 'game') {
    const games = [];
    seasons.forEach(S => S.games.forEach(g => { if (R.playoffs && !g.playoff) return; games.push({ S, g }); }));
    if (R.entity === 'game' || R.blowout || R.closest) {
      entityLabel = R.closest ? 'closest game' : 'blowout'; metricLabel = 'margin'; fmt = f2;
      games.forEach(({ S, g }) => { if (g.ap === g.bp) return; const wnr = g.ap > g.bp ? g.a : g.b; const lsr = wnr === g.a ? g.b : g.a;
        if (mgr && S.ownerOf[wnr] !== mgr && S.ownerOf[lsr] !== mgr) return;
        rows.push({ v: Math.abs(g.ap - g.bp), label: link(S.ownerOf[wnr]) + ' over ' + link(S.ownerOf[lsr]), sub: S.season + ' Week ' + g.week + ' · ' + f2(Math.max(g.ap, g.bp)) + '–' + f2(Math.min(g.ap, g.bp)) + (g.playoff ? ' · playoffs' : '') }); });
      if (R.closest) { R = { ...R, desc: false, goodness: false }; }
    } else {
      entityLabel = 'score' + (R.inLoss ? ' in a loss' : R.inWin ? ' in a win' : ''); metricLabel = 'points'; fmt = f2;
      games.forEach(({ S, g }) => [[g.a, g.ap, g.bp, g.b], [g.b, g.bp, g.ap, g.a]].forEach(([r, mine, theirs, opp]) => {
        if (!ok(S, r)) return; if (R.inLoss && !(mine < theirs)) return; if (R.inWin && !(mine > theirs)) return; if (mine <= 0) return;
        rows.push({ v: mine, label: link(S.ownerOf[r]) + ' · ' + S.season + ' Week ' + g.week, sub: (mine > theirs ? 'Beat ' : mine < theirs ? 'Lost to ' : 'Tied ') + link(S.ownerOf[opp]) + ' ' + f2(mine) + '–' + f2(theirs) + (g.playoff ? ' · playoffs' : '') }); }));
    }
  }
  if (!rows.length) return `<div class="answer"><h2 class="ans-title">Nothing matches that.</h2><p class="lead">Try fewer filters, or a different season or round.</p></div>`;

  // Direction: "best/worst" follow whether higher is better; "most/least" follow the raw number.
  let desc = R.desc;
  if (R.goodness && lowerIsBetter) desc = !desc;
  rows.sort((a, b) => (desc ? b.v - a.v : a.v - b.v));
  const top = rows.slice(0, 10);
  const scope = (P.season ? (R.entity === 'manager' ? '' : ' of ' + P.season) : ' ever') + (mgr ? ' for ' + esc(M.nameOf(mgr)) : '') + (R.playoffs ? ' in the playoffs' : '');
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  let head;
  if (R.entity === 'game') head = (R.closest ? 'Closest game' : 'Biggest blowout') + scope;
  else if (R.entity === 'score' || R.entity === 'perf') head = (desc ? 'Highest ' : 'Lowest ') + entityLabel + scope;
  else if (metric === 'luck') head = (desc ? 'Luckiest ' : 'Unluckiest ') + entityLabel + scope;
  else if (R.goodness) head = (R.desc ? 'Best ' : 'Worst ') + entityLabel + scope + ' by ' + metricLabel;
  else head = cap(R.sup && /highest|lowest/.test(R.sup) ? R.sup : desc ? 'most' : 'fewest') + ' ' + metricLabel + (R.entity === 'season' ? ' in a season' : R.entity === 'manager' ? '' : ' for a ' + entityLabel) + scope;
  const ties = rows.filter(x => x.v === top[0].v).length;
  head += ': ' + top[0].label.replace(/<span class="note">.*?<\/span>/, '').trim() + ', ' + fmt(top[0].v) + (ties > 1 ? ' (tied with ' + (ties - 1) + ' other' + (ties > 2 ? 's' : '') + ')' : '') + '.';
  return `<div class="answer"><h2 class="ans-title">${head}</h2>
    <div class="rows">${top.map((x, i) => `<div class="row" style="grid-template-columns:28px minmax(0,1fr) auto;padding:11px 0">
      <span class="num" style="font-size:12px;color:${i === 0 ? '#E8B04B' : '#8A9C9F'}">${i + 1}</span>
      <span class="stack"><span style="font-size:14px;font-weight:500">${x.label}</span><span class="sub">${x.sub}</span></span>
      <span class="num" style="font-size:15px">${fmt(x.v)}</span></div>`).join('')}</div>
    <p class="note" style="margin:0">Top ${top.length} of ${rows.length}${note ? '. ' + note : '.'}</p></div>`;
}
