// Live matchup projections.
//
// Each starter's projection = Sleeper's projected stats for the week, scored with this league's own
// scoring settings (kickers use Sleeper's projected points, since their stats are labeled differently).
// Ruled out, on IR, suspended or on a bye = 0.
// During the week, by the player's NFL game status:
//   not started -> full projection; finished -> actual points;
//   in progress -> actual points + half of what's left of the projection (the feed has no game clock).
// Win chance: each player's remaining points can swing by 65% of his remaining projection;
// P(win) comes from the projected gap against the combined swing (normal distribution).

import { loadProjections, loadSchedule } from './data.js';

const OUT = new Set(['Out', 'IR', 'Suspended', 'PUP', 'NA', 'DNR']);
const SWING = 0.65;

function scoreStats(stats, scoring) {
  let t = 0;
  for (const k in stats) if (scoring[k] != null && typeof stats[k] === 'number') t += scoring[k] * stats[k];
  return t;
}

// Normal CDF (Abramowitz–Stegun approximation).
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

const cache = {};
// Projections change slowly, so they load once per page view; game status reloads with each refresh.
export async function liveContext(S, week, refreshSchedule) {
  const key = S.season + ':' + week;
  const c = cache[key] = cache[key] || {};
  if (!c.proj && !c.projFailed) {
    try { c.proj = await loadProjections(S.season, week); } catch (e) { c.projFailed = true; }
  }
  if (!c.games || refreshSchedule) {
    try { c.games = (await loadSchedule(S.season)).filter(g => g.week === week); } catch (e) { c.games = c.games || null; }
  }
  if (c.games) {
    c.sched = {};
    c.games.forEach(g => { c.sched[g.home] = g.status; c.sched[g.away] = g.status; });
  }
  return c;
}

// Fallback when Sleeper's projections can't load: the player's average in weeks he scored this season.
function seasonAverage(S, pid) {
  let pts = 0; let n = 0;
  S.regWeeks.forEach(w => Object.values(S.byWeek[w]).forEach(m => { const p = m.players_points[pid]; if (p) { pts += p; n++; } }));
  return n ? pts / n : 0;
}

function fullProjection(S, ctx, pid) {
  const P = ctx.proj ? ctx.proj[pid] : null;
  if (!P) return ctx.proj ? 0 : seasonAverage(S, pid);
  return S.posOf(pid) === 'K' ? (P.stats.pts_std ?? P.stats.pts_ppr ?? scoreStats(P.stats, S.scoring)) : scoreStats(P.stats, S.scoring);
}

export function projectPlayer(S, ctx, pid, actual) {
  if (!pid || pid === '0') return { proj: 0, now: 0, remaining: 0, state: 'empty' };
  const P = ctx.proj ? ctx.proj[pid] : null;
  const full = Math.max(0, fullProjection(S, ctx, pid));
  const team = P && P.team;
  const status = team && ctx.sched ? ctx.sched[team] : undefined;
  const bye = !!(ctx.sched && team && status === undefined);
  if ((P && OUT.has(P.injury)) || bye) return { proj: actual, now: actual, remaining: 0, state: actual > 0 ? 'done' : (bye ? 'bye' : 'out') };
  if (status === 'complete') return { proj: actual, now: actual, remaining: 0, state: 'done' };
  if (status === 'in_progress' || (!ctx.sched && actual > 0)) {
    const remaining = Math.max(0, full - actual) / 2;
    return { proj: actual + remaining, now: actual, remaining, state: 'playing' };
  }
  return { proj: full, now: actual, remaining: full, state: 'waiting' };
}

export function projectTeam(S, ctx, m) {
  const t = { now: 0, proj: 0, varSum: 0, waiting: 0, playing: 0, done: 0, zero: 0 };
  (m.starters || []).forEach(pid => {
    const x = projectPlayer(S, ctx, pid, (m.players_points || {})[pid] || 0);
    t.now += x.now; t.proj += x.proj; t.varSum += Math.pow(SWING * x.remaining, 2);
    if (x.state === 'waiting') t.waiting++; else if (x.state === 'playing') t.playing++; else if (x.state === 'done') t.done++; else t.zero++;
  });
  return t;
}

export function winChance(a, b) {
  const sd = Math.sqrt(a.varSum + b.varSum);
  if (sd < 1e-6) return a.proj > b.proj ? 1 : a.proj < b.proj ? 0 : 0.5;
  return phi((a.proj - b.proj) / sd);
}

// ---------- simulation (?sim=4pm) ----------
// A made-up Sunday at halftime of the 4pm games, for showing how the projections behave.
// Thursday's game is final; Sleeper's schedule has dates but not kickoff times, so the Sunday games
// are split by game ID into "1pm (final)", "4pm (halftime)" and "Sunday night (not started)";
// Monday's games haven't started. Projections are real; every point scored is invented.
function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }

export function simulate4pm(S, ctx, week, list) {
  if (!ctx.games || !ctx.games.length) return list;
  const dates = [...new Set(ctx.games.map(g => g.date))].sort();
  const sundays = dates.filter(d => new Date(d + 'T12:00:00Z').getUTCDay() === 0);
  const sunday = sundays[0] || dates[Math.floor(dates.length / 2)];
  const status = {};
  const sun = ctx.games.filter(g => g.date === sunday).sort((a, b) => String(a.game_id).localeCompare(String(b.game_id)));
  const night = sun.length > 2 ? sun.slice(-1) : [];
  const day = sun.slice(0, sun.length - night.length);
  const late = day.slice(Math.round(day.length * 0.65));
  ctx.games.forEach(g => {
    let s;
    if (g.date < sunday) s = 'complete';
    else if (g.date > sunday) s = 'pre_game';
    else if (night.indexOf(g) >= 0) s = 'pre_game';
    else if (late.indexOf(g) >= 0) s = 'in_progress';
    else s = 'complete';
    status[g.home] = s; status[g.away] = s;
  });
  ctx.sched = status;
  ctx.simulated = { kickoffs: { final: day.length - late.length + ctx.games.filter(g => g.date < sunday).length, halftime: late.length, later: night.length + ctx.games.filter(g => g.date > sunday).length } };
  return list.map(m => {
    const pp = {};
    m.players.forEach(pid => {
      const P = ctx.proj && ctx.proj[pid];
      const st = P && P.team ? status[P.team] : undefined;
      if (!P || OUT.has(P.injury) || !st || st === 'pre_game') { pp[pid] = 0; return; }
      const full = Math.max(0, fullProjection(S, ctx, pid));
      const f = 0.35 + 1.3 * seeded(pid + ':' + week); // 35%–165% of the projection
      pp[pid] = Math.round(full * f * (st === 'in_progress' ? 0.5 : 1) * 100) / 100;
    });
    const points = (m.starters || []).reduce((t, pid) => t + (pp[pid] || 0), 0);
    return { ...m, players_points: pp, points: Math.round(points * 100) / 100 };
  });
}
