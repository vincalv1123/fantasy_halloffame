// Renders the Hall of Fame for any Sleeper league.
// The league comes from the address (?league=<id>&u=<username>); without one, the start screen shows.
// Routes: #all, #search, #drafts[@season], #awards, #s<season>, #m-<managerId>[@season], #vs-<id>~<id>.

import { CONFIG } from './config.js?v=202610290447';
import { loadAll, loadLiveWeek, lookupUser, nflState, userLeagues, leagueInfo, clearSavedSeasons } from './data.js?v=202610290447';
import { buildModel, optimalPoints } from './model.js?v=202610290447';
import { parse as parseQuery, answer as answerQuery, EXAMPLES, HELP, examplesFor } from './search.js?v=202610290447';

const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
let M = null;
const params = new URLSearchParams(location.search);
let LG = null; // { key, name, leagueId, username, format }
const PX = '#';
let liveTimer = null;
const $leagues = document.getElementById('leagues');

// ---------- helpers ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const f2 = x => (Math.round(x * 100) / 100).toFixed(2);
const comma = x => Number(x).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
const pct3 = x => x.toFixed(3).replace(/^0/, '');
const wl = (w, l, t) => w + '–' + l + (t ? '–' + t : '');
const name = id => esc(M.nameOf(id));
const mlink = id => PX + 'm-' + encodeURIComponent(id);
const sign = x => (x > 0 ? 'up' : x < 0 ? 'down' : '');
const TROPHY = (color, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/></svg>`;
const DOWN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F0907A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
const MARK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/></svg>';
const GOLD = '#E8B04B';
const SEARCH_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const section = (inner, cls = '') => `<section class="${cls}"><div class="wrap">${inner}</div></section>`;
const seasonOf = s => M.seasons.find(x => x.season === s);
const completed = () => M.seasons.filter(s => !s.isCurrent);
const posLabel = pid => { const p = M.playerPos(pid); return p ? ' · ' + p : ''; };
const player = pid => esc(M.playerName(pid));
const sum = xs => xs.reduce((t, x) => t + x, 0);

// ---------- sortable tables ----------
// A table whose sortable column headers re-sort its rows in place. Each column:
// { key, label, left?, desc? (default direction), cell(row, i) }. Rows carry their sort values in row.v.
const SORTS = {};
let sortSeq = 0;
function sortTable(cols, rows, opts) {
  const id = 'sort' + (++sortSeq);
  SORTS[id] = { cols, rows, key: opts.key, desc: opts.desc !== false, cut: opts.cut, cutKey: opts.cutKey || opts.key };
  return `<div class="scroll"><table class="table sortable" id="${id}">${sortHead(id)}<tbody>${sortBody(id)}</tbody></table></div>`;
}
function sortHead(id) {
  const T = SORTS[id];
  return '<thead><tr>' + T.cols.map(c => {
    const align = c.left ? ' style="text-align:left"' : '';
    if (!c.sortable) return `<th${align}>${c.label}</th>`;
    const on = T.key === c.key;
    return `<th${align} aria-sort="${on ? (T.desc ? 'descending' : 'ascending') : 'none'}"><button type="button" class="sort${on ? ' on' : ''}" data-sort="${id}" data-key="${c.key}">${c.label}<span class="arrow" aria-hidden="true">${on ? (T.desc ? '↓' : '↑') : '↕'}</span></button></th>`;
  }).join('') + '</tr></thead>';
}
function sortBody(id) {
  const T = SORTS[id];
  const rows = T.rows.slice().sort((a, b) => (T.desc ? b.v[T.key] - a.v[T.key] : a.v[T.key] - b.v[T.key]) || (b.v.tie || 0) - (a.v.tie || 0));
  return rows.map((r, i) => `<tr class="${T.cut && T.key === T.cutKey && T.desc && i === T.cut ? 'cut' : ''}">${T.cols.map(c => c.cell(r, i)).join('')}</tr>`).join('');
}
document.addEventListener('click', e => {
  const b = e.target.closest('button[data-sort]');
  if (!b) return;
  const T = SORTS[b.dataset.sort];
  if (!T) return;
  const k = b.dataset.key;
  if (T.key === k) T.desc = !T.desc; else { T.key = k; T.desc = T.cols.find(c => c.key === k).desc !== false; }
  const tbl = document.getElementById(b.dataset.sort);
  tbl.querySelector('thead').outerHTML = sortHead(b.dataset.sort);
  tbl.querySelector('tbody').innerHTML = sortBody(b.dataset.sort);
  const nb = tbl.querySelector(`button[data-key="${k}"]`); if (nb) nb.focus();
});

const cellNum = (txt, color) => `<td${color ? ` style="color:${color}"` : ''}>${txt}</td>`;
function standingsColumns(extra) {
  return [
    { key: 'pos', label: '#', cell: (r, i) => `<td class="rk">${i + 1}</td>` },
    { key: 'name', label: 'Team', left: true, cell: r => `<td class="t"><a href="${r.href}" style="text-decoration:none">${r.name}</a>${r.tag || ''}</td>` }
  ].concat(extra || []).concat([
    { key: 'wins', label: 'W–L', sortable: true, cell: r => cellNum(r.wl) },
    { key: 'pf', label: 'PF', sortable: true, cell: r => cellNum(comma(r.v.pf)) },
    { key: 'pa', label: 'PA', sortable: true, cell: r => cellNum(comma(r.v.pa), '#C9D3D2') },
    { key: 'maxPf', label: 'Max PF', sortable: true, cell: r => cellNum(comma(r.v.maxPf), '#C9D3D2') },
    { key: 'ap', label: 'All-play', sortable: true, cell: r => cellNum(pct3(r.v.ap), '#C9D3D2') }
  ]);
}

// ---------- trade pop-up ----------
const TRADES = [];
function tradeAttr(t) { let i = TRADES.indexOf(t); if (i < 0) i = TRADES.push(t) - 1; return ` data-trade="${i}"`; }
function openTrade(i) {
  const t = TRADES[i];
  if (!t) return;
  const S = seasonOf(t.season);
  const ownerOf = s => s.owner || (S ? S.ownerOf[s.rid] : null);
  const dynasty = LG && LG.format === 'dynasty';
  let dlg = document.getElementById('trade-modal');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'trade-modal';
    dlg.className = 'modal';
    dlg.setAttribute('aria-labelledby', 'trade-title');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  }
  const pickLabel = d => `${d.season} round ${d.round} pick${S && d.orig !== d.to && d.orig !== d.from && S.ownerOf[d.orig] ? ` <span class="note">(originally ${name(S.ownerOf[d.orig])}'s)</span>` : ''}`;
  dlg.innerHTML = `<div class="modal-card">
    <div class="line2" style="align-items:center"><h2 id="trade-title" style="font-size:18px">Trade · ${t.season} Week ${t.week}</h2>
      <button type="button" class="close" data-close aria-label="Close">✕</button></div>
    ${t.sides.map(s => { const id = ownerOf(s);
      return `<div class="side"><div class="line2"><a class="name" href="${mlink(id)}" style="text-decoration:none" data-close>${name(id)}</a>
        <span class="num ${sign(s.net)}" style="font-size:16px">${signed(s.net)}</span></div>
        <span class="note" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px">Received</span>
        <div class="rows">${s.got.map(g => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;padding:9px 0">
            <span style="font-size:14px">${player(g.pid)} <span class="note">${esc(M.playerPos(g.pid))}</span></span><span class="num" style="font-size:13px">${f1(g.pts)} pts</span></div>`).join('')}
          ${(s.picks || []).map(d => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;padding:9px 0"><span style="font-size:14px">${pickLabel(d)}</span><span class="note">pick</span></div>`).join('')}
          ${!s.got.length && !(s.picks || []).length ? '<p class="note" style="margin:8px 0 0">Nothing on record (FAAB or other).</p>' : ''}</div></div>`; }).join('')}
    <p class="note" style="margin:0">Pts = starter points each player scored for his new team after the trade${dynasty ? ', including later seasons while he stayed' : ', rest of that season'}. The number by each name is the net. Picks count as 0.</p>
  </div>`;
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  const c = dlg.querySelector('.close'); if (c) c.focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-trade]');
  if (b) { e.preventDefault(); openTrade(Number(b.dataset.trade)); }
});

// ---------- tabs ----------
function renderTabs(route) {
  const items = [`<a class="pill${route.view === 'all' ? ' on' : ''}" href="${PX}all">All-Time</a>`, `<a class="pill${route.view === 'playoffs' ? ' on' : ''}" href="${PX}playoffs">Playoffs</a>`, `<a class="pill${route.view === 'search' ? ' on' : ''}" href="${PX}search">${SEARCH_ICON} Stat search</a>`,
    `<a class="pill${route.view === 'drafts' ? ' on' : ''}" href="${PX}drafts">Drafts</a>`, `<a class="pill${route.view === 'awards' ? ' on' : ''}" href="${PX}awards">Awards</a>`, `<a class="pill${route.view === 'matchups' ? ' on' : ''}" href="${PX}matchups">Matchup history</a>`]
    .concat(['<span class="tabs-label" aria-hidden="true">Seasons</span>'])
    .concat(M.seasons.map(s => `<a class="pill${route.view === 'season' && route.season === s.season ? ' on' : ''}" href="${PX}s${s.season}">${s.isCurrent ? '<span class="dot"></span>' : ''}${s.season}</a>`));
  $tabs.innerHTML = items.join('');
  const on = $tabs.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---------- All-Time ----------
function viewAll() {
  const done = completed();
  const first = M.seasons.length ? M.seasons[M.seasons.length - 1].season : '';
  const out = [];
  out.push(section(`<div class="eyebrow">${MARK} ${esc(LG.name)} · all-time archive since ${first}</div>
    <h1>Every title, record and trade <span class="soft">since the league began.</span></h1>
    ${searchForm('home-q', '')}`, 'hero'));

  const reign = done.find(s => s.champion);
  if (reign) {
    const id = reign.ownerOf[reign.champion];
    const st = reign.st[reign.champion];
    const c = M.career[id];
    out.push(`<section class="paper"><div class="wrap">
      <div class="line2"><span class="label">Reigning champion</span>${TROPHY(GOLD, 26)}</div>
      <a href="${mlink(id)}" class="big" style="text-decoration:none">${name(id)} <span class="soft">${reign.season}</span></a>
      <div class="stats"><div><span>Record</span><span>${wl(st.wins, st.losses, st.ties)}</span></div>
      <div><span>Points for</span><span>${comma(st.pf)}</span></div>
      <div><span>Titles</span><span>${c.titles}</span></div></div></div></section>`);
  }

  if (done.length) {
    out.push(section(`<h2>Trophy case</h2><div class="rows">${done.map(s => `
      <a class="row r-trophy" href="${PX}s${s.season}"><span class="year">${s.season}</span>
      <span class="stack"><span class="name">${s.champion ? name(s.ownerOf[s.champion]) : '—'}</span>
      <span class="sub">Runner-up ${s.runnerUp ? name(s.ownerOf[s.runnerUp]) : '—'} · Last ${s.lastPlace ? name(s.ownerOf[s.lastPlace]) : '—'}</span></span>
      ${TROPHY(GOLD)}</a>`).join('')}</div>`));

    out.push(section(`<div class="head"><h2>Wall of Shame</h2><span class="note">Toilet bowl losers, every year</span></div>
      <div class="rows">${done.filter(s => s.lastPlace).map(s => { const st = s.st[s.lastPlace]; return `
      <a class="row r-trophy" href="${mlink(s.ownerOf[s.lastPlace])}"><span class="year">${s.season}</span>
      <span class="stack"><span class="name">${name(s.ownerOf[s.lastPlace])}</span><span class="sub">${s.toiletBowl ? 'Lost the toilet bowl · ' : ''}${wl(st.wins, st.losses, st.ties)} regular season</span></span>${DOWN}</a>`; }).join('')}</div>`));
  }

  const lb = M.leaderboard;
  const atRows = lb.map(c => ({ name: name(c.id), href: mlink(c.id), wl: wl(c.wins, c.losses, c.ties),
    tag: c.titles ? ` <span class="note gold-t">${'★'.repeat(Math.min(c.titles, 5))}</span>` : '',
    v: { wins: c.winPct, pf: c.pf, pa: c.pa, maxPf: c.maxPf, ap: c.allPlayPct, seasons: c.bySeason.length, titles: c.titles, tie: c.pf } }));
  out.push(section(`<div class="head"><h2>All-time standings</h2><span class="note">Regular season · tap a column to sort</span></div>
    ${sortTable(standingsColumns([{ key: 'seasons', label: 'Yrs', sortable: true, cell: r => cellNum(String(r.v.seasons), '#8A9C9F') }]).concat([{ key: 'titles', label: 'Titles', sortable: true, cell: r => cellNum(String(r.v.titles)) }]), atRows, { key: 'wins' })}
    <span class="note">W–L sorts by win %. ★ = titles.</span>`));
  out.push(section(`<div class="head"><h2>Manager Score</h2><span class="note">Career · 0–100 · 50 is average</span></div>
    <div class="rows">${lb.map((c, i) => {
      const best = i === 0; const worst = i === lb.length - 1 && lb.length > 1;
      const color = best ? GOLD : worst ? '#F0907A' : '#7E9093';
      return `<a class="row r-score" href="${mlink(c.id)}"><span class="num" style="font-size:13px;color:${best ? GOLD : '#8A9C9F'}">${i + 1}</span>
        <span class="stack" style="gap:7px"><span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="name">${name(c.id)}</span>
        ${best ? '<span class="tag gold">Best manager</span>' : ''}${worst ? '<span class="tag down">Worst manager</span>' : ''}</span>
        <span class="bar"><i style="width:${c.score}%;background:${color}"></i></span></span>
        <span class="val">${Math.round(c.score)}</span></a>`;
    }).join('')}</div><span class="note">Tap a manager to see how the score breaks down.</span>`));

  if (M.records.length) {
    out.push(section(`<h2>Single-game records</h2><div class="tiles">${M.records.map(r => `
      <div class="tile">${r.isNew ? '<span class="tag gold" style="align-self:flex-start">New record</span>' : ''}
      <span class="k">${esc(r.label)}</span><span class="v">${esc(r.display)}</span><span class="w">${esc(r.who)}</span>
      <span class="d">${r.season}${r.week ? ' · Week ' + r.week : ''}${r.detail ? ' · ' + esc(r.detail) : ''}</span></div>`).join('')}</div>`));
  }

  const byLuck = lb.slice().sort((a, b) => b.luck - a.luck);
  if (byLuck.length > 1) {
    const L = byLuck[0]; const U = byLuck[byLuck.length - 1];
    out.push(section(`<div class="head"><h2>Luck Index</h2><span class="note">Actual wins minus expected wins</span></div>
      <div class="cards"><a class="card" href="${mlink(L.id)}"><span class="k">Luckiest</span><span class="v up">${signed(L.luck)}</span><span class="name">${name(L.id)}</span></a>
      <a class="card" href="${mlink(U.id)}"><span class="k">Unluckiest</span><span class="v down">${signed(U.luck)}</span><span class="name">${name(U.id)}</span></a></div>
      <p class="lead">Expected wins come from all-play: each week, how many teams your score would have beaten.</p>`));
  }

  const riv = M.rivalry; const heist = M.heist;
  if (riv || heist) {
    let html = '<h2>Rivalries &amp; trades</h2>';
    if (riv) html += `<a class="box" href="${PX}vs-${encodeURIComponent(riv.a)}~${encodeURIComponent(riv.b)}" style="text-decoration:none">
      <span class="k note" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px">Fiercest rivalry</span>
      <div class="line2"><span class="name" style="font-weight:600">${name(riv.a)} vs ${name(riv.b)}</span><span class="num">${wl(riv.aw, riv.bw, riv.t)}</span></div>
      <span class="note">${riv.games} games · average margin ${f1(riv.margin / riv.games)} pts${riv.playoff ? ' · ' + riv.playoff + ' playoff meeting' + (riv.playoff > 1 ? 's' : '') : ''}</span></a>`;
    if (heist && heist.side.net > 0) {
      const others = heist.trade.sides.filter(s => s.owner !== heist.side.owner).map(s => name(s.owner)).join(' & ');
      html += `<button type="button" class="box tradebtn"${tradeAttr(heist.trade)}><span class="note" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px">Biggest trade heist · tap for details</span>
        <div class="line2"><span style="font-weight:600">${name(heist.side.owner)} over ${others}</span><span class="num up">${signed(heist.side.net)}</span></div>
        <span class="note">${heist.trade.season} · Week ${heist.trade.week} · got ${heist.side.got.map(g => player(g.pid)).join(', ') || 'picks'} · starter pts gained, ${LG.format === 'dynasty' ? 'including later seasons' : 'rest of season'}</span></button>`;
    }
    out.push(section(html));
  }

  // Schedule swap
  const swaps = lb.map(c => ({ c, s: M.swapCareer[c.id] })).filter(x => x.s && (x.s.actualW + x.s.actualL) > 0)
    .map(x => ({ ...x, diff: x.s.actualW - x.s.avgW })).sort((a, b) => b.diff - a.diff);
  if (swaps.length > 2) {
    const max = swaps[0]; const min = swaps[swaps.length - 1];
    out.push(section(`<h2>Schedule swap</h2><p class="lead">Your career record if you had played each other manager's schedule instead of your own.</p>
      <div class="scroll"><table class="table"><thead><tr><th>Manager</th><th>Actual</th><th>Swap avg</th><th>Best / worst</th></tr></thead><tbody>
      ${swaps.map(x => `<tr><td class="t"><a href="${mlink(x.c.id)}" style="text-decoration:none">${name(x.c.id)}</a>
        ${x === max && x.diff >= 1 ? ' <span class="tag up">Lucky</span>' : ''}${x === min && x.diff <= -1 ? ' <span class="tag down">Robbed</span>' : ''}</td>
        <td>${wl(x.s.actualW, x.s.actualL, x.s.actualT)}</td><td style="color:#C9D3D2">${Math.round(x.s.avgW)}–${Math.round(x.s.avgL)}</td>
        <td style="color:#8A9C9F">${x.s.bestW}–${x.s.bestL} / ${x.s.worstW}–${x.s.worstL}</td></tr>`).join('')}</tbody></table></div>`));
  }

  // Clutch
  const clutch = lb.filter(c => c.clutch != null && c.poGames >= 2).sort((a, b) => b.clutch - a.clutch);
  if (clutch.length) {
    out.push(section(`<div class="head"><h2>Clutch rating</h2><span class="note">Playoff vs. regular-season points per game</span></div>
      <div class="rows">${clutch.map(c => {
        const v = c.clutch * 100; const w = Math.min(50, Math.abs(v) * 3.5); const up = v >= 0;
        return `<a class="row" href="${mlink(c.id)}" style="grid-template-columns:minmax(0,1fr) 110px 64px">
          <span class="stack"><span class="name" style="font-size:14px">${name(c.id)}</span><span class="sub">${c.poGames} playoff games${c.titles ? ' · ' + c.titles + ' title' + (c.titles > 1 ? 's' : '') : ''}</span></span>
          <span class="bar thick" style="position:relative;overflow:visible"><i style="position:absolute;top:0;${up ? 'left' : 'right'}:50%;width:${w}%;background:${up ? '#5FC79B' : '#F0907A'}"></i>
          <i style="position:absolute;left:50%;top:-4px;width:1px;height:14px;background:#4A6168;border-radius:0"></i></span>
          <span class="num ${up ? 'up' : 'down'}" style="text-align:right;font-size:14px">${signed(v)}%</span></a>`;
      }).join('')}</div>`));
  }

  // Head-to-head grid
  if (lb.length > 1) {
    const ids = lb.map(c => c.id);
    const short = ids.map(id => esc(M.nameOf(id).slice(0, 4)));
    const head = '<tr><th></th>' + short.map((s, i) => `<th scope="col" title="${name(ids[i])}">${s}</th>`).join('') + '</tr>';
    const body = ids.map((a, i) => '<tr><th scope="row" class="rowh">' + short[i] + '</th>' + ids.map(b => {
      if (a === b) return '<td style="background:#13252A;color:#4A6168">—</td>';
      const r = M.h2hRecord(a, b);
      if (!r.games) return '<td style="background:#13252A;color:#4A6168">·</td>';
      const d = r.w - r.l; const al = Math.min(0.6, 0.14 + Math.abs(d) * 0.14);
      const bg = d > 0 ? `rgba(95,199,155,${al})` : d < 0 ? `rgba(240,144,122,${al})` : '#1A2F34';
      return `<td style="background:${bg}" title="${name(a)} vs ${name(b)}: ${wl(r.w, r.l, r.t)}">${wl(r.w, r.l, r.t)}</td>`;
    }).join('') + '</tr>').join('');
    out.push(section(`<div class="head"><h2>Head-to-head</h2><span class="note">Row's record vs. column</span></div>
      <div class="scroll"><table class="h2h"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <span class="note">Green = the row's manager owns that matchup. Includes playoff games.</span>
      <a class="btn" href="${PX}vs-${encodeURIComponent(ids[0])}~${encodeURIComponent(ids[1])}">Compare two managers →</a>`));
  }
  return out.join('');
}

// ---------- Season ----------
const HL = ['#E8B04B', '#C9D3D2', '#F0907A', '#6FB7E0', '#B59CE6'];

function powerChart(S, highlight) {
  const weeks = S.regWeeks.length;
  if (weeks < 2) return '<p class="lead">The chart appears after Week 2.</p>';
  const n = S.rids.length;
  const x = i => 24 + i * (316 / (weeks - 1));
  const y = r => 10 + (r - 1) * (190 / Math.max(1, n - 1));
  const mid = Math.ceil(n / 2);
  const line = (rid, color, width) => `<polyline fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" points="${S.power[rid].map((r, i) => x(i).toFixed(1) + ',' + y(r).toFixed(1)).join(' ')}"/>`;
  const base = S.rids.filter(r => highlight.indexOf(r) < 0).map(r => line(r, '#3B5258', 1.5)).join('');
  const top = highlight.slice().reverse().map(r => { const c = HL[highlight.indexOf(r)]; const last = S.power[r][weeks - 1];
    return line(r, c, 2.6) + `<circle cx="${x(weeks - 1)}" cy="${y(last)}" r="3.5" fill="${c}"/>`; }).join('');
  const midW = Math.ceil(weeks / 2);
  return `<div class="scroll"><svg viewBox="0 0 350 232" width="100%" style="max-width:560px;display:block" role="img" aria-label="Weekly power rankings by points for">
    <g stroke="#1F3237" stroke-width="1"><line x1="24" y1="${y(1)}" x2="340" y2="${y(1)}"/><line x1="24" y1="${y(mid)}" x2="340" y2="${y(mid)}"/><line x1="24" y1="${y(n)}" x2="340" y2="${y(n)}"/></g>
    <g fill="#8A9C9F" font-size="10"><text x="0" y="${y(1) + 3.5}">1</text><text x="0" y="${y(mid) + 3.5}">${mid}</text><text x="0" y="${y(n) + 3.5}">${n}</text>
    <text x="${x(0)}" y="224" text-anchor="middle">W1</text><text x="${x(midW - 1)}" y="224" text-anchor="middle">W${midW}</text><text x="340" y="224" text-anchor="end">W${weeks}</text></g>
    ${base}${top}
    <polyline id="phover" fill="none" stroke="#F1F4F3" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round" points="" pointer-events="none"/>
    <g class="ppts">${S.rids.map(r => S.power[r].map((rk, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(rk).toFixed(1)}" r="5" data-rid="${r}" data-i="${i}" tabindex="-1"/>`).join('')).join('')}</g>
    <circle id="pdot" r="4" fill="#F1F4F3" stroke="#0C171A" stroke-width="1.5" pointer-events="none" style="display:none"/>
    </svg></div><div class="ptip" id="ptip" hidden></div>`;
}

// Hover (or tap) a point on the power rankings chart to see that team's week: rank, total PF, that week's score.
function powerWeekData(S) {
  if (S._powerData) return S._powerData;
  const out = {};
  S.rids.forEach(r => { let cum = 0; out[r] = S.regWeeks.map(w => { const p = S.byWeek[w][r] ? S.byWeek[w][r].points : 0; cum += p; return { w, p, cum }; }); });
  S._powerData = out;
  return out;
}
function bindPowerHover(S) {
  const box = document.getElementById('power');
  if (!box || box.dataset.hover) return;
  box.dataset.hover = '1';
  const data = powerWeekData(S);
  const show = c => {
    const svg = box.querySelector('svg'); const tip = document.getElementById('ptip');
    if (!svg || !tip) return;
    const r = Number(c.dataset.rid); const i = Number(c.dataset.i);
    const d = data[r][i]; const rank = S.power[r][i];
    const prev = i > 0 ? S.power[r][i - 1] : null;
    const move = prev == null || prev === rank ? '' : prev > rank ? ` <span class="up">▲${prev - rank}</span>` : ` <span class="down">▼${rank - prev}</span>`;
    tip.innerHTML = `<b>${name(S.ownerOf[r])}</b><span>Week ${d.w}</span><span>Rank <b class="num">${rank}</b>${move} · PF <b class="num">${comma(d.cum)}</b></span><span>Scored <b class="num">${f2(d.p)}</b> that week</span>`;
    tip.hidden = false;
    const pts = S.power[r].map((rk, k) => { const cc = svg.querySelector(`circle[data-rid="${r}"][data-i="${k}"]`); return cc.getAttribute('cx') + ',' + cc.getAttribute('cy'); }).join(' ');
    svg.querySelector('#phover').setAttribute('points', pts);
    const dot = svg.querySelector('#pdot'); dot.setAttribute('cx', c.getAttribute('cx')); dot.setAttribute('cy', c.getAttribute('cy')); dot.style.display = '';
    const br = box.getBoundingClientRect(); const cr = c.getBoundingClientRect();
    const left = Math.min(Math.max(cr.left - br.left + cr.width / 2 - tip.offsetWidth / 2, 0), br.width - tip.offsetWidth);
    let top = cr.top - br.top - tip.offsetHeight - 10; if (top < 0) top = cr.bottom - br.top + 10;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  const hide = () => {
    const tip = document.getElementById('ptip'); if (tip) tip.hidden = true;
    const svg = box.querySelector('svg'); if (!svg) return;
    const h = svg.querySelector('#phover'); if (h) h.setAttribute('points', '');
    const dot = svg.querySelector('#pdot'); if (dot) dot.style.display = 'none';
  };
  box.addEventListener('pointerover', e => { const c = e.target.closest('circle[data-rid]'); if (c) show(c); });
  box.addEventListener('click', e => { const c = e.target.closest('circle[data-rid]'); if (c) show(c); else hide(); });
  box.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
}

// Series history between this week's opponents (games before this week).
function matchupPreview(S, ra, rb, week) {
  const a = S.ownerOf[ra]; const b = S.ownerOf[rb];
  const r = M.h2hRecord(a, b);
  const past = r.list.filter(g => !(g.season === S.season && g.week >= week)).sort((x, y) => Number(y.season) - Number(x.season) || y.week - x.week);
  const sa = S.st[ra]; const sb = S.st[rb];
  const ppg = st => (st.games ? f1(st.pf / st.games) : '—');
  let series;
  if (!past.length) series = 'First meeting';
  else {
    const w = past.filter(g => g.mine > g.theirs).length; const l = past.filter(g => g.mine < g.theirs).length;
    series = w === l ? `Series tied ${w}–${l}` : `${w > l ? name(a) : name(b)} leads ${Math.max(w, l)}–${Math.min(w, l)}`;
    const last = past[0];
    series += ` · last met ${last.season} W${last.week}, ${last.mine > last.theirs ? name(a) : last.mine < last.theirs ? name(b) : 'tie'} ${f2(Math.max(last.mine, last.theirs))}–${f2(Math.min(last.mine, last.theirs))}`;
  }
  return `<div class="preview"><span>${series}</span><span>This season: ${wl(sa.wins, sa.losses, sa.ties)} · ${ppg(sa)} PPG vs ${wl(sb.wins, sb.losses, sb.ties)} · ${ppg(sb)} PPG</span>
    <a href="${PX}vs-${encodeURIComponent(a)}~${encodeURIComponent(b)}">Full head-to-head →</a></div>`;
}

function liveGames(S, week, list) {
  const groups = {};
  (list || []).forEach(m => { if (m.matchup_id != null) (groups[m.matchup_id] = groups[m.matchup_id] || []).push(m); });
  const games = Object.values(groups).filter(g => g.length === 2);
  if (!games.length) return '<p class="lead">No matchups this week.</p>';
  const final = week <= S.scoredThrough;
  return games.map(([a, b]) => {
    const aLead = a.points >= b.points;
    return `<div class="box"><div class="top-line"><span>Week ${week}</span><span>${final ? 'Final' : 'Live'}</span></div><div class="game">
      <a class="${aLead ? 'lead-t' : 'trail-t'}" href="${mlink(S.ownerOf[a.roster_id])}" style="text-decoration:none">${name(S.ownerOf[a.roster_id])}</a><span class="score">${f2(a.points || 0)}</span>
      <a class="${aLead ? 'trail-t' : 'lead-t'}" href="${mlink(S.ownerOf[b.roster_id])}" style="text-decoration:none">${name(S.ownerOf[b.roster_id])}</a><span class="score">${f2(b.points || 0)}</span></div>
      ${matchupPreview(S, a.roster_id, b.roster_id, week)}</div>`;
  }).join('');
}

// Every award a season hands out. The season tab shows the tile set; the Awards page shows all of them.
const SEASON_TILE_AWARDS = ['waiver', 'trade', 'steal', 'bust', 'blunder', 'sacko'];
function seasonAwards(S) {
  const aw = [];
  const done = !S.isCurrent;
  if (S.champion) aw.push({ key: 'champion', k: 'Champion', rid: S.champion, v: wl(S.st[S.champion].wins, S.st[S.champion].losses, S.st[S.champion].ties), d: 'Won the title', cls: 'major-t', good: true, major: true });
  if (S.runnerUp) aw.push({ key: 'runnerUp', k: 'Runner-up', rid: S.runnerUp, v: wl(S.st[S.runnerUp].wins, S.st[S.runnerUp].losses, S.st[S.runnerUp].ties), d: 'Lost the final', cls: '', good: true });
  const top = S.standings[0];
  if (top && done) aw.push({ key: 'regSeason', k: 'Regular-season champ', rid: top.rid, v: wl(top.wins, top.losses, top.ties), d: comma(top.pf) + ' PF · No. 1 seed', cls: 'major-t', good: true, major: true });
  const ranked = S.rids.slice().sort((a, b) => S.scores[b].total - S.scores[a].total);
  if (ranked.length) {
    aw.push({ key: 'bestMgr', k: 'Best manager', rid: ranked[0], v: String(Math.round(S.scores[ranked[0]].total)), d: 'Highest Manager Score', cls: 'major-t', good: true, major: true });
    aw.push({ key: 'worstMgr', k: 'Worst manager', rid: ranked[ranked.length - 1], v: String(Math.round(S.scores[ranked[ranked.length - 1]].total)), d: 'Lowest Manager Score', cls: 'down', good: false });
  }
  const wk = S.rids.slice().sort((a, b) => S.waivers[b].pts - S.waivers[a].pts)[0];
  if (wk != null) {
    const w = S.waivers[wk];
    aw.push({ key: 'waiver', k: 'Waiver Wire King', rid: wk, v: f1(w.pts) + ' pts', d: 'Starter points from pickups' + (w.perDollar != null ? ' · ' + f1(w.perDollar) + ' pts per FAAB dollar' : '') + (w.best ? ' · best add: ' + player(w.best.pid) : ''), cls: 'gold-t', good: true });
  }
  let toy = null;
  S.trades.forEach(t => t.sides.forEach(x => { if (!toy || x.net > toy.s.net) toy = { t, s: x }; }));
  if (toy && toy.s.net > 0) aw.push({ key: 'trade', k: 'Trade of the Year', rid: toy.s.rid, v: signed(toy.s.net), d: 'Week ' + toy.t.week + ' · got ' + (toy.s.got.map(g => player(g.pid)).join(', ') || 'picks'), cls: 'gold-t', good: true });
  if (S.steal) aw.push({ key: 'steal', k: 'Steal of the Draft', rid: S.steal.roster_id, v: 'R' + S.steal.round + ' → ' + esc(S.steal.pos) + S.posRank[S.steal.player_id], d: player(S.steal.player_id) + ', round ' + S.steal.round + ', finished ' + esc(S.steal.pos) + S.posRank[S.steal.player_id] + (S.isCurrent ? ' so far' : ''), cls: 'gold-t', good: true });
  if (S.bust) aw.push({ key: 'bust', k: 'Bust of the Draft', rid: S.bust.roster_id, v: 'R' + S.bust.round + ' → ' + esc(S.bust.pos) + (S.posRank[S.bust.player_id] || '—'), d: player(S.bust.player_id) + ', round ' + S.bust.round + (S.posRank[S.bust.player_id] ? ', finished ' + esc(S.bust.pos) + S.posRank[S.bust.player_id] : ', barely played') + (S.isCurrent ? ' so far' : ''), cls: 'down', good: false });
  const hi = S.weeklyHighs[0];
  if (hi) aw.push({ key: 'highScore', k: 'Highest score', rid: hi.rid, v: f2(hi.pts), d: 'Week ' + hi.week, cls: 'gold-t', good: true });
  const byLuck = S.standings.slice().sort((a, b) => b.luck - a.luck);
  if (byLuck.length > 1) {
    aw.push({ key: 'luckiest', k: 'Luckiest', rid: byLuck[0].rid, v: signed(byLuck[0].luck), d: 'Wins above expected', cls: 'up', good: true });
    aw.push({ key: 'unluckiest', k: 'Unluckiest', rid: byLuck[byLuck.length - 1].rid, v: signed(byLuck[byLuck.length - 1].luck), d: 'Wins below expected', cls: 'down', good: false });
  }
  if (S.benchBlunder && S.benchBlunder.gap > 0) {
    const b = S.benchBlunder;
    aw.push({ key: 'blunder', k: 'Bench Blunder', rid: b.rid, v: f1(b.gap) + ' pts', d: 'Week ' + b.week + ' points left on the bench' + (b.wouldHaveWon ? ' · would have won' : b.lostBy != null ? ' · lost by ' + f1(b.lostBy) : ''), cls: 'down', good: false });
  }
  const lastR = S.lastPlace != null ? S.st[S.lastPlace] : S.standings[S.standings.length - 1];
  aw.push({ key: 'sacko', k: S.isCurrent ? 'Sacko watch' : 'Sacko', rid: lastR.rid, v: wl(lastR.wins, lastR.losses, lastR.ties),
    d: (S.isCurrent ? 'Worst record so far · ' : S.toiletBowl ? 'Lost the toilet bowl · ' : 'Last place · ') + comma(lastR.pf) + ' PF', cls: 'down', good: false });
  return aw;
}

function viewSeason(S) {
  const out = [];
  const nm = r => name(S.ownerOf[r]);
  const ml = r => mlink(S.ownerOf[r]);
  const liveWeek = S.isCurrent && S.currentWeek && S.currentWeek <= S.playoffWeekStart + 2 ? S.currentWeek : null;
  if (S.isCurrent) {
    out.push(section(`<div class="eyebrow"><span class="tag live"><span class="dot"></span>Live</span><span id="updated">Scores refresh every ${CONFIG.liveRefreshSeconds} seconds</span></div>
      <h1>${S.season} season. <span class="soft">${liveWeek ? 'Week ' + liveWeek + ' is underway.' : 'Through Week ' + S.scoredThrough + '.'}</span></h1>`, 'hero'));
    if (liveWeek) out.push(section(`<div class="head"><h2>This week's matchups</h2><span class="note">Current score</span></div><div id="live-games" style="display:flex;flex-direction:column;gap:10px">${liveGames(S, liveWeek, Object.values(S.byWeek[liveWeek] || {}))}</div>`));
    if (S.odds && !S.champion && S.regWeeks.length) {
      const O = S.odds;
      const pctLabel = x => { const p = x * 100; return p >= 99.5 && p < 100 ? '>99%' : p > 0 && p < 0.5 ? '<1%' : Math.round(p) + '%'; };
      const rows = S.rids.slice().sort((a, b) => O.byRid[b].title - O.byRid[a].title || O.byRid[b].playoffs - O.byRid[a].playoffs);
      const showPlayoffs = !O.bracketLive;
      const fav = rows[0];
      out.push(section(`<div class="head"><h2>${showPlayoffs ? 'Playoff and title odds' : 'Title odds'}</h2><span class="note">${CONFIG.simulations.toLocaleString()} simulated seasons</span></div>
        <p class="lead">${nm(fav)} is the title favorite at ${pctLabel(O.byRid[fav].title)}.</p>
        <div class="scroll"><table class="table"><thead><tr><th>Team</th>${showPlayoffs ? '<th>Playoffs</th>' : ''}${showPlayoffs && O.byeCount ? '<th>Bye</th>' : ''}<th>Final</th><th>Title</th></tr></thead><tbody>
        ${rows.map((r, i) => { const o = O.byRid[r]; const st = S.st[r];
          return `<tr><td class="t"><a href="${ml(r)}" style="text-decoration:none">${nm(r)}</a> <span class="note">${wl(st.wins, st.losses, st.ties)}</span></td>
            ${showPlayoffs ? `<td>${pctLabel(o.playoffs)}</td>` : ''}${showPlayoffs && O.byeCount ? `<td>${pctLabel(o.bye)}</td>` : ''}<td style="color:#C9D3D2">${pctLabel(o.final)}</td>
            <td><span style="display:inline-flex;align-items:center;gap:8px;justify-content:flex-end"><span class="bar thick" style="width:60px;display:inline-block"><i style="width:${o.title * 100}%;background:${i === 0 ? GOLD : '#C9D3D2'}"></i></span>${pctLabel(o.title)}</span></td></tr>`; }).join('')}</tbody></table></div>
        <span class="note">${showPlayoffs ? 'Every remaining regular-season game, then the playoff bracket (top ' + S.playoffTeams + (O.byeCount ? ', with first-round byes for the top ' + O.byeCount : '') + '), is played out using each team\'s scoring this season.' : 'The rest of the bracket is played out using each team\'s scoring this season. Games already played count as they happened.'}</span>`));
    }
  } else {
    const rounds = S.games.filter(g => g.playoff).reduce((m, g) => Math.max(m, g.round || 0), 0);
    out.push(section(`<div class="eyebrow">Season complete · ${S.regWeeks.length} weeks + ${rounds} playoff rounds</div>
      <h1>${S.season} season. <span class="soft">${S.champion ? nm(S.champion) + ' beat ' + (S.runnerUp ? nm(S.runnerUp) : 'the field') + ' for the title.' : ''}</span></h1>
      <div class="chips">${S.champion ? `<a class="chip gold" href="${ml(S.champion)}" style="text-decoration:none">${TROPHY(GOLD, 13)} Champion · ${nm(S.champion)}</a>` : ''}
      ${S.runnerUp ? `<span class="chip">Runner-up · ${nm(S.runnerUp)}</span>` : ''}${S.lastPlace ? `<span class="chip">Last · ${nm(S.lastPlace)}</span>` : ''}</div>`, 'hero'));
  }

  const stRows = S.standings.map(x => ({ name: nm(x.rid), href: ml(x.rid), wl: wl(x.wins, x.losses, x.ties),
    v: { wins: S.standings.length - x.rank, pf: x.pf, pa: x.pa, maxPf: x.maxPf, ap: x.allPlayPct, tie: x.pf } }));
  out.push(section(`<div class="head"><h2>${S.isCurrent ? 'Standings' : 'Final standings'}</h2><span class="note">Tap a column to sort</span></div>
    ${sortTable(standingsColumns(), stRows, { key: 'wins', cut: S.playoffTeams })}
    <span class="note">Dashed line = playoff cut (top ${S.playoffTeams}), shown when sorted by W–L. Max PF = points from the best possible lineup every week. All-play = win rate if you'd played every team every week.</span>`));

  const defaultHL = [S.champion || S.standings[0].rid, S.runnerUp || (S.standings[1] && S.standings[1].rid), S.standings[S.standings.length - 1].rid].filter((v, i, a) => v && a.indexOf(v) === i);
  out.push(section(`<div class="head"><h2>Power rankings</h2><span class="note">Rank by total points for, each week</span></div>
    <div id="power" data-season="${S.season}">${powerChart(S, defaultHL)}</div>
    <div class="legend" id="power-legend">${S.standings.map(s => `<button type="button" data-rid="${s.rid}" aria-pressed="${defaultHL.indexOf(s.rid) >= 0}">
      <i style="background:${defaultHL.indexOf(s.rid) >= 0 ? HL[defaultHL.indexOf(s.rid)] : '#3B5258'}"></i>${nm(s.rid)}</button>`).join('')}</div>
    <span class="note">Hover or tap a point to see that week's rank, total PF and score. Tap names to highlight up to five teams.</span>`));

  const ranked = S.rids.slice().sort((a, b) => S.scores[b].total - S.scores[a].total);
  const best = ranked[0]; const worst = ranked[ranked.length - 1];
  out.push(section(`<div class="head"><h2>${S.season} Manager Scores</h2><a class="note" href="${ml(best)}">How it works</a></div>
    <div class="cards"><a class="card" href="${ml(best)}"><span class="k gold-t">Best manager</span><span class="v">${Math.round(S.scores[best].total)}</span><span class="name">${nm(best)}</span>
      <span class="note">Start/sit ${(S.efficiency[best].pct * 100).toFixed(1)}% of best lineup</span></a>
      <a class="card" href="${ml(worst)}"><span class="k down">Worst manager</span><span class="v">${Math.round(S.scores[worst].total)}</span><span class="name">${nm(worst)}</span>
      <span class="note">Left ${Math.round(S.efficiency[worst].benchLeft)} pts on the bench</span></a></div>
    <div class="rows">${ranked.map((r, i) => `<a class="row r-score" href="${ml(r)}"><span class="num" style="font-size:13px;color:#8A9C9F">${i + 1}</span>
      <span class="stack" style="gap:7px"><span class="name" style="font-size:14px">${nm(r)}</span><span class="bar"><i style="width:${S.scores[r].total}%;background:${i === 0 ? GOLD : '#7E9093'}"></i></span></span>
      <span class="val" style="font-size:17px">${Math.round(S.scores[r].total)}</span></a>`).join('')}</div>`));

  // Awards
  const aw = seasonAwards(S).filter(x => SEASON_TILE_AWARDS.indexOf(x.key) >= 0).map(x => ({ ...x, who: nm(x.rid) }));
  out.push(section(`<h2>Season awards</h2><div class="tiles">${aw.map(a => `<div class="tile"><span class="k ${a.cls}">${a.k}</span>
    <span style="font-size:15px;font-weight:600">${a.who}</span><span class="num" style="font-size:15px">${a.v}</span><span class="d">${a.d}</span></div>`).join('')}</div>`));

  if (S.picks.length && LG.format !== 'dynasty') out.push(section(teamGradesSection(S, draftTeamGrades(S), S.season + ' draft grades') + `<a class="btn" href="${PX}drafts@${S.season}">Full ${S.season} draft →</a>`));

  if (S.trades.length) {
    out.push(section(`<div class="head"><h2>Trades</h2><span class="note">${S.trades.length} trade${S.trades.length > 1 ? 's' : ''} · ${LG.format === 'dynasty' ? 'starter pts since, all seasons' : 'starter pts for the rest of the season'}</span></div>
      <div style="display:flex;flex-direction:column;gap:10px">${S.trades.slice().reverse().map(t => `<button type="button" class="box tradebtn"${tradeAttr(t)}><div class="top-line"><span>Week ${t.week}</span><span>Tap for details</span></div>
      ${t.sides.map(s => `<div class="line2"><span style="font-size:14px;min-width:0"><span style="font-weight:500">${nm(s.rid)}</span>
        <span style="color:#8A9C9F"> got ${s.got.map(g => player(g.pid)).join(', ') || 'draft picks'}</span></span>
        <span class="num ${sign(s.net)}" style="font-size:14px;white-space:nowrap">${signed(s.net)}</span></div>`).join('')}</button>`).join('')}</div>`));
  }

  out.push(section(`<div class="head"><h2>Team MVPs</h2><span class="note">Most starter points for that team</span></div><div class="rows">
    ${S.standings.map(s => { const m = S.mvp[s.rid]; return m ? `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;padding:11px 0">
      <span class="stack"><span style="font-size:14px;font-weight:500">${player(m.pid)}${m.pos ? ' · ' + esc(m.pos) : ''}</span><span class="sub">${nm(s.rid)}</span></span>
      <span class="num" style="font-size:14px">${f1(m.pts)}</span></div>` : ''; }).join('')}</div>`));

  out.push(section(`<h2>Weekly highs</h2><div class="rows">${S.weeklyHighs.map(h => `<div class="row" style="grid-template-columns:52px minmax(0,1fr) auto;padding:12px 0">
    <span class="num" style="font-size:12px;color:#8A9C9F">WK ${h.week}</span><a href="${ml(h.rid)}" style="text-decoration:none;font-size:14px">${nm(h.rid)}</a><span class="num" style="font-size:15px">${f2(h.pts)}</span></div>`).join('')}</div>`));

  return { html: out.join(''), liveWeek, defaultHL };
}

function bindPowerLegend(S, initial) {
  bindPowerHover(S);
  const legend = document.getElementById('power-legend');
  if (!legend) return;
  let hl = initial.slice();
  legend.addEventListener('click', e => {
    const btn = e.target.closest('button[data-rid]');
    if (!btn) return;
    const rid = Number(btn.dataset.rid);
    const i = hl.indexOf(rid);
    if (i >= 0) hl.splice(i, 1); else { if (hl.length >= HL.length) hl.shift(); hl.push(rid); }
    document.getElementById('power').innerHTML = powerChart(S, hl);
    bindPowerHover(S);
    legend.querySelectorAll('button').forEach(b => {
      const r = Number(b.dataset.rid); const k = hl.indexOf(r);
      b.setAttribute('aria-pressed', String(k >= 0));
      b.querySelector('i').style.background = k >= 0 ? HL[k] : '#3B5258';
    });
  });
}

function startLive(S, week) {
  stopLive();
  liveTimer = setInterval(async () => {
    try {
      const list = await loadLiveWeek(S.leagueId, week);
      const el = document.getElementById('live-games');
      if (!el) return stopLive();
      el.innerHTML = liveGames(S, week, list);
      const u = document.getElementById('updated');
      if (u) u.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) { /* keep last scores */ }
  }, CONFIG.liveRefreshSeconds * 1000);
}
function stopLive() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }

// ---------- Manager ----------
const PART_LABELS = { results: 'Results', startSit: 'Start/sit', waivers: 'Waivers', trades: 'Trades', draft: 'Draft' };

// One manager's numbers for one season.
function seasonStats(S, r) {
  const st = S.st[r];
  const weeks = [];
  S.regWeeks.forEach(w => { const m = S.byWeek[w][r]; if (m) weeks.push({ season: S.season, w, pts: m.points }); });
  const po = S.games.filter(g => g.playoff && (g.a === r || g.b === r));
  po.forEach(g => weeks.push({ season: S.season, w: g.week, pts: g.a === r ? g.ap : g.bp, playoff: true }));
  const poW = po.filter(g => (g.a === r ? g.ap > g.bp : g.bp > g.ap)).length;
  const sorted = weeks.slice().sort((a, b) => b.pts - a.pts);
  const finish = S.champion === r ? 'Champion' : S.runnerUp === r ? 'Runner-up' : S.lastPlace === r ? 'Last place'
    : S.isCurrent ? 'In progress' : S.playoffRids.has(r) ? 'Made playoffs' : 'Missed playoffs';
  return {
    S, r, st, weeks, best: sorted[0], worst: sorted[sorted.length - 1], poW, poL: po.length - poW, finish,
    eff: S.efficiency[r], waiv: S.waivers[r], trades: S.tradeNet[r], mvp: S.mvp[r], draftVal: S.draftValue[r],
    picks: S.picks.filter(p => p.roster_id === r).length, score: S.scores[r]
  };
}

function managerSeasons(id) {
  return M.seasons.map(S => { const r = S.rids.find(x => S.ownerOf[x] === id); return r == null ? null : seasonStats(S, r); }).filter(Boolean);
}

function tiles(list) {
  return `<div class="tiles">${list.map(t => `<div class="tile"><span class="k">${t[0]}</span><span class="v" style="font-size:20px">${t[1]}</span>${t[2] ? `<span class="d">${t[2]}</span>` : ''}</div>`).join('')}</div>`;
}

const fmtRaw = (k, v) => k === 'results' ? pct3(v) : k === 'startSit' ? (v * 100).toFixed(1) + '%' : k === 'waivers' ? f1(v) + ' pts' : signed(v) + ' pts';

function seasonCalc(x) {
  const S = x.S; const sc = x.score; const W = CONFIG.weights;
  const keys = ['results', 'startSit', 'waivers', 'trades'].concat(S.hasDraft ? ['draft'] : []);
  const rows = keys.map(k => {
    const stat = S.scoreStats[k];
    const part = sc.parts[k];
    return `<tr><td class="t" style="font-weight:500">${PART_LABELS[k]}</td><td>${fmtRaw(k, sc.raw[k])}</td><td style="color:#8A9C9F">${fmtRaw(k, stat.mean)}</td>
      <td style="color:#8A9C9F">${k === 'results' ? stat.sd.toFixed(3) : k === 'startSit' ? (stat.sd * 100).toFixed(1) + '%' : f1(stat.sd)}</td>
      <td>${f1(sc.scaled[k])}${k === 'results' && sc.bonus ? ' <span class="gold-t">+' + sc.bonus + '</span>' : ''}</td>
      <td style="color:#8A9C9F">${Math.round(W[k] * 100)}%</td><td>${f1(W[k] * part / S.weightSum)}</td></tr>`;
  }).join('');
  return `<details class="calc"><summary>Show the calculation</summary><div class="calc-body">
    <div class="scroll"><table class="table"><thead><tr><th>Part</th><th>Raw stat</th><th>League avg</th><th>Spread</th><th>Scaled</th><th>Weight</th><th>Adds</th></tr></thead>
    <tbody>${rows}<tr><td class="t" style="font-weight:600">Total</td><td></td><td></td><td></td><td></td><td></td><td style="font-weight:600;color:#F1F4F3">${f1(sc.total)}</td></tr></tbody></table></div>
    <ol class="steps">
      <li><b>Raw stats.</b> Results = ½ × win % (${pct3(x.st.winPct)}) + ½ × all-play (${pct3(x.st.allPlayPct)}) = ${pct3(sc.raw.results)}. Start/sit = points started ÷ best possible lineup (${comma(x.eff.actual)} ÷ ${comma(x.eff.optimal)}). Waivers = starter points from pickups. Trades = starter points gained minus given up.${S.hasDraft ? ' Draft = each pick’s points above a replacement-level starter at his position, minus what picks near the same slot were worth.' : ''}</li>
      <li><b>Scaled.</b> 50 + 20 × (raw − league avg) ÷ spread, kept between 0 and 100. Spread is the standard deviation across all ${S.rids.length} teams that season.</li>
      <li><b>Bonus.</b> ${sc.bonusParts.length ? 'Results got ' + sc.bonusParts.join(', ') + ' (capped at 100).' : 'No playoff, final or title bonus this season.'}${S.isCurrent ? ' Bonuses are added once the season ends.' : ''}</li>
      <li><b>Score.</b> Each scaled part × its weight, divided by the total weight (${Math.round(S.weightSum * 100)}%) = <b>${f1(sc.total)}</b>.</li>
    </ol></div></details>`;
}

function careerCalc(id, list) {
  const c = M.career[id];
  const rows = list.slice().sort((a, b) => Number(b.S.season) - Number(a.S.season));
  const games = rows.reduce((s, x) => s + Math.max(1, x.score.games), 0);
  return `<details class="calc"><summary>Show the calculation</summary><div class="calc-body">
    <div class="scroll"><table class="table"><thead><tr><th>Season</th><th>Score</th><th>Games</th><th>Share</th><th>Adds</th></tr></thead><tbody>
    ${rows.map(x => { const g = Math.max(1, x.score.games); return `<tr><td class="t" style="font-weight:500"><a href="${mlink(id)}@${x.S.season}" style="text-decoration:none">${x.S.season}</a>${x.S.isCurrent ? ' <span class="note">so far</span>' : ''}</td>
      <td>${f1(x.score.total)}</td><td style="color:#8A9C9F">${g}</td><td style="color:#8A9C9F">${(g / games * 100).toFixed(0)}%</td><td>${f1(x.score.total * g / games)}</td></tr>`; }).join('')}
    <tr><td class="t" style="font-weight:600">Career</td><td></td><td style="color:#8A9C9F">${games}</td><td></td><td style="font-weight:600;color:#F1F4F3">${f1(c.score)}</td></tr></tbody></table></div>
    <ol class="steps"><li><b>Each season</b> gets its own score against that season's league (pick a year above to see its math).</li>
    <li><b>Career</b> = each season's score × its games played, added up, ÷ total games. Seasons with more games count more, and the current season counts the games played so far.</li></ol></div></details>`;
}

function breakdown(title, parts) {
  return `<h2>${title}</h2><div class="rows">${parts.map(p => `
    <div class="row" style="grid-template-columns:1fr;gap:8px;padding:14px 0"><div class="line2"><span style="font-size:15px;font-weight:500">${p[0]} <span class="note">${Math.round(p[1] * 100)}%</span></span>
    <span class="num" style="font-size:17px">${Math.round(p[2])}</span></div><span class="bar thick"><i style="width:${p[2]}%;background:${p[2] >= 65 ? GOLD : '#7E9093'}"></i></span>
    <span class="note" style="color:#A3B2B4">${p[3]}</span></div>`).join('')}</div>`;
}

// Awards a manager won in one season, and across a career.
// Major awards (champion, regular-season champ, best manager) are blue; other good awards gold; bad ones red.
const MAJOR_BLUE = '#7CC4F5';
const awardColor = a => (a.major ? MAJOR_BLUE : a.good ? GOLD : '#F0907A');
const awardTier = a => (a.major ? 2 : a.good ? 1 : 0);
function awardRow(a, sub) {
  return `<div class="row" style="grid-template-columns:22px minmax(0,1fr) auto;padding:12px 0">
    <span class="dot" style="background:${awardColor(a)};width:8px;height:8px"></span>
    <span class="stack"><span style="font-size:14px;font-weight:500">${esc(a.k)}</span><span class="sub">${sub}</span></span>
    <span class="num" style="font-size:14px">${a.v}</span></div>`;
}
function managerSeasonAwards(x) {
  const mine = seasonAwards(x.S).filter(a => a.rid === x.r).sort((a, b) => awardTier(b) - awardTier(a));
  const head = `<div class="head"><h2>${x.S.season} awards</h2><span class="note">${x.S.isCurrent ? 'So far this season' : (mine.some(a => a.major) ? mine.filter(a => a.major).length + ' major · ' : '') + mine.filter(a => a.good && !a.major).length + ' good · ' + mine.filter(a => !a.good).length + ' bad'}</span></div>`;
  if (!mine.length) return head + '<p class="lead">No awards this season.</p>';
  return head + `<div class="rows">${mine.map(a => awardRow(a, a.d)).join('')}</div>`;
}
function managerCareerAwards(id, list) {
  const won = {};
  list.filter(x => !x.S.isCurrent).forEach(x => seasonAwards(x.S).filter(a => a.rid === x.r).forEach(a => {
    const k = a.key === 'sacko' ? 'Sacko' : a.k;
    const w = won[k] = won[k] || { k, good: a.good, major: a.major, years: [] };
    w.years.push(x.S.season);
  }));
  const rows = Object.values(won).sort((a, b) => awardTier(b) - awardTier(a) || b.years.length - a.years.length);
  const major = rows.filter(r => r.major).reduce((t, r) => t + r.years.length, 0);
  const good = rows.filter(r => r.good && !r.major).reduce((t, r) => t + r.years.length, 0);
  const bad = rows.filter(r => !r.good).reduce((t, r) => t + r.years.length, 0);
  const cur = list.find(x => x.S.isCurrent);
  const curAw = cur ? seasonAwards(cur.S).filter(a => a.rid === cur.r) : [];
  let html = `<div class="head"><h2>Career awards</h2><span class="note">Finished seasons</span></div>
    <div class="cards"><div class="card"><span class="k major-t">Major awards</span><span class="v">${major}</span></div><div class="card"><span class="k gold-t">Good awards</span><span class="v">${good}</span></div><div class="card"><span class="k down">Bad awards</span><span class="v">${bad}</span></div></div>`;
  html += rows.length ? `<div class="rows">${rows.map(r => awardRow({ ...r, v: r.years.length > 1 ? '×' + r.years.length : '' }, r.years.sort().reverse().join(', '))).join('')}</div>` : '<p class="lead">No awards yet.</p>';
  if (curAw.length) html += `<p class="note" style="margin:0">On track in ${cur.S.season}: ${curAw.map(a => esc(a.k)).join(', ')}. These count once the season ends.</p>`;
  return html;
}

function viewManager(id, seasonSel) {
  const c = M.career[id];
  if (!c) return section(`<h1>Manager not found.</h1><a class="btn" href="${PX}all">Back to All-Time</a>`, 'hero');
  const lb = M.leaderboard;
  const rank = lb.findIndex(x => x.id === id) + 1;
  const list = managerSeasons(id);
  const sel = seasonSel ? list.find(x => x.S.season === seasonSel) : null;
  const completedPlayed = list.filter(x => !x.S.isCurrent).length;
  const tag = rank === 1 ? '<span class="tag gold">Best manager</span>' : rank === lb.length && lb.length > 1 ? '<span class="tag down">Worst manager</span>' : '';
  const W = CONFIG.weights;
  const out = [];
  out.push(section(`<div class="eyebrow">${tag}<span>#${rank} of ${lb.length} · ${list.length} season${list.length > 1 ? 's' : ''}</span></div>
    <div class="line2" style="align-items:flex-end;gap:16px"><h1 style="min-width:0;overflow-wrap:anywhere">${name(id)}</h1>
    <span style="display:flex;flex-direction:column;align-items:flex-end"><span class="num" style="font-size:52px;line-height:1;color:${rank === 1 ? GOLD : '#F1F4F3'}">${Math.round(sel ? sel.score.total : c.score)}</span><span class="note">${sel ? sel.S.season + ' score' : 'Career score'}</span></span></div>
    ${M.managers[id].teamNames.length ? `<span class="note">Team names: ${M.managers[id].teamNames.map(esc).join(' · ')}</span>` : ''}
    <nav class="chips" aria-label="Choose a season" style="padding-top:6px"><a class="pill${sel ? '' : ' on'}" href="${mlink(id)}">Career</a>
    ${list.map(x => `<a class="pill${sel === x ? ' on' : ''}" href="${mlink(id)}@${x.S.season}">${x.S.isCurrent ? '<span class="dot"></span>' : ''}${x.S.season}</a>`).join('')}</nav>`, 'hero'));

  if (sel) {
    const x = sel; const S = x.S; const st = x.st;
    out.push(section(`<div class="head"><h2>${S.season} stats</h2><span class="note">${x.finish}${S.isCurrent ? ' · through Week ' + S.scoredThrough : ''}</span></div>` + tiles([
      ['Record', wl(st.wins, st.losses, st.ties), ordinal(st.rank) + ' of ' + S.rids.length + ' in the standings'],
      ['Points for', comma(st.pf), f1(st.games ? st.pf / st.games : 0) + ' per game'],
      ['Points against', comma(st.pa), f1(st.games ? st.pa / st.games : 0) + ' per game'],
      ['All-play', pct3(st.allPlayPct), f1(st.allPlay) + ' expected wins'],
      ['Luck', `<span class="${sign(st.luck)}">${signed(st.luck)}</span>`, 'Wins above expected'],
      ['Playoffs', x.poW + x.poL ? wl(x.poW, x.poL) : '—', x.finish],
      ['Best week', x.best ? f2(x.best.pts) : '—', x.best ? 'Week ' + x.best.w + (x.best.playoff ? ' · playoffs' : '') : ''],
      ['Worst week', x.worst ? f2(x.worst.pts) : '—', x.worst ? 'Week ' + x.worst.w : ''],
      ['Start/sit', (x.eff.pct * 100).toFixed(1) + '%', Math.round(x.eff.benchLeft) + ' pts left on the bench'],
      ['Waivers', x.waiv.adds + ' adds', f1(x.waiv.pts) + ' starter pts' + (S.usesFaab ? ' · $' + x.waiv.faab + ' FAAB' : '')],
      ['Trades', String(x.trades.count), 'Net ' + signed(x.trades.net) + ' starter pts'],
      ['Team MVP', x.mvp ? esc(M.playerName(x.mvp.pid)) : '—', x.mvp ? f1(x.mvp.pts) + ' starter pts' : '']
    ])));
    out.push(section(managerSeasonAwards(x)));
    const sc = x.score;
    const parts = [
      ['Results', W.results, sc.parts.results, `Win % ${pct3(st.winPct)} · all-play ${pct3(st.allPlayPct)}${sc.bonusParts.length ? ' · bonus: ' + sc.bonusParts.join(', ') : ''}`],
      ['Start/sit', W.startSit, sc.parts.startSit, `Started ${(x.eff.pct * 100).toFixed(1)}% of best possible points · ${Math.round(x.eff.benchLeft)} pts left on the bench`],
      ['Waivers', W.waivers, sc.parts.waivers, `${f1(x.waiv.pts)} starter pts from ${x.waiv.adds} pickups${x.waiv.best && x.waiv.best.pts > 0 ? ' · best: ' + player(x.waiv.best.pid) + ' (' + f1(x.waiv.best.pts) + ')' : ''}`],
      ['Trades', W.trades, sc.parts.trades, `${x.trades.count} trade${x.trades.count === 1 ? '' : 's'} · net ${signed(x.trades.net)} starter pts`],
      ['Draft', W.draft, sc.parts.draft, `${x.picks} picks · ${signed(x.draftVal, 0)} positional pts vs. what picks near those slots were worth`]
    ].filter(p => p[2] != null);
    out.push(section(breakdown(`How the ${S.season} ${Math.round(sc.total)} breaks down`, parts) + seasonCalc(x)));
  } else {
    let apSum = 0; let apG = 0; let draft = 0; let picks = 0; let adds = 0; let faab = 0; let faabSeasons = 0; let poW = 0; let poL = 0;
    const weeks = [];
    list.forEach(x => { apSum += x.st.allPlay; apG += x.st.allPlayGames; draft += x.draftVal; picks += x.picks; adds += x.waiv.adds; poW += x.poW; poL += x.poL;
      if (x.S.usesFaab) { faab += x.waiv.faab; faabSeasons++; } weeks.push.apply(weeks, x.weeks); });
    const sorted = weeks.slice().sort((a, b) => b.pts - a.pts);
    const best = sorted[0]; const worst = sorted[sorted.length - 1];
    out.push(section(`<div class="head"><h2>Career stats</h2><span class="note">${list.map(x => x.S.season).sort().join(', ')}</span></div>` + tiles([
      ['Record', wl(c.wins, c.losses, c.ties), pct3(c.winPct) + ' win %'],
      ['Titles', String(c.titles), c.finals + ' final' + (c.finals === 1 ? '' : 's') + ' · ' + c.playoffs + '/' + completedPlayed + ' playoffs'],
      ['Points for', comma(c.pf), f1(c.ppg) + ' per game'],
      ['Points against', comma(c.pa), f1(c.games ? c.pa / c.games : 0) + ' per game'],
      ['All-play', pct3(apG ? apSum / apG : 0), f1(apSum) + ' expected wins'],
      ['Luck', `<span class="${sign(c.luck)}">${signed(c.luck)}</span>`, 'Wins above expected'],
      ['Playoff record', poW + poL ? wl(poW, poL) : '—', c.clutch != null ? 'Clutch ' + signed(c.clutch * 100) + '%' : ''],
      ['Last places', String(c.lastPlaces), c.lastPlaces ? 'Toilet bowl losses' : 'Never lost the toilet bowl'],
      ['Best week', best ? f2(best.pts) : '—', best ? best.season + ' · Week ' + best.w : ''],
      ['Worst week', worst ? f2(worst.pts) : '—', worst ? worst.season + ' · Week ' + worst.w : ''],
      ['Start/sit', (c.effPct * 100).toFixed(1) + '%', Math.round(c.benchLeft) + ' pts left on the bench'],
      ['Waivers', adds + ' adds', comma(c.waiverPts) + ' starter pts' + (faabSeasons ? ' · $' + faab + ' FAAB' : '')],
      ['Trades', String(c.trades), 'Net ' + signed(c.tradeNet) + ' starter pts'],
      ['Draft', picks + ' picks', signed(draft, 0) + ' positional pts vs. their slots']
    ])));
    const parts = [
      ['Results', W.results, c.parts.results, `Win % ${pct3(c.winPct)} · all-play ${pct3(apG ? apSum / apG : 0)}${c.titles ? ' · title bonus ×' + c.titles : ''}`],
      ['Start/sit', W.startSit, c.parts.startSit, `Started ${(c.effPct * 100).toFixed(1)}% of best possible points · ${Math.round(c.benchLeft)} pts left on the bench`],
      ['Waivers', W.waivers, c.parts.waivers, `${comma(c.waiverPts)} starter pts from ${adds} pickups`],
      ['Trades', W.trades, c.parts.trades, `${c.trades} trade${c.trades === 1 ? '' : 's'} · net ${signed(c.tradeNet)} starter pts`],
      ['Draft', W.draft, c.parts.draft, `${picks} picks · ${signed(draft, 0)} positional pts vs. what their draft slots usually produce`]
    ].filter(p => p[2] != null);
    out.push(section(managerCareerAwards(id, list)));
    out.push(section(breakdown(`How the ${Math.round(c.score)} breaks down`, parts) +
      '<span class="note">50 = league average that season. Each part here is the games-weighted average of that part across seasons.</span>' + careerCalc(id, list)));
  }

  // By season: chart + cards (always shown).
  const seasons = c.bySeason.slice().sort((a, b) => Number(a.season) - Number(b.season));
  let chart = '';
  if (seasons.length >= 2) {
    const x = i => 30 + i * (290 / (seasons.length - 1));
    const y = v => 120 - v * 1.1;
    const pts = seasons.map((s, i) => x(i).toFixed(1) + ',' + y(s.score).toFixed(1)).join(' ');
    chart = `<svg viewBox="0 0 350 150" width="100%" style="max-width:560px;display:block" role="img" aria-label="Manager Score by season">
      <line x1="30" y1="${y(50)}" x2="320" y2="${y(50)}" stroke="#4A6168" stroke-dasharray="4 4"/><text x="320" y="${y(50) - 6}" fill="#8A9C9F" font-size="10" text-anchor="end">League avg 50</text>
      <polygon points="${pts} ${x(seasons.length - 1)},120 30,120" fill="${GOLD}" fill-opacity="0.10"/>
      <polyline points="${pts}" fill="none" stroke="${GOLD}" stroke-width="2.4" stroke-linejoin="round"/>
      ${seasons.map((s, i) => `<circle cx="${x(i)}" cy="${y(s.score)}" r="${sel && sel.S.season === s.season ? 5 : 3.5}" fill="${GOLD}"/><text x="${x(i)}" y="140" fill="#8A9C9F" font-size="10" text-anchor="${i === 0 ? 'start' : i === seasons.length - 1 ? 'end' : 'middle'}">${s.season}</text>`).join('')}</svg>`;
  }
  out.push(section(`<h2>By season</h2>${chart}<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">${seasons.slice().reverse().map(s => `
    <a class="card${sel && sel.S.season === s.season ? ' sel' : ''}" href="${mlink(id)}@${s.season}"><span class="num note">${s.season}</span><span class="num" style="font-size:24px">${Math.round(s.score)}</span>
    <span class="note" style="${s.champion ? 'color:' + GOLD : ''}">${s.champion ? 'Champion' : s.runnerUp ? 'Runner-up' : s.last ? 'Last place' : s.current ? 'In progress · ' + ordinal(s.rank) : ordinal(s.rank) + ' · ' + wl(s.wins, s.losses, s.ties)}</span></a>`).join('')}</div>
    <a class="btn" href="${PX}vs-${encodeURIComponent(id)}~${encodeURIComponent((lb.find(x => x.id !== id) || {}).id || id)}">Compare with another manager →</a>`));
  return out.join('');
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// ---------- Compare ----------
function viewCompare(a, b) {
  const lb = M.leaderboard;
  if (!M.career[a]) a = lb[0].id;
  if (!M.career[b] || b === a) b = (lb.find(x => x.id !== a) || lb[0]).id;
  const A = M.career[a]; const B = M.career[b];
  const r = M.h2hRecord(a, b);
  const opts = sel => lb.map(c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${name(c.id)}</option>`).join('');
  const poW = r.list.filter(g => g.playoff && g.mine > g.theirs).length;
  const poL = r.list.filter(g => g.playoff && g.mine < g.theirs).length;
  const last = r.list.slice().sort((p, q) => Number(q.season) - Number(p.season) || q.week - p.week)[0];
  const out = [];
  out.push(section(`<h1>Head to head. <span class="soft">Pick any two.</span></h1>
    <div class="pickers"><label for="pickA">Manager 1<select id="pickA" class="a">${opts(a)}</select></label><span class="vs">vs</span>
    <label for="pickB">Manager 2<select id="pickB">${opts(b)}</select></label></div>`, 'hero'));
  out.push(`<section class="paper"><div class="wrap"><span class="label">All-time series</span>
    <div class="line2" style="align-items:center"><span class="stack"><span class="num" style="font-size:44px;line-height:1">${r.w}</span><span style="font-size:13px;font-weight:600">${name(a)}</span></span>
    <span style="color:#6B7B7E">${r.t ? r.t + ' tie' + (r.t > 1 ? 's' : '') : '–'}</span>
    <span class="stack" style="align-items:flex-end"><span class="num" style="font-size:44px;line-height:1;color:#6B7B7E">${r.l}</span><span style="font-size:13px;font-weight:600;color:#4A5A5D">${name(b)}</span></span></div>
    <div class="stats"><div><span>Avg margin</span><span>${r.games ? f1(r.margin) : '—'}</span></div><div><span>Playoffs</span><span>${r.playoff ? poW + '–' + poL : '—'}</span></div>
    <div><span>Last meeting</span><span style="font-size:13px">${last ? last.season + ' W' + last.week + ' · ' + (last.mine > last.theirs ? 'W' : last.mine < last.theirs ? 'L' : 'T') : '—'}</span></div></div></div></section>`);

  const keys = [['Overall', A.score, B.score], ['Results', A.parts.results, B.parts.results], ['Start/sit', A.parts.startSit, B.parts.startSit],
    ['Waivers', A.parts.waivers, B.parts.waivers], ['Trades', A.parts.trades, B.parts.trades], ['Draft', A.parts.draft, B.parts.draft]].filter(k => k[1] != null && k[2] != null);
  out.push(section(`<div class="head"><h2>Manager Score</h2><span class="legend"><span><i style="background:${GOLD}"></i> ${name(a)}</span><span><i style="background:#C9D3D2"></i> ${name(b)}</span></span></div>
    <div class="rows">${keys.map((k, i) => `<div class="row" style="grid-template-columns:82px minmax(0,1fr) 64px;padding:11px 0">
      <span style="font-size:13px;${i === 0 ? 'font-weight:600' : 'color:#C9D3D2'}">${k[0]}</span>
      <span class="stack" style="gap:4px"><span class="bar"><i style="width:${k[1]}%;background:${GOLD}"></i></span><span class="bar"><i style="width:${k[2]}%;background:#C9D3D2"></i></span></span>
      <span class="num" style="font-size:13px;text-align:right">${Math.round(k[1])} / ${Math.round(k[2])}</span></div>`).join('')}</div>`));

  const rows = [['Titles', A.titles, B.titles, A.titles - B.titles], ['Record', wl(A.wins, A.losses, A.ties), wl(B.wins, B.losses, B.ties), A.winPct - B.winPct],
    ['Points per game', f1(A.ppg), f1(B.ppg), A.ppg - B.ppg], ['Start/sit', (A.effPct * 100).toFixed(1) + '%', (B.effPct * 100).toFixed(1) + '%', A.effPct - B.effPct],
    ['Clutch rating', A.clutch != null ? signed(A.clutch * 100) + '%' : '—', B.clutch != null ? signed(B.clutch * 100) + '%' : '—', (A.clutch || 0) - (B.clutch || 0)],
    ['Luck Index', signed(A.luck), signed(B.luck), 0]];
  out.push(section(`<h2>Career side by side</h2><div class="scroll"><table class="table"><thead><tr><th></th><th>${name(a)}</th><th>${name(b)}</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td class="t" style="font-weight:400;color:#A3B2B4;font-size:13px">${x[0]}</td><td style="${x[3] > 0 ? 'color:#F1F4F3;font-weight:500' : 'color:#8A9C9F'}">${x[1]}</td>
      <td style="${x[3] < 0 ? 'color:#F1F4F3;font-weight:500' : 'color:#8A9C9F'}">${x[2]}</td></tr>`).join('')}</tbody></table></div>`));

  const between = M.allTrades.filter(t => t.sides.some(s => s.owner === a) && t.sides.some(s => s.owner === b));
  out.push(section(`<h2>Trades between them</h2>${between.length ? between.map(t => {
    const sa = t.sides.find(s => s.owner === a); const win = sa.net >= 0 ? a : b;
    return `<button type="button" class="box tradebtn"${tradeAttr(t)}><div class="top-line"><span>${t.season} · Week ${t.week}</span><span>Winner · tap for details</span></div>
      <div class="line2"><span style="font-size:14px;min-width:0">${name(a)} got ${sa.got.map(g => player(g.pid)).join(', ') || 'picks'} for ${sa.sent.map(g => player(g.pid)).join(', ') || 'picks'}</span>
      <span class="num up" style="font-size:14px;white-space:nowrap">${name(win)} ${signed(Math.abs(sa.net))}</span></div></button>`;
  }).join('') : '<p class="lead">These two have never traded with each other.</p>'}`));
  return out.join('');
}

function bindCompare() {
  const pa = document.getElementById('pickA'); const pb = document.getElementById('pickB');
  if (!pa) return;
  const go = () => { location.hash = PX.slice(1) + 'vs-' + encodeURIComponent(pa.value) + '~' + encodeURIComponent(pb.value); };
  pa.addEventListener('change', go); pb.addEventListener('change', go);
}

// ---------- Playoffs ----------
function byeCountFor(S) { let n = 1; while (n < S.playoffTeams) n *= 2; return n - S.playoffTeams; }
const ROUND_NAMES = (total, r) => (r === total ? 'Final' : r === total - 1 ? 'Semifinals' : r === total - 2 ? 'Quarterfinals' : 'Round ' + r);

function viewPlayoffs() {
  const done = completed();
  const out = [];
  out.push(section(`<div class="eyebrow">${TROPHY(GOLD, 13)} Playoff history</div>
    <h1>Every bracket, every year. <span class="soft">Who shows up when it counts.</span></h1>`, 'hero'));

  // Career playoff table.
  const P = {};
  const row = id => (P[id] = P[id] || { id, apps: 0, byes: 0, w: 0, l: 0, pts: 0, games: 0, finals: 0, titles: 0, regPts: 0, regGames: 0 });
  done.forEach(S => {
    const byes = byeCountFor(S);
    S.playoffRids.forEach(r => { const x = row(S.ownerOf[r]); x.apps++; if (S.st[r].rank <= byes) x.byes++; });
    S.finalists.forEach(r => { row(S.ownerOf[r]).finals++; });
    if (S.champion) row(S.ownerOf[S.champion]).titles++;
    S.games.filter(g => g.playoff).forEach(g => [[g.a, g.ap, g.bp], [g.b, g.bp, g.ap]].forEach(([r, mine, theirs]) => {
      const x = row(S.ownerOf[r]); x.games++; x.pts += mine; if (mine > theirs) x.w++; else if (mine < theirs) x.l++;
    }));
  });
  Object.values(P).forEach(x => { const c = M.career[x.id]; x.regPpg = c ? c.ppg : 0; });
  const rows = Object.values(P).map(x => ({ name: name(x.id), href: mlink(x.id), wl: wl(x.w, x.l),
    tag: x.titles ? ` <span class="note gold-t">${'★'.repeat(Math.min(x.titles, 5))}</span>` : '',
    v: { apps: x.apps, byes: x.byes, wins: x.games ? x.w / x.games + x.w / 1000 : 0, titles: x.titles, finals: x.finals,
      ppg: x.games ? x.pts / x.games : 0, clutch: x.games && x.regPpg ? (x.pts / x.games / x.regPpg - 1) * 100 : 0, tie: x.apps } }));
  const cols = [
    { key: 'pos', label: '#', cell: (r, i) => `<td class="rk">${i + 1}</td>` },
    { key: 'name', label: 'Team', left: true, cell: r => `<td class="t"><a href="${r.href}" style="text-decoration:none">${r.name}</a>${r.tag}</td>` },
    { key: 'apps', label: 'Apps', sortable: true, cell: r => cellNum(String(r.v.apps)) },
    { key: 'byes', label: 'Byes', sortable: true, cell: r => cellNum(String(r.v.byes), '#C9D3D2') },
    { key: 'wins', label: 'W–L', sortable: true, cell: r => cellNum(r.wl) },
    { key: 'finals', label: 'Finals', sortable: true, cell: r => cellNum(String(r.v.finals), '#C9D3D2') },
    { key: 'titles', label: 'Titles', sortable: true, cell: r => cellNum(String(r.v.titles)) },
    { key: 'ppg', label: 'PPG', sortable: true, cell: r => cellNum(r.v.ppg ? f1(r.v.ppg) : '—', '#C9D3D2') },
    { key: 'clutch', label: 'Clutch', sortable: true, cell: r => `<td class="${sign(r.v.clutch)}">${r.v.ppg ? signed(r.v.clutch) + '%' : '—'}</td>` }
  ];
  out.push(section(`<div class="head"><h2>Playoff standings</h2><span class="note">Finished seasons · tap a column to sort</span></div>
    ${rows.length ? sortTable(cols, rows, { key: 'titles' }) : '<p class="lead">No finished playoffs yet.</p>'}
    <span class="note">Apps = playoff appearances. Byes = first-round byes. W–L and PPG count championship-bracket games only (no 3rd-place or consolation games). Clutch = playoff PPG vs. regular-season PPG.</span>`));

  // Playoff records.
  const all = [];
  done.forEach(S => S.games.filter(g => g.playoff).forEach(g => all.push({ S, g })));
  if (all.length) {
    const flat = [].concat.apply([], all.map(({ S, g }) => [{ S, g, r: g.a, me: g.ap, them: g.bp, opp: g.b }, { S, g, r: g.b, me: g.bp, them: g.ap, opp: g.a }]));
    const hi = flat.slice().sort((a, b) => b.me - a.me)[0];
    const lo = flat.filter(x => x.me > 0).sort((a, b) => a.me - b.me)[0];
    const blow = all.slice().sort((a, b) => Math.abs(b.g.ap - b.g.bp) - Math.abs(a.g.ap - a.g.bp))[0];
    const close = all.filter(x => x.g.ap !== x.g.bp).sort((a, b) => Math.abs(a.g.ap - a.g.bp) - Math.abs(b.g.ap - b.g.bp))[0];
    const finals = flat.filter(x => x.g.placement === 1 && x.me > x.them).sort((a, b) => b.me - a.me)[0];
    const win = x => (x.g.ap > x.g.bp ? x.g.a : x.g.b); const lose = x => (x.g.ap > x.g.bp ? x.g.b : x.g.a);
    const tiles = [
      ['Highest playoff score', f2(hi.me), name(hi.S.ownerOf[hi.r]), hi.S.season + ' · Week ' + hi.g.week],
      lo ? ['Lowest playoff score', f2(lo.me), name(lo.S.ownerOf[lo.r]), lo.S.season + ' · Week ' + lo.g.week] : null,
      ['Biggest playoff blowout', '+' + f2(Math.abs(blow.g.ap - blow.g.bp)), name(blow.S.ownerOf[win(blow)]) + ' over ' + name(blow.S.ownerOf[lose(blow)]), blow.S.season + ' · Week ' + blow.g.week],
      close ? ['Closest playoff game', f2(Math.abs(close.g.ap - close.g.bp)), name(close.S.ownerOf[win(close)]) + ' over ' + name(close.S.ownerOf[lose(close)]), close.S.season + ' · Week ' + close.g.week] : null,
      finals ? ['Best title-game score', f2(finals.me), name(finals.S.ownerOf[finals.r]), finals.S.season + ' final'] : null
    ].filter(Boolean);
    out.push(section(`<h2>Playoff records</h2><div class="tiles">${tiles.map(t => `<div class="tile"><span class="k">${t[0]}</span><span class="v">${t[1]}</span><span class="w">${t[2]}</span><span class="d">${t[3]}</span></div>`).join('')}</div>`));
  }

  // Brackets, newest first. The current season shows the seeding as it stands.
  const cur = M.seasons.find(S => S.isCurrent && !S.champion);
  let brackets = '';
  if (cur && cur.regWeeks.length) {
    const byes = byeCountFor(cur);
    brackets += `<details class="calc" open><summary>${cur.season} · if the season ended today</summary><div class="calc-body"><div class="rows">
      ${cur.standings.slice(0, cur.playoffTeams).map((x, i) => `<a class="row" href="${mlink(cur.ownerOf[x.rid])}" style="grid-template-columns:32px minmax(0,1fr) auto;padding:10px 0">
        <span class="num note">${i + 1}</span><span class="stack"><span style="font-size:14px;font-weight:500">${name(cur.ownerOf[x.rid])}</span><span class="sub">${wl(x.wins, x.losses, x.ties)} · ${comma(x.pf)} PF</span></span>
        ${i < byes ? '<span class="tag up">Bye</span>' : '<span></span>'}</a>`).join('')}</div>
      <a class="btn" href="${PX}s${cur.season}">Playoff and title odds →</a></div></details>`;
  }
  done.forEach((S, k) => {
    const seed = r => S.st[r].rank;
    const games = S.games.filter(g => g.playoff);
    const total = games.reduce((m, g) => Math.max(m, g.round || 0), 0);
    const byes = byeCountFor(S);
    const byeTeams = S.standings.slice(0, byes).map(x => x.rid);
    const rounds = [];
    for (let r = 1; r <= total; r++) rounds.push(games.filter(g => g.round === r));
    const gameRow = g => { const aw = g.ap > g.bp;
      return `<div class="pgame"><div class="line2"><span class="${aw ? 'lead-t' : 'trail-t'}"><span class="num note">${seed(g.a)}</span> ${name(S.ownerOf[g.a])}</span><span class="num ${aw ? '' : 'trail-t'}">${f2(g.ap)}</span></div>
        <div class="line2"><span class="${!aw ? 'lead-t' : 'trail-t'}"><span class="num note">${seed(g.b)}</span> ${name(S.ownerOf[g.b])}</span><span class="num ${!aw ? '' : 'trail-t'}">${f2(g.bp)}</span></div></div>`; };
    brackets += `<details class="calc"${k === 0 && !brackets ? ' open' : ''}><summary><span>${S.season}${S.champion ? ` · <span class="gold-t">${name(S.ownerOf[S.champion])}</span>` : ''}</span></summary><div class="calc-body">
      ${byeTeams.length ? `<p class="note" style="margin:0">Byes: ${byeTeams.map(r => '<span class="num">' + seed(r) + '</span> ' + name(S.ownerOf[r])).join(', ')}</p>` : ''}
      ${rounds.map((g, i) => `<div class="stack" style="gap:8px"><span class="note" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px">${ROUND_NAMES(total, i + 1)} · Week ${S.playoffWeekStart + i}</span>${g.map(gameRow).join('')}</div>`).join('')}
      ${S.champion ? `<p style="margin:0;display:flex;align-items:center;gap:8px">${TROPHY(GOLD, 16)} <b>${name(S.ownerOf[S.champion])}</b> <span class="note">won the ${S.season} title</span></p>` : ''}
    </div></details>`;
  });
  out.push(section(`<h2>Brackets</h2><div style="display:flex;flex-direction:column;gap:8px">${brackets || '<p class="lead">No playoffs yet.</p>'}</div>
    <span class="note">Numbers are seeds. Winners in white.</span>`));
  return out.join('');
}

// ---------- Matchup history ----------
const SLOT_LABEL = { SUPER_FLEX: 'SF', FLEX: 'FLX', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', IDP_FLEX: 'IDP' };
const slotLabel = s => SLOT_LABEL[s] || s;

// What a playoff-week game was: a bracket round, a placement game or a consolation game.
function gameLabel(S, w, a, b) {
  if (w < S.playoffWeekStart) return '';
  const r = w - S.playoffWeekStart + 1;
  const same = m => m.r === r && ((m.t1 === a && m.t2 === b) || (m.t1 === b && m.t2 === a));
  const total = (S.winners || []).filter(m => !m.p || m.p === 1).reduce((x, m) => Math.max(x, m.r), 0);
  const win = (S.winners || []).find(same);
  if (win) return win.p === 1 ? 'Championship' : win.p ? ordinal(win.p) + ' place game' : ROUND_NAMES(total, r);
  const lose = (S.losers || []).find(same);
  if (lose && lose.p === 1) return 'Toilet bowl';
  return 'Consolation';
}

// Every two-team matchup in a week, bracket games first.
function weekGames(S, w) {
  const groups = {};
  Object.values(S.byWeek[w] || {}).forEach(m => { if (m.matchup_id != null) (groups[m.matchup_id] = groups[m.matchup_id] || []).push(m); });
  const list = Object.keys(groups).map(Number).sort((x, y) => x - y).filter(k => groups[k].length === 2).map(k => {
    const [A, B] = groups[k];
    return { mid: k, a: A.roster_id, b: B.roster_id, ap: A.points, bp: B.points, label: gameLabel(S, w, A.roster_id, B.roster_id) };
  });
  const rank = g => (!g.label ? 0 : g.label === 'Championship' ? 0 : /final|Round/i.test(g.label) ? 1 : /place/.test(g.label) ? 2 : g.label === 'Toilet bowl' ? 4 : 3);
  return list.sort((x, y) => rank(x) - rank(y) || x.mid - y.mid);
}

function historyWeeks(S) {
  const last = Math.min(S.playoffWeekStart + 2, Math.max(S.scoredThrough, S.isCurrent ? S.currentWeek || 0 : 0));
  const weeks = [];
  for (let w = 1; w <= last; w++) {
    const games = weekGames(S, w);
    if (!games.length) continue;
    const live = w > S.scoredThrough;
    if (live && !games.some(g => g.ap || g.bp)) continue;
    weeks.push({ w, games, live });
  }
  return weeks;
}

function viewMatchups(seasonSel) {
  const S = M.seasons.find(x => x.season === seasonSel) || M.seasons[0];
  const nm = r => name(S.ownerOf[r]);
  const weeks = historyWeeks(S);
  const out = [];
  out.push(section(`<div class="eyebrow">Matchup history</div>
    <h1>${S.season} matchups. <span class="soft">Every week, every score.</span></h1>
    <nav class="chips" aria-label="Choose a season">${M.seasons.map(x => `<a class="pill${x === S ? ' on' : ''}" href="${PX}matchups@${x.season}">${x.isCurrent ? '<span class="dot"></span>' : ''}${x.season}</a>`).join('')}</nav>`, 'hero'));
  if (!weeks.length) { out.push(section('<p class="lead">No games played yet this season.</p>')); return out.join(''); }
  const gameRow = (w, g) => { const aw = g.ap > g.bp; const bw = g.bp > g.ap;
    return `<button type="button" class="pgame mbtn" data-matchup="${S.season}:${w}:${g.mid}">
      ${g.label ? `<span class="note" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px">${g.label}</span>` : ''}
      <span class="line2"><span class="${aw ? 'lead-t' : 'trail-t'}">${nm(g.a)}</span><span class="num ${aw ? '' : 'trail-t'}">${f2(g.ap)}</span></span>
      <span class="line2"><span class="${bw ? 'lead-t' : 'trail-t'}">${nm(g.b)}</span><span class="num ${bw ? '' : 'trail-t'}">${f2(g.bp)}</span></span></button>`; };
  const blocks = weeks.slice().reverse().map(({ w, games, live }) => {
    const flat = [].concat.apply([], games.map(g => [[g.a, g.ap], [g.b, g.bp]]));
    const hi = flat.sort((x, y) => y[1] - x[1])[0];
    const tag = live ? 'In progress' : w >= S.playoffWeekStart ? 'Playoffs' : '';
    return `<details class="calc"><summary><span>Week ${w}${tag ? ` · <span class="note">${tag}</span>` : ''}</span><span class="note" style="margin-left:auto;padding-left:10px">High: ${nm(hi[0])} ${f1(hi[1])}</span></summary>
      <div class="calc-body"><div class="mgrid">${games.map(g => gameRow(w, g)).join('')}</div></div></details>`;
  });
  out.push(section(`<div class="head"><h2>Weeks</h2><span class="note">Newest first · tap a week, then a game for both lineups</span></div>
    <div style="display:flex;flex-direction:column;gap:8px">${blocks.join('')}</div>`));
  return out.join('');
}

function openMatchup(key) {
  const [season, wk, mid] = key.split(':');
  const S = seasonOf(season); const w = Number(wk);
  if (!S) return;
  const g = weekGames(S, w).find(x => x.mid === Number(mid));
  if (!g) return;
  const A = S.byWeek[w][g.a]; const B = S.byWeek[w][g.b];
  const pts = (m, p) => (m.players_points[p] || 0);
  const taxiOf = r => (S.taxi && S.taxi[r]) || new Set();
  // Non-starters split into bench (IR included) and taxi squad, each sorted by points.
  const group = (m, r, kind) => m.players.filter(p => m.starters.indexOf(p) < 0)
    .filter(p => (kind === 'TX') === taxiOf(r).has(p)).sort((x, y) => pts(m, y) - pts(m, x));
  const best = (m, r) => { const pool = m.players.filter(p => !taxiOf(r).has(p) || m.starters.indexOf(p) >= 0);
    return Math.max(optimalPoints(S.startSlots || S.slots, pool, m.players_points, S.posOf), sum(m.starters.map(p => pts(m, p)))); };
  const slots = S.startSlots || S.slots;
  const cellL = (m, p) => !p || p === '0' ? '<span class="pl note">Empty</span>' : `<span class="pl"><span class="pn">${player(p)}</span><span class="note">${esc(M.playerPos(p) || '')}</span></span>`;
  const cellR = (m, p) => !p || p === '0' ? '<span class="pl r note">Empty</span>' : `<span class="pl r"><span class="pn">${player(p)}</span><span class="note">${esc(M.playerPos(p) || '')}</span></span>`;
  const ptsCell = (m, p, r) => `<span class="num${r ? ' r' : ''}">${p && p !== '0' ? f2(pts(m, p)) : '—'}</span>`;
  const n = Math.max(A.starters.length, B.starters.length, slots.length);
  let rowsHtml = '';
  for (let i = 0; i < n; i++) {
    const pa = A.starters[i]; const pb = B.starters[i];
    const ha = pa && pb && pts(A, pa) > pts(B, pb); const hb = pa && pb && pts(B, pb) > pts(A, pa);
    rowsHtml += `<div class="mrow${ha ? ' la' : ''}${hb ? ' lb' : ''}">${cellL(A, pa)}${ptsCell(A, pa)}<span class="slot">${esc(slotLabel(slots[i] || ''))}</span>${ptsCell(B, pb, 1)}${cellR(B, pb)}</div>`;
  }
  const GROUPS = [['BN', 'Bench'], ['TX', 'Taxi squad']];
  const benchHtml = GROUPS.map(([kind, label]) => {
    const xa = group(A, g.a, kind); const xb = group(B, g.b, kind);
    if (!xa.length && !xb.length) return '';
    let h = `<span class="note mlabel">${label}</span>`;
    for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
      const x = xa[i]; const y = xb[i];
      h += `<div class="mrow bn">${x ? cellL(A, x) + ptsCell(A, x) : '<span></span><span></span>'}<span class="slot">${kind}</span>${y ? ptsCell(B, y, 1) + cellR(B, y) : '<span></span><span></span>'}</div>`;
    }
    return h;
  }).join('');
  const head = (m, r, right) => { const won = m.points > (r === g.a ? g.bp : g.ap); const edited = Math.abs(sum(m.starters.map(p => pts(m, p))) - m.points) > 0.01;
    return `<div class="stack"${right ? ' style="text-align:right;align-items:flex-end"' : ''}><a class="name" href="${mlink(S.ownerOf[r])}" data-close style="text-decoration:none">${name(S.ownerOf[r])}</a>
      <span class="num${won ? '' : ' trail-t'}" style="font-size:26px;font-weight:600">${f2(m.points)}</span>
      <span class="note">Best possible ${f1(best(m, r))}${edited ? ' · score set by commissioner' : ''}</span></div>`; };
  let dlg = document.getElementById('matchup-modal');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'matchup-modal';
    dlg.className = 'modal wide';
    dlg.setAttribute('aria-labelledby', 'matchup-title');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  }
  dlg.innerHTML = `<div class="modal-card">
    <div class="line2" style="align-items:center"><h2 id="matchup-title" style="font-size:18px">${S.season} · Week ${w}${g.label ? ' · ' + g.label : ''}</h2>
      <button type="button" class="close" data-close aria-label="Close">✕</button></div>
    <div class="mhead">${head(A, g.a)}${head(B, g.b, 1)}</div>
    <div class="mtable"><span class="note mlabel">Starters</span>${rowsHtml}
      ${benchHtml}</div>
    <p class="note" style="margin:0">Highlighted points won that lineup slot. Best possible = the highest score that week's roster could have started${S.taxi ? ' (taxi players left out)' : ''}.${S.taxi ? ' Sleeper only saves the latest taxi squads, so older weeks use ' + (S.isCurrent ? 'the current ones' : 'the end-of-season ones') + '.' : ''}</p>
  </div>`;
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  const c = dlg.querySelector('.close'); if (c) c.focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-matchup]');
  if (b) { e.preventDefault(); openMatchup(b.dataset.matchup); }
});

// ---------- Draft history ----------
const GRADE_COLORS = { A: '#5FC79B', B: '#9FD8B8', C: '#C9D3D2', D: '#F2B59E', F: '#F0907A' };
function gradeOf(z) { return z >= 1 ? 'A' : z >= 0.33 ? 'B' : z >= -0.33 ? 'C' : z >= -1 ? 'D' : 'F'; }

// "Best pick" labels skip kickers and defenses (they still count toward every grade).
const notKDef = p => p.pos !== 'K' && p.pos !== 'DEF';

// Team draft grades: total value of each team's picks, scored against the other teams (A–F).
function draftTeamGrades(S) {
  const teams = S.rids.map(r => {
    const picks = S.picks.filter(p => p.roster_id === r);
    const total = picks.reduce((t, p) => t + p.value, 0);
    const best = picks.filter(notKDef).sort((a, b) => b.value - a.value)[0];
    return { r, picks, total, best };
  });
  const xs = teams.map(t => t.total); const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sdv = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, xs.length - 1)) || 1;
  teams.forEach(t => { t.grade = gradeOf((t.total - m) / sdv); });
  return teams.sort((a, b) => b.total - a.total);
}
function teamGradesSection(S, teams, title) {
  const nm = r => name(S.ownerOf[r]);
  return `<div class="head"><h2>${title || 'Team grades'}</h2><span class="note">Positional value vs. what each pick number usually produces${S.isCurrent ? ', so far' : ''}</span></div>
    <div class="rows">${teams.map(t => `<button type="button" class="row rowbtn" data-draft-team="${S.season}:${t.r}" style="grid-template-columns:40px minmax(0,1fr) auto">
      <span class="grade" style="background:${GRADE_COLORS[t.grade]}">${t.grade}</span>
      <span class="stack"><span class="name" style="font-size:15px">${nm(t.r)}</span><span class="sub">${t.best ? 'Best pick: ' + player(t.best.player_id) + ' (R' + t.best.round + ')' : 'No picks'}</span></span>
      <span class="num ${sign(t.total)}" style="font-size:15px">${signed(t.total, 0)}</span></button>`).join('')}</div>
    <span class="note">Tap a team to see its whole draft with a grade for every pick.</span>
    <span class="note">Each pick is worth its points above a replacement-level starter at its position (${Object.entries(S.replacement).map(([p, x]) => p + x.rank).join(', ')}), compared with what that pick number usually produces across this league's drafts. A late QB who scores a lot but barely beats the replacement QB isn't rated above a late RB who became a starter. Misses count more in early rounds (1.5× in round 1) and less in late ones (0.4× in the last); hits count in full. Grades compare each team's total with the rest of the league: A is a standout draft, C is about average, F is far below.</span>`;
}

function viewDrafts(seasonSel) {
  const withPicks = M.seasons.filter(S => S.picks.length);
  if (!withPicks.length) return section('<h1>No drafts on record.</h1>', 'hero');
  const S = withPicks.find(x => x.season === seasonSel) || withPicks[0];
  const nm = r => name(S.ownerOf[r]);
  const n = S.rids.length;
  const later = M.seasons.filter(x => Number(x.season) > Number(S.season));
  const dynasty = LG.format === 'dynasty' && later.length;
  const sincePts = pid => later.reduce((t, x) => t + (x.playerPts[pid] || 0), 0);
  const showGrades = LG.format !== 'dynasty';

  const teams = draftTeamGrades(S);

  const out = [];
  out.push(section(`<div class="eyebrow">Draft history${S.isCurrent ? ' · season in progress' : ''}</div>
    <h1>${S.season} draft. <span class="soft">${showGrades ? nm(teams[0].r) + ' drafted best, ' + nm(teams[teams.length - 1].r) + ' worst.' : 'Every pick, round by round.'}</span></h1>
    <nav class="chips" aria-label="Choose a draft">${withPicks.map(x => `<a class="pill${x === S ? ' on' : ''}" href="${PX}drafts@${x.season}">${x.season}</a>`).join('')}</nav>`, 'hero'));

  if (showGrades) out.push(section(teamGradesSection(S, teams)));

  if (!showGrades) out.push(section(`<h2>Team drafts</h2><div class="chips">${teams.slice().sort((a, b) => M.nameOf(S.ownerOf[a.r]).localeCompare(M.nameOf(S.ownerOf[b.r]))).map(t =>
    `<button type="button" class="chip ex" data-draft-team="${S.season}:${t.r}">${nm(t.r)}</button>`).join('')}</div><span class="note">Tap a team to see its whole draft.</span>`));

  const rounds = [...new Set(S.picks.map(p => p.round))].sort((a, b) => a - b);
  out.push(section(`<h2>Round by round</h2>${rounds.map(rd => {
    const picks = S.picks.filter(p => p.round === rd).sort((a, b) => a.pick_no - b.pick_no);
    const best = picks.filter(notKDef).sort((a, b) => b.value - a.value)[0];
    const worst = rd < 10 ? picks.slice().sort((a, b) => a.value - b.value)[0] : null;
    return `<details class="calc round"${rd <= 2 ? ' open' : ''}><summary>Round ${rd}<span class="note" style="font-weight:400;margin-left:auto;margin-right:12px">Best: ${best ? player(best.player_id) : "—"}</span></summary><div class="calc-body" style="padding-top:4px">
      <div class="scroll"><table class="table"><thead><tr><th>Pick</th><th style="text-align:left">Player</th><th>Pts</th><th>Drafted</th><th>Finish</th><th>Above repl.</th>${dynasty ? '<th>Since</th>' : ''}<th>vs. slot</th></tr></thead><tbody>
      ${picks.map(p => `<tr><td class="rk" style="width:auto">${p.round}.${String(((p.pick_no - 1) % n) + 1).padStart(2, '0')}</td>
        <td class="t"><span style="display:flex;flex-direction:column;gap:2px"><span>${player(p.player_id)} <span class="note">${esc(p.pos)}</span>${p === best ? ' <span class="tag up">Best</span>' : p === worst ? ' <span class="tag down">Worst</span>' : ''}</span>
        <button type="button" class="linkbtn note" data-draft-team="${S.season}:${p.roster_id}">${nm(p.roster_id)}</button></span></td>
        <td>${f1(p.pts)}</td><td style="color:#C9D3D2">${esc(p.pos)}${p.posDrafted}</td><td style="color:#C9D3D2">${S.posRank[p.player_id] ? esc(p.pos) + S.posRank[p.player_id] : '—'}${finishMove(p, S)}</td><td>${signed(p.vor, 0)}</td>${dynasty ? `<td style="color:#C9D3D2">${f1(sincePts(p.player_id))}</td>` : ''}
        <td class="${sign(p.value)}">${signed(p.value, 0)}</td></tr>`).join('')}</tbody></table></div></div></details>`;
  }).join('')}
    <span class="note">Pts = regular-season points that year. Drafted = when his position came off the board (WR1 = first WR taken). Finish = rank at his position among rostered players, with ▲/▼ vs. where he was drafted. Above repl. = points above the replacement-level starter at his position. vs. slot = above repl. minus what that pick number usually produces across this league's drafts; misses count 1.5× in round 1 sliding to 0.4× in the last round. Worst tags only go to rounds 1–9.${dynasty ? ' Since = regular-season points in every season after this draft, for any team.' : ''}</span>`));
  return out.join('');
}

// Finish vs. draft position: ▲ beat it, ▼ fell short (e.g. drafted WR1, finished WR3 = ▼2).
function finishMove(p, S) {
  const f = S.posRank[p.player_id];
  if (!f || !p.posDrafted || f === p.posDrafted) return '';
  return f < p.posDrafted ? ` <span class="up">▲${p.posDrafted - f}</span>` : ` <span class="down">▼${f - p.posDrafted}</span>`;
}

// ---------- team draft pop-up ----------
// Each pick's grade compares its value vs. slot with every other pick in that draft (A = top, C = about average).
function openDraftTeam(season, rid) {
  const S = seasonOf(season);
  if (!S) return;
  const n = S.rids.length;
  const showGrades = LG.format !== 'dynasty';
  const later = M.seasons.filter(x => Number(x.season) > Number(S.season));
  const sincePts = pid => later.reduce((t, x) => t + (x.playerPts[pid] || 0), 0);
  const all = S.picks.map(p => p.value);
  const m = all.reduce((a, b) => a + b, 0) / all.length;
  const sdv = Math.sqrt(all.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, all.length - 1)) || 1;
  const picks = S.picks.filter(p => p.roster_id === rid).sort((a, b) => a.pick_no - b.pick_no);
  const total = picks.reduce((t, p) => t + p.value, 0);
  const teamTotals = S.rids.map(r => S.picks.filter(p => p.roster_id === r).reduce((t, p) => t + p.value, 0));
  const tm = teamTotals.reduce((a, b) => a + b, 0) / teamTotals.length;
  const tsd = Math.sqrt(teamTotals.reduce((a, b) => a + (b - tm) * (b - tm), 0) / Math.max(1, teamTotals.length - 1)) || 1;
  const teamGrade = gradeOf((total - tm) / tsd);
  const rank = teamTotals.slice().sort((a, b) => b - a).indexOf(total) + 1;
  const best = picks.filter(notKDef).sort((a, b) => b.value - a.value)[0];
  const worst = picks.filter(p => p.round < 10).sort((a, b) => a.value - b.value)[0];
  const id = S.ownerOf[rid];
  let dlg = document.getElementById('draft-modal');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'draft-modal';
    dlg.className = 'modal wide';
    dlg.setAttribute('aria-labelledby', 'draft-title');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  }
  const showSince = LG.format === 'dynasty' && later.length;
  dlg.innerHTML = `<div class="modal-card">
    <div class="line2" style="align-items:center"><h2 id="draft-title" style="font-size:18px">${name(id)} · ${S.season} draft</h2>
      <button type="button" class="close" data-close aria-label="Close">✕</button></div>
    <div class="line2" style="align-items:center;justify-content:flex-start;gap:12px">
      ${showGrades ? `<span class="grade" style="background:${GRADE_COLORS[teamGrade]}">${teamGrade}</span>` : ''}
      <span class="stack"><span style="font-size:14px">${showGrades ? ordinal(rank) + ' of ' + n + ' teams · ' : ''}<span class="${sign(total)} num">${signed(total, 0)}</span> vs. slot${S.isCurrent ? ' so far' : ''}</span>
      <span class="sub">Best: ${best ? player(best.player_id) + ' (R' + best.round + ')' : '—'} · Worst (R1–9): ${worst ? player(worst.player_id) + ' (R' + worst.round + ')' : '—'}</span></span></div>
    <div class="scroll"><table class="table"><thead><tr><th>Pick</th><th style="text-align:left">Player</th><th>Pts</th><th>Drafted</th><th>Finish</th><th>Above repl.</th>${showSince ? '<th>Since</th>' : ''}<th>vs. slot</th>${showGrades ? '<th>Grade</th>' : ''}</tr></thead><tbody>
    ${picks.map(p => { const g = gradeOf((p.value - m) / sdv);
      return `<tr><td class="rk" style="width:auto">${p.round}.${String(((p.pick_no - 1) % n) + 1).padStart(2, '0')}</td>
        <td class="t">${player(p.player_id)} <span class="note">${esc(p.pos)}</span></td>
        <td>${f1(p.pts)}</td><td style="color:#C9D3D2">${esc(p.pos)}${p.posDrafted}</td><td style="color:#C9D3D2">${S.posRank[p.player_id] ? esc(p.pos) + S.posRank[p.player_id] : '—'}${finishMove(p, S)}</td><td>${signed(p.vor, 0)}</td>
        ${showSince ? `<td style="color:#C9D3D2">${f1(sincePts(p.player_id))}</td>` : ''}<td class="${sign(p.value)}">${signed(p.value, 0)}</td>
        ${showGrades ? `<td><span class="grade sm" style="background:${GRADE_COLORS[g]}">${g}</span></td>` : ''}</tr>`; }).join('')}</tbody></table></div>
    <p class="note" style="margin:0">${showGrades ? 'Each pick is graded against every pick in the ' + S.season + ' draft: A is a standout pick for its slot, C is about what that slot usually gives, F is far below. ' : ''}vs. slot = points above a replacement-level starter at his position, minus what that pick number usually produces across this league's drafts. Misses count more early (1.5× in round 1) and less late (0.4× in the last round); hits count in full. Drafted = when his position came off the board; Finish = where he ended up.</p>
    <a class="btn" href="${mlink(id)}@${S.season}" data-close>Open ${name(id)}'s ${S.season} profile →</a>
  </div>`;
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  const c = dlg.querySelector('.close'); if (c) c.focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-draft-team]');
  if (!b) return;
  e.preventDefault();
  const [season, rid] = b.dataset.draftTeam.split(':');
  openDraftTeam(season, Number(rid));
});

// ---------- Awards history ----------
const AWARD_ORDER = ['champion', 'runnerUp', 'regSeason', 'bestMgr', 'waiver', 'trade', 'steal', 'highScore', 'luckiest', 'worstMgr', 'bust', 'unluckiest', 'blunder', 'sacko'];
function viewAwards() {
  const bySeason = M.seasons.map(S => ({ S, list: seasonAwards(S) }));
  const out = [];
  out.push(section(`<div class="eyebrow">${TROPHY(GOLD, 13)} Awards history</div>
    <h1>Every award, every year. <span class="soft">Who keeps winning, and who keeps losing.</span></h1>`, 'hero'));

  // Award cabinet: count per manager (finished seasons only).
  const cab = {};
  bySeason.filter(x => !x.S.isCurrent).forEach(({ S, list }) => list.forEach(a => {
    const id = S.ownerOf[a.rid];
    const c = cab[id] = cab[id] || { id, major: 0, good: 0, bad: 0, items: {} };
    if (a.major) c.major++; else if (a.good) c.good++; else c.bad++;
    c.items[a.k] = (c.items[a.k] || 0) + 1;
  }));
  const rows = Object.values(cab).sort((a, b) => b.major - a.major || b.good - a.good || a.bad - b.bad);
  out.push(section(`<div class="head"><h2>Award cabinet</h2><span class="note">Finished seasons</span></div>
    <div class="rows">${rows.map((c, i) => `<a class="row" href="${mlink(c.id)}" style="grid-template-columns:minmax(0,1fr) auto">
      <span class="stack"><span class="name">${name(c.id)}</span><span class="sub">${Object.keys(c.items).map(k => (c.items[k] > 1 ? c.items[k] + '× ' : '') + esc(k)).join(' · ')}</span></span>
      <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><span class="tag major">${c.major} major</span><span class="tag up">${c.good} good</span><span class="tag down">${c.bad} bad</span></span></a>`).join('')}</div>`));

  const seen = {};
  bySeason.forEach(({ list }) => list.forEach(a => { seen[a.key] = seen[a.key] || a.k.replace(' watch', ''); }));
  const awardBlock = key => {
    const entries = bySeason.map(({ S, list }) => ({ S, a: list.find(x => x.key === key) })).filter(x => x.a);
    return `<details class="calc"${key === 'champion' || key === 'sacko' ? ' open' : ''}><summary><span style="display:flex;align-items:center;gap:8px"><span class="dot" style="background:${awardColor(entries[0].a)}"></span>${esc(seen[key])}</span></summary>
      <div class="calc-body" style="padding-top:4px"><div class="rows">${entries.map(({ S, a }) => `<a class="row" href="${mlink(S.ownerOf[a.rid])}@${S.season}" style="grid-template-columns:52px minmax(0,1fr) auto">
        <span class="year">${S.season}</span><span class="stack"><span class="name" style="font-size:14px">${name(S.ownerOf[a.rid])}${S.isCurrent ? ' <span class="note">so far</span>' : ''}</span><span class="sub">${a.d}</span></span>
        <span class="num" style="font-size:14px">${a.v}</span></a>`).join('')}</div></div></details>`;
  };
  const isMajor = k => bySeason.some(({ list }) => list.some(x => x.key === k && x.major));
  const keys = AWARD_ORDER.filter(k => seen[k]);
  out.push(section(`<h2 class="major-t">Major awards</h2>${keys.filter(isMajor).map(awardBlock).join('')}`));
  out.push(section(`<h2>Season awards</h2>${keys.filter(k => !isMajor(k)).map(awardBlock).join('')}`));
  return out.join('');
}

// ---------- Stat search ----------
let lastQuery = '';
const qKey = () => 'hof-q-' + LG.leagueId;
function searchForm(id, value) {
  return `<form class="search" data-search role="search"><label class="sr" for="${id}">Ask a stat question</label>
    <input id="${id}" name="q" type="search" autocomplete="off" enterkeyhint="search" placeholder="Try: ${esc(examplesFor(M)[0])}" value="${esc(value)}">
    <button type="submit" class="go">Search</button></form>`;
}
function runQuery(q) {
  lastQuery = q;
  try { sessionStorage.setItem(qKey(), q); } catch (e) { /* private mode */ }
  if (!q.trim()) return '';
  const P = parseQuery(q, M);
  const html = answerQuery(M, P);
  if (html) return html;
  return `<div class="answer"><h2 class="ans-title">I couldn't tell what to look up.</h2>${HELP}</div>`;
}
function viewSearch() {
  try { lastQuery = sessionStorage.getItem(qKey()) || lastQuery; } catch (e) { /* ignore */ }
  return section(`<div class="eyebrow">${SEARCH_ICON} Stat search</div>
    <h1>Ask the archive. <span class="soft">Any manager, season, week or player.</span></h1>
    ${searchForm('search-q', lastQuery)}
    <div class="chips">${examplesFor(M).map(x => `<button type="button" class="chip ex" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>`, 'hero') +
    section(`<div id="results" aria-live="polite">${lastQuery ? runQuery(lastQuery) : HELP}</div>`);
}
function bindSearch() {
  document.querySelectorAll('form[data-search]').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    const q = f.q.value;
    if (location.hash !== PX + 'search') { lastQuery = q; try { sessionStorage.setItem(qKey(), q); } catch (err) { /* ignore */ } location.hash = PX.slice(1) + 'search'; return; }
    document.getElementById('results').innerHTML = runQuery(q);
  }));
  document.querySelectorAll('.chip.ex').forEach(b => b.addEventListener('click', () => {
    const input = document.getElementById('search-q');
    input.value = b.dataset.q;
    document.getElementById('results').innerHTML = runQuery(b.dataset.q);
  }));
}

// ---------- start screen ----------
const RECENT_KEY = 'hof-recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } };
function remember(entry) {
  try {
    const list = readRecent().filter(x => x.id !== entry.id);
    list.unshift(entry);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch (e) { /* storage blocked */ }
}
const leagueHref = (id, u) => '?league=' + encodeURIComponent(id) + (u ? '&u=' + encodeURIComponent(u) : '') + '#all';
const fmtLabel = l => l.teams + '-team ' + (l.superflex ? 'superflex ' : '') + l.format;

function viewStart() {
  let saved = '';
  try { saved = localStorage.getItem('hof-user') || ''; } catch (e) { /* ignore */ }
  const recent = readRecent();
  return section(`<div class="eyebrow">${MARK} ${esc(CONFIG.appName)}</div>
    <h1>Your league's hall of fame. <span class="soft">Every title, record and trade, live from Sleeper.</span></h1>
    <form class="search" id="user-form" autocomplete="off"><label class="sr" for="username">Sleeper username</label>
      <input id="username" name="username" type="text" autocapitalize="none" spellcheck="false" enterkeyhint="go" placeholder="Your Sleeper username" value="${esc(saved)}">
      <button type="submit" class="go">Find leagues</button></form>
    <p class="note" style="margin:0" id="user-status">Usernames are public on Sleeper, so no password or sign-in is needed.</p>
    ${recent.length ? `<div class="stack" style="gap:8px;padding-top:6px"><span class="note">Recently opened</span><div class="chips">${recent.map(r => `<a class="chip" style="text-decoration:none" href="${leagueHref(r.id, r.u)}">${esc(r.name)}</a>`).join('')}</div></div>` : ''}`, 'hero') +
    section(`<div id="league-list"><p class="lead">Enter a username to see that account's leagues from this season and last. Pick one to open its hall of fame. Every page has a link you can share with the league.</p></div>`);
}

async function showLeagues(username) {
  const $list = document.getElementById('league-list');
  const $status = document.getElementById('user-status');
  $status.textContent = 'Looking up ' + username + '…';
  try {
    const user = await lookupUser(username);
    if (!user || !user.user_id) { $status.textContent = `No Sleeper account named "${username}". Check the spelling and try again.`; $list.innerHTML = ''; return; }
    try { localStorage.setItem('hof-user', user.username || username); } catch (e) { /* ignore */ }
    const state = await nflState();
    const leagues = await userLeagues(user.user_id, state.season);
    $status.textContent = (user.display_name || username) + ' · ' + leagues.length + ' league' + (leagues.length === 1 ? '' : 's');
    if (!leagues.length) { $list.innerHTML = `<p class="lead">No football leagues for ${esc(user.display_name || username)} in ${state.season} or ${Number(state.season) - 1}.</p>`; return; }
    const u = user.username || username;
    $list.innerHTML = `<h2>Pick a league</h2><div class="rows">${leagues.map(l => `<a class="row" data-league="${esc(l.id)}" data-name="${esc(l.name)}" href="${leagueHref(l.id, u)}" style="grid-template-columns:minmax(0,1fr) auto">
      <span class="stack"><span class="name">${esc(l.name)}</span><span class="sub">${l.season} · ${esc(fmtLabel(l))}${l.status === 'in_season' ? ' · in season' : l.status === 'complete' ? ' · complete' : ''}</span></span>
      <span class="note">Open →</span></a>`).join('')}</div>`;
    $list.querySelectorAll('a[data-league]').forEach(a => a.addEventListener('click', () => remember({ id: a.dataset.league, name: a.dataset.name, u })));
  } catch (e) {
    $status.textContent = "Couldn't reach Sleeper. Check your connection and try again.";
  }
}

function bindStart() {
  const f = document.getElementById('user-form');
  f.addEventListener('submit', e => { e.preventDefault(); const v = f.username.value.trim(); if (v) showLeagues(v); });
  if (f.username.value.trim()) showLeagues(f.username.value.trim());
}

// ---------- routing ----------
function parse(h) {
  if (/^s\d{4}$/.test(h) && seasonOf(h.slice(1))) return { view: 'season', season: h.slice(1) };
  if (h.indexOf('m-') === 0) { const p = h.slice(2).split('@'); return { view: 'manager', id: p[0], season: p[1] || null }; }
  if (h === 'search') return { view: 'search' };
  if (h === 'awards') return { view: 'awards' };
  if (h === 'matchups' || h.indexOf('matchups@') === 0) return { view: 'matchups', season: h.split('@')[1] || null };
  if (h === 'playoffs') return { view: 'playoffs' };
  if (h === 'drafts' || h.indexOf('drafts@') === 0) return { view: 'drafts', season: h.split('@')[1] || null };
  if (h.indexOf('vs-') === 0) { const p = h.slice(3).split('~'); return { view: 'compare', a: p[0], b: p[1] }; }
  return { view: 'all' };
}

function describe(m, lg) {
  const cur = m.seasons[0];
  if (!cur) return lg.name;
  const sf = cur.slots && cur.slots.indexOf('SUPER_FLEX') >= 0 ? 'superflex ' : '';
  return cur.rids.length + '-team ' + sf + lg.format;
}

let lastRoute = '';
function render() {
  const rest = decodeURIComponent(location.hash.replace(/^#/, ''));
  const route = parse(rest);
  const suffix = ' · ' + LG.name + ' Hall of Fame';
  stopLive();
  renderTabs(route);
  if (route.view === 'season') {
    const S = seasonOf(route.season);
    const v = viewSeason(S);
    $app.innerHTML = v.html;
    bindPowerLegend(S, v.defaultHL);
    if (v.liveWeek && v.liveWeek > S.scoredThrough) startLive(S, v.liveWeek);
    document.title = S.season + suffix;
  } else if (route.view === 'manager') {
    $app.innerHTML = viewManager(route.id, route.season);
    document.title = M.nameOf(route.id) + suffix;
  } else if (route.view === 'search') {
    $app.innerHTML = viewSearch();
    bindSearch();
    document.title = 'Stat search' + suffix;
  } else if (route.view === 'drafts') {
    $app.innerHTML = viewDrafts(route.season);
    document.title = 'Drafts' + suffix;
  } else if (route.view === 'playoffs') {
    $app.innerHTML = viewPlayoffs();
    document.title = 'Playoffs' + suffix;
  } else if (route.view === 'matchups') {
    $app.innerHTML = viewMatchups(route.season);
    document.title = 'Matchup history' + suffix;
  } else if (route.view === 'awards') {
    $app.innerHTML = viewAwards();
    document.title = 'Awards' + suffix;
  } else if (route.view === 'compare') {
    $app.innerHTML = viewCompare(route.a, route.b);
    bindCompare();
    document.title = 'Compare' + suffix;
  } else {
    $app.innerHTML = viewAll();
    bindSearch();
    document.title = LG.name + ' Hall of Fame';
  }
  const key = location.hash.split('@')[0];
  if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
}

// ---------- refresh button ----------
const $refresh = document.getElementById('refresh');
function setRefresh(state) {
  if (!$refresh) return;
  const label = $refresh.querySelector('.refresh-label');
  $refresh.hidden = false;
  $refresh.disabled = state === 'busy';
  $refresh.classList.toggle('spin', state === 'busy');
  label.textContent = state === 'busy' ? 'Refreshing…' : state === 'error' ? 'Try again' : 'Refresh';
  $refresh.title = state === 'done' ? 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · pull everything from Sleeper again' : 'Pull everything from Sleeper again';
}

async function start() {
  const leagueId = params.get('league');
  const username = params.get('u') || '';
  if (!leagueId) {
    document.body.classList.add('start');
    $leagues.innerHTML = '';
    document.getElementById('meta').textContent = 'Any Sleeper league';
    document.title = CONFIG.appName;
    $app.innerHTML = viewStart();
    bindStart();
    return;
  }
  const $status = document.getElementById('status');
  try {
    const info = await leagueInfo(leagueId);
    if (!info) throw new Error('Sleeper has no league with that ID.');
    LG = { key: 'main', name: info.name, leagueId, username, format: info.format };
    if ($status) $status.textContent = 'Loading ' + info.name + ' from Sleeper…';
    const data = await loadAll(LG, msg => { const el = document.getElementById('status'); if (el) el.textContent = msg; });
    M = buildModel(data, LG.format);
    M.px = PX;
    M.league = LG;
    LG.name = (data.seasons[0] && data.seasons[0].name) || info.name;
    remember({ id: leagueId, name: LG.name, u: username });
    document.getElementById('meta').textContent = describe(M, LG);
    $leagues.className = 'league-bar';
    $leagues.innerHTML = `<span class="league-name">${esc(LG.name)}</span><a class="switch" href="./">Switch league</a>`;
    window.addEventListener('hashchange', render);
    render();
    setRefresh('idle');
    if ($refresh) $refresh.addEventListener('click', async () => {
      setRefresh('busy');
      clearSavedSeasons();
      const y = window.scrollY;
      try {
        const fresh = await loadAll(LG, () => {});
        M = buildModel(fresh, LG.format);
        M.px = PX;
        M.league = LG;
        document.getElementById('meta').textContent = describe(M, LG);
        render();
        window.scrollTo(0, y);
        setRefresh('done');
      } catch (err) { setRefresh('error'); }
    });
  } catch (e) {
    $app.innerHTML = `<div class="wrap status err">Couldn't load that league from Sleeper. Check the link, or <a href="./">pick a league again</a>.<br><span class="note">${esc(e.message)}</span></div>`;
  }
}
start();
