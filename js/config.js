// Settings shared by every league. The league itself comes from the page address
// (?league=<id>&u=<username>), chosen on the start screen.
export const CONFIG = {
  appName: 'Sleeper Hall of Fame',

  // Manager Score weights (must add up to 1). Dynasty leagues leave out the draft part.
  weights: { results: 0.35, startSit: 0.20, waivers: 0.15, trades: 0.20, draft: 0.10 },

  // Redraft draft grades: share of each pick's expected value that comes from hindsight
  // (the Nth-best player's value that season for the Nth pick). The rest comes from what
  // that slot has produced across the league's drafts. 0 = slot history only.
  draftHindsight: 0.3,

  // Kickers and defenses count for this share of their value in waiver, trade and draft numbers
  // (they're easy to replace and swing week to week). 1 = full value.
  kDefWeight: 0.5,

  // Bonus points added to the Results part of the score.
  bonus: { playoffs: 3, final: 5, title: 10 },

  // How often the live tab refreshes scores while open (seconds).
  liveRefreshSeconds: 60,

  // Simulated seasons for playoff and title odds.
  simulations: 10000
};
