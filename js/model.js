// Turns raw Sleeper data into every stat, award and score the site shows.
// Pure functions only: nothing here touches the page or the network.

import { CONFIG } from './config.js?v=202610290448';

const ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE']
};

const round1 = x => Math.round(x * 10) / 10;
const round2 = x => Math.round(x * 100) / 100;
const sum = xs => xs.reduce((a, b) => a + b, 0);
const mean = xs => xs.length ? sum(xs) / xs.length : 0;
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map(x => (x - m) * (x - m))) / (xs.length - 1));
}

// Rescale raw values so the league average that season is 50 (one SD = 20 points).
function scale(values) {
  const keys = Object.keys(values);
  const xs = keys.map(k => values[k]);
  const m = mean(xs);
  const s = sd(xs);
  const out = {};
  keys.forEach(k => {
    const z = s > 0 ? (values[k] - m) / s : 0;
    out[k] = Math.max(0, Math.min(100, 50 + 20 * z));
  });
  return out;
}

// Best possible lineup from the players a team had that week.
export function optimalPoints(slots, playerIds, pointsById, positionOf) {
  const order = slots
    .filter(s => ELIGIBLE[s])
    .slice()
    .sort((a, b) => ELIGIBLE[a].length - ELIGIBLE[b].length);
  const pool = playerIds
    .map(id => ({ id, pts: pointsById[id] || 0, pos: positionOf(id) }))
    .sort((a, b) => b.pts - a.pts);
  const used = new Set();
  let total = 0;
  for (const slot of order) {
    const allowed = ELIGIBLE[slot];
    const pick = pool.find(p => !used.has(p.id) && allowed.indexOf(p.pos) >= 0);
    if (pick) { used.add(pick.id); total += Math.max(0, pick.pts); }
  }
  return total;
}

function buildSeason(raw, players, isNewest, later, format, opts) {
  opts = opts || {};
  const S = {
    season: raw.season,
    leagueId: raw.leagueId,
    isCurrent: raw.status !== 'complete',
    status: raw.status,
    playoffWeekStart: raw.playoffWeekStart,
    playoffTeams: raw.playoffTeams,
    scoredThrough: raw.scoredThrough,
    currentWeek: raw.currentWeek,
    usesFaab: raw.waiverType === 2,
    isNewest,
    format
  };
  const ownerOf = {};
  raw.rosters.forEach(r => { ownerOf[r.roster_id] = r.owner_id || ('roster-' + raw.season + '-' + r.roster_id); });
  S.ownerOf = ownerOf;
  const rids = raw.rosters.map(r => r.roster_id);
  S.rids = rids;
  const lastReg = raw.playoffWeekStart - 1;
  const positionOf = id => (players[id] && players[id][1]) || (/^[A-Z]{2,3}$/.test(id) ? 'DEF' : '');
  const pickPos = {};
  raw.picks.forEach(p => { if (p.pos) pickPos[p.player_id] = p.pos; });
  const posOf = id => positionOf(id) || pickPos[id] || '';
  const slots = raw.rosterPositions;
  S.slots = slots.filter(s => ELIGIBLE[s]);
  S.posOf = id => posOf(id);

  // Week-by-week lookups.
  const byWeek = {}; // week -> rid -> matchup entry
  raw.matchups.forEach((list, i) => {
    const w = i + 1;
    byWeek[w] = {};
    list.forEach(m => { byWeek[w][m.roster_id] = m; });
  });
  S.byWeek = byWeek;
  const scoredWeeks = [];
  for (let w = 1; w <= lastReg; w++) if (w <= raw.scoredThrough) scoredWeeks.push(w);
  S.regWeeks = scoredWeeks;

  // Regular-season games.
  const games = [];
  scoredWeeks.forEach(w => {
    const groups = {};
    Object.values(byWeek[w]).forEach(m => {
      if (m.matchup_id == null) return;
      (groups[m.matchup_id] = groups[m.matchup_id] || []).push(m);
    });
    Object.values(groups).forEach(g => {
      if (g.length !== 2) return;
      games.push({ season: raw.season, week: w, playoff: false, a: g[0].roster_id, b: g[1].roster_id, ap: g[0].points, bp: g[1].points });
    });
  });

  // Playoff games from the winners bracket (one week per round).
  const playoffRids = new Set();
  raw.winners.forEach(m => {
    if (typeof m.t1 === 'number') playoffRids.add(m.t1);
    if (typeof m.t2 === 'number') playoffRids.add(m.t2);
    const w = raw.playoffWeekStart + m.r - 1;
    // Skip 3rd/5th-place games: they decide nothing and teams often stop setting lineups.
    if (m.p && m.p !== 1) return;
    if (typeof m.t1 !== 'number' || typeof m.t2 !== 'number' || w > raw.scoredThrough) return;
    const a = byWeek[w] && byWeek[w][m.t1];
    const b = byWeek[w] && byWeek[w][m.t2];
    if (!a || !b) return;
    games.push({ season: raw.season, week: w, playoff: true, round: m.r, placement: m.p || null, a: m.t1, b: m.t2, ap: a.points, bp: b.points });
  });
  S.games = games;
  S.winners = raw.winners || [];
  S.losers = raw.losers || [];
  S.startSlots = raw.rosterPositions.filter(s => s !== 'BN' && s !== 'IR' && s !== 'TAXI');
  S.playoffRids = playoffRids;

  // Standings, all-play and luck.
  const st = {};
  rids.forEach(r => { st[r] = { rid: r, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, maxPf: 0, allPlay: 0, allPlayGames: 0, games: 0, streak: [] }; });
  games.filter(g => !g.playoff).forEach(g => {
    const A = st[g.a]; const B = st[g.b];
    A.pf += g.ap; A.pa += g.bp; B.pf += g.bp; B.pa += g.ap; A.games++; B.games++;
    if (g.ap > g.bp) { A.wins++; B.losses++; } else if (g.bp > g.ap) { B.wins++; A.losses++; } else { A.ties++; B.ties++; }
  });
  scoredWeeks.forEach(w => {
    const scores = rids.map(r => (byWeek[w][r] ? byWeek[w][r].points : null)).filter(x => x != null);
    rids.forEach(r => {
      const m = byWeek[w][r];
      if (!m) return;
      const beat = scores.filter(x => x < m.points).length + 0.5 * (scores.filter(x => x === m.points).length - 1);
      st[r].allPlay += beat / Math.max(1, scores.length - 1);
      st[r].allPlayGames++;
    });
  });
  const standings = rids.map(r => st[r]).sort((a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf);
  standings.forEach((s, i) => {
    s.rank = i + 1;
    s.winPct = s.games ? (s.wins + s.ties / 2) / s.games : 0;
    s.allPlayPct = s.allPlayGames ? s.allPlay / s.allPlayGames : 0;
    s.expectedWins = s.allPlay;
    s.luck = (s.wins + s.ties / 2) - s.allPlay;
  });
  S.standings = standings;
  S.st = st;

  // Champion, runner-up, last place.
  const final = raw.winners.find(m => m.p === 1);
  S.champion = final && final.w && raw.status === 'complete' ? final.w : null;
  S.runnerUp = final && final.l && raw.status === 'complete' ? final.l : null;
  S.finalists = final ? [final.t1, final.t2].filter(x => typeof x === 'number') : [];
  // Last place = the toilet bowl loser. In Sleeper's losers bracket the team that loses each game
  // moves on, so the "winner" of the final (p = 1) is last. Falls back to the worst record.
  const toilet = (raw.losers || []).find(m => m.p === 1);
  S.toiletBowl = !!(toilet && toilet.w);
  S.lastPlace = raw.status === 'complete' && standings.length
    ? (toilet && toilet.w ? toilet.w : standings[standings.length - 1].rid) : null;

  // Taxi-squad players can't be started, so they're left out of the best-possible lineup.
  // Sleeper only keeps the end-of-season taxi squad, so that list is used for every week.
  const taxi = {};
  raw.rosters.forEach(r => { if (r.taxi && r.taxi.length) taxi[r.roster_id] = new Set(r.taxi); });
  S.taxi = Object.keys(taxi).length ? taxi : null;
  S.reserve = {};
  raw.rosters.forEach(r => { if (r.reserve && r.reserve.length) S.reserve[r.roster_id] = new Set(r.reserve); });

  // Start/sit efficiency and bench blunders.
  const eff = {};
  rids.forEach(r => { eff[r] = { actual: 0, optimal: 0, benchLeft: 0 }; });
  let blunder = null;
  const effWeeks = scoredWeeks.map(w => ({ w, rids })).concat(
    games.filter(g => g.playoff).map(g => ({ w: g.week, rids: [g.a, g.b] }))
  );
  effWeeks.forEach(({ w, rids: list }) => {
    list.forEach(r => {
      const m = byWeek[w] && byWeek[w][r];
      if (!m) return;
      const actual = sum(m.starters.map(id => m.players_points[id] || 0));
      const opt = optimalPoints(slots, m.players.filter(p => !taxi[r] || !taxi[r].has(p) || m.starters.indexOf(p) >= 0), m.players_points, posOf);
      eff[r].actual += actual;
      eff[r].optimal += Math.max(opt, actual);
      if (w <= lastReg) st[r].maxPf += Math.max(opt, actual);
      const gap = Math.max(0, opt - actual);
      eff[r].benchLeft += gap;
      const game = games.find(g => g.week === w && (g.a === r || g.b === r));
      const oppPts = game ? (game.a === r ? game.bp : game.ap) : null;
      if (!blunder || gap > blunder.gap) {
        blunder = { rid: r, week: w, gap, lostBy: oppPts != null && oppPts > m.points ? oppPts - m.points : null, wouldHaveWon: oppPts != null && oppPts > m.points && m.points + gap > oppPts };
      }
    });
  });
  rids.forEach(r => { eff[r].pct = eff[r].optimal > 0 ? eff[r].actual / eff[r].optimal : 0; });
  S.efficiency = eff;
  S.benchBlunder = blunder;

  // Starter points a player gave a roster from a given week on, while he stayed there.
  const allWeeks = [];
  for (let w = 1; w <= raw.scoredThrough && w <= raw.playoffWeekStart + 2; w++) allWeeks.push(w);
  function starterPointsFor(rid, pid, fromWeek) {
    let pts = 0; let starts = 0;
    for (const w of allWeeks) {
      if (w < fromWeek) continue;
      const m = byWeek[w] && byWeek[w][rid];
      if (!m) continue;
      if (m.players.indexOf(pid) < 0) { if (w > fromWeek) break; else continue; }
      if (m.starters.indexOf(pid) >= 0) { pts += m.players_points[pid] || 0; starts++; }
    }
    return { pts, starts };
  }

  // Dynasty: a traded player keeps paying off in later seasons while he stays on that manager's team.
  function futurePoints(owner, pid) {
    let pts = 0;
    for (const L of later || []) {
      const rr = L.rosters.find(x => x.owner_id === owner);
      if (!rr) break;
      let seen = false; let gone = false;
      for (let w = 1; w <= L.scoredThrough && w <= L.playoffWeekStart + 2; w++) {
        const m = (L.matchups[w - 1] || []).find(x => x.roster_id === rr.roster_id);
        if (!m) continue;
        if (m.players.indexOf(pid) < 0) { if (seen || w === 1) { gone = true; break; } continue; }
        seen = true;
        if (m.starters.indexOf(pid) >= 0) pts += m.players_points[pid] || 0;
      }
      if (gone || !seen) break;
    }
    return pts;
  }

  // Waivers and free agents.
  const waivers = {};
  rids.forEach(r => { waivers[r] = { pts: 0, faab: 0, adds: 0, best: null }; });
  raw.transactions.filter(t => t.type === 'waiver' || t.type === 'free_agent').forEach(t => {
    Object.keys(t.adds).forEach(pid => {
      const rid = t.adds[pid];
      if (!waivers[rid]) return;
      const r = starterPointsFor(rid, pid, t.leg);
      waivers[rid].pts += r.pts;
      waivers[rid].adds++;
      (waivers[rid].list = waivers[rid].list || []).push({ pid, pts: r.pts, starts: r.starts, week: t.leg, bid: t.type === 'waiver' ? t.bid : null, type: t.type });
      if (t.type === 'waiver' && t.bid) waivers[rid].faab += t.bid;
      if (!waivers[rid].best || r.pts > waivers[rid].best.pts) waivers[rid].best = { pid, pts: r.pts, starts: r.starts, week: t.leg };
    });
  });
  rids.forEach(r => { waivers[r].perDollar = S.usesFaab && waivers[r].faab > 0 ? waivers[r].pts / waivers[r].faab : null; });
  S.waivers = waivers;

  // Trades: points each incoming player scored as a starter for his new team, minus the same for players sent away.
  const tradeNet = {};
  rids.forEach(r => { tradeNet[r] = { net: 0, count: 0 }; });
  const trades = [];
  raw.transactions.filter(t => t.type === 'trade').forEach(t => {
    const sides = {};
    t.roster_ids.forEach(r => { sides[r] = { rid: r, got: [], sent: [], net: 0 }; });
    Object.keys(t.adds).forEach(pid => {
      const to = t.adds[pid];
      const from = t.drops[pid];
      const r = starterPointsFor(to, pid, t.leg);
      if (format === 'dynasty') r.pts += futurePoints(ownerOf[to], pid);
      if (sides[to]) { sides[to].got.push({ pid, pts: r.pts }); sides[to].net += r.pts; }
      if (sides[from]) { sides[from].sent.push({ pid, pts: r.pts }); sides[from].net -= r.pts; }
    });
    const list = Object.values(sides);
    list.forEach(s => { if (tradeNet[s.rid]) { tradeNet[s.rid].net += s.net; tradeNet[s.rid].count++; } });
    (t.picks || []).forEach(d => { if (sides[d.to]) (sides[d.to].picks = sides[d.to].picks || []).push(d); });
    trades.push({ season: raw.season, week: t.leg, created: t.created, sides: list });
  });
  trades.sort((a, b) => a.created - b.created);
  S.trades = trades;
  S.tradeNet = tradeNet;

  // Season totals per player (regular season) and positional finishes.
  const playerPts = {};
  scoredWeeks.forEach(w => {
    Object.values(byWeek[w]).forEach(m => {
      Object.keys(m.players_points).forEach(pid => { playerPts[pid] = (playerPts[pid] || 0) + (m.players_points[pid] || 0); });
    });
  });
  const byPos = {};
  Object.keys(playerPts).forEach(pid => { const p = posOf(pid); (byPos[p] = byPos[p] || []).push(pid); });
  const posRank = {};
  Object.keys(byPos).forEach(p => {
    byPos[p].sort((a, b) => playerPts[b] - playerPts[a]).forEach((pid, i) => { posRank[pid] = i + 1; });
  });
  S.playerPts = playerPts;
  S.posRank = posRank;

  // Positional value: points above a replacement-level starter at the same position.
  // The replacement level is the first player past the league's starting spots at that position
  // (dedicated slots plus a share of each flex), e.g. QB13 in a 12-team 1-QB league.
  const share = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  const FLEX_SPLIT = { FLEX: { RB: 0.4, WR: 0.5, TE: 0.1 }, SUPER_FLEX: { QB: 0.8, RB: 0.08, WR: 0.1, TE: 0.02 }, WRRB_FLEX: { WR: 0.55, RB: 0.45 }, REC_FLEX: { WR: 0.8, TE: 0.2 } };
  S.slots.forEach(sl => {
    if (ELIGIBLE[sl].length === 1) share[ELIGIBLE[sl][0]] += 1;
    else Object.entries(FLEX_SPLIT[sl] || {}).forEach(([p, f]) => { share[p] += f; });
  });
  const replacement = {};
  Object.keys(share).forEach(p => {
    if (!share[p]) return;
    const rank = Math.max(1, Math.round(rids.length * share[p]));
    const list = (byPos[p] || []);
    replacement[p] = { rank: rank + 1, pts: list[rank] ? playerPts[list[rank]] : 0 };
  });
  S.replacement = replacement;
  const aboveRepl = pid => { const p = posOf(pid); return replacement[p] ? (playerPts[pid] || 0) - replacement[p].pts : 0; };
  S.aboveRepl = aboveRepl;

  // Draft: each pick's positional value against what picks around that slot produced this season.
  const picks = raw.picks.filter(p => p.player_id).map(p => ({ ...p, pts: playerPts[p.player_id] || 0, pos: posOf(p.player_id), vor: aboveRepl(p.player_id) }));
  // Expected value at each pick comes from a smooth curve across all of the league's finished drafts
  // of a similar size (see draftCurves); with no finished drafts yet, from picks within 6 spots in this draft.
  const curve = opts.curves && opts.curves[raw.season];
  picks.forEach(p => {
    if (curve) p.expected = curve(p.pick_no);
    else p.expected = mean(picks.filter(q => Math.abs(q.pick_no - p.pick_no) <= 6).map(q => q.vor));
  });
  // The curve sets the shape (how value falls off by pick); re-centering keeps each draft's picks
  // averaging zero, so a strong or weak season overall doesn't push every team up or down.
  const offset = curve ? mean(picks.map(p => p.vor - p.expected)) : 0;
  picks.forEach(p => { p.expected += offset; p.value = p.vor - p.expected; });
  // Misses hurt more early and less late: a below-slot pick counts 1.5x in round 1, sliding to 0.4x
  // in the last round. Hits count in full. rawValue keeps the unweighted number.
  const lastRound = picks.reduce((m, p) => Math.max(m, p.round || 1), 1);
  S.missWeight = rd => (lastRound <= 1 ? 1 : 1.5 - 1.1 * ((rd || 1) - 1) / (lastRound - 1));
  picks.forEach(p => { p.rawValue = p.value; if (p.value < 0) p.value *= S.missWeight(p.round); });
  // Positional draft rank: the order each position came off the board (WR1 = first WR taken).
  const posCount = {};
  picks.slice().sort((a, b) => a.pick_no - b.pick_no).forEach(p => { posCount[p.pos] = (posCount[p.pos] || 0) + 1; p.posDrafted = posCount[p.pos]; });
  const draftVal = {};
  rids.forEach(r => { draftVal[r] = 0; });
  picks.forEach(p => { if (draftVal[p.roster_id] != null) draftVal[p.roster_id] += p.value; });
  S.picks = picks;
  S.draftValue = draftVal;
  // Kickers and defenses can't be the steal; they still count toward grades.
  const skill = picks.filter(p => p.pos !== 'K' && p.pos !== 'DEF');
  S.steal = skill.length ? skill.slice().sort((a, b) => b.value - a.value)[0] : null;
  const early = picks.filter(p => p.round <= 3);
  S.bust = early.length ? early.slice().sort((a, b) => a.value - b.value)[0] : null;

  // Team MVPs: most starter points for that team.
  const mvp = {};
  rids.forEach(r => {
    const totals = {};
    allWeeks.forEach(w => {
      const m = byWeek[w] && byWeek[w][r];
      if (!m) return;
      m.starters.forEach(pid => { if (pid && pid !== '0') totals[pid] = (totals[pid] || 0) + (m.players_points[pid] || 0); });
    });
    const best = Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0];
    mvp[r] = best ? { pid: best, pts: totals[best], pos: posOf(best) } : null;
  });
  S.mvp = mvp;

  // Weekly power rankings by cumulative points for.
  const cum = {};
  rids.forEach(r => { cum[r] = 0; });
  const power = {};
  rids.forEach(r => { power[r] = []; });
  scoredWeeks.forEach(w => {
    rids.forEach(r => { cum[r] += byWeek[w][r] ? byWeek[w][r].points : 0; });
    rids.slice().sort((a, b) => cum[b] - cum[a]).forEach((r, i) => { power[r].push(i + 1); });
  });
  S.power = power;

  // Weekly highs and lows.
  const allScores = [];
  scoredWeeks.forEach(w => rids.forEach(r => { if (byWeek[w][r]) allScores.push({ rid: r, week: w, pts: byWeek[w][r].points }); }));
  S.weeklyHighs = allScores.slice().sort((a, b) => b.pts - a.pts).slice(0, 5);

  // Manager Score for the season.
  const results = {}; const startSit = {}; const waiv = {}; const trade = {}; const draft = {};
  rids.forEach(r => {
    results[r] = 0.5 * st[r].winPct + 0.5 * st[r].allPlayPct;
    startSit[r] = eff[r].pct;
    waiv[r] = waivers[r].pts;
    trade[r] = tradeNet[r].net;
    draft[r] = draftVal[r];
  });
  // Dynasty drafts are left out of the Manager Score; the other parts are reweighted to fill the gap.
  const hasDraft = picks.length > 0 && format !== 'dynasty';
  const sc = { results: scale(results), startSit: scale(startSit), waivers: scale(waiv), trades: scale(trade), draft: scale(draft) };
  const W = CONFIG.weights;
  const wsum = W.results + W.startSit + W.waivers + W.trades + (hasDraft ? W.draft : 0);
  // League average and spread for each raw stat, kept so profiles can show the math.
  const rawSets = { results, startSit, waivers: waiv, trades: trade, draft };
  S.scoreStats = {};
  Object.keys(rawSets).forEach(k => { const xs = rids.map(r => rawSets[k][r]); S.scoreStats[k] = { mean: mean(xs), sd: sd(xs) }; });
  S.hasDraft = hasDraft;
  S.weightSum = wsum;
  const scores = {};
  rids.forEach(r => {
    let res = sc.results[r];
    let bonus = 0;
    const bonusParts = [];
    if (playoffRids.has(r) && raw.status === 'complete') { bonus += CONFIG.bonus.playoffs; bonusParts.push('playoffs +' + CONFIG.bonus.playoffs); }
    if (S.finalists.indexOf(r) >= 0 && raw.status === 'complete') { bonus += CONFIG.bonus.final; bonusParts.push('final +' + CONFIG.bonus.final); }
    if (S.champion === r) { bonus += CONFIG.bonus.title; bonusParts.push('title +' + CONFIG.bonus.title); }
    res = Math.min(100, res + bonus);
    const parts = { results: res, startSit: sc.startSit[r], waivers: sc.waivers[r], trades: sc.trades[r], draft: hasDraft ? sc.draft[r] : null };
    const total = (W.results * parts.results + W.startSit * parts.startSit + W.waivers * parts.waivers + W.trades * parts.trades + (hasDraft ? W.draft * parts.draft : 0)) / wsum;
    scores[r] = {
      total, parts, games: st[r].games,
      raw: { results: results[r], startSit: startSit[r], waivers: waiv[r], trades: trade[r], draft: draft[r] },
      scaled: { results: sc.results[r], startSit: sc.startSit[r], waivers: sc.waivers[r], trades: sc.trades[r], draft: sc.draft[r] },
      bonus, bonusParts
    };
  });
  S.scores = scores;

  // Schedule swap: this team's scores against each other team's opponents.
  const oppOf = {};
  scoredWeeks.forEach(w => {
    oppOf[w] = {};
    games.filter(g => !g.playoff && g.week === w).forEach(g => { oppOf[w][g.a] = g.b; oppOf[w][g.b] = g.a; });
  });
  const swap = {};
  rids.forEach(x => {
    const results = [];
    rids.forEach(y => {
      if (y === x) return;
      let wins = 0; let losses = 0; let ties = 0;
      scoredWeeks.forEach(w => {
        let opp = oppOf[w][y];
        if (opp == null) return;
        if (opp === x) opp = y;
        const xs = byWeek[w][x] ? byWeek[w][x].points : 0;
        const os = byWeek[w][opp] ? byWeek[w][opp].points : 0;
        if (xs > os) wins++; else if (os > xs) losses++; else ties++;
      });
      results.push({ y, wins, losses, ties });
    });
    swap[x] = results;
  });
  S.swap = swap;

  // Playoff odds for a season still being played.
  if (S.isCurrent && !opts.skipOdds) S.odds = simulateOdds(S, raw, byWeek, st);

  return S;
}

function simulateOdds(S, raw, byWeek, st) {
  const lastReg = raw.playoffWeekStart - 1;
  const rids = S.rids;
  const scoresBy = {};
  rids.forEach(r => { scoresBy[r] = S.regWeeks.map(w => byWeek[w][r] ? byWeek[w][r].points : null).filter(x => x != null); });
  const all = [].concat.apply([], rids.map(r => scoresBy[r]));
  const leagueMean = mean(all) || 110;
  const leagueSd = sd(all) || 25;
  const params = {};
  rids.forEach(r => {
    const xs = scoresBy[r];
    const n = xs.length;
    // Shrink toward the league average early in the season.
    const m = (sum(xs) + leagueMean * 3) / (n + 3);
    params[r] = { m, s: Math.max(15, n >= 3 ? sd(xs) : leagueSd) };
  });
  const future = [];
  for (let w = S.scoredThrough + 1; w <= lastReg; w++) {
    const groups = {};
    Object.values(byWeek[w] || {}).forEach(m => { if (m.matchup_id != null) (groups[m.matchup_id] = groups[m.matchup_id] || []).push(m.roster_id); });
    Object.values(groups).forEach(g => { if (g.length === 2) future.push(g); });
  }
  const made = {}; const top = {}; const titles = {}; const finals = {}; const byes = {};
  rids.forEach(r => { made[r] = 0; top[r] = 0; titles[r] = 0; finals[r] = 0; byes[r] = 0; });
  // First-round byes go to the top seeds when the playoff field isn't a power of two (6 teams: seeds 1–2).
  let bracketSize = 1; while (bracketSize < S.playoffTeams) bracketSize *= 2;
  const byeCount = bracketSize - S.playoffTeams;
  const N = CONFIG.simulations;
  function normal() { let u = 0; let v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const play = (a, b) => {
    if (a == null) return b; if (b == null) return a;
    return params[a].m + params[a].s * normal() > params[b].m + params[b].s * normal() ? a : b;
  };
  // Standard single elimination with byes for the top seeds (6 teams: 1 and 2 get byes, 3v6 and 4v5).
  function seedOrder(size) { let o = [1]; while (o.length < size) { const n = o.length * 2; o = [].concat.apply([], o.map(x => [x, n + 1 - x])); } return o; }
  function bracketFromSeeds(seeds) {
    let size = 1; while (size < seeds.length) size *= 2;
    let field = seedOrder(size).map(k => seeds[k - 1]);
    let finalists = null;
    while (field.length > 1) {
      if (field.length === 2) finalists = field.slice();
      const next = [];
      for (let i = 0; i < field.length; i += 2) next.push(play(field[i], field[i + 1]));
      field = next;
    }
    return { champ: field[0], finalists: finalists || field };
  }
  // Once the playoffs start, play out Sleeper's real bracket and keep games already decided.
  const bracketLive = S.scoredThrough >= lastReg && (raw.winners || []).some(m => typeof m.t1 === 'number');
  function bracketFromSleeper() {
    const res = {};
    const matches = raw.winners.filter(m => !m.p || m.p === 1).slice().sort((a, b) => a.r - b.r || a.m - b.m);
    let champ = null; let finalists = null;
    matches.forEach(m => {
      const side = (t, from) => (typeof t === 'number' ? t : from ? (from.w != null ? (res[from.w] || {}).w : (res[from.l] || {}).l) : null);
      const a = side(m.t1, m.t1_from); const b = side(m.t2, m.t2_from);
      const week = raw.playoffWeekStart + m.r - 1;
      let w; if (m.w && week <= S.scoredThrough) w = m.w; else w = play(a, b);
      res[m.m] = { w, l: w === a ? b : a };
      if (m.p === 1) { champ = w; finalists = [a, b]; }
    });
    return { champ, finalists: finalists || [] };
  }
  for (let i = 0; i < N; i++) {
    const wins = {}; const pf = {};
    rids.forEach(r => { wins[r] = st[r].wins + st[r].ties / 2; pf[r] = st[r].pf; });
    future.forEach(([a, b]) => {
      const sa = params[a].m + params[a].s * normal();
      const sb = params[b].m + params[b].s * normal();
      pf[a] += sa; pf[b] += sb;
      if (sa > sb) wins[a]++; else wins[b]++;
    });
    const order = rids.slice().sort((a, b) => wins[b] - wins[a] || pf[b] - pf[a]);
    const seeds = order.slice(0, S.playoffTeams);
    seeds.forEach(r => { made[r]++; });
    seeds.slice(0, byeCount).forEach(r => { byes[r]++; });
    top[order[0]]++;
    const out = bracketLive ? bracketFromSleeper() : bracketFromSeeds(seeds);
    if (out.champ != null) titles[out.champ]++;
    out.finalists.forEach(r => { if (r != null) finals[r]++; });
  }
  const out = {};
  rids.forEach(r => { out[r] = { playoffs: bracketLive ? (S.playoffRids.has(r) ? 1 : 0) : made[r] / N, first: top[r] / N, bye: byes[r] / N, title: titles[r] / N, final: finals[r] / N }; });
  return { byRid: out, remainingWeeks: Math.max(0, lastReg - S.scoredThrough), bracketLive, byeCount };
}

// Expected positional value by overall pick number, smoothed across the league's finished drafts.
// Only drafts with the same number of teams and a similar number of picks are pooled
// (a 10-team draft isn't compared with a 12-team one, nor a dynasty startup with a rookie draft).
// For a season still in progress, the curve is scaled down to the share of the regular season played.
function draftCurves(seasons) {
  const drafts = seasons.filter(S => S.picks.length);
  const curves = {};
  drafts.forEach(S => {
    const peers = drafts.filter(D => !D.isCurrent && D.rids.length === S.rids.length && Math.abs(D.picks.length - S.picks.length) <= 0.25 * S.picks.length);
    const pool = [].concat.apply([], peers.map(D => D.picks.map(p => ({ k: p.pick_no, v: p.vor }))));
    if (pool.length < 40) return;
    const full = Math.max(1, S.playoffWeekStart - 1);
    const frac = S.isCurrent ? Math.max(1, S.regWeeks.length) / full : 1;
    const memo = {};
    curves[S.season] = k => {
      if (memo[k] != null) return memo[k];
      let ws = 0; let t = 0;
      pool.forEach(q => { const d = Math.abs(q.k - k); if (d <= 8) { const w = 1 - d / 9; ws += w; t += w * q.v; } });
      return (memo[k] = ws ? (t / ws) * frac : 0);
    };
  });
  return curves;
}

export function buildModel(data, format) {
  const players = data.players;
  // data.seasons is newest first, so the seasons after season i are 0..i-1 (oldest first).
  const build = opts => data.seasons.map((raw, i) => buildSeason(raw, players, i === 0, data.seasons.slice(0, i).reverse(), format || 'redraft', opts));
  // Two passes: the first works out every pick's positional value, which the slot curves are built from.
  const seasons = build({ curves: draftCurves(build({ skipOdds: true })) });
  const managers = {};
  data.seasons.forEach(raw => {
    raw.rosters.forEach(r => {
      const id = r.owner_id || ('roster-' + raw.season + '-' + r.roster_id);
      const u = raw.users.find(x => x.user_id === r.owner_id);
      if (!managers[id]) managers[id] = { id, name: u ? u.display_name : 'Team ' + r.roster_id, avatar: u && u.avatar, teamNames: [], seasons: [] };
      if (u && u.team_name && managers[id].teamNames.indexOf(u.team_name) < 0) managers[id].teamNames.push(u.team_name);
      managers[id].seasons.push(raw.season);
    });
  });
  const nameOf = id => (managers[id] ? managers[id].name : 'Unknown');
  const playerName = pid => (players[pid] ? players[pid][0] : pid);
  const playerPos = pid => (players[pid] ? players[pid][1] : '');

  // Career totals per manager.
  const career = {};
  Object.keys(managers).forEach(id => {
    career[id] = { id, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, maxPf: 0, allPlay: 0, allPlayGames: 0, games: 0, titles: 0, finals: 0, playoffs: 0, lastPlaces: 0,
      luck: 0, regPts: 0, regGames: 0, poPts: 0, poGames: 0, scoreWeighted: 0, scoreGames: 0,
      parts: { results: 0, startSit: 0, waivers: 0, trades: 0, draft: 0 }, draftGames: 0,
      tradeNet: 0, trades: 0, waiverPts: 0, benchLeft: 0, effActual: 0, effOptimal: 0, bySeason: [] };
  });
  seasons.forEach(S => {
    S.rids.forEach(r => {
      const id = S.ownerOf[r];
      const c = career[id];
      const s = S.st[r];
      c.wins += s.wins; c.losses += s.losses; c.ties += s.ties; c.pf += s.pf; c.pa += s.pa; c.games += s.games;
      c.maxPf += s.maxPf; c.allPlay += s.allPlay; c.allPlayGames += s.allPlayGames;
      c.luck += s.luck; c.regPts += s.pf; c.regGames += s.games;
      if (S.champion === r) c.titles++;
      if (S.status === 'complete' && S.finalists.indexOf(r) >= 0) c.finals++;
      if (S.status === 'complete' && S.playoffRids.has(r)) c.playoffs++;
      if (S.lastPlace === r) c.lastPlaces++;
      const sc = S.scores[r];
      const g = Math.max(1, sc.games);
      c.scoreWeighted += sc.total * g; c.scoreGames += g;
      ['results', 'startSit', 'waivers', 'trades'].forEach(k => { c.parts[k] += sc.parts[k] * g; });
      if (sc.parts.draft != null) { c.parts.draft += sc.parts.draft * g; c.draftGames += g; }
      c.tradeNet += S.tradeNet[r].net; c.trades += S.tradeNet[r].count;
      c.waiverPts += S.waivers[r].pts;
      c.benchLeft += S.efficiency[r].benchLeft; c.effActual += S.efficiency[r].actual; c.effOptimal += S.efficiency[r].optimal;
      c.bySeason.push({ season: S.season, rid: r, score: sc.total, rank: s.rank, wins: s.wins, losses: s.losses, ties: s.ties,
        champion: S.champion === r, runnerUp: S.runnerUp === r, last: S.lastPlace === r, current: S.isCurrent });
    });
    S.games.filter(g => g.playoff).forEach(g => {
      [[g.a, g.ap], [g.b, g.bp]].forEach(([r, p]) => { const c = career[S.ownerOf[r]]; c.poPts += p; c.poGames++; });
    });
  });
  Object.values(career).forEach(c => {
    c.score = c.scoreGames ? c.scoreWeighted / c.scoreGames : 0;
    ['results', 'startSit', 'waivers', 'trades'].forEach(k => { c.parts[k] = c.scoreGames ? c.parts[k] / c.scoreGames : 0; });
    c.parts.draft = c.draftGames ? c.parts.draft / c.draftGames : null;
    c.winPct = c.games ? (c.wins + c.ties / 2) / c.games : 0;
    c.allPlayPct = c.allPlayGames ? c.allPlay / c.allPlayGames : 0;
    c.ppg = c.regGames ? c.regPts / c.regGames : 0;
    c.poPpg = c.poGames ? c.poPts / c.poGames : null;
    c.clutch = c.poPpg != null && c.ppg ? c.poPpg / c.ppg - 1 : null;
    c.effPct = c.effOptimal ? c.effActual / c.effOptimal : 0;
  });
  const leaderboard = Object.values(career).filter(c => c.games > 0).sort((a, b) => b.score - a.score);

  // Every game, all seasons.
  const allGames = [].concat.apply([], seasons.map(S => S.games.map(g => ({ ...g, ao: S.ownerOf[g.a], bo: S.ownerOf[g.b] }))));
  const newest = seasons.length ? seasons[0].season : null;

  // Single-game and streak records.
  const rec = (label, value, fmt, who, season, week, detail) => ({ label, value, display: fmt(value), who, season, week, detail, isNew: season === newest });
  const pts = x => round2(x).toFixed(2).replace(/\.?0+$/, '') ;
  const records = [];
  if (allGames.length) {
    const flat = [].concat.apply([], allGames.map(g => [
      { o: g.ao, p: g.ap, op: g.bp, oo: g.bo, g }, { o: g.bo, p: g.bp, op: g.ap, oo: g.ao, g }
    ]));
    const hi = flat.slice().sort((a, b) => b.p - a.p)[0];
    const lo = flat.filter(x => x.p > 0 && !x.g.playoff).sort((a, b) => a.p - b.p)[0];
    const blow = allGames.slice().sort((a, b) => Math.abs(b.ap - b.bp) - Math.abs(a.ap - a.bp))[0];
    const close = allGames.filter(g => g.ap !== g.bp).sort((a, b) => Math.abs(a.ap - a.bp) - Math.abs(b.ap - b.bp))[0];
    const lossHi = flat.filter(x => x.p < x.op).sort((a, b) => b.p - a.p)[0];
    const winLo = flat.filter(x => x.p > x.op).sort((a, b) => a.p - b.p)[0];
    const winner = g => (g.ap > g.bp ? g.ao : g.bo);
    const loser = g => (g.ap > g.bp ? g.bo : g.ao);
    records.push(rec('Highest score', hi.p, pts, nameOf(hi.o), hi.g.season, hi.g.week));
    if (lo) records.push(rec('Lowest score', lo.p, pts, nameOf(lo.o), lo.g.season, lo.g.week));
    records.push(rec('Biggest blowout', Math.abs(blow.ap - blow.bp), x => '+' + pts(x), nameOf(winner(blow)) + ' over ' + nameOf(loser(blow)), blow.season, blow.week));
    if (close) records.push(rec('Closest game', Math.abs(close.ap - close.bp), pts, nameOf(winner(close)) + ' over ' + nameOf(loser(close)), close.season, close.week));
    // Streaks within a regular season.
    let bestW = null; let bestL = null;
    seasons.forEach(S => {
      S.rids.forEach(r => {
        const seq = S.games.filter(g => !g.playoff && (g.a === r || g.b === r)).sort((a, b) => a.week - b.week)
          .map(g => { const mine = g.a === r ? g.ap : g.bp; const theirs = g.a === r ? g.bp : g.ap; return { w: g.week, res: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T' }; });
        ['W', 'L'].forEach(kind => {
          let run = 0; let start = 0;
          seq.forEach((x, i) => {
            if (x.res === kind) { if (run === 0) start = x.w; run++; } else run = 0;
            const cur = { n: run, o: S.ownerOf[r], season: S.season, from: start, to: x.w };
            if (run > 0) {
              if (kind === 'W' && (!bestW || run > bestW.n)) bestW = cur;
              if (kind === 'L' && (!bestL || run > bestL.n)) bestL = cur;
            }
          });
        });
      });
    });
    if (bestW) records.push(rec('Longest win streak', bestW.n, String, nameOf(bestW.o), bestW.season, null, 'Weeks ' + bestW.from + '–' + bestW.to));
    if (bestL) records.push(rec('Longest losing streak', bestL.n, String, nameOf(bestL.o), bestL.season, null, 'Weeks ' + bestL.from + '–' + bestL.to));
    if (lossHi) records.push(rec('Most pts in a loss', lossHi.p, pts, nameOf(lossHi.o), lossHi.g.season, lossHi.g.week));
    if (winLo) records.push(rec('Fewest pts in a win', winLo.p, pts, nameOf(winLo.o), winLo.g.season, winLo.g.week));
  }

  // Head-to-head.
  const h2h = {};
  allGames.forEach(g => {
    const k = [g.ao, g.bo].sort().join('|');
    const x = h2h[k] = h2h[k] || { a: [g.ao, g.bo].sort()[0], b: [g.ao, g.bo].sort()[1], aw: 0, bw: 0, t: 0, margin: 0, games: 0, playoff: 0, list: [] };
    const aPts = g.ao === x.a ? g.ap : g.bp;
    const bPts = g.ao === x.a ? g.bp : g.ap;
    if (aPts > bPts) x.aw++; else if (bPts > aPts) x.bw++; else x.t++;
    x.margin += Math.abs(aPts - bPts); x.games++; if (g.playoff) x.playoff++;
    x.list.push({ season: g.season, week: g.week, aPts, bPts, playoff: g.playoff });
  });
  const h2hRecord = (p, q) => {
    const k = [p, q].sort().join('|');
    const x = h2h[k];
    if (!x) return { w: 0, l: 0, t: 0, games: 0, margin: 0, playoff: 0, list: [] };
    const mine = x.a === p;
    return { w: mine ? x.aw : x.bw, l: mine ? x.bw : x.aw, t: x.t, games: x.games, margin: x.games ? x.margin / x.games : 0, playoff: x.playoff,
      list: x.list.map(m => ({ season: m.season, week: m.week, mine: mine ? m.aPts : m.bPts, theirs: mine ? m.bPts : m.aPts, playoff: m.playoff })) };
  };
  const rivalry = Object.values(h2h).filter(x => x.games >= 3)
    .sort((p, q) => (q.games - Math.abs(q.aw - q.bw) * 1.5 + q.playoff) - (p.games - Math.abs(p.aw - p.bw) * 1.5 + p.playoff))[0] || null;

  // Every trade, all seasons, with owner ids.
  const allTrades = [].concat.apply([], seasons.map(S => S.trades.map(t => ({ ...t, sides: t.sides.map(s => ({ ...s, owner: S.ownerOf[s.rid] })) }))));
  let heist = null;
  allTrades.forEach(t => t.sides.forEach(s => { if (!heist || s.net > heist.side.net) heist = { trade: t, side: s }; }));

  // Schedule swap, career.
  const swapCareer = {};
  Object.keys(career).forEach(id => { swapCareer[id] = { actualW: 0, actualL: 0, actualT: 0, avgW: 0, avgL: 0, bestW: 0, bestL: 0, worstW: 0, worstL: 0 }; });
  seasons.forEach(S => {
    S.rids.forEach(r => {
      const x = swapCareer[S.ownerOf[r]];
      const s = S.st[r];
      x.actualW += s.wins; x.actualL += s.losses; x.actualT += s.ties;
      const list = S.swap[r];
      if (!list.length) return;
      x.avgW += mean(list.map(v => v.wins)); x.avgL += mean(list.map(v => v.losses));
      const best = list.slice().sort((a, b) => b.wins - a.wins)[0];
      const worst = list.slice().sort((a, b) => a.wins - b.wins)[0];
      x.bestW += best.wins; x.bestL += best.losses; x.worstW += worst.wins; x.worstL += worst.losses;
    });
  });

  return {
    seasons, managers, career, leaderboard, records, h2h, h2hRecord, rivalry, allTrades, heist, swapCareer,
    nameOf, playerName, playerPos, newest
  };
}
