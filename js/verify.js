/* LEXIS — verify.js (evaluation page only)
 * The live-number standard (r2 handpicked, Victor): a claim the reader cannot re-run is an appeal
 * to authority. This lets the evaluation page enumerate the state space in front of the reader,
 * on their own device, using the very same shipped pure core (window.LEXIS.render). No network,
 * no telemetry — arithmetic in the open.
 */
(function (global) {
  'use strict';
  function boot() {
    var btn = document.getElementById('verify-run');
    var out = document.getElementById('verify-out');
    if (!btn || !out || !global.LEXIS) return;
    btn.addEventListener('click', function () {
      var L = global.LEXIS, N = L.N;
      function foot(g) {
        var s = '';
        for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) s += g[r][c].k + ':' + g[r][c].v + '|';
        return s;
      }
      /* breadth-first BY LENGTH, so "new at length N" honestly means: states no shorter line
       * can say (a DFS discovery order would misattribute short states to long detours) */
      function countUpTo(ids, depth) {
        var seen = {}, perDepth = [], total = 0;
        for (var len = 1; len <= depth; len++) {
          var news = 0;
          (function rec(seq) {
            if (seq.length === len) {
              var fr = L.render(seq), key = foot(fr[fr.length - 1]);
              if (!seen[key]) { seen[key] = 1; total++; news++; }
              return;
            }
            for (var i = 0; i < ids.length; i++) { seq.push(ids[i]); rec(seq); seq.pop(); }
          })([]);
          perDepth[len - 1] = news;
        }
        return { total: total, perDepth: perDepth };
      }
      /* alternate keyings for the ablation claims: ignore kind (position-only) or ignore fading */
      function countKeyed(ids, depth, keyFn) {
        var seen = {}, total = 0;
        (function rec(seq, d) {
          if (seq.length > 0) {
            var fr = L.render(seq), key = keyFn(fr[fr.length - 1]);
            if (!seen[key]) { seen[key] = 1; total++; }
          }
          if (d === 0) return;
          for (var i = 0; i < ids.length; i++) { seq.push(ids[i]); rec(seq, d - 1); seq.pop(); }
        })([], depth);
        return total;
      }
      function posFoot(g) { var s = ''; for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) s += (g[r][c].k === '' ? '0' : '1'); return s; }
      function kFoot(g) { var s = ''; for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) s += g[r][c].k + '|'; return s; }
      var ALL = ['dot', 'bar', 'ring', 'wave', 'spread', 'fold', 'chain'];
      var t0 = (global.performance && performance.now) ? performance.now() : 0;
      var all = countUpTo(ALL, 4);
      var noSpread = countUpTo(['dot', 'bar', 'ring', 'wave', 'fold', 'chain'], 4);
      var posOnly = countKeyed(ALL, 4, posFoot);
      var kindNoFade = countKeyed(ALL, 4, kFoot);
      /* spread-injectivity, checked here too: all four marks must spread distinctly */
      var feet = {}, inj = 0;
      ['dot', 'bar', 'ring', 'wave'].forEach(function (m) {
        var g = L.render([m, 'spread'])[0], f = foot(g);
        if (!feet[f]) { feet[f] = 1; inj++; }
      });
      var ms = t0 ? Math.round(((performance.now() - t0)) * 10) / 10 : null;
      var lines = [];
      lines.push('distinct settled states, all 7 glyphs, lines of length ≤ 4:');
      for (var d = 0; d < 4; d++) lines.push('  new at length ' + (d + 1) + ': ' + (all.perDepth[d] || 0));
      lines.push('  total: ' + all.total + (all.total === 651 ? '   (matches the printed claim)' : '   (DOES NOT match the printed 651 — the claim is wrong or the code changed)'));
      lines.push('');
      lines.push('without the spread operator: ' + noSpread.total
        + '   (' + Math.round((1 - noSpread.total / all.total) * 1000) / 10 + '% of the space depends on it)');
      lines.push('ignoring the marks’ kinds (shape only): ' + posOnly
        + '   (' + Math.round((1 - posOnly / all.total) * 1000) / 10 + '% of the space is carried by kind)');
      lines.push('counting kind but not the fading tiers: ' + kindNoFade
        + '   (' + (all.total - kindNoFade) + ' states differ only by intensity)');
      lines.push('all four marks spread distinctly: ' + (inj === 4 ? 'yes (4 of 4)' : 'NO — ' + inj + ' of 4'));
      if (ms !== null) lines.push('');
      if (ms !== null) lines.push('computed on this device in ' + ms + ' ms, by the same code that runs the field.');
      out.textContent = lines.join('\n');
      out.hidden = false;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
