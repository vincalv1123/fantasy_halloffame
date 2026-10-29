// Stat search: reads a plain-English question, works out which manager(s),
// season, week and player it is about, and answers from the league data.
// Rule-based, so it understands the question shapes listed in EXAMPLES and HELP.

import { parseRank, rankAnswer } from './rank.js?v=202610290537';

export const EXAMPLES = [
  'Best season ever by manager score',
  'Worst 1st round pick by points per game',
  'Most points in a loss',
  'Luckiest manager',
  'Biggest blowout in the playoffs',
  'Best QB pickup'
];

// Example questions built from a league's own managers and seasons.
export function examplesFor(M) {
  const S = M.seasons.find(s => !s.isCurrent) || M.seasons[0];
  if (!S || M.leaderboard.length < 2) return EXAMPLES;
  const a = M.leaderboard[0].id; const b = M.leaderboard[1].id;
  const an = M.nameOf(a); const bn = M.nameOf(b);
  const wk = n => Math.max(1, Math.min(n, S.scoredThrough));
  const rid = S.rids.find(r => S.ownerOf[r] === a);
  const mvp = rid != null && S.mvp[rid] ? M.playerName(S.mvp[rid].pid) : null;
  return [
    `${an}'s highest scoring player week ${wk(3)} ${S.season}`,
    'Best season ever by manager score',
    'Worst 1st round pick by points per game',
    `Who scored the most in week 1 ${S.season}?`,
    `${bn} lineup week ${wk(5)} ${S.season}`,
    `${an} vs ${bn}`,
    `${an} ${S.season} season`
  ].concat(mvp ? [`${mvp} points for ${an} ${S.season}`] : []);
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f2 = x => (Math.round((x || 0) * 100) / 100).toFixed(2);
const wl = (w, l, t) => w + '–' + l + (t ? '–' + t : '');
const STOP = new Set(['week', 'weeks', 'season', 'player', 'points', 'score', 'scored', 'highest', 'lowest', 'most', 'best', 'worst', 'game', 'games', 'team', 'with', 'from', 'what', 'which', 'when', 'where', 'lineup', 'bench', 'record', 'draft', 'trade', 'trades', 'against', 'versus', 'their', 'during', 'total', 'starter', 'starters', 'smith', 'brown', 'jones', 'williams', 'johnson', 'allen', 'moore', 'davis', 'taylor', 'thomas', 'jackson', 'harris', 'wilson', 'white', 'hill', 'young', 'walker', 'robinson', 'lewis', 'carter']);

// ---------- parsing ----------
function managerIndex(M) {
  const list = [];
  Object.values(M.managers).forEach(m => {
    const names = [m.name].concat(m.teamNames || []).filter(Boolean).map(n => n.toLowerCase());
    list.push({ id: m.id, names });
  });
  return list;
}

const playerIdxCache = new WeakMap();
function playerIndex(M) {
  if (playerIdxCache.has(M)) return playerIdxCache.get(M);
  const seen = new Set();
  M.seasons.forEach(S => Object.values(S.byWeek).forEach(week => Object.values(week).forEach(m => m.players.forEach(p => seen.add(p)))));
  const full = []; const lastCount = {};
  seen.forEach(pid => {
    const n = M.playerName(pid);
    if (!n || n === pid) return;
    const lower = n.toLowerCase().replace(/[^a-z0-9' .-]/g, '');
    const parts = lower.split(' ');
    const last = parts[parts.length - 1].replace(/\b(jr|sr|ii|iii|iv)\.?$/, '').trim() || parts[parts.length - 2] || '';
    full.push({ pid, lower, last });
    lastCount[last] = (lastCount[last] || 0) + 1;
  });
  const idx = { full, lastCount };
  playerIdxCache.set(M, idx);
  return idx;
}

export function parse(q, M) {
  const text = ' ' + q.toLowerCase().replace(/[’‘]/g, "'").replace(/[?!,]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out = { text, managers: [], season: null, week: null, players: [] };
  const yr = text.match(/\b(20\d\d)\b/);
  if (yr) out.season = yr[1];
  const wk = text.match(/\b(?:week|wk|w)\s*#?\s*(\d{1,2})\b/);
  if (wk) out.week = Number(wk[1]);

  // Full player names win over manager matches (team names often borrow player names).
  const idx = playerIndex(M);
  const playerSpans = [];
  idx.full.forEach(p => { const i = text.indexOf(' ' + p.lower + ' '); if (i >= 0) playerSpans.push({ pid: p.pid, at: i + 1, len: p.lower.length }); });

  // Managers: exact names first, then a word that starts a manager's name ("sean", "dmanno").
  const taken = playerSpans.map(p => [p.at, p.at + p.len]);
  const hits = [];
  managerIndex(M).forEach(m => m.names.forEach(n => {
    const i = text.indexOf(n.replace(/'s$/, ''));
    if (n.length >= 3 && i >= 0) hits.push({ id: m.id, at: i, len: n.length });
  }));
  if (!hits.length || hits.length < 2) {
    text.split(' ').forEach((word, k, arr) => {
      const w = word.replace(/'s$/, '');
      if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) return;
      managerIndex(M).forEach(m => {
        if (m.names.some(n => n.indexOf(w) === 0)) hits.push({ id: m.id, at: text.indexOf(' ' + word + ' ') + 1, len: word.length, fuzzy: true });
      });
    });
  }
  hits.sort((a, b) => a.at - b.at || b.len - a.len).forEach(h => {
    if (out.managers.indexOf(h.id) < 0 && !taken.some(t => h.at >= t[0] && h.at < t[1])) { out.managers.push(h.id); taken.push([h.at, h.at + h.len]); }
  });

  // Players: full names, then unique last names not used by a manager match.
  const inTaken = i => taken.some(t => i >= t[0] && i < t[1]);
  playerSpans.forEach(p => out.players.push(p));
  if (!out.players.length) {
    idx.full.forEach(p => {
      if (p.last.length < 4 || STOP.has(p.last) || idx.lastCount[p.last] > 1) return;
      const i = text.indexOf(' ' + p.last + ' ');
      if (i >= 0 && !inTaken(i + 1)) out.players.push({ pid: p.pid, at: i, len: p.last.length });
    });
  }
  out.players = out.players.sort((a, b) => b.len - a.len).map(p => p.pid).filter((p, i, a) => a.indexOf(p) === i).slice(0, 1);

  const t = text;
  out.intent =
    (out.managers.length >= 2 && /\b(vs|v|versus|against|h2h|head to head|head-to-head)\b/.test(t)) || (out.managers.length >= 2 && !out.week) ? 'h2h' :
    /\b(lowest|worst|fewest|least)\b/.test(t) && /\b(player|starter|scorer|guy)\b/.test(t) ? 'lowPlayer' :
    /\b(highest|top|best|most|leading|mvp)\b/.test(t) && /\b(player|scorer|guy|mvp|performer)\b/.test(t) ? 'topPlayer' :
    /\b(waivers?|pickups?|picked up|adds|free agents?|faab)\b/.test(t) ? 'waivers' :
    /\bbench\b/.test(t) ? 'bench' :
    /\b(lineup|starters|started|start|roster)\b/.test(t) ? 'lineup' :
    /\b(draft|drafted|picks|picked)\b/.test(t) ? 'draft' :
    /\btrades?\b|\btraded\b/.test(t) ? 'trades' :
    /\b(lowest|worst|fewest)\b/.test(t) ? 'lowScore' :
    /\b(highest|most|top|best)\b/.test(t) ? 'topScore' :
    out.players.length ? 'player' : 'summary';
  out.rank = parseRank(text);
  return out;
}

// ---------- answering ----------
const card = (title, body) => `<div class="answer"><h2 class="ans-title">${title}</h2>${body || ''}</div>`;
const note = t => `<p class="note" style="margin:0">${t}</p>`;

function seasonList(M, P) {
  if (P.season) { const S = M.seasons.find(s => s.season === P.season); return S ? [S] : []; }
  return M.seasons;
}
function ridOf(S, id) { return S.rids.find(r => S.ownerOf[r] === id); }
function played(S, w) { return w >= 1 && w <= S.scoredThrough && S.byWeek[w]; }
function gameFor(S, w, rid) { return S.games.find(g => g.week === w && (g.a === rid || g.b === rid)); }

function lineupTable(M, S, m) {
  const rows = m.starters.map((pid, i) => ({ slot: S.slots[i] || '', pid, pts: m.players_points[pid] || 0 }));
  const bench = m.players.filter(p => m.starters.indexOf(p) < 0).map(pid => ({ pid, pts: m.players_points[pid] || 0 })).sort((a, b) => b.pts - a.pts);
  const nameCell = pid => pid && pid !== '0' ? esc(M.playerName(pid)) + ' <span class="note">' + esc(S.posOf(pid)) + '</span>' : '<span class="note">Empty</span>';
  return `<div class="scroll"><table class="table"><thead><tr><th>Starter</th><th>Slot</th><th>Pts</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="t">${nameCell(r.pid)}</td><td style="color:#8A9C9F">${esc(r.slot.replace('_', ' '))}</td><td>${f2(r.pts)}</td></tr>`).join('')}</tbody></table></div>
    ${bench.length ? `<div class="scroll"><table class="table"><thead><tr><th>Bench</th><th></th><th>Pts</th></tr></thead><tbody>
    ${bench.map(r => `<tr><td class="t" style="font-weight:400">${nameCell(r.pid)}</td><td></td><td style="color:#C9D3D2">${f2(r.pts)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

function weekLine(M, S, w, rid) {
  const m = S.byWeek[w][rid];
  const g = gameFor(S, w, rid);
  if (!g) return `Scored ${f2(m.points)} (no head-to-head game that week).`;
  const mine = g.a === rid ? g.ap : g.bp; const theirs = g.a === rid ? g.bp : g.ap; const opp = g.a === rid ? g.b : g.a;
  const res = mine > theirs ? 'beat' : mine < theirs ? 'lost to' : 'tied';
  return `Scored ${f2(mine)} and ${res} ${esc(M.nameOf(S.ownerOf[opp]))} (${f2(theirs)})${g.playoff ? ' in the playoffs' : ''}.`;
}

function needWeek(M, P, S) {
  if (!S) return card('That season isn\'t in the league history.', note('Seasons on record: ' + M.seasons.map(s => s.season).join(', ') + '.'));
  if (S.isCurrent && P.week > S.scoredThrough) return card(`Week ${P.week} of ${S.season} hasn't been played yet.`, note('Scores are final through Week ' + S.scoredThrough + '.'));
  if (!played(S, P.week)) return card(`There's no Week ${P.week} in ${S.season}.`);
  return null;
}

export function answer(M, P) {
  const name = id => esc(M.nameOf(id));
  const link = id => `<a href="${M.px}m-${encodeURIComponent(id)}">${name(id)}</a>`;
  const assumed = !P.season && P.week ? M.seasons.find(s => played(s, P.week)) : null;
  const S0 = P.season ? M.seasons.find(s => s.season === P.season) : assumed;
  const assumeNote = !P.season && P.week && S0 ? note(`No season given, so this is ${S0.season}. Add a year to pick another season.`) : '';

  // Head to head
  if (P.intent === 'h2h' && P.managers.length >= 2) {
    const [a, b] = P.managers;
    const r = M.h2hRecord(a, b);
    if (!r.games) return card(`${name(a)} and ${name(b)} have never played each other.`);
    const games = r.list.filter(g => !P.season || g.season === P.season).sort((x, y) => Number(y.season) - Number(x.season) || y.week - x.week);
    return card(`${link(a)} is ${wl(r.w, r.l, r.t)} against ${link(b)}.`,
      note(`${r.games} games · average margin ${f2(r.margin)} pts${r.playoff ? ' · ' + r.playoff + ' in the playoffs' : ''}.`) +
      `<div class="scroll"><table class="table"><thead><tr><th>Game</th><th>${name(a)}</th><th>${name(b)}</th></tr></thead><tbody>
      ${games.map(g => `<tr><td class="t" style="font-weight:400">${g.season} · Week ${g.week}${g.playoff ? ' · playoffs' : ''}</td><td style="${g.mine > g.theirs ? 'color:#F1F4F3;font-weight:500' : 'color:#8A9C9F'}">${f2(g.mine)}</td><td style="${g.theirs > g.mine ? 'color:#F1F4F3;font-weight:500' : 'color:#8A9C9F'}">${f2(g.theirs)}</td></tr>`).join('')}</tbody></table></div>` +
      `<a class="btn" href="${M.px}vs-${encodeURIComponent(a)}~${encodeURIComponent(b)}">Full comparison →</a>`);
  }

  // Rankings across seasons ("best season ever by manager score", "worst 1st round pick by ppg")
  if (!P.week && P.rank) { const r = rankAnswer(M, P, P.rank); if (r) return r; }

  const id = P.managers[0];

  // Waiver and free-agent pickups
  if (id && P.intent === 'waivers') {
    const list = seasonList(M, P).filter(S => ridOf(S, id) != null);
    const S = list[0];
    if (!S) return card(`${name(id)} wasn't in the league${P.season ? ' in ' + P.season : ''}.`);
    const w = S.waivers[ridOf(S, id)];
    const adds = (w.list || []).slice().sort((a, b) => b.pts - a.pts);
    if (!adds.length) return card(`${name(id)} made no pickups in ${S.season}.`);
    return card(`${link(id)} made ${adds.length} pickups in ${S.season} for ${f2(w.pts)} starter pts${S.usesFaab ? ' and $' + w.faab + ' FAAB' : ''}.`,
      `<div class="scroll"><table class="table"><thead><tr><th>Player</th><th>Week</th>${S.usesFaab ? '<th>Bid</th>' : ''}<th>Starts</th><th>Starter pts</th></tr></thead><tbody>
      ${adds.slice(0, 25).map(a => `<tr><td class="t" style="font-weight:400">${esc(M.playerName(a.pid))} <span class="note">${esc(S.posOf(a.pid))}</span></td><td>${a.week}</td>${S.usesFaab ? `<td>${a.bid ? '$' + a.bid : 'FA'}</td>` : ''}<td>${a.starts}</td><td>${f2(a.pts)}</td></tr>`).join('')}</tbody></table></div>` +
      (adds.length > 25 ? note('Showing the 25 best of ' + adds.length + '.') : '') + (P.season ? '' : note('Showing ' + S.season + '. Add a year for another season.')));
  }

  // One manager, one week
  if (id && P.week) {
    const S = S0;
    const bad = needWeek(M, P, S); if (bad) return bad;
    const rid = ridOf(S, id);
    if (rid == null) return card(`${name(id)} wasn't in the league in ${S.season}.`);
    const m = S.byWeek[P.week][rid];
    if (!m) return card(`No lineup on record for ${name(id)} in Week ${P.week}.`);
    const all = m.players.map(pid => ({ pid, pts: m.players_points[pid] || 0, started: m.starters.indexOf(pid) >= 0 }));
    const starters = all.filter(p => p.started);
    if (P.intent === 'topPlayer' || P.intent === 'lowPlayer') {
      const pool = P.intent === 'lowPlayer' ? starters : all;
      const pick = pool.slice().sort((x, y) => P.intent === 'lowPlayer' ? x.pts - y.pts : y.pts - x.pts)[0];
      if (!pick) return card('No players on record that week.');
      const topStarter = starters.slice().sort((x, y) => y.pts - x.pts)[0];
      return card(`${link(id)}'s ${P.intent === 'lowPlayer' ? 'lowest-scoring starter' : 'highest-scoring player'} in Week ${P.week} of ${S.season} was ${esc(M.playerName(pick.pid))} with ${f2(pick.pts)} pts.`,
        note((pick.started ? 'He was in the starting lineup.' : `He was on the bench. Top starter: ${esc(M.playerName(topStarter.pid))} (${f2(topStarter.pts)}).`) + ' ' + weekLine(M, S, P.week, rid)) + assumeNote + lineupTable(M, S, m));
    }
    if (P.intent === 'bench') {
      const benchPts = all.filter(p => !p.started).reduce((s, p) => s + p.pts, 0);
      return card(`${link(id)} left ${f2(benchPts)} pts on the bench in Week ${P.week} of ${S.season}.`, note(weekLine(M, S, P.week, rid)) + assumeNote + lineupTable(M, S, m));
    }
    if (P.players.length) {
      const pid = P.players[0];
      const p = all.find(x => x.pid === pid);
      return card(p ? `${esc(M.playerName(pid))} scored ${f2(p.pts)} for ${link(id)} in Week ${P.week} of ${S.season}${p.started ? '' : ' (on the bench)'}.` : `${esc(M.playerName(pid))} wasn't on ${name(id)}'s roster in Week ${P.week} of ${S.season}.`, assumeNote + lineupTable(M, S, m));
    }
    return card(`${link(id)} in Week ${P.week} of ${S.season}`, note(weekLine(M, S, P.week, rid)) + assumeNote + lineupTable(M, S, m));
  }

  // A player, no week
  if (P.players.length) {
    const pid = P.players[0];
    const rows = [];
    seasonList(M, P).forEach(S => {
      S.rids.forEach(r => {
        if (id && S.ownerOf[r] !== id) return;
        let pts = 0; let starts = 0; let weeks = 0; let best = null;
        for (let w = 1; w <= S.scoredThrough; w++) {
          const m = S.byWeek[w] && S.byWeek[w][r];
          if (!m || m.players.indexOf(pid) < 0) continue;
          weeks++;
          const p = m.players_points[pid] || 0;
          if (m.starters.indexOf(pid) >= 0) { pts += p; starts++; }
          if (!best || p > best.p) best = { p, w };
        }
        if (weeks) rows.push({ S, r, pts, starts, weeks, best });
      });
    });
    const pn = esc(M.playerName(pid));
    if (!rows.length) return card(`${pn} never played for ${id ? name(id) : 'anyone in the league'}${P.season ? ' in ' + P.season : ''}.`);
    const total = rows.reduce((s, x) => s + x.pts, 0);
    return card(id ? `${pn} scored ${f2(total)} starter pts for ${link(id)}${P.season ? ' in ' + P.season : ''}.` : `${pn} in the league${P.season ? ', ' + P.season : ''}`,
      `<div class="scroll"><table class="table"><thead><tr><th>Season · team</th><th>Weeks</th><th>Starts</th><th>Starter pts</th><th>Best week</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td class="t" style="font-weight:400">${x.S.season} · ${link(x.S.ownerOf[x.r])}</td><td>${x.weeks}</td><td>${x.starts}</td><td>${f2(x.pts)}</td><td>${f2(x.best.p)} <span class="note">W${x.best.w}</span></td></tr>`).join('')}</tbody></table></div>`);
  }

  // One manager, no week
  if (id) {
    const list = seasonList(M, P).filter(S => ridOf(S, id) != null);
    if (!list.length) return card(`${name(id)} wasn't in the league${P.season ? ' in ' + P.season : ''}.`);
    if (P.intent === 'topPlayer' || P.intent === 'lowPlayer' || P.intent === 'topScore' || P.intent === 'lowScore') {
      const perf = []; const team = [];
      list.forEach(S => { const r = ridOf(S, id); for (let w = 1; w <= S.scoredThrough; w++) { const m = S.byWeek[w] && S.byWeek[w][r]; if (!m) continue;
        if (w < S.playoffWeekStart || gameFor(S, w, r)) team.push({ S, w, pts: m.points });
        m.starters.forEach(pid => { if (pid && pid !== '0') perf.push({ S, w, pid, pts: m.players_points[pid] || 0 }); }); } });
      if (P.intent === 'topScore' || P.intent === 'lowScore') {
        const top = team.sort((a, b) => P.intent === 'lowScore' ? a.pts - b.pts : b.pts - a.pts).slice(0, 5);
        return card(`${link(id)}'s ${P.intent === 'lowScore' ? 'lowest' : 'highest'} score${P.season ? ' in ' + P.season : ' ever'}: ${f2(top[0].pts)} in Week ${top[0].w} of ${top[0].S.season}.`,
          `<div class="rows">${top.map(x => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;padding:10px 0"><span>${x.S.season} · Week ${x.w}</span><span class="num">${f2(x.pts)}</span></div>`).join('')}</div>`);
      }
      const top = perf.sort((a, b) => P.intent === 'lowPlayer' ? a.pts - b.pts : b.pts - a.pts).slice(0, 5);
      return card(`${link(id)}'s ${P.intent === 'lowPlayer' ? 'lowest' : 'best'} single-week starter${P.season ? ' in ' + P.season : ' ever'}: ${esc(M.playerName(top[0].pid))}, ${f2(top[0].pts)} pts in Week ${top[0].w} of ${top[0].S.season}.`,
        `<div class="rows">${top.map(x => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;padding:10px 0"><span class="stack"><span>${esc(M.playerName(x.pid))}</span><span class="sub">${x.S.season} · Week ${x.w}</span></span><span class="num">${f2(x.pts)}</span></div>`).join('')}</div>` +
        note('Add a week (like "week 7 2023") to see a single lineup.'));
    }
    if (P.intent === 'draft') {
      const S = list[0]; const r = ridOf(S, id);
      const picks = S.picks.filter(p => p.roster_id === r).sort((a, b) => a.pick_no - b.pick_no);
      return card(`${link(id)}'s ${S.season} draft`, `<div class="scroll"><table class="table"><thead><tr><th>Player</th><th>Pick</th><th>Finish</th><th>vs. slot</th></tr></thead><tbody>
        ${picks.map(p => `<tr><td class="t" style="font-weight:400">${esc(M.playerName(p.player_id))} <span class="note">${esc(p.pos)}</span></td><td>R${p.round} · ${p.pick_no}</td><td>${S.posRank[p.player_id] ? esc(p.pos) + S.posRank[p.player_id] : '—'}</td><td class="${p.value >= 0 ? 'up' : 'down'}">${(p.value >= 0 ? '+' : '−') + Math.abs(Math.round(p.value))}</td></tr>`).join('')}</tbody></table></div>` + (P.season ? '' : note('Showing the most recent draft. Add a year for another.')));
    }
    if (P.intent === 'trades') {
      const trades = M.allTrades.filter(t => (!P.season || t.season === P.season) && t.sides.some(s => s.owner === id));
      if (!trades.length) return card(`${name(id)} made no trades${P.season ? ' in ' + P.season : ''}.`);
      return card(`${link(id)}'s trades${P.season ? ' in ' + P.season : ''}`, trades.slice().reverse().map(t => { const s = t.sides.find(x => x.owner === id);
        return `<div class="box"><div class="top-line"><span>${t.season} · Week ${t.week}</span><span class="${s.net >= 0 ? 'up' : 'down'}">${(s.net >= 0 ? '+' : '−') + Math.abs(s.net).toFixed(1)}</span></div>
          <span style="font-size:14px">Got ${s.got.map(g => esc(M.playerName(g.pid))).join(', ') || 'picks'} · sent ${s.sent.map(g => esc(M.playerName(g.pid))).join(', ') || 'picks'}</span></div>`; }).join(''));
    }
    if (P.season) {
      const S = list[0]; const r = ridOf(S, id); const st = S.st[r]; const mvp = S.mvp[r];
      return card(`${link(id)} in ${S.season}: ${wl(st.wins, st.losses, st.ties)}, ${ordinal(st.rank)} place${S.champion === r ? ', champion' : S.lastPlace === r ? ', last place' : ''}.`,
        `<div class="tiles"><div class="tile"><span class="k">Points for</span><span class="v">${f2(st.pf)}</span></div><div class="tile"><span class="k">Manager Score</span><span class="v">${Math.round(S.scores[r].total)}</span></div>
        <div class="tile"><span class="k">Team MVP</span><span class="w">${mvp ? esc(M.playerName(mvp.pid)) + ' · ' + f2(mvp.pts) : '—'}</span></div><div class="tile"><span class="k">Start/sit</span><span class="v">${(S.efficiency[r].pct * 100).toFixed(1)}%</span></div></div>` +
        `<a class="btn" href="${M.px}s${S.season}">Open the ${S.season} tab →</a>`);
    }
    const c = M.career[id];
    return card(`${link(id)}: ${wl(c.wins, c.losses, c.ties)} career, ${c.titles} title${c.titles === 1 ? '' : 's'}, Manager Score ${Math.round(c.score)}.`,
      note('Add a season or week for more detail, like "' + esc(M.nameOf(id)) + ' week 3 2025".') + `<a class="btn" href="${M.px}m-${encodeURIComponent(id)}">Open their profile →</a>`);
  }

  // No manager: league-wide week or season
  if (P.week) {
    const S = S0;
    const bad = needWeek(M, P, S); if (bad) return bad;
    const scores = S.rids.map(r => ({ r, pts: S.byWeek[P.week][r] ? S.byWeek[P.week][r].points : 0 })).sort((a, b) => b.pts - a.pts);
    const games = S.games.filter(g => g.week === P.week);
    const lead = P.intent === 'lowScore' ? scores[scores.length - 1] : scores[0];
    return card(`${P.intent === 'lowScore' ? 'Lowest' : 'Highest'} score in Week ${P.week} of ${S.season}: ${link(S.ownerOf[lead.r])}, ${f2(lead.pts)}.`,
      assumeNote + `<div class="rows">${games.map(g => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;padding:10px 0"><span style="font-size:14px">${link(S.ownerOf[g.a])} vs ${link(S.ownerOf[g.b])}${g.playoff ? ' <span class="note">playoffs</span>' : ''}</span><span class="num">${f2(g.ap)} – ${f2(g.bp)}</span></div>`).join('')}</div>`);
  }
  if (P.season && (P.intent === 'topScore' || P.intent === 'lowScore' || P.intent === 'topPlayer')) {
    const S = M.seasons.find(s => s.season === P.season);
    if (!S) return card('That season isn\'t in the league history.');
    if (P.intent === 'topPlayer') {
      const perf = [];
      S.rids.forEach(r => { for (let w = 1; w <= S.scoredThrough; w++) { const m = S.byWeek[w] && S.byWeek[w][r]; if (m) m.starters.forEach(pid => { if (pid && pid !== '0') perf.push({ r, w, pid, pts: m.players_points[pid] || 0 }); }); } });
      const top = perf.sort((a, b) => b.pts - a.pts).slice(0, 5);
      return card(`Best single-week starter of ${S.season}: ${esc(M.playerName(top[0].pid))}, ${f2(top[0].pts)} for ${link(S.ownerOf[top[0].r])} in Week ${top[0].w}.`,
        `<div class="rows">${top.map(x => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;padding:10px 0"><span class="stack"><span>${esc(M.playerName(x.pid))}</span><span class="sub">${link(S.ownerOf[x.r])} · Week ${x.w}</span></span><span class="num">${f2(x.pts)}</span></div>`).join('')}</div>`);
    }
    const all = [];
    S.rids.forEach(r => { for (let w = 1; w < S.playoffWeekStart && w <= S.scoredThrough; w++) { const m = S.byWeek[w] && S.byWeek[w][r]; if (m) all.push({ r, w, pts: m.points }); } });
    const top = all.sort((a, b) => P.intent === 'lowScore' ? a.pts - b.pts : b.pts - a.pts).slice(0, 5);
    return card(`${P.intent === 'lowScore' ? 'Lowest' : 'Highest'} score of ${S.season}: ${link(S.ownerOf[top[0].r])}, ${f2(top[0].pts)} in Week ${top[0].w}.`,
      `<div class="rows">${top.map(x => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;padding:10px 0"><span>${link(S.ownerOf[x.r])} · Week ${x.w}</span><span class="num">${f2(x.pts)}</span></div>`).join('')}</div>`);
  }
  return null;
}

const ordinal = n => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

export const HELP = `<p class="lead">Name a manager, a player, a season and a week in any order. It understands questions like:</p>
<ul class="help">
<li><b>A manager's week:</b> lineup, highest- or lowest-scoring player, bench points</li>
<li><b>A manager's season or career:</b> record, best score, best starter, draft, trades, waiver pickups</li>
<li><b>Two managers:</b> head-to-head record and every game</li>
<li><b>A player:</b> points for a manager, or every team he played for</li>
<li><b>A week or season:</b> highest or lowest score, every matchup</li>
<li><b>Rankings, all-time or for one year:</b> best/worst <i>seasons</i> by Manager Score, wins, points or luck; <i>managers</i> by titles, clutch or start/sit; <i>draft picks</i> by round, position, points per game or value; <i>trades</i>; <i>pickups</i>; <i>player games</i> and <i>player seasons</i>; <i>scores</i> in a win or loss; <i>blowouts</i> and <i>closest games</i></li>
</ul>`;
