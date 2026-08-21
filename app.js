/* 카탄 — 화면과 진행
   방장(또는 혼자 하기)의 브라우저가 심판이다. 참가자는 자기 시야만 받아서 그린다. */
(function () {
  'use strict';
  var R = window.Rules, AI = window.AI;
  var $ = function (id) { return document.getElementById(id); };
  var RES = R.RES, RN = R.RES_NAME;
  var PCOLOR = { red: '#d95f4a', blue: '#5a8fd9', orange: '#e09a3e', white: '#d8dce6' };
  var EMOJI = { b: '\uD83E\uDDF1', l: '\uD83E\uDEB5', w: '\uD83D\uDC11', g: '\uD83C\uDF3E', o: '\uD83E\uDEA8' };  // 🧱 🪵 🐑 🌾 🪨
  function rchip(c) { return el('i', 'rc r-' + c, EMOJI[c]); }
  var S = 52;                                     // 육각형 한 변(px)
  var SVGNS = 'http://www.w3.org/2000/svg';

  var App = {
    mode: 'solo', me: 'me', net: null, seats: [], state: null, view: null,
    started: false, skill: 1, botTimer: null,
    build: null,               // 'road' | 'settlement' | 'city' — 짓기 모드
    discardSel: [],            // 버리기 선택
    tGive: {}, tWant: {},      // 거래 제안 폼
    tourStep: 0
  };

  function show(which) {
    ['title', 'home', 'lobby', 'game'].forEach(function (id) {
      $(id).classList.toggle('hidden', id !== which);
    });
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }
  function myName() { return $('name').value.trim() || '이름없음'; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function meOf(v) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === v.me) return v.players[i];
    return null;
  }
  function playerIn(v, pid) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === pid) return v.players[i];
    return null;
  }
  function isMyTurn(v) {
    if (v.phase === 'setup') return v.setup.who === v.me;
    return v.players[v.turn] && v.players[v.turn].id === v.me;
  }
  function px(X) { return X * S * 0.8660254; }
  function py(Y) { return Y * S * 0.5; }
  // #rrggbb 를 밝기 f 배로
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round((n >> 16 & 255) * f));
    var g = Math.min(255, Math.round((n >> 8 & 255) * f));
    var b = Math.min(255, Math.round((n & 255) * f));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ---------------- 진행 ---------------- */

  function startEngine() {
    if (App.seats.length < 2) { toast('2명 이상이어야 시작할 수 있습니다.'); return; }
    App.started = true;
    App.state = R.newGame(App.seats.map(function (s) {
      return { id: s.id, name: s.name, bot: s.bot };
    }), Math.floor(Math.random() * 1e9));
    App.build = null; App.discardSel = [];
    show('game');
    pushViews();
  }

  function pushViews() {
    var s = App.state;
    if (App.mode === 'host' && App.net) {
      App.net.broadcast(function (pid) { return { t: 'view', view: R.viewFor(s, pid) }; });
    }
    applyView(R.viewFor(s, App.me));
  }

  function applyView(v) {
    var prev = App.view;
    // 단계가 바뀌면 선택을 정리한다
    if (!prev || prev.phase !== v.phase || prev.turn !== v.turn) {
      App.build = null; App.discardSel = [];
    }
    App.view = v;
    // 새로 굴린 주사위면 가운데에 연출로 보여준다
    if (v.dice) {
      var dk = v.turnCount + '-' + v.dice[0] + v.dice[1];
      if (App.diceKey !== dk) {
        App.diceKey = dk;
        var gains = (v.lastGain && v.lastGain.length) ? v.lastGain : null;
        var isSeven = v.dice[0] + v.dice[1] === 7;
        // 주사위가 화면에서 사라진 뒤에 해당 칸이 점등하고, 그 다음 카드가 온다
        showDiceRoll(v.dice, function () {
          if (isSeven) litRobber();
          else if (gains) flyGains(gains);
        });
      }
    }
    render();
    if (v.phase === 'over') showOver(v);
    scheduleBot();
  }

  function act(action, args) {
    if (App.mode === 'client') { App.net.toHost({ t: 'act', action: action, args: args }); return; }
    doAction(App.me, action, args);
  }
  var ALLOWED = ['placeSettlement', 'placeRoad', 'roll', 'discard', 'moveRobber', 'build',
    'buyDev', 'playDev', 'bankTrade', 'offerTrade', 'replyTrade', 'acceptTrade', 'cancelTrade', 'endTurn'];
  function doAction(pid, action, args) {
    var s = App.state;
    if (!s || ALLOWED.indexOf(action) < 0) return;
    var r = R[action].apply(null, [s, pid].concat(args || []));
    if (!r.ok) {
      if (pid === App.me) toast(r.error);
      else if (App.net) App.net.toPlayer(pid, { t: 'err', msg: r.error });
      return;
    }
    pushViews();
  }

  /* ---------------- 봇 ---------------- */

  function scheduleBot() {
    if (App.mode === 'client') return;
    var s = App.state;
    if (!s || s.phase === 'over') return;
    clearTimeout(App.botTimer);
    // 거래 응답이 먼저다
    var pend = R.tradePending(s).filter(function (pid) { return R.playerOf(s, pid).bot; });
    if (pend.length) { App.botTimer = setTimeout(function () { botTradeReply(pend[0]); }, 600); return; }
    // 제안이 떠 있는데 응답이 다 모였으면 사람(제안자)의 몫 — 봇은 제안하지 않는다
    if (s.trade) return;
    var need = R.needsAction(s).filter(function (pid) { return R.playerOf(s, pid).bot; });
    if (!need.length) return;
    var wait = s.phase === 'setup' ? 550 : s.phase === 'roll' ? 650 : 520;
    App.botTimer = setTimeout(function () { botStep(need[0]); }, wait);
  }

  function botTradeReply(pid) {
    var s = App.state;
    if (!s || !s.trade) { scheduleBot(); return; }
    var v = R.viewFor(s, pid);
    R.replyTrade(s, pid, AI.replyToTrade(v));
    pushViews();
  }

  function botStep(pid) {
    var s = App.state;
    if (!s || s.phase === 'over') return;
    var p = R.playerOf(s, pid);
    if (!p || !p.bot) return;
    var v = R.viewFor(s, pid), r = null;

    if (s.phase === 'setup') {
      if (s.setupSub === 'settlement') {
        r = R.placeSettlement(s, pid, AI.chooseSetupSettlement(v));
        if (!r.ok) r = R.placeSettlement(s, pid, R.legalSettlements(s, pid)[0]);
      } else {
        r = R.placeRoad(s, pid, AI.chooseSetupRoad(v));
        if (!r.ok) r = R.placeRoad(s, pid, R.legalRoads(s, pid)[0]);
      }
    } else if (s.phase === 'discard') {
      r = R.discard(s, pid, AI.chooseDiscard(v));
      if (!r.ok) {
        var pool = [];
        RES.forEach(function (c) { for (var i = 0; i < p.res[c]; i++) pool.push(c); });
        r = R.discard(s, pid, pool.slice(0, s.mustDiscard[pid]));
      }
    } else if (s.phase === 'robber') {
      var rb = AI.chooseRobber(v);
      var cands = R.robberVictims(s, rb.hex, pid);
      r = R.moveRobber(s, pid, rb.hex, cands.length ? (rb.victim && cands.indexOf(rb.victim) >= 0 ? rb.victim : cands[0]) : null);
      if (!r.ok) {
        var hx = (s.robber + 1) % 19, cd = R.robberVictims(s, hx, pid);
        r = R.moveRobber(s, pid, hx, cd.length ? cd[0] : null);
      }
    } else {
      var a = AI.act(v, App.skill);
      if (a) r = R[a.action].apply(null, [s, pid].concat(a.args));
      if (!r || !r.ok) {
        if (s.phase === 'roll') r = R.roll(s, pid);
        else { if (s.freeRoads > 0) s.freeRoads = 0; r = R.endTurn(s, pid); }
      }
    }
    if (!r || !r.ok) { toast('봇이 막혔습니다.'); return; }
    pushViews();
  }

  /* ---------------- 주사위 연출 ---------------- */

  var PIP_CELLS = {
    1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9]
  };
  function dieFace(elm, n) {
    elm.innerHTML = '';
    var cells = PIP_CELLS[n] || [];
    for (var i = 1; i <= 9; i++) {
      var cell = document.createElement('span');
      if (cells.indexOf(i) >= 0) cell.appendChild(document.createElement('i'));
      elm.appendChild(cell);
    }
  }
  var diceSpin = null, diceHide = null;
  function showDiceRoll(d, done) {
    var ov = $('diceOverlay');
    ov.classList.remove('hidden'); ov.classList.remove('out');
    $('diceSum').textContent = ''; $('diceNote').textContent = '';
    var b1 = $('bd1'), b2 = $('bd2');
    b1.classList.add('rolling'); b2.classList.add('rolling');
    clearInterval(diceSpin); clearTimeout(diceHide);
    var t0 = Date.now();
    diceSpin = setInterval(function () {
      dieFace(b1, 1 + Math.floor(Math.random() * 6));
      dieFace(b2, 1 + Math.floor(Math.random() * 6));
      if (Date.now() - t0 > 700) {
        clearInterval(diceSpin);
        b1.classList.remove('rolling'); b2.classList.remove('rolling');
        dieFace(b1, d[0]); dieFace(b2, d[1]);
        var sum = d[0] + d[1];
        $('diceSum').textContent = d[0] + ' + ' + d[1] + ' = ' + sum;
        $('diceNote').textContent = sum === 7 ? '도둑이 움직입니다' : sum + ' 타일에서 자원이 나옵니다';
        // 눈을 충분히 읽을 시간을 준 뒤 사라진다
        diceHide = setTimeout(function () {
          ov.classList.add('out');
          setTimeout(function () {
            ov.classList.add('hidden');
            if (done) done();                    // 다 사라지고 나서 다음 연출
          }, 340);
        }, 1500);
      }
    }, 85);
  }

  /* ---------------- 카드 날아오기 ---------------- */

  // 판 좌표(viewBox)를 화면 좌표로 — viewBox 는 (0,0) 이 한가운데다
  function boardToScreen(x, y) {
    var svg = $('board'), rect = svg.getBoundingClientRect();
    var scale = Math.min(rect.width / 584, rect.height / 584);
    return {
      x: rect.left + rect.width / 2 + x * scale,
      y: rect.top + rect.height / 2 + y * scale
    };
  }
  function gainTarget(pid) {
    if (pid === App.view.me) {
      return null;                       // 자원별 손패 칩으로 — flyOne 에서 자원별로 찾는다
    }
    var chip = document.querySelector('.pl[data-pid="' + pid + '"]');
    return chip ? chip.getBoundingClientRect() : null;
  }
  // 7 — 지금 도둑이 앉아 있는 칸을 밝혀서 "여기를 옮긴다"를 보여준다
  function litRobber() {
    var v = App.view;
    if (!v) return;
    var poly = $('board').querySelector('.hex[data-hex="' + v.robber + '"]');
    if (poly) {
      poly.classList.add('litRob');
      setTimeout(function () { poly.classList.remove('litRob'); }, 2600);
    }
    var mine = v.mustDiscard && v.mustDiscard[v.me];
    if (mine) toast('7 — 먼저 ' + mine + '장을 버립니다.');
    else if (isMyTurn(v)) toast('7 — 도둑을 옮길 타일을 누르세요.');
  }

  function flyGains(gains) {
    var v = App.view;
    if (!v) return;

    // 생산한 칸을 먼저 밝힌다
    var hexes = {};
    gains.forEach(function (gGain) { hexes[gGain.hex] = true; });
    var lit = [];
    Object.keys(hexes).forEach(function (hi) {
      var poly = $('board').querySelector('.hex[data-hex="' + hi + '"]');
      if (poly) { poly.classList.add('lit'); lit.push(poly); }
    });

    // 점등을 눈으로 확인할 틈을 주고 카드를 보낸다
    var delay = 520;
    gains.forEach(function (gGain) {
      var hex = v.board.hexes[gGain.hex];
      if (!hex) return;
      var from = boardToScreen(px(hex.X), py(hex.Y));
      for (var i = 0; i < gGain.n; i++) {
        flyOne(from, gGain.p, gGain.res, delay);
        delay += 260;
      }
    });
    setTimeout(function () {
      lit.forEach(function (poly) { poly.classList.remove('lit'); });
    }, delay + 700);
  }
  function flyOne(from, pid, resC, delay) {
    setTimeout(function () {
      var toRect;
      if (pid === App.view.me) {
        var stack = document.querySelector('.rstack[data-res="' + resC + '"]');
        toRect = stack ? stack.getBoundingClientRect() : null;
      } else {
        var chip = document.querySelector('.pl[data-pid="' + pid + '"]');
        toRect = chip ? chip.getBoundingClientRect() : null;
      }
      if (!toRect) return;
      var card = el('div', 'flyCard', EMOJI[resC]);
      var x0 = from.x - 15, y0 = from.y - 20;
      card.style.left = x0 + 'px';
      card.style.top = y0 + 'px';
      document.body.appendChild(card);
      var tx = toRect.left + toRect.width / 2 - 15 - x0;
      var ty = toRect.top + toRect.height / 2 - 20 - y0;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.55)';
        });
      });
      setTimeout(function () {
        card.style.opacity = '0';
        setTimeout(function () { card.remove(); }, 300);
      }, 900);
    }, delay);
  }

  /* ---------------- 판 그리기 ---------------- */

  function hexPoints(cx, cy) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i - 90);
      pts.push((cx + S * Math.cos(a)).toFixed(1) + ',' + (cy + S * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  function renderBoard(v) {
    var svg = $('board');
    svg.innerHTML = '';
    // 도둑 칸에 덮을 빗금
    var defs = svgEl('defs', {});
    var pat = svgEl('pattern', { id: 'hatch', width: 9, height: 9, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(svgEl('rect', { width: 9, height: 9, fill: '#14171f', 'fill-opacity': 0.16 }));
    pat.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 9, stroke: '#14171f', 'stroke-width': 4, 'stroke-opacity': 0.5 }));
    defs.appendChild(pat);
    svg.appendChild(defs);
    var g = svgEl('g', {});
    svg.appendChild(g);
    var myTurn = isMyTurn(v);

    // 바다 — 섬 둘레만 얇게 두른다 (판이 잘리지 않게)
    (function () {
      var pts = [];
      var Rr = S * 5.28;                     // 섬 바깥 반지름보다 살짝 크게
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 180 * (60 * i - 90);
        pts.push((Rr * Math.cos(a)).toFixed(1) + ',' + (Rr * Math.sin(a)).toFixed(1));
      }
      g.appendChild(svgEl('polygon', { points: pts.join(' '), class: 'seaRing' }));
    })();

    // 땅 타일
    v.board.hexes.forEach(function (h) {
      var cx = px(h.X), cy = py(h.Y);
      var robbedHere = h.i === v.robber;
      var hexEl = svgEl('polygon', {
        points: hexPoints(cx, cy),
        class: 'hex t-' + h.terrain + (robbedHere ? ' robbed' : ''),
        'data-hex': h.i
      });
      // 도둑 옮기기 — 내 차례면 타일을 누른다
      if (v.phase === 'robber' && myTurn && h.i !== v.robber) {
        hexEl.classList.add('robTarget');
        hexEl.addEventListener('click', function () { clickRobber(h.i); });
      }
      g.appendChild(hexEl);
      if (robbedHere) {
        g.appendChild(svgEl('polygon', { points: hexPoints(cx, cy), fill: 'url(#hatch)', class: 'robHatch' }));
      }

      // 육각형 안을 위아래로 나눠 쓴다 — 위는 자원, 아래는 숫자 칩
      var hasNum = !!h.number;
      var emo = svgEl('text', {
        x: cx, y: cy + (hasNum ? -12 : 6), 'font-size': hasNum ? 21 : 26,
        'text-anchor': 'middle', class: 'terrEmo'
      });
      emo.textContent = h.res ? EMOJI[h.res] : '\uD83C\uDF35';   // 사막은 🌵
      g.appendChild(emo);

      if (hasNum) {
        var hot = h.number === 6 || h.number === 8;
        var ny = cy + 17;
        g.appendChild(svgEl('circle', { cx: cx, cy: ny, r: 14, class: 'chipC' }));
        var t = svgEl('text', { x: cx, y: ny + 5, 'font-size': 15, class: 'chipT' + (hot ? ' hot' : '') });
        t.textContent = h.number;
        g.appendChild(t);
      }
    });

    // 항구 — 바닷가 부두와 선착장 다리 두 개
    v.board.ports.forEach(function (port) {
      var a = v.board.verts[port.verts[0]], b = v.board.verts[port.verts[1]];
      var hx = v.board.hexes[port.hex];
      var ax = px(a.X), ay = py(a.Y), bx0 = px(b.X), by0 = py(b.Y);
      var mx = (ax + bx0) / 2, my = (ay + by0) / 2;
      var ox = mx - px(hx.X), oy = my - py(hx.Y);          // 바다 쪽 방향
      var len = Math.hypot(ox, oy) || 1;
      ox /= len; oy /= len;
      var cx = mx + ox * 21, cy = my + oy * 21;            // 부두 중심

      var pg = svgEl('g', { class: 'port' });

      // 선착장 다리 — 꼭짓점에서 부두까지
      [[ax, ay], [bx0, by0]].forEach(function (pt) {
        var tx = cx - ox * 6, ty = cy - oy * 6;
        var vx = tx - pt[0], vy = ty - pt[1];
        var vl = Math.hypot(vx, vy) || 1;
        var nx = -vy / vl, ny = vx / vl;                   // 다리에 수직인 방향
        pg.appendChild(svgEl('line', { x1: pt[0], y1: pt[1], x2: tx, y2: ty, class: 'pierBase' }));
        pg.appendChild(svgEl('line', { x1: pt[0], y1: pt[1], x2: tx, y2: ty, class: 'pierTop' }));
        for (var t = 0.28; t <= 0.8; t += 0.26) {          // 널빤지
          var wx = pt[0] + vx * t, wy = pt[1] + vy * t;
          pg.appendChild(svgEl('line', {
            x1: wx - nx * 3, y1: wy - ny * 3, x2: wx + nx * 3, y2: wy + ny * 3, class: 'plank'
          }));
        }
      });

      // 부두 — 라벨이 읽히도록 수평으로 둔다
      var w = port.type === 'any' ? 30 : 40, hgt = 20;
      pg.appendChild(svgEl('rect', {
        x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt, rx: 4, class: 'dock'
      }));
      pg.appendChild(svgEl('line', {
        x1: cx - w / 2 + 3, y1: cy - hgt / 2 + 4.5, x2: cx + w / 2 - 3, y2: cy - hgt / 2 + 4.5, class: 'dockGrain'
      }));
      pg.appendChild(svgEl('line', {
        x1: cx - w / 2 + 3, y1: cy + hgt / 2 - 4.5, x2: cx + w / 2 - 3, y2: cy + hgt / 2 - 4.5, class: 'dockGrain'
      }));
      var label = svgEl('text', { x: cx, y: cy + 4, 'font-size': 11.5, 'text-anchor': 'middle', class: 'portT' });
      label.textContent = port.type === 'any' ? '3:1' : EMOJI[port.type] + '2:1';
      pg.appendChild(label);
      g.appendChild(pg);

      // 항구가 걸리는 두 꼭짓점
      [[ax, ay], [bx0, by0]].forEach(function (pt) {
        g.appendChild(svgEl('circle', { cx: pt[0], cy: pt[1], r: 3.2, class: 'portDot' }));
      });
    });

    // 도둑 — 숫자 칩 왼쪽에 세운다. 칩은 그대로 보인다
    (function () {
      var h = v.board.hexes[v.robber];
      var cx = px(h.X) + (h.number ? -27 : 0), cy = py(h.Y) + (h.number ? 19 : 10);
      g.appendChild(svgEl('circle', { cx: cx, cy: cy - 1, r: 14, fill: '#14171f', 'fill-opacity': 0.55, class: 'robHatch' }));
      var path = svgEl('path', {
        d: 'M' + cx + ' ' + (cy - 11) + ' a6.5 6.5 0 0 1 6.5 6.5 c0 2.8 -1.5 4.2 -1.5 6.5 h-10 c0 -2.3 -1.5 -3.7 -1.5 -6.5 a6.5 6.5 0 0 1 6.5 -6.5 z ' +
           'M' + (cx - 7.5) + ' ' + (cy + 4) + ' h15 l2.8 7.5 h-20.6 z',
        class: 'robber'
      });
      g.appendChild(path);
    })();

    // 도로 — 테두리 있는 띠에 흰 점선 차선을 얹는다
    v.board.edges.forEach(function (e) {
      if (!e.road) return;
      var a = v.board.verts[e.a], b = v.board.verts[e.b];
      var p = playerIn(v, e.road);
      var ax = px(a.X), ay = py(a.Y), bx2 = px(b.X), by2 = py(b.Y);
      var t = 0.15;
      var x1 = ax + (bx2 - ax) * t, y1 = ay + (by2 - ay) * t;
      var x2 = bx2 + (ax - bx2) * t, y2 = by2 + (ay - by2) * t;
      g.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: '#0b0e14', 'stroke-width': 10, class: 'road' }));
      g.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: PCOLOR[p.color], 'stroke-width': 7.5, class: 'road' }));
      g.appendChild(svgEl('line', {
        x1: x1, y1: y1, x2: x2, y2: y2, stroke: '#fff', 'stroke-width': 1.4,
        'stroke-dasharray': '4.5 4.5', 'stroke-opacity': 0.75, class: 'road', 'stroke-linecap': 'butt'
      }));
    });

    // 지을 수 있는 자리 표시
    var mode = buildModeNow(v);
    if (mode === 'road') {
      v.legal.roads.forEach(function (ei) {
        var e = v.board.edges[ei];
        var a = v.board.verts[e.a], b = v.board.verts[e.b];
        var ax = px(a.X), ay = py(a.Y), bx2 = px(b.X), by2 = py(b.Y);
        var t = 0.22;
        var line = svgEl('line', {
          x1: ax + (bx2 - ax) * t, y1: ay + (by2 - ay) * t,
          x2: bx2 + (ax - bx2) * t, y2: by2 + (ay - by2) * t,
          'stroke-width': 9, class: 'edgeHit'
        });
        line.addEventListener('click', function () { clickEdge(ei); });
        g.appendChild(line);
      });
    } else if (mode === 'settlement') {
      v.legal.settlements.forEach(function (vi) {
        var vert = v.board.verts[vi];
        var c = svgEl('circle', { cx: px(vert.X), cy: py(vert.Y), r: 8, class: 'spotDot' });
        c.addEventListener('click', function () { clickVertex(vi); });
        g.appendChild(c);
      });
    }

    // 건물
    v.board.verts.forEach(function (vert) {
      if (!vert.b) return;
      var p = playerIn(v, vert.b.p);
      var cx = px(vert.X), cy = py(vert.Y);
      var col = PCOLOR[p.color];
      var roof = shade(col, 0.62), wallHi = shade(col, 1.18);
      var shape = svgEl('g', { class: 'bld bldG' });
      if (vert.b.t === 'settlement') {
        // 작은 집 — 벽, 처마 나온 지붕, 문
        shape.appendChild(svgEl('rect', { x: cx - 6.5, y: cy - 2, width: 13, height: 9.5, fill: col, class: 'bld' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 9) + ' ' + (cy - 1.2) + ' L' + cx + ' ' + (cy - 9.5) + ' L' + (cx + 9) + ' ' + (cy - 1.2) + ' z',
          fill: roof, class: 'bld'
        }));
        shape.appendChild(svgEl('rect', { x: cx - 1.8, y: cy + 2.6, width: 3.6, height: 4.9, rx: 1.2, fill: '#1a1410', stroke: 'none' }));
      } else {
        // 도시 — 탑 + 본채, 깃발과 창문
        shape.appendChild(svgEl('rect', { x: cx - 1, y: cy - 3.5, width: 12, height: 11.5, fill: col, class: 'bld' }));
        shape.appendChild(svgEl('rect', { x: cx - 11, y: cy - 9, width: 9, height: 17, fill: wallHi, class: 'bld' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 12.5) + ' ' + (cy - 8.2) + ' L' + (cx - 6.5) + ' ' + (cy - 15) + ' L' + (cx - 0.5) + ' ' + (cy - 8.2) + ' z',
          fill: roof, class: 'bld'
        }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 1.8) + ' ' + (cy - 3) + ' L' + (cx + 5) + ' ' + (cy - 9.5) + ' L' + (cx + 11.8) + ' ' + (cy - 3) + ' z',
          fill: roof, class: 'bld'
        }));
        shape.appendChild(svgEl('rect', { x: cx - 8.6, y: cy - 5, width: 3.2, height: 3.6, rx: 0.8, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('rect', { x: cx - 8.6, y: cy + 1, width: 3.2, height: 3.6, rx: 0.8, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('rect', { x: cx + 2.8, y: cy + 3, width: 3.4, height: 4.5, rx: 1, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('line', { x1: cx - 6.5, y1: cy - 15, x2: cx - 6.5, y2: cy - 19, stroke: '#0b0e14', 'stroke-width': 1 }));
        shape.appendChild(svgEl('path', { d: 'M' + (cx - 6.5) + ' ' + (cy - 19) + ' h5 l-1.6 1.8 1.6 1.8 h-5 z', fill: roof, stroke: 'none' }));
      }
      // 도시 올리기 모드 — 내 마을을 누른다
      if (mode === 'city' && vert.b.p === v.me && vert.b.t === 'settlement') {
        shape.classList.add('pick');
        var halo = svgEl('circle', { cx: cx, cy: cy, r: 13, class: 'spotDot', 'fill-opacity': 0.25 });
        halo.addEventListener('click', function () { clickVertex(vert.i); });
        g.appendChild(halo);
        shape.addEventListener('click', function () { clickVertex(vert.i); });
      }
      g.appendChild(shape);
    });
  }

  // 지금 판에서 자리를 보여줄 모드
  function buildModeNow(v) {
    if (!isMyTurn(v)) return null;
    if (v.phase === 'setup') return v.setup.sub === 'settlement' ? 'settlement' : 'road';
    if (v.phase === 'main' && v.freeRoads > 0) return 'road';
    if (v.phase === 'main') return App.build;
    return null;
  }

  function clickVertex(vi) {
    var v = App.view;
    if (v.phase === 'setup') { act('placeSettlement', [vi]); return; }
    if (App.build === 'settlement') { act('build', ['settlement', vi]); App.build = null; return; }
    if (App.build === 'city') { act('build', ['city', vi]); App.build = null; return; }
  }
  function clickEdge(ei) {
    var v = App.view;
    if (v.phase === 'setup') { act('placeRoad', [ei]); return; }
    // 공짜 도로가 남아 있으면 계속 놓는다. 아니면 한 번 짓고 모드를 푼다.
    if (v.freeRoads <= 1) App.build = null;
    act('build', ['road', ei]);
  }
  function clickRobber(hex) {
    var v = App.view;
    // 피해자 후보 — 공개 정보(카드 수)로 판단할 수 있다
    var owners = {};
    v.board.hexes[hex].corners.forEach(function (vi) {
      var b = v.board.verts[vi].b;
      if (!b || b.p === v.me) return;
      var p = playerIn(v, b.p);
      if (p && !p.out && p.cards > 0) owners[b.p] = true;
    });
    var cands = Object.keys(owners);
    if (cands.length <= 1) { act('moveRobber', [hex, cands[0] || null]); return; }
    openPick('누구에게서 가져올까요?', '', cands.map(function (pid) {
      var p = playerIn(v, pid);
      return { label: p.name + ' (' + p.cards + '장)', fn: function () { act('moveRobber', [hex, pid]); } };
    }));
  }

  /* ---------------- 위쪽 — 플레이어 ---------------- */

  function renderPlayers(v) {
    var box = $('players');
    box.innerHTML = '';
    v.players.forEach(function (p, i) {
      var d = el('div', 'pl' + (p.out ? ' out' : ''));
      d.dataset.pid = p.id;
      d.style.borderLeftColor = PCOLOR[p.color];
      if ((v.phase === 'setup' ? v.setup.who === p.id : v.turn === i) && v.phase !== 'over') d.classList.add('turn');
      var nm = el('span', 'nm', p.name);
      d.appendChild(nm);
      if (p.id === v.me) d.appendChild(el('span', 'meTag', '나'));
      d.appendChild(el('span', 'vp', (p.id === v.me && p.vpFull !== undefined ? p.vpFull : p.vp) + '점'));
      var cardIc = el('span', 'st');
      cardIc.appendChild(el('i', 'cardIc'));
      cardIc.appendChild(document.createTextNode(String(p.cards)));
      cardIc.title = '자원 카드';
      d.appendChild(cardIc);
      if (p.devCount) { var dv = el('span', 'st', '⚙' + p.devCount); dv.title = '발전 카드'; d.appendChild(dv); }
      if (p.knights) { var kn = el('span', 'st', '⚔' + p.knights); kn.title = '쓴 기사'; d.appendChild(kn); }
      // 남은 말 — 도로 / 마을 / 도시
      var left = el('span', 'left');
      left.title = '남은 말 — 도로 ' + p.left.road + ' · 마을 ' + p.left.settlement + ' · 도시 ' + p.left.city;
      left.textContent = p.left.road + '/' + p.left.settlement + '/' + p.left.city;
      d.appendChild(left);
      if (v.longest.p === p.id) d.appendChild(el('span', 'badge', '교역로'));
      if (v.army.p === p.id) d.appendChild(el('span', 'badge', '기사단'));
      box.appendChild(d);
    });
    var dice = $('dice');
    if (v.dice) {
      dice.classList.remove('hidden');
      $('die1').textContent = v.dice[0];
      $('die2').textContent = v.dice[1];
      $('dsum').textContent = '= ' + (v.dice[0] + v.dice[1]);
    } else dice.classList.add('hidden');
  }

  /* ---------------- 아래쪽 — 손패와 행동 ---------------- */

  function renderHand(v) {
    var box = $('hand');
    box.innerHTML = '';
    var p = meOf(v);
    if (!p || p.res === undefined) return;
    var discarding = v.phase === 'discard' && v.mustDiscard[v.me];
    RES.forEach(function (c) {
      var n = p.res[c];
      var picked = App.discardSel.filter(function (x) { return x === c; }).length;
      var d = el('div', 'rstack' + (n ? '' : ' zero'));
      d.dataset.res = c;
      d.appendChild(rchip(c));
      d.appendChild(el('span', 'rname', RN[c]));
      d.appendChild(el('span', 'rnum', discarding && picked ? (n - picked) + '/' + n : String(n)));
      if (discarding && n > 0) {
        d.classList.add('selectable');
        if (picked) d.classList.add('sel');
        d.onclick = function () {
          var need = v.mustDiscard[v.me];
          if (picked < n && App.discardSel.length < need) App.discardSel.push(c);
          else App.discardSel = App.discardSel.filter(function (x, i) {
            return !(x === c && i === App.discardSel.indexOf(c));
          });
          render();
        };
      }
      d.title = RN[c];
      box.appendChild(d);
    });
    // 발전 카드
    (p.dev || []).forEach(function (d, i) {
      var b = el('button', 'devchip' + (d.fresh ? ' fresh' : ''), R.DEV_NAME[d.type]);
      if (d.type === 'vp') { b.classList.remove('fresh'); b.title = '승점 1점 — 그냥 점수로 들어갑니다'; b.onclick = function () { toast('승점 카드는 쓰는 카드가 아닙니다. 점수에 이미 들어가 있습니다.'); }; }
      else if (d.fresh) { b.title = '산 턴에는 못 씁니다'; b.onclick = function () { toast('산 턴에는 쓸 수 없습니다.'); }; }
      else b.onclick = function () { playDevUI(d.type); };
      box.appendChild(b);
    });
  }

  function playDevUI(type) {
    var v = App.view;
    if (!isMyTurn(v)) { toast('내 차례에만 쓸 수 있습니다.'); return; }
    if (v.playedDev) { toast('발전 카드는 한 턴에 하나만 씁니다.'); return; }
    if (type === 'knight' || type === 'road') { act('playDev', [type, []]); return; }
    if (type === 'monopoly') {
      openPick('독점 — 어떤 자원을 거둘까요?', '모든 사람의 그 자원을 전부 가져옵니다.', RES.map(function (c) {
        return { label: RN[c], res: c, fn: function () { act('playDev', ['monopoly', [c]]); } };
      }));
      return;
    }
    if (type === 'plenty') {
      var first = null;
      openPick('자원 발견 — 첫 장', '은행에서 두 장을 가져옵니다.', RES.map(function (c) {
        return { label: RN[c], res: c, fn: function () {
          first = c;
          openPick('자원 발견 — 둘째 장', '', RES.map(function (c2) {
            return { label: RN[c2], res: c2, fn: function () { act('playDev', ['plenty', [first, c2]]); } };
          }));
        } };
      }));
    }
  }

  function renderPanel(v) {
    var box = $('panel');
    box.innerHTML = '';
    var msg = el('p', 'panelMsg');
    box.appendChild(msg);
    var p = meOf(v);
    var myTurn = isMyTurn(v);
    var res = p && p.res ? p.res : { b: 0, l: 0, w: 0, g: 0, o: 0 };
    var buildable = myTurn && v.phase === 'main' && !v.trade && v.freeRoads === 0 && !(p && p.out);

    /* 짓기 블록 — 항상 자리를 지키고, 될 때만 켜진다 */
    var buildRow = el('div', 'buildRow');
    box.appendChild(buildRow);
    function afford(cost) {
      var need = {};
      cost.forEach(function (c) { need[c] = (need[c] || 0) + 1; });
      for (var c in need) if (res[c] < need[c]) return false;
      return true;
    }
    // 못 누르는 버튼도 눌리게 두고, 왜 안 되는지 알려준다
    function bbtn(label, pts, cost, usable, onClick, mode, why) {
      var b = el('button', 'bcard');
      var head = el('span', 'bhead');
      head.appendChild(el('span', 'bname', label));
      head.appendChild(el('span', 'bpts', pts));
      b.appendChild(head);
      var cs = el('span', 'bcost');
      var have = {};
      RES.forEach(function (c) { have[c] = res[c]; });
      cost.forEach(function (c) {
        var chip = rchip(c);
        if (have[c] > 0) have[c]--;        // 이 장은 감당된다
        else chip.classList.add('miss');   // 이 장이 모자라다
        cs.appendChild(chip);
      });
      b.appendChild(cs);
      if (usable) { b.classList.add('can'); b.onclick = onClick; }
      else {
        b.classList.add('off');
        b.onclick = function () { toast(why || '지금은 지을 수 없습니다.'); };
      }
      if (mode && App.build === mode) b.classList.add('on');
      buildRow.appendChild(b);
      return b;
    }
    // 왜 못 짓는지 한 줄로
    function why(kind) {
      if (!myTurn) return '내 차례에만 지을 수 있습니다.';
      if (v.phase === 'roll') return '먼저 주사위를 굴리세요.';
      if (v.phase !== 'main') return '지금은 지을 때가 아닙니다.';
      if (v.trade) return '먼저 거래 제안을 정리하세요.';
      if (kind === 'dev') {
        if (!v.devLeft) return '발전 카드가 다 떨어졌습니다.';
        return '자원이 모자랍니다 — 양 1 · 밀 1 · 철 1이 필요합니다.';
      }
      if (kind === 'road') {
        if (!p.left.road) return '도로 말 15개를 다 썼습니다.';
        if (!v.legal.roads.length) return '이어 놓을 자리가 없습니다.';
        return '자원이 모자랍니다 — 벽돌 1 · 나무 1이 필요합니다.';
      }
      if (kind === 'settlement') {
        if (!p.left.settlement) return '마을 말 5개를 다 썼습니다. 하나를 도시로 올리면 말이 돌아옵니다.';
        if (!v.legal.settlements.length) return '지을 자리가 없습니다 — 도로를 더 이어서 빈 꼭짓점을 만들어야 합니다. (마을끼리는 두 변 이상 떨어져야 합니다)';
        return '자원이 모자랍니다 — 벽돌·나무·양·밀이 한 장씩 필요합니다.';
      }
      if (kind === 'city') {
        if (!p.left.city) return '도시 말 4개를 다 썼습니다.';
        if (!v.legal.cities.length) return '올릴 내 마을이 없습니다. 마을을 먼저 지으세요.';
        return '자원이 모자랍니다 — 밀 2 · 철 3이 필요합니다.';
      }
      return '지금은 지을 수 없습니다.';
    }
    var canRoad = buildable && afford(['b', 'l']) && p.left.road > 0 && v.legal.roads.length > 0;
    var canSett = buildable && afford(['b', 'l', 'w', 'g']) && p.left.settlement > 0 && v.legal.settlements.length > 0;
    var canCity = buildable && afford(['g', 'g', 'o', 'o', 'o']) && p.left.city > 0 && v.legal.cities.length > 0;
    var canDev = buildable && afford(['w', 'g', 'o']) && v.devLeft > 0;
    function modeToggle(mode) {
      return function () { App.build = App.build === mode ? null : mode; render(); };
    }
    // 켜 둔 모드가 더 이상 불가능하면 조용히 푼다
    if ((App.build === 'road' && !canRoad) || (App.build === 'settlement' && !canSett) ||
        (App.build === 'city' && !canCity)) {
      App.build = null;
    }
    bbtn('도로', '0점', ['b', 'l'], canRoad, modeToggle('road'), 'road', why('road'));
    bbtn('마을', '1점', ['b', 'l', 'w', 'g'], canSett, modeToggle('settlement'), 'settlement', why('settlement'));
    bbtn('도시', '2점', ['g', 'g', 'o', 'o', 'o'], canCity, modeToggle('city'), 'city', why('city'));
    bbtn('발전 카드', '?점', ['w', 'g', 'o'], canDev, function () { act('buyDev', []); }, null, why('dev'));
    box.appendChild(el('p', 'panelFoot', '최장 교역로 2점 · 최강 기사단 2점 — 더 잘한 사람이 나오면 넘어갑니다.'));

    var acts = el('div', 'acts');
    box.appendChild(acts);
    function btn(label, fn, primary, disabled) {
      var b = el('button', primary ? 'primary' : null, label);
      if (disabled) b.disabled = true;
      b.onclick = fn;
      acts.appendChild(b);
      return b;
    }

    if (v.phase === 'over') { msg.textContent = '판이 끝났습니다.'; return; }
    if (p && p.out) { msg.textContent = '판에서 나갔습니다.'; return; }

    // 거래 제안이 떠 있으면 최우선으로 보여준다
    if (v.trade) { renderTrade(v, msg, acts, btn); return; }

    if (v.phase === 'setup') {
      if (myTurn) {
        msg.innerHTML = v.setup.sub === 'settlement'
          ? '<b>마을을 놓을 자리</b>를 판에서 누르세요.' + (v.setup.idx >= v.players.length ? ' 이번 마을 둘레의 자원을 받습니다.' : '')
          : '방금 놓은 마을에 <b>이을 도로</b>를 누르세요.';
      } else {
        var who = playerIn(v, v.setup.who);
        msg.textContent = (who ? who.name : '?') + '이(가) 자리를 고르는 중…';
      }
      return;
    }

    if (v.phase === 'discard') {
      var mine = v.mustDiscard[v.me];
      if (mine) {
        msg.innerHTML = '7이 나왔습니다. 손패에서 <b>' + mine + '장</b>을 골라 버리세요. (' + App.discardSel.length + '/' + mine + ')';
        btn('버리기', function () { act('discard', [App.discardSel.slice()]); App.discardSel = []; }, true, App.discardSel.length !== mine);
      } else {
        var names = Object.keys(v.mustDiscard).map(function (pid) { return playerIn(v, pid).name; });
        msg.textContent = names.join(', ') + '이(가) 버리는 중…';
      }
      return;
    }

    if (v.phase === 'robber') {
      msg.innerHTML = myTurn
        ? '<b>도둑을 옮길 타일</b>을 누르세요. 지금 자리(빗금)는 고를 수 없습니다.'
        : playerIn(v, v.players[v.turn].id).name + '이(가) 도둑을 옮기는 중…';
      return;
    }

    if (!myTurn) {
      msg.textContent = v.players[v.turn].name + '의 차례…';
      return;
    }

    if (v.phase === 'roll') {
      msg.innerHTML = '<b>주사위</b>를 굴리세요.';
      btn('주사위 굴리기', function () { act('roll', []); }, true);
      return;
    }

    // main
    if (v.freeRoads > 0) {
      if (v.legal.roads.length && p.left.road) {
        msg.innerHTML = '<b>도로 건설</b> — 공짜 도로 <b>' + v.freeRoads + '개</b>가 남았습니다. 판에서 주황 점선을 누르세요.';
      } else {
        msg.innerHTML = '놓을 자리가 없어 공짜 도로는 넘어갑니다.';
        btn('차례 넘기기', function () { act('endTurn', []); }, true);
      }
      return;
    }
    if (App.build === 'road') msg.innerHTML = '<b>도로를 놓을 변</b>을 누르세요.';
    else if (App.build === 'settlement') msg.innerHTML = '<b>마을을 놓을 꼭짓점</b>을 누르세요.';
    else if (App.build === 'city') msg.innerHTML = '<b>도시로 올릴 내 마을</b>을 누르세요.';
    else msg.innerHTML = '내 차례 — 짓거나 거래하거나, 차례를 넘기세요.';

    btn('은행 교환', function () { openBankTrade(v, p); }, false, !RES.some(function (c) { return res[c] >= R.tradeRate(p, c); }));
    var others = v.players.filter(function (q) { return q.id !== v.me && !q.out; }).length;
    btn('거래 제안', function () { openTradeModal(v, p); }, false, !others || !RES.some(function (c) { return res[c] > 0; }));
    var end = btn('차례 넘기기', function () { act('endTurn', []); }, true);
    end.classList.add('push');
  }

  /* ---------------- 거래 ---------------- */

  function renderTrade(v, msg, acts, btn) {
    var t = v.trade;
    var from = playerIn(v, t.from);
    var giveTxt = R.resText(t.give), wantTxt = R.resText(t.want);
    if (t.from === v.me) {
      var yes = [], waiting = [];
      v.players.forEach(function (q) {
        if (q.id === v.me || q.out) return;
        if (t.replies[q.id] === 'yes') yes.push(q);
        else if (!t.replies[q.id]) waiting.push(q);
      });
      msg.innerHTML = '내 제안 — <b>' + giveTxt + '</b> 주고 <b>' + wantTxt + '</b> 받기.' +
        (waiting.length ? ' (' + waiting.map(function (q) { return q.name; }).join(', ') + ' 대답 대기 중)' : '');
      yes.forEach(function (q) {
        btn(q.name + '와 교환', function () { act('acceptTrade', [q.id]); }, true);
      });
      btn('제안 거두기', function () { act('cancelTrade', []); });
    } else {
      msg.innerHTML = '<b>' + from.name + '</b>의 제안 — ' + giveTxt + ' 주고 <b>' + wantTxt + '</b> 받겠답니다.';
      var myReply = t.replies[v.me];
      if (myReply) {
        msg.innerHTML += ' (' + (myReply === 'yes' ? '받겠다고 했습니다' : '거절했습니다') + ')';
      } else {
        var p = meOf(v);
        var canAfford = Object.keys(t.want).every(function (c) { return p.res && p.res[c] >= t.want[c]; });
        btn('받기', function () { act('replyTrade', [true]); }, true, !canAfford);
        btn('거절', function () { act('replyTrade', [false]); });
      }
    }
  }

  function openBankTrade(v, p) {
    var opts = [];
    RES.forEach(function (c) {
      var rate = R.tradeRate(p, c);
      if (p.res[c] >= rate) opts.push({ c: c, rate: rate });
    });
    openPick('은행 교환 — 무엇을 낼까요?', '항구가 있으면 교환비가 좋아집니다.', opts.map(function (o) {
      return { label: RN[o.c] + ' ' + o.rate + '장 내기', res: o.c, fn: function () {
        openPick('무엇을 받을까요?', '', RES.filter(function (c) { return c !== o.c && v.bank[c] > 0; }).map(function (c) {
          return { label: RN[c] + ' 1장 (은행에 ' + v.bank[c] + ')', res: c, fn: function () { act('bankTrade', [o.c, c]); } };
        }));
      } };
    }));
  }

  function openTradeModal(v, p) {
    App.tGive = {}; App.tWant = {};
    renderTradeForm(v, p);
    $('tradeModal').classList.remove('hidden');
  }
  function renderTradeForm(v, p) {
    ['tGive', 'tWant'].forEach(function (side) {
      var box = $(side);
      box.innerHTML = '';
      RES.forEach(function (c) {
        var row = el('div', 'tRow');
        row.appendChild(rchip(c));
        var minus = el('button', null, '−');
        var cnt = el('span', 'cnt', String(App[side][c] || 0));
        var plus = el('button', null, '+');
        var max = side === 'tGive' ? p.res[c] : 19;
        minus.onclick = function () { App[side][c] = Math.max(0, (App[side][c] || 0) - 1); renderTradeForm(v, p); };
        plus.onclick = function () {
          if ((App[side][c] || 0) >= max) return;
          if (side === 'tGive' && App.tWant[c]) return;
          if (side === 'tWant' && App.tGive[c]) return;
          App[side][c] = (App[side][c] || 0) + 1; renderTradeForm(v, p);
        };
        row.appendChild(minus); row.appendChild(cnt); row.appendChild(plus);
        box.appendChild(row);
      });
    });
  }

  /* ---------------- 자원/대상 고르기 ---------------- */

  function openPick(title, hint, options) {
    $('pickTitle').textContent = title;
    $('pickHint').textContent = hint || '';
    var list = $('pickList');
    list.innerHTML = '';
    options.forEach(function (o) {
      var b = el('button', null, '');
      if (o.res) b.appendChild(rchip(o.res));
      b.appendChild(el('span', null, o.label));
      b.onclick = function () { $('pickModal').classList.add('hidden'); o.fn(); };
      list.appendChild(b);
    });
    $('pickModal').classList.remove('hidden');
  }
  $('btnPickCancel').onclick = function () { $('pickModal').classList.add('hidden'); };

  /* ---------------- 로그 / 끝 ---------------- */

  function renderLog(v) {
    var box = $('log');
    box.innerHTML = '';
    v.log.forEach(function (l) {
      box.appendChild(el('div', l.mine ? 'mine' : null, l.text));
    });
    box.scrollTop = box.scrollHeight;
  }

  function showOver(v) {
    var w = v.winner ? playerIn(v, v.winner) : null;
    $('overTitle').textContent = w ? w.name + ' 승리!' : '판이 끝났습니다';
    var body = $('overBody');
    body.innerHTML = '';
    v.players.slice().sort(function (a, b) {
      return (b.vpFull || b.vp) - (a.vpFull || a.vp);
    }).forEach(function (p) {
      var line = el('p', null);
      line.textContent = p.name + ' — ' + (p.vpFull !== undefined ? p.vpFull : p.vp) + '점' +
        (p.vpCards ? ' (승점 카드 ' + p.vpCards + ')' : '') +
        (v.longest.p === p.id ? ' · 최장 교역로' : '') +
        (v.army.p === p.id ? ' · 최강 기사단' : '') +
        (p.out ? ' · 나감' : '');
      body.appendChild(line);
    });
    $('over').classList.remove('hidden');
  }

  function render() {
    var v = App.view;
    if (!v) return;
    renderBoard(v);
    renderPlayers(v);
    renderHand(v);
    renderPanel(v);
    renderLog(v);
  }

  /* ---------------- 대기실 ---------------- */

  function renderSeats(seats, canControl) {
    var box = $('seats');
    box.innerHTML = '';
    seats.forEach(function (s, i) {
      var d = el('div', 'seat');
      var dot = el('span', 'dot');
      dot.style.background = PCOLOR[R.COLORS[i]] || '#666';
      d.appendChild(dot);
      d.appendChild(el('span', null, s.name));
      if (s.bot) d.appendChild(el('span', 'bot', '봇'));
      box.appendChild(d);
    });
    $('hostControls').classList.toggle('hidden', !canControl);
  }

  function broadcastLobby() {
    if (!App.net) return;
    var list = App.seats.map(function (s) { return { name: s.name, bot: s.bot }; });
    App.net.broadcast(function () { return { t: 'lobby', seats: list }; });
  }

  /* ---------------- 방장 / 참가자 ---------------- */

  function beHost() {
    App.mode = 'host'; App.me = 'host';
    App.seats = [{ id: 'host', name: myName(), bot: false }];
    App.net = new Net();
    App.net.on.status = toast;
    App.net.on.error = toast;
    App.net.on.open = function (code) {
      $('roomCode').textContent = code;
      $('lobbyHint').textContent = '친구에게 이 코드를 알려주세요.';
      show('lobby'); renderSeats(App.seats, true);
    };
    App.net.on.join = function (pid, name) {
      if (App.started || App.seats.length >= 4) {
        App.net.toPlayer(pid, { t: 'err', msg: App.started ? '이미 시작된 방입니다.' : '자리가 찼습니다.' });
        return;
      }
      var base = name, n = 2;
      while (App.seats.some(function (s) { return s.name === name; })) name = base + n++;
      App.seats.push({ id: pid, name: name, bot: false });
      renderSeats(App.seats, true); broadcastLobby(); toast(name + ' 참가');
    };
    App.net.on.leave = function (pid) {
      var seat = null;
      App.seats.forEach(function (s) { if (s.id === pid) seat = s; });
      if (!seat) return;
      App.seats = App.seats.filter(function (s) { return s.id !== pid; });
      if (App.started && App.state) { R.dropPlayer(App.state, pid); pushViews(); }
      else { renderSeats(App.seats, true); broadcastLobby(); }
      toast(seat.name + ' 나감');
    };
    App.net.on.data = function (pid, msg) {
      if (msg.t === 'act' && App.started) doAction(pid, msg.action, msg.args || []);
    };
    App.net.host();
  }

  function beClient(code) {
    App.mode = 'client';
    App.net = new Net();
    App.net.on.status = toast;
    App.net.on.error = function (m) { toast(m); show('home'); App.net.close(); };
    App.net.on.open = function (c) {
      $('roomCode').textContent = c;
      $('lobbyHint').textContent = '방장이 시작하기를 기다리는 중…';
      show('lobby'); renderSeats([], false);
    };
    App.net.on.data = function (_, msg) {
      if (msg.t === 'lobby') renderSeats(msg.seats, false);
      else if (msg.t === 'view') {
        App.me = msg.view.me;
        if ($('game').classList.contains('hidden')) show('game');
        applyView(msg.view);
      } else if (msg.t === 'err') toast(msg.msg);
    };
    App.net.join(code, myName());
  }

  /* ---------------- 첫 안내 ---------------- */

  var TOUR_LAST = 5;
  function tourShow(step) {
    App.tourStep = Math.max(0, Math.min(TOUR_LAST, step));
    var steps = document.querySelectorAll('#tour .tstep');
    for (var i = 0; i < steps.length; i++) steps[i].classList.toggle('hidden', i !== App.tourStep);
    var dots = $('tourDots'); dots.innerHTML = '';
    for (var j = 0; j <= TOUR_LAST; j++) dots.appendChild(el('i', j === App.tourStep ? 'on' : null));
    $('btnTourPrev').disabled = App.tourStep === 0;
    $('btnTourNext').textContent = App.tourStep === TOUR_LAST ? '시작하기' : '다음';
    $('tour').classList.remove('hidden');
  }
  function tourClose() {
    $('tour').classList.add('hidden');
    try { localStorage.setItem('catan.seen', '1'); } catch (e) {}
  }

  /* ---------------- 버튼 ---------------- */

  $('btnSolo').onclick = function () {
    var count = parseInt($('soloCount').value, 10);
    App.skill = parseFloat($('soloSkill').value);
    App.mode = 'solo'; App.me = 'me';
    App.seats = [{ id: 'me', name: myName(), bot: false }];
    var names = ['봇 하나', '봇 둘', '봇 셋'];
    for (var i = 0; i < count - 1; i++) App.seats.push({ id: 'bot' + i, name: names[i], bot: true });
    startEngine();
  };
  $('btnHost').onclick = function () {
    if (!window.Peer) { toast('통신 모듈을 불러오지 못했습니다.'); return; }
    beHost();
  };
  $('btnJoin').onclick = function () {
    var code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { toast('방 코드 4자리를 입력해 주세요.'); return; }
    if (!window.Peer) { toast('통신 모듈을 불러오지 못했습니다.'); return; }
    beClient(code);
  };
  $('joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnJoin').click(); });
  $('btnAddBot').onclick = function () {
    if (App.seats.length >= 4) return;
    var names = ['봇 하나', '봇 둘', '봇 셋'];
    var used = App.seats.filter(function (s) { return s.bot; }).length;
    App.seats.push({ id: 'bot' + used + '-' + Date.now(), name: names[used] || ('봇 ' + (used + 1)), bot: true });
    renderSeats(App.seats, true); broadcastLobby();
  };
  $('btnStart').onclick = function () { App.skill = 0.75; startEngine(); };
  $('btnLeave').onclick = function () { if (App.net) App.net.close(); location.reload(); };
  $('btnAgain').onclick = function () { if (App.net) App.net.close(); location.reload(); };
  $('btnRules').onclick = function () { tourShow(0); };
  $('btnHelp').onclick = function () { $('rules').classList.remove('hidden'); };
  $('btnCloseRules').onclick = function () { $('rules').classList.add('hidden'); };
  $('btnTourAgain').onclick = function () { $('rules').classList.add('hidden'); tourShow(0); };
  $('btnTourNext').onclick = function () {
    if (App.tourStep === TOUR_LAST) tourClose(); else tourShow(App.tourStep + 1);
  };
  $('btnTourPrev').onclick = function () { tourShow(App.tourStep - 1); };
  $('btnTourSkip').onclick = tourClose;
  $('btnTradeCancel').onclick = function () { $('tradeModal').classList.add('hidden'); };
  $('btnTradeOffer').onclick = function () {
    var g = {}, w = {}, gn = 0, wn = 0;
    RES.forEach(function (c) {
      if (App.tGive[c]) { g[c] = App.tGive[c]; gn += g[c]; }
      if (App.tWant[c]) { w[c] = App.tWant[c]; wn += w[c]; }
    });
    if (!gn || !wn) { toast('주고받을 자원을 한 장 이상씩 골라 주세요.'); return; }
    $('tradeModal').classList.add('hidden');
    act('offerTrade', [g, w]);
  };

  $('btnPlay').onclick = function () { show('home'); };
  $('btnBack').onclick = function () { show('title'); };

  // 테마 — 라이트가 기본, 한 번 고르면 기억한다
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('themeToggle').checked = dark;
    $('themeLabel').textContent = dark ? '다크' : '라이트';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0d1017' : '#f6efe0');
    try { localStorage.setItem('catan.dark', dark ? '1' : '0'); } catch (e) {}
    if (App.view) render();
  }
  (function () {
    var saved = null;
    try { saved = localStorage.getItem('catan.dark'); } catch (e) {}
    applyTheme(saved === '1');
  })();
  $('themeToggle').onchange = function () { applyTheme($('themeToggle').checked); };

  // 안내는 타이틀의 `가이드` 를 눌렀을 때만 연다
  $('name').value = localStorage.getItem('catan.name') || '';
  $('name').addEventListener('change', function () { localStorage.setItem('catan.name', myName()); });

  App.act = act; App.doAction = doAction; App.pushViews = pushViews; App.render = render;
  window.__ct = App;
})();
