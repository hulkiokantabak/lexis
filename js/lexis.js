/* LEXIS — lexis.js
 * The language: glyph definitions, a PURE deterministic evaluator render(sequence) -> frames of a
 * 5x5 typed-cell grid (text is the source of truth; the DOM is a view), the two ARIA live regions,
 * a drag-free keyboard model, and the URL-hash fossil. No network. Depends only on LEXIS_ENGINE.
 *
 * Design law (docs/DECISIONS ADR-006/007):
 *  - marks (dot/bar/ring/wave) place a body into the next cell along a fixed centre-out path;
 *  - spread and fold are functions of the CURRENT field and compose on the RESULTS of operators:
 *      spread — each filled cell propagates one step into its KIND-SPECIFIC neighbourhood;
 *      fold   — reflect the field left<->right, union overlay (kind-agnostic, the reliable one);
 *  - chain is NOT a field function: it is a span separator — the settled state of "A chain B" is
 *    the state of B alone; chain's whole payload is temporal (the morph + the two-beat narration);
 *  - a no-op is an honest answer, never an error; nothing is withheld; no goal, score, or counter.
 */
(function (global) {
  'use strict';
  /* JS is alive: reveal the interactive controls the no-js stylesheet hides */
  try { document.documentElement.className = document.documentElement.className.replace(/\bno-js\b/, ''); } catch (e) {}
  var E = global.LEXIS_ENGINE;
  var N = 5, PATHLEN = N * N, MAXLEN = 12;

  /* ============================ glyph table ============================ */
  /* Accessible names are NEUTRAL PERCEPTUAL identity only — never the meaning. Discovering what a
   * glyph does is the whole piece; leaking it in a label hands the grammar away. */
  var GLYPHS = {
    dot:  { kind: 'mark', name: 'dot',  cell: '●' },   /* ● */
    bar:  { kind: 'mark', name: 'bar',  cell: '▬' },   /* ▬ */
    ring: { kind: 'mark', name: 'ring', cell: '○' },   /* ○ */
    wave: { kind: 'mark', name: 'wave', cell: '≈' },   /* ≈ */
    spread: { kind: 'op', name: 'rays' },
    fold:   { kind: 'op', name: 'bracket' },
    chain:  { kind: 'op', name: 'arrow' }
  };
  var MARKS = ['dot', 'bar', 'ring', 'wave'];
  /* own-key check: guards against Object.prototype keys (constructor, __proto__, toString…)
   * arriving via the URL hash and being treated as glyph ids. */
  function isGlyph(id) { return Object.prototype.hasOwnProperty.call(GLYPHS, id); }
  var SVG = {
    dot:  '<circle cx="24" cy="24" r="9" fill="currentColor"/>',
    bar:  '<rect x="7" y="19" width="34" height="10" rx="3" fill="currentColor"/>',
    ring: '<circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" stroke-width="6"/>',
    wave: '<path d="M6 27 q6 -13 12 0 t12 0 t12 0" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
    /* Operators carry NO accent: the one teal is reserved for the settle moment alone (panel r2
     * ruling — the op-tick was the single accent smuggled onto the language surface). Operators
     * read as a different family via open silhouette, lighter stroke, dashed tile, and the tray. */
    spread: '<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M24 22V9"/><path d="M24 26v13"/><path d="M22 24H9"/><path d="M26 24h13"/></g>',
    fold: '<line x1="24" y1="7" x2="24" y2="41" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M18 13 q-9 11 0 22 M30 13 q9 11 0 22" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
    chain: '<circle cx="11" cy="24" r="4.5" fill="currentColor"/><line x1="17" y1="24" x2="33" y2="24" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M30 18l6 6-6 6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  function glyphSVG(id) {
    return '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">' + SVG[id] + '</svg>';
  }

  /* ============================ placement path ============================ */
  /* centre-out: order all cells by (Chebyshev distance, then ORTHOGONAL-before-diagonal, then
   * angle measured FROM THE RIGHT, clockwise). Deterministic, radial, predictable — the
   * orthogonal-first tie-break makes "the next cell outward" literally an adjacent cell
   * (playtest r1 #5), and starting each ring at the RIGHT keeps the second mark OFF the fold
   * axis, so the most natural first fold test visibly mirrors instead of answering a no-op
   * (chair's live-driving find, r2: up-first put mark #2 on the mirror column). */
  function buildPath() {
    var TAU = Math.PI * 2;
    var mid = (N - 1) / 2, cells = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var dr = r - mid, dc = c - mid;
      var diag = (dr !== 0 && dc !== 0) ? 1 : 0;
      var a = ((Math.atan2(dr, dc) % TAU) + TAU) % TAU;   /* [0, 2pi): right, down, left, up */
      cells.push({ r: r, c: c, d: Math.max(Math.abs(dr), Math.abs(dc)), diag: diag, a: a });
    }
    cells.sort(function (p, q) { return p.d - q.d || p.diag - q.diag || p.a - q.a; });
    return cells.map(function (p) { return [p.r, p.c]; });
  }
  var PATH = buildPath();

  /* ============================ the pure evaluator ============================ */
  function emptyGrid() {
    var g = [];
    for (var r = 0; r < N; r++) { g[r] = []; for (var c = 0; c < N; c++) g[r][c] = { k: '', v: 0 }; }
    return g;
  }
  function cloneGrid(g) {
    var o = [];
    for (var r = 0; r < N; r++) { o[r] = []; for (var c = 0; c < N; c++) o[r][c] = { k: g[r][c].k, v: g[r][c].v }; }
    return o;
  }
  function inBounds(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }

  function neighboursFor(kind, r, c) {
    if (kind === 'dot')  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];       /* orthogonal diamond */
    if (kind === 'bar')  return [[r, c - 1], [r, c + 1]];                                 /* horizontal only */
    if (kind === 'ring') return [[r - 1, c - 1], [r - 1, c + 1], [r + 1, c - 1], [r + 1, c + 1]]; /* diagonal X */
    return [];                                                                            /* wave: handled by flood */
  }

  /* spread: each filled cell proposes filling its kind-specific EMPTY neighbours at v-1
   * (wave floods the connected empty region with a distance gradient). Non-destructive: only
   * empty cells are filled. Proposals resolved by max-v, tie-break by kind priority. */
  function spread(g) {
    var out = cloneGrid(g), prop = {};
    function propose(r, c, v, kind) {
      if (!inBounds(r, c) || v <= 0 || g[r][c].k !== '') return;
      var key = r + ',' + c, cur = prop[key];
      if (!cur || v > cur.v || (v === cur.v && MARKS.indexOf(kind) < MARKS.indexOf(cur.kind))) prop[key] = { v: v, kind: kind };
    }
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var cell = g[r][c];
      if (cell.k === '' || cell.v <= 0) continue;
      if (cell.k === 'wave') {
        /* BFS flood over connected empties; v decays with distance */
        var seen = {}, q = [[r, c, cell.v]];
        seen[r + ',' + c] = true;
        while (q.length) {
          var cur = q.shift(), cr = cur[0], cc = cur[1], cv = cur[2];
          var orth = [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]];
          for (var i = 0; i < orth.length; i++) {
            var nr = orth[i][0], nc = orth[i][1], key = nr + ',' + nc;
            if (!inBounds(nr, nc) || seen[key] || g[nr][nc].k !== '') continue;
            seen[key] = true;
            if (cv - 1 > 0) { propose(nr, nc, cv - 1, 'wave'); q.push([nr, nc, cv - 1]); }
          }
        }
      } else {
        var nb = neighboursFor(cell.k, r, c);
        for (var j = 0; j < nb.length; j++) propose(nb[j][0], nb[j][1], cell.v - 1, cell.k);
      }
    }
    for (var key in prop) if (prop.hasOwnProperty(key)) {
      var p = key.split(','), pr = +p[0], pc = +p[1];
      out[pr][pc] = { k: prop[key].kind, v: prop[key].v };
    }
    return out;
  }

  /* fold: reflect across the vertical axis and union (higher v wins; tie-break by kind priority,
   * side-independent, so the result is genuinely symmetric and fold is idempotent on it). */
  function foldGrid(g) {
    function pick(a, b) {
      if (a.v !== b.v) return a.v > b.v ? a : b;
      if (a.k === '' && b.k !== '') return b;
      if (b.k === '' && a.k !== '') return a;
      if (a.k === b.k) return a;
      return MARKS.indexOf(a.k) <= MARKS.indexOf(b.k) ? a : b;
    }
    var out = cloneGrid(g);
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var w = pick(g[r][c], g[r][N - 1 - c]);
      out[r][c] = { k: w.k, v: w.v };
    }
    return out;
  }

  /* evaluate a span (marks + spread/fold only) into one grid */
  function evalSpan(tokens) {
    var g = emptyGrid(), m = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], def = GLYPHS[t];
      if (!def) continue;
      if (def.kind === 'mark') { var p = PATH[m % PATHLEN]; g[p[0]][p[1]] = { k: t, v: 3 }; m++; }
      else if (t === 'spread') g = spread(g);
      else if (t === 'fold') g = foldGrid(g);
    }
    return g;
  }

  /* render(sequence) -> frames[]: split on `chain` into spans, each evaluated independently.
   * The settled state is the LAST frame. Pure and deterministic. */
  function render(seqArr) {
    var spans = [[]];
    for (var i = 0; i < seqArr.length; i++) {
      if (seqArr[i] === 'chain') spans.push([]);
      else spans[spans.length - 1].push(seqArr[i]);
    }
    return spans.map(evalSpan);
  }

  function gridsEqual(a, b) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++)
      if (a[r][c].k !== b[r][c].k || a[r][c].v !== b[r][c].v) return false;
    return true;
  }
  function filledCount(g) {
    var n = 0;
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (g[r][c].k !== '') n++;
    return n;
  }

  /* ============================ narration (the screen-reader truth) ============================ */
  var ROWW = ['top', 'upper', 'middle', 'lower', 'bottom'];
  var COLW = ['far-left', 'left', 'centre', 'right', 'far-right'];
  function posWord(r, c) {
    if (r === 2 && c === 2) return 'the centre';
    return ROWW[r] + ' ' + COLW[c];
  }
  function gridRows(g) {
    var lines = [];
    for (var r = 0; r < N; r++) {
      var cells = [];
      for (var c = 0; c < N; c++) cells.push(g[r][c].k === '' ? 'empty' : GLYPHS[g[r][c].k].name);
      lines.push('Row ' + (r + 1) + ': ' + cells.join(', ') + '.');
    }
    return lines.join(' ');
  }
  function fullReadText(g) { return 'A five by five field. ' + gridRows(g); }
  function isEmptyGridState(g) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (g[r][c].k !== '') return false;
    return true;
  }
  function framesText(frames) {
    if (frames.length === 1) return fullReadText(frames[0]);
    /* a trailing arrow leaves the second span UNSAID — an honest state, not an erasure; saying
     * so prevents the plausible wrong rule "the arrow deletes everything" from sitting
     * uncorrected (playtest r4) */
    var lastEmpty = isEmptyGridState(frames[frames.length - 1]);
    if (frames.length === 2) {   /* the two-beat form, so the before->after of chain reads in audio */
      return 'A field of five by five that changes. Before the arrow: ' + gridRows(frames[0])
           + (lastEmpty ? ' After the arrow, nothing is said yet.'
                        : ' After the arrow, it becomes: ' + gridRows(frames[1]));
    }
    var parts = frames.map(function (f, i) {
      if (i === frames.length - 1 && lastEmpty) return 'State ' + (i + 1) + ': nothing is said yet.';
      return 'State ' + (i + 1) + ': ' + gridRows(f);
    });
    return 'A sequence of ' + frames.length + ' states, five by five, each becoming the next. ' + parts.join(' ');
  }
  function diffText(prev, next) {
    var changes = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var a = prev[r][c], b = next[r][c];
      if (a.k !== b.k) {
        changes.push(b.k === '' ? posWord(r, c) + ' is now empty'
                                : posWord(r, c) + ' is now ' + GLYPHS[b.k].name);
      } else if (a.k !== '' && a.v !== b.v) {
        /* intensity is real evaluator state; a v-only change must be speakable (r5 logic audit) */
        changes.push(posWord(r, c) + (b.v > a.v ? ' grew' : ' faded'));
      }
    }
    if (changes.length === 0) return null;              /* an honest no-op */
    if (changes.length > 6) return null;                /* too many — caller falls back to full read */
    var s = changes.join('; ');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }

  /* ============================ the view ============================ */
  var seq = [], prevGrid = emptyGrid(), morphTimer = null, narrateTimer = null, hashTimer = null;
  var lastFocusLine = -1;
  var el = {};

  function $(id) { return document.getElementById(id); }

  function buildPalette() {
    function makeGroup(ids, groupLabel, rowClass) {
      var frag = document.createDocumentFragment();
      ids.forEach(function (id) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'glyph glyph--' + GLYPHS[id].kind + (GLYPHS[id].kind === 'op' ? ' glyph--op' : '');
        b.setAttribute('data-glyph', id);
        b.setAttribute('aria-label', GLYPHS[id].name);
        b.setAttribute('title', GLYPHS[id].name);   /* the shape's name on hover — the ear always had it */
        b.setAttribute('tabindex', '-1');
        b.innerHTML = glyphSVG(id);
        frag.appendChild(b);
      });
      var wrap = document.createElement('div');
      wrap.className = 'palette__row ' + rowClass;
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', groupLabel);
      wrap.appendChild(frag);
      return wrap;
    }
    el.palette.appendChild(makeGroup(MARKS, 'marks', 'palette__row--marks'));
    el.palette.appendChild(makeGroup(['spread', 'fold', 'chain'], 'operators', 'palette__row--ops'));
    /* roving tabindex: first glyph is the single tab stop */
    var first = el.palette.querySelector('.glyph');
    if (first) first.setAttribute('tabindex', '0');
  }

  function paletteButtons() { return Array.prototype.slice.call(el.palette.querySelectorAll('.glyph')); }
  function lineButtons() { return Array.prototype.slice.call(el.line.querySelectorAll('.tile')); }

  function renderLine() {
    el.line.innerHTML = '';
    if (seq.length === 0) {
      var empty = document.createElement('span');
      empty.className = 'line__empty';
      empty.textContent = 'the line is empty';
      el.line.appendChild(empty);
      return;
    }
    seq.forEach(function (id, i) {
      var t = document.createElement('button');
      t.type = 'button';
      t.className = 'tile tile--' + GLYPHS[id].kind + (id === 'chain' ? ' tile--split' : '');
      t.setAttribute('data-index', String(i));
      t.setAttribute('data-glyph', id);
      t.setAttribute('aria-label', GLYPHS[id].name + ', position ' + (i + 1) + ' of ' + seq.length);
      t.setAttribute('title', GLYPHS[id].name);
      t.setAttribute('tabindex', i === Math.min(lastFocusLine, seq.length - 1) ? '0' : '-1');
      t.innerHTML = glyphSVG(id);
      el.line.appendChild(t);
    });
    if (lineButtons().length && !el.line.querySelector('[tabindex="0"]')) lineButtons()[0].setAttribute('tabindex', '0');
  }

  /* paintGrid: cells carry real glyph DRAWINGS (glyphSVG), not unicode chars, so marks stay
   * themselves at every size and match the palette/filmstrip (r2 handpicked, Albers/Victor).
   * Change detection is attribute-compare (data-k/data-v), so repainting an identical state
   * touches zero cells. Falloff is SCALE on the inner svg, never colour: full size plus exactly
   * two reduced tiers — never more; further steps would read as a value gradient. tierFn
   * optionally overrides the stagger order (fold pulses outward from its axis; default is
   * propagation tier by v). */
  function paintGrid(g, animate, tierFn) {
    var changed = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var cell = el.cells[r][c], data = g[r][c];
      if (cell.getAttribute('data-k') !== data.k || cell.getAttribute('data-v') !== String(data.v)) {
        cell.innerHTML = data.k === '' ? '' : glyphSVG(data.k);
        cell.setAttribute('data-k', data.k);
        cell.setAttribute('data-v', String(data.v));
        if (animate) changed.push([cell, data.v, r, c]);
      }
    }
    if (animate && changed.length) {
      /* one forced reflow on the container restarts the settle animation for all changed cells.
       * The settle EMPHASIS travels outward (default: v=3 sources first, then v=2, then v=1) so
       * an operator's reach reads ring-by-ring — the state itself still paints in the same
       * synchronous frame (first-frame law); only the pulse is staggered. */
      for (var i = 0; i < changed.length; i++) {
        changed[i][0].classList.remove('cell--settling');
        changed[i][0].style.animationDelay = '';
      }
      void el.grid.offsetWidth;
      for (var j = 0; j < changed.length; j++) {
        var v = changed[j][1], tier;
        if (tierFn) tier = tierFn(changed[j][2], changed[j][3], v);
        else { tier = v >= 3 ? 0 : v === 2 ? 1 : 2; if (v === 0) tier = 2; }
        changed[j][0].style.animationDelay = (tier * 70) + 'ms';
        changed[j][0].classList.add('cell--settling');
      }
    }
  }

  /* reduced-motion chain: a static filmstrip of labelled stills, so nothing is lost when the
   * morph cannot play. Built only when needed; the single grid is hidden while it shows. */
  function renderFilmstrip(frames) {
    el.film.innerHTML = '';
    frames.forEach(function (g, fi) {
      if (fi > 0) { var ar = document.createElement('span'); ar.className = 'film__arrow'; ar.textContent = '→'; ar.setAttribute('aria-hidden', 'true'); el.film.appendChild(ar); }
      var wrap = document.createElement('div');
      wrap.className = 'film__frame';
      var lab = document.createElement('span'); lab.className = 'film__label'; lab.textContent = String(fi + 1); lab.setAttribute('aria-hidden', 'true');
      var mini = document.createElement('div'); mini.className = 'mini';
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
        var d = document.createElement('span'); d.className = 'cell cell--mini';
        d.setAttribute('data-k', g[r][c].k); d.setAttribute('data-v', String(g[r][c].v));
        /* real glyph drawings, not unicode chars — at mini size the chars blur into identical
         * grey dots, and the filmstrip serves exactly the reduced-motion reader who most needs
         * the shapes to stay themselves (panel r2, Visual Arts). */
        if (g[r][c].k !== '') d.innerHTML = glyphSVG(g[r][c].k);
        mini.appendChild(d);
      }
      wrap.appendChild(lab); wrap.appendChild(mini); el.film.appendChild(wrap);
    });
    el.grid.hidden = true; el.film.hidden = false;
  }
  function showSingleGrid() { el.film.hidden = true; el.grid.hidden = false; }

  /* showFrames(frames, animate, opts): opts.onFinal fires exactly when the SETTLED state has
   * painted — causal, never a tuned delay (r2 handpicked, Norman's ruling) — so the settle tone
   * sounds at the truth, not at the edit. opts.tierFn overrides the stagger order. */
  function showFrames(frames, animate, opts) {
    opts = opts || {};
    /* re-entrancy: any edit mid-morph lands here first and kills the stale timer, so a stale
     * chain-step can never fire against a mutated seq (verified + closed, panel r2 Game Design) */
    if (morphTimer) { clearTimeout(morphTimer); morphTimer = null; }
    var last = frames[frames.length - 1];
    if (frames.length === 1) {
      showSingleGrid(); paintGrid(frames[0], animate, opts.tierFn);
      if (opts.onFinal) opts.onFinal(last);
      return;
    }
    if (E.Motion.reduced) {                                            /* reduced motion: stills */
      renderFilmstrip(frames);
      if (opts.onFinal) opts.onFinal(last);
      return;
    }
    showSingleGrid();
    if (!E.Motion.shouldAnimate()) {                                   /* tab hidden: jump to end */
      paintGrid(last, animate, opts.tierFn);
      if (opts.onFinal) opts.onFinal(last);
      return;
    }
    var i = 0;
    paintGrid(frames[0], true);
    function step() {
      i++;
      paintGrid(frames[i], true, i === frames.length - 1 ? opts.tierFn : null);
      if (i >= frames.length - 1) {
        morphTimer = null;   /* cleared as the last frame paints, so the scrub is live immediately */
        if (opts.onFinal) opts.onFinal(frames[i]);
        return;
      }
      morphTimer = setTimeout(step, 680);
    }
    /* the FIRST transition is scheduled, never synchronous — otherwise a two-span chain paints
     * its before-state and instantly overwrites it, and the "time" operator never shows time
     * (r5 audit, bug-fix + gameplay convergence) */
    morphTimer = setTimeout(step, 680);
  }

  function announce(region, text) { region.textContent = ''; /* force re-read */ region.textContent = text; }

  /* ============================ the visible answer ============================
   * The meaning of every act, in words, under the field — the same words the screen reader has
   * always heard. Added when the author's first real look (the human gate) found that "the
   * meaning does not appear anywhere": it did, but only in the ear channel. Not instruction —
   * the answer to an act already taken, in the piece's own descriptive voice. */
  var answerAtRest = 'Every arrangement is answered.';
  function setAnswer(text) { answerAtRest = text; if (el.answer) el.answer.textContent = text; }
  function overlayAnswer(text) { if (el.answer) el.answer.textContent = text; }      /* transient (preview) */
  function restoreAnswer() { if (el.answer) el.answer.textContent = answerAtRest; }
  function kindSummary(g) {
    var counts = {}, order = ['dot', 'bar', 'ring', 'wave'], total = 0;
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var k = g[r][c].k;
      if (k !== '') { counts[k] = (counts[k] || 0) + 1; total++; }
    }
    if (total === 0) return 'The field is empty.';
    var parts = [];
    for (var i = 0; i < order.length; i++) {
      var k2 = order[i], n = counts[k2];
      if (n) parts.push(n + ' ' + GLYPHS[k2].name + (n > 1 ? 's' : ''));
    }
    return 'The field now holds ' + parts.join(', ') + '.';
  }
  function visibleAnswer(prev, settled, frames, changed, opts) {
    if (frames.length > 1) {
      return isEmptyGridState(settled) ? 'After the arrow, nothing is said yet.'
                                       : 'One state becomes the next.';
    }
    if (!changed && opts.userEdit) return 'Nothing changed.';
    var d = diffText(prev, settled);
    return d || kindSummary(settled);
  }

  /* the settle PITCH is a pure function of the settled state (a small hash of its footprint):
   * the same field always answers with the same tone — determinism made audible. The old
   * monotonic settleCount was deleted (r2 handpicked, Cage: "an answer that differs each time
   * you ask is a lie"); pitch never encodes magnitude, count, or praise. */
  function pitchOf(g) {
    var h = 0;
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var cell = g[r][c];
      if (cell.k !== '') h = (h * 31 + (r * N + c + 1) * (MARKS.indexOf(cell.k) + 2) + cell.v) % 9973;
    }
    return h;
  }
  /* symmetry is a structural FACT of the settled state; a symmetric field answers as a dyad at
   * equal total energy — reported, never rewarded (r2 handpicked, adopted 6-1). */
  function isSymmetric(g) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      if (g[r][c].k !== g[r][N - 1 - c].k || g[r][c].v !== g[r][N - 1 - c].v) return false;
    }
    return true;
  }

  function update(opts) {
    opts = opts || {};
    endPreview();                                  /* an edit always returns the grid to the truth */
    if (seq.length > MAXLEN) seq = seq.slice(0, MAXLEN);
    var frames = render(seq);
    var settled = frames[frames.length - 1];
    var changed = !gridsEqual(prevGrid, settled);

    renderLine();
    /* fold pulses outward from its axis (|c-2|); everything else by propagation tier */
    var tierFn = (changed && seq.length && seq[seq.length - 1] === 'fold')
      ? function (r, c) { return Math.min(2, Math.abs(c - 2)); } : null;
    showFrames(frames, true, {
      tierFn: tierFn,
      onFinal: changed ? function (g) {
        if (E.Audio.enabled) E.Audio.settle(pitchOf(g), isSymmetric(g));
      } : null
    });

    /* sound for the ACT (immediate); the settle answers at the truth, via onFinal above */
    if (E.Audio.enabled) {
      if (opts.placed) E.Audio.place();
      else if (opts.removed) E.Audio.lift();
      if (!changed && opts.userEdit) E.Audio.still();
    }
    /* the ground's visual sibling of the still tone: one quiet breath when nothing changed —
     * ink-only, sub-1Hz, skipped under reduced motion (the narration already says it in words).
     * A vacuous FOLD additionally performs its mirror axis for a beat ("already a palindrome",
     * r4 playtest — a first fold on a symmetric field must not read as a dead button), and the
     * answer line breathes with the ground so the honest words are SEEN at the moment they
     * matter most. */
    if (!changed && opts.userEdit && E.Motion.shouldAnimate()) {
      el.grid.classList.remove('grid--still'); el.grid.classList.remove('grid--axis');
      if (el.answer) el.answer.classList.remove('caption--pulse');
      void el.grid.offsetWidth;
      el.grid.classList.add('grid--still');
      if (seq.length && seq[seq.length - 1] === 'fold') el.grid.classList.add('grid--axis');
      if (el.answer) el.answer.classList.add('caption--pulse');
    }

    /* result live region — debounced; diff for small edits, full read otherwise / on demand.
     * The visible answer line carries the same meaning in a short written form. */
    var prev = prevGrid;
    if (narrateTimer) clearTimeout(narrateTimer);
    narrateTimer = setTimeout(function () {
      var text;
      if (frames.length > 1) text = framesText(frames);
      else if (!changed && opts.userEdit) text = 'Nothing changed. ' + fullReadText(settled);
      else {
        var d = opts.full ? null : diffText(prev, settled);
        /* large changes get a one-sentence gestalt before the row-by-row recital, so a flood
         * reads as a fact before it reads as a table (r4 playtest, SR seat) */
        text = d || (kindSummary(settled) + ' ' + fullReadText(settled));
      }
      announce(el.result, text);
      setAnswer(visibleAnswer(prev, settled, frames, changed, opts));
    }, 300);

    prevGrid = settled;

    /* URL fossil — debounced, replaceState so history isn't spammed */
    if (hashTimer) clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      var h = seq.length ? '#' + seq.join('.') : '#';
      try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
    }, 250);
  }

  /* ============================ actions ============================ */
  function append(id) {
    if (!isGlyph(id)) return;
    if (seq.length >= MAXLEN) {
      /* a refused act is a committed event and gets the same honest answer as a no-op: the
       * still tone + one breath of the ground + words (r2 honest-ground; playtest r4 found the
       * silent cap was the one unanswered arrangement in the piece). Kill any pending settle
       * narration so the refusal is not overwritten by it; end any preview so the breath plays
       * over the truth, not a prefix (r5 audit). */
      endPreview();
      if (narrateTimer) { clearTimeout(narrateTimer); narrateTimer = null; }
      announce(el.result, 'The line is full at twelve glyphs.');
      setAnswer('The line is full at twelve glyphs.');
      if (E.Audio.enabled) E.Audio.still();
      if (E.Motion.shouldAnimate()) {
        el.grid.classList.remove('grid--still');
        void el.grid.offsetWidth;
        el.grid.classList.add('grid--still');
      }
      return;
    }
    seq.push(id);
    lastFocusLine = seq.length - 1;
    update({ placed: true, userEdit: true });
  }
  function removeAt(i) {
    if (i !== i || i < 0 || i >= seq.length) return;   /* i!==i: NaN guard */
    var goneName = GLYPHS[seq[i]].name;
    seq.splice(i, 1);
    lastFocusLine = Math.min(i, seq.length - 1);
    update({ removed: true, userEdit: true });
    announce(el.status, 'Removed ' + goneName + ' from position ' + (i + 1) + '.');
    var lb = lineButtons();
    suppressPreviewOnce = true;   /* programmatic focus must not open a prefix preview */
    if (lb.length) (lb[Math.min(i, lb.length - 1)] || lb[lb.length - 1]).focus();
    else { suppressPreviewOnce = false; el.clearBtn.focus(); }
  }
  function reorder(i, dir) {
    var j = i + dir;
    if (i !== i || i < 0 || i >= seq.length) return;
    if (j < 0 || j >= seq.length) {
      /* the edge is an answer too — never a silent unanswered act (r5 audit) */
      announce(el.status, 'Already at ' + (j < 0 ? 'the start' : 'the end') + ' of the line.');
      return;
    }
    var tmp = seq[i]; seq[i] = seq[j]; seq[j] = tmp;
    lastFocusLine = j;
    update({ userEdit: true });
    announce(el.status, 'Moved ' + GLYPHS[seq[j]].name + ' to position ' + (j + 1) + ' of ' + seq.length + '.');
    setAnswer('Moved ' + GLYPHS[seq[j]].name + ' to position ' + (j + 1) + ' of ' + seq.length + '.');
    var lb = lineButtons();
    if (lb[j]) { suppressPreviewOnce = true; lb[j].focus(); }
  }
  function clearAll() {
    seq = []; lastFocusLine = -1;
    update({ userEdit: true, full: true });
    announce(el.status, 'The line is cleared.');
    setAnswer('The line is cleared.');
    var pb = paletteButtons(); if (pb[0]) pb[0].focus();
  }
  /* R re-read: recompute so a multi-frame chain reads its before/after, not just the final frame.
   * Context-sensitive: with a line tile focused, R reads the PREFIX state up to that tile —
   * the audible face of the scrub. */
  function fullRead() {
    var a = document.activeElement;
    if (a && a.classList && a.classList.contains('tile')) {
      var i = +a.getAttribute('data-index');
      announce(el.result, 'Up to position ' + (i + 1) + ': ' + framesText(render(seq.slice(0, i + 1))));
      return;
    }
    announce(el.result, framesText(render(seq)));
  }

  /* ============================ the inspectable past (prefix scrub) ============================
   * Hover or focus a line tile to see the state the line meant UP TO that glyph — the line read
   * as a timeline of the computation (r2 handpicked, Victor). Strictly the PAST: only states
   * already committed are shown (previewing an uncommitted future was killed in session as
   * instruction). Silent: no sound, no accent, no live-region traffic — the settled state stays
   * the narrated truth; R on a focused tile speaks the prefix on demand. */
  var previewOn = false, suppressPreviewOnce = false, armedIndex = -1;   /* armedIndex: touch two-step tap */
  /* returns true only when a preview actually painted — the touch two-step arms on that truth */
  function previewAt(i) {
    if (suppressPreviewOnce) { suppressPreviewOnce = false; return false; }  /* programmatic focus after an edit */
    if (morphTimer) return false;                 /* never fight a live morph */
    if (i !== i || i < 0 || i >= seq.length) return false;   /* i!==i: NaN guard */
    var frames = render(seq.slice(0, i + 1));
    previewOn = true;
    el.stateBox.classList.add('state--preview');
    paintGrid(frames[frames.length - 1], false);
    lineButtons().forEach(function (b, j) { b.classList.toggle('tile--dim', j > i); });
    overlayAnswer('Up to ' + GLYPHS[seq[i]].name + ' (position ' + (i + 1) + ' of ' + seq.length + ').');
    return true;
  }
  function endPreview() {
    armedIndex = -1;
    if (!previewOn) return;
    previewOn = false;
    el.stateBox.classList.remove('state--preview');
    paintGrid(prevGrid, false);
    lineButtons().forEach(function (b) { b.classList.remove('tile--dim'); });
    restoreAnswer();
  }

  /* ============================ keyboard ============================ */
  function rove(buttons, current, key) {
    var i = buttons.indexOf(current), n = buttons.length, next = i;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (i + 1) % n;
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (i - 1 + n) % n;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = n - 1;
    else return false;
    buttons.forEach(function (b) { b.setAttribute('tabindex', '-1'); });
    buttons[next].setAttribute('tabindex', '0'); buttons[next].focus();
    return true;
  }

  function onKey(e) {
    var t = e.target;
    /* R re-reads — checked FIRST so it works from every focus position, including the palette
     * and the line tiles (whose branches below end in returns; r5 audit found R dead there,
     * which made the documented prefix-read unreachable) */
    if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag !== 'input' && tag !== 'textarea') { e.preventDefault(); fullRead(); return; }
    }
    if (t && t.classList && t.classList.contains('glyph')) {
      if (rove(paletteButtons(), t, e.key)) { e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        if (e.repeat) return;   /* a held key must not machine-gun the cap refusal */
        e.preventDefault(); append(t.getAttribute('data-glyph'));
      }
      return;
    }
    if (t && t.classList && t.classList.contains('tile')) {
      var idx = +t.getAttribute('data-index');
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); reorder(idx, e.key === 'ArrowLeft' ? -1 : 1); return; }
      if (rove(lineButtons(), t, e.key)) { e.preventDefault(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); removeAt(idx); }
      return;
    }
  }

  /* ============================ wiring ============================ */
  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return null;
    var ids = h.split('.').filter(isGlyph);
    return ids.length ? ids.slice(0, MAXLEN) : null;
  }

  /* fossil-as-specimen (r2 handpicked, Papert's MUST): what you keep is not a bare address but
   * the field itself — the 5-row specimen the state serializes to — followed by the link that
   * speaks it. A fossil you can SEE grows a culture; a URL only stores one. */
  function specimenText(g) {
    var rows = [];
    for (var r = 0; r < N; r++) {
      var cells = [];
      for (var c = 0; c < N; c++) cells.push(g[r][c].k === '' ? '·' : GLYPHS[g[r][c].k].cell);
      rows.push(cells.join(' '));
    }
    return rows.join('\n');
  }
  function keepLink() {
    /* build the URL from seq directly — location.href can be up to 250ms stale behind the hash
     * debounce, which would pair the specimen with the WRONG line (r5 audit) */
    if (hashTimer) { clearTimeout(hashTimer); hashTimer = null; }
    var h = seq.length ? '#' + seq.join('.') : '#';
    try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
    var url = location.origin + location.pathname + (seq.length ? h : '');
    var text = specimenText(prevGrid) + '\n' + url;
    function done(msg) { announce(el.status, msg); setAnswer(msg); el.keepBtn.classList.add('is-kept'); setTimeout(function () { el.keepBtn.classList.remove('is-kept'); }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done('Copied: the field, and a link that speaks this line.'); }, function () { done('This line lives in the page address.'); });
    } else { done('This line lives in the page address.'); }
  }

  function initCells() {
    el.cells = [];
    el.grid.innerHTML = '';
    var mid = (N - 1) / 2;
    for (var r = 0; r < N; r++) {
      el.cells[r] = [];
      for (var c = 0; c < N; c++) {
        var d = document.createElement('span');
        d.className = 'cell' + (r === mid && c === mid ? ' cell--origin' : '');
        d.setAttribute('data-k', '');
        el.grid.appendChild(d);
        el.cells[r][c] = d;
      }
    }
    el.film = document.createElement('div');
    el.film.className = 'filmstrip';
    el.film.hidden = true;
    el.grid.parentNode.appendChild(el.film);
    el.stateBox = el.grid.parentNode;   /* the .state panel — carries the preview border */
  }

  function boot() {
    el.grid = $('grid'); el.line = $('line'); el.palette = $('palette');
    el.result = $('result'); el.status = $('status'); el.answer = $('answer');
    el.clearBtn = $('clear'); el.keepBtn = $('keep'); el.soundBtn = $('sound');
    if (!el.grid) return;

    initCells();
    buildPalette();

    /* first-tap law: a single dot pre-placed and already rendered, unless a shared line is in
     * the URL. DOCTRINE NOTE (panel r2): a bloomed operator seed (e.g. ['dot','spread']) was
     * proposed (Visual Arts 3-1) and refused by Game Design + the authored-first-minute law —
     * the seeded operator would run the worked example before the visitor acts. The direction
     * is DEFERRED TO THE AUTHOR (see handoff/RATIFY-LEXIS.md); do not change without that call. */
    var handed = parseHash();
    seq = handed || ['dot'];
    lastFocusLine = seq.length - 1;
    /* canonicalize a handed hash at once (junk filtered, overlength clamped), so the address —
     * and anything copied from it — is truthful from the first moment (r5 audit) */
    if (handed) { try { history.replaceState(null, '', '#' + seq.join('.')); } catch (e) {} }
    /* paint the initial state without sound; one gentle settle (reduced-motion-safe) so the
     * surface reads as alive */
    var frames = render(seq);
    prevGrid = frames[frames.length - 1];
    renderLine();
    showFrames(frames, true);
    /* a hash arrival is someone's utterance — say so (r4 playtest, returning-visitor seat) */
    if (handed) setAnswer('You were handed this line.');
    setTimeout(function () { announce(el.result, framesText(frames)); }, 400);

    /* events */
    el.palette.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.glyph') : null;
      if (b) append(b.getAttribute('data-glyph'));
    });
    /* the inspectable past: hover (real hover devices only) and keyboard focus scrub the line */
    var canHover = global.matchMedia && global.matchMedia('(hover: hover)').matches;
    /* touch gets a two-step tap: the first tap on a line glyph PREVIEWS its prefix (the scrub,
     * which thumbs otherwise never get), the second tap on the same glyph removes it — so an
     * exploratory tap can no longer silently delete (r4 playtest; Victor's equity dissent,
     * partially answered). Hover devices keep one-click remove (hover already previews);
     * keyboard keeps explicit Backspace/Enter via onKey (which preventDefaults the click). */
    el.line.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.tile') : null;
      if (!b) return;
      var i = +b.getAttribute('data-index');
      if (!canHover && armedIndex !== i) {
        /* arm only when the preview truly painted — never a blind two-step (r5 audit) */
        if (previewAt(i)) {
          armedIndex = i;
          overlayAnswer('Up to ' + GLYPHS[seq[i]].name + ' (position ' + (i + 1) + ' of ' + seq.length + '). A second tap removes it.');
        }
        return;
      }
      armedIndex = -1;
      removeAt(i);
    });
    if (canHover) {
      /* mouseover fallback: hover-capable browsers without Pointer Events keep the scrub (r5) */
      var overEvt = global.PointerEvent ? 'pointerover' : 'mouseover';
      var outEvt = global.PointerEvent ? 'pointerout' : 'mouseout';
      el.line.addEventListener(overEvt, function (e) {
        var b = e.target.closest ? e.target.closest('.tile') : null;
        if (b) previewAt(+b.getAttribute('data-index'));
      });
      el.line.addEventListener(outEvt, function (e) {
        if (!el.line.contains(e.relatedTarget)) endPreview();
        else { var b = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.tile') : null; if (!b) endPreview(); }
      });
    }
    el.line.addEventListener('focusin', function (e) {
      var b = e.target.closest ? e.target.closest('.tile') : null;
      if (b) previewAt(+b.getAttribute('data-index'));
    });
    el.line.addEventListener('focusout', function (e) {
      if (!el.line.contains(e.relatedTarget)) endPreview();
    });
    /* touch: a tap anywhere outside the line is a non-destructive exit from preview/armed state —
     * it restores the truth and says nothing (r5 gameplay audit) */
    document.addEventListener('pointerdown', function (e) {
      if (previewOn && !el.line.contains(e.target)) endPreview();
    }, true);
    document.addEventListener('keydown', onKey);
    if (el.clearBtn) el.clearBtn.addEventListener('click', clearAll);
    if (el.keepBtn) el.keepBtn.addEventListener('click', keepLink);
    if (el.soundBtn) el.soundBtn.addEventListener('click', function () {
      E.Audio.enabled = !E.Audio.enabled;
      el.soundBtn.setAttribute('aria-pressed', String(E.Audio.enabled));
      el.soundBtn.textContent = 'Sound: ' + (E.Audio.enabled ? 'on' : 'off');
      /* turning sound ON answers audibly — an honest confirmation the channel works, and the
       * gesture completes the mobile unlock (the author's phone found the silence) */
      if (E.Audio.enabled && E.Audio.ensure()) E.Audio.still();
    });
    window.addEventListener('hashchange', function () {
      var parsed = parseHash();
      if (parsed && parsed.join('.') !== seq.join('.')) { seq = parsed; lastFocusLine = seq.length - 1; update({ full: true }); }
    });

    /* dev self-check (console only; deferred so the first frame stays synchronous).
     * Machine-checks the claims the piece makes in public (panel r2, Deep Thinkers):
     *   d1 determinism; d2 order matters; d3 spread-injectivity — all four marks spread
     *   DISTINCTLY (the load-bearing "kind matters" claim); d4 the exact state count printed
     *   on the evaluation page (651 distinct settled states from lines of length <= 4,
     *   re-measured after the ring-start rotation of the placement path). */
    setTimeout(function () {
      try {
        function foot(g) {
          var s = '';
          for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) s += g[r][c].k + ':' + g[r][c].v + '|';
          return s;
        }
        var d1 = gridsEqual(render(['dot', 'spread'])[0], render(['dot', 'spread'])[0]);
        var d2 = !gridsEqual(render(['dot', 'spread'])[0], render(['spread', 'dot'])[0]);
        var marks = ['dot', 'bar', 'ring', 'wave'], feet = {}, distinct = 0;
        for (var m = 0; m < marks.length; m++) {
          var f = foot(render([marks[m], 'spread'])[0]);
          if (!feet[f]) { feet[f] = 1; distinct++; }
        }
        var d3 = distinct === 4;
        var ids = ['dot', 'bar', 'ring', 'wave', 'spread', 'fold', 'chain'], states = {}, count = 0;
        (function rec(seq, depth) {
          if (seq.length > 0) {
            var fr = render(seq), key = foot(fr[fr.length - 1]);
            if (!states[key]) { states[key] = 1; count++; }
          }
          if (depth === 0) return;
          for (var i = 0; i < ids.length; i++) { seq.push(ids[i]); rec(seq, depth - 1); seq.pop(); }
        })([], 4);
        var d4 = count === 651;
        /* the fold dyad's predicate, machine-checked (r2 handpicked, Cage's signing condition):
         * fold genuinely symmetrizes, and an asymmetric field genuinely reads asymmetric */
        var d5 = isSymmetric(render(['dot', 'dot', 'fold'])[0]) && !isSymmetric(render(['dot', 'dot'])[0]);
        /* the settle pitch is a pure function of the state — same field, same answer */
        var d6 = pitchOf(render(['ring', 'spread'])[0]) === pitchOf(render(['ring', 'spread'])[0]);
        if (!(d1 && d2 && d3 && d4 && d5 && d6) && global.console) {
          console.warn('LEXIS self-check failed', { determinism: d1, orderMatters: d2, spreadInjective: d3, stateCount: count, foldSymmetry: d5, pitchPure: d6 });
        }
      } catch (e) {}
    }, 0);
  }

  /* expose the pure core for the depth-enumeration audit */
  global.LEXIS = { render: render, gridsEqual: gridsEqual, filledCount: filledCount, GLYPHS: GLYPHS, MARKS: MARKS, N: N };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
