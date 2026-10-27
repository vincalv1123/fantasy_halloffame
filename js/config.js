// Settings shared by every league. The league itself comes from the page address
// (?league=<id>&u=<username>), chosen on the start screen.
export const CONFIG = {
  appName: 'Sleeper Hall of Fame',

  // Manager Score weights (must add up to 1). Dynasty leagues leave out the draft part.
  weights: { results: 0.35, startSit: 0.20, waivers: 0.15, trades: 0.20, draft: 0.10 },

  // Bonus points added to the Results part of the score.
  bonus: { playoffs: 3, final: 5, title: 10 },

  // How often the live tab refreshes scores while open (seconds).
  liveRefreshSeconds: 60,

  // Simulated seasons for playoff and title odds.
  simulations: 10000
};
