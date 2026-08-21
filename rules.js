/* 카탄 — 규칙 엔진
   순수 함수 모음이다. 화면도 통신도 모른다.
   상태를 통째로 들고 다니고, 모든 동작은 {ok:true} 또는 {ok:false,error}를 돌려준다. */
(function (root) {
  'use strict';

  /* ---------------- 상수 ---------------- */

  var RES = ['b', 'l', 'w', 'g', 'o'];            // 벽돌 나무 양 밀 철
  var RES_NAME = { b: '벽돌', l: '나무', w: '양', g: '밀', o: '철' };
  var TERRAIN = ['hills', 'forest', 'pasture', 'fields', 'mountains', 'desert'];
  var TERRAIN_RES = { hills: 'b', forest: 'l', pasture: 'w', fields: 'g', mountains: 'o', desert: null };
  var TERRAIN_NAME = { hills: '언덕', forest: '숲', pasture: '초원', fields: '농지', mountains: '산', desert: '사막' };

  var COST = {
    road: { b: 1, l: 1 },
    settlement: { b: 1, l: 1, w: 1, g: 1 },
    city: { g: 2, o: 3 },
    dev: { w: 1, g: 1, o: 1 }
  };
  var PIECES = { road: 15, settlement: 5, city: 4 };
  var BANK_EACH = 19;
  var HAND_LIMIT = 7;          // 8장부터 절반을 버린다
  var WIN_VP = 10;
  var LONGEST_MIN = 5;
  var ARMY_MIN = 3;
  var COLORS = ['red', 'blue', 'orange', 'white'];

  // 땅 타일 19개
  var TERRAIN_BAG = [
    'forest', 'forest', 'forest', 'forest',
    'pasture', 'pasture', 'pasture', 'pasture',
    'fields', 'fields', 'fields', 'fields',
    'hills', 'hills', 'hills',
    'mountains', 'mountains', 'mountains',
    'desert'
  ];
  // 숫자 칩 18개 — 뒷면 A~R 순서 그대로
  var NUMBER_ORDER = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
  var PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

  // 항구 9개 — 3:1 넷, 자원별 2:1 다섯
  var PORT_BAG = ['any', 'any', 'any', 'any', 'b', 'l', 'w', 'g', 'o'];

  // 바깥 테두리부터 시계 방향으로 안으로 감는 순서 (숫자 칩을 이 순서로 놓는다)
  var SPIRAL = [
    [0, -2], [1, -2], [2, -2], [2, -1], [2, 0], [1, 1],
    [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-1, -1],
    [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0],
    [0, 0]
  ];
  var HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  // 꼭짓점 여섯 개 — (X,Y) 정수 격자. X 한 칸 = 가로 반 칸, Y 한 칸 = 세로 1/4 칸
  var CORNER = [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]];

  /* ---------------- 난수 ---------------- */

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function roll1(s) { return 1 + Math.floor(s.rnd() * 6); }

  /* ---------------- 판 만들기 ---------------- */

  function makeGeometry() {
    var hexes = [], vmap = {}, verts = [], emap = {}, edges = [];

    function vertexAt(X, Y) {
      var k = X + ',' + Y;
      if (vmap[k] === undefined) {
        vmap[k] = verts.length;
        verts.push({ i: verts.length, X: X, Y: Y, hexes: [], edges: [], adj: [], port: null, b: null });
      }
      return vmap[k];
    }
    function edgeAt(a, b) {
      var k = Math.min(a, b) + '-' + Math.max(a, b);
      if (emap[k] === undefined) {
        emap[k] = edges.length;
        edges.push({ i: edges.length, a: Math.min(a, b), b: Math.max(a, b), hexes: [], road: null });
      }
      return emap[k];
    }

    SPIRAL.forEach(function (qr, idx) {
      var q = qr[0], r = qr[1];
      var X = 2 * q + r, Y = 3 * r;
      var h = { i: idx, q: q, r: r, X: X, Y: Y, terrain: null, res: null, number: null, corners: [], edges: [] };
      for (var c = 0; c < 6; c++) h.corners.push(vertexAt(X + CORNER[c][0], Y + CORNER[c][1]));
      for (var c2 = 0; c2 < 6; c2++) {
        var e = edgeAt(h.corners[c2], h.corners[(c2 + 1) % 6]);
        h.edges.push(e);
        edges[e].hexes.push(idx);
      }
      h.corners.forEach(function (v) { verts[v].hexes.push(idx); });
      hexes.push(h);
    });

    edges.forEach(function (e) {
      verts[e.a].edges.push(e.i); verts[e.b].edges.push(e.i);
      verts[e.a].adj.push(e.b); verts[e.b].adj.push(e.a);
    });

    return { hexes: hexes, verts: verts, edges: edges };
  }

  function hexIndexOf(hexes, q, r) {
    for (var i = 0; i < hexes.length; i++) if (hexes[i].q === q && hexes[i].r === r) return i;
    return -1;
  }
  function neighborsOf(hexes, i) {
    var out = [];
    HEX_DIRS.forEach(function (d) {
      var j = hexIndexOf(hexes, hexes[i].q + d[0], hexes[i].r + d[1]);
      if (j >= 0) out.push(j);
    });
    return out;
  }

  // 6과 8이 붙지 않고 같은 숫자도 붙지 않게. 못 맞추면 200번까지 다시 깐다.
  function layLand(board, rnd) {
    for (var attempt = 0; attempt < 200; attempt++) {
      var bag = shuffle(TERRAIN_BAG.slice(), rnd);
      board.hexes.forEach(function (h, i) {
        h.terrain = bag[i];
        h.res = TERRAIN_RES[bag[i]];
        h.number = null;
      });
      var n = 0;
      board.hexes.forEach(function (h) {                 // SPIRAL 순서 = hexes 순서
        if (h.terrain === 'desert') return;
        h.number = NUMBER_ORDER[n++];
      });
      if (attempt === 199 || balanced(board)) return;
    }
  }
  function balanced(board) {
    for (var i = 0; i < board.hexes.length; i++) {
      var a = board.hexes[i].number;
      if (!a) continue;
      var ns = neighborsOf(board.hexes, i);
      for (var k = 0; k < ns.length; k++) {
        var b = board.hexes[ns[k]].number;
        if (!b) continue;
        if (a === b) return false;
        if ((a === 6 || a === 8) && (b === 6 || b === 8)) return false;
      }
    }
    return true;
  }

  // 바닷가 변 30개를 각도 순으로 세워 놓고 아홉 자리에 항구를 붙인다
  function layPorts(board, rnd) {
    var coast = board.edges.filter(function (e) { return e.hexes.length === 1; });
    coast.forEach(function (e) {
      var va = board.verts[e.a], vb = board.verts[e.b];
      var x = (va.X + vb.X) / 2 * 0.8660254, y = (va.Y + vb.Y) / 2 * 0.5;
      e.__ang = Math.atan2(y, x);
    });
    coast.sort(function (p, q) { return p.__ang - q.__ang; });
    var slots = [0, 3, 7, 10, 13, 17, 20, 23, 27];
    var types = shuffle(PORT_BAG.slice(), rnd);
    board.ports = slots.map(function (slot, k) {
      var e = coast[slot % coast.length];
      var port = { type: types[k], edge: e.i, verts: [e.a, e.b], hex: e.hexes[0] };
      board.verts[e.a].port = port.type;
      board.verts[e.b].port = port.type;
      return port;
    });
    coast.forEach(function (e) { delete e.__ang; });
  }

  function makeBoard(rnd) {
    var board = makeGeometry();
    layLand(board, rnd);
    layPorts(board, rnd);
    board.neighbors = board.hexes.map(function (h, i) { return neighborsOf(board.hexes, i); });
    return board;
  }

  /* ---------------- 발전 카드 ---------------- */

  function makeDevDeck(rnd) {
    var deck = [];
    var add = function (type, n) { for (var i = 0; i < n; i++) deck.push(type); };
    add('knight', 14); add('vp', 5);
    add('road', 2); add('plenty', 2); add('monopoly', 2);
    return shuffle(deck, rnd);
  }
  var DEV_NAME = {
    knight: '기사', vp: '승점', road: '도로 건설', plenty: '자원 발견', monopoly: '독점'
  };

  /* ---------------- 상태 ---------------- */

  function emptyRes() { return { b: 0, l: 0, w: 0, g: 0, o: 0 }; }

  function newGame(seats, seed) {
    var rnd = mulberry(seed >>> 0 || 1);
    var s = {
      seed: seed >>> 0 || 1,
      rnd: rnd,
      board: makeBoard(rnd),
      bank: { b: BANK_EACH, l: BANK_EACH, w: BANK_EACH, g: BANK_EACH, o: BANK_EACH },
      devDeck: makeDevDeck(rnd),
      players: seats.map(function (st, i) {
        return {
          id: st.id, name: st.name, bot: !!st.bot, color: COLORS[i], seat: i,
          res: emptyRes(), dev: [], knights: 0,
          left: { road: PIECES.road, settlement: PIECES.settlement, city: PIECES.city },
          ports: { any: false, b: false, l: false, w: false, g: false, o: false },
          settlements: [], cities: [], roads: [],
          out: false
        };
      }),
      turn: 0, phase: 'setup', dice: null,
      setupIdx: 0, setupSub: 'settlement', setupSpot: null,
      robber: 0, robberBack: 'main',
      mustDiscard: {}, stealFrom: [],
      playedDev: false, boughtDev: [], freeRoads: 0,
      trade: null,
      longest: { p: null, len: 0 }, army: { p: null, n: 0 },
      turnCount: 0, winner: null, log: [], logId: 0, lastGain: null
    };
    s.board.hexes.forEach(function (h, i) { if (h.terrain === 'desert') s.robber = i; });
    s.setupOrder = [];
    for (var i = 0; i < s.players.length; i++) s.setupOrder.push(i);
    for (var j = s.players.length - 1; j >= 0; j--) s.setupOrder.push(j);
    say(s, null, '마을을 하나 놓고 도로를 하나 놓습니다. 두 바퀴째는 역순이고, 그때 놓은 마을 둘레의 자원을 받습니다.');
    return s;
  }

  function say(s, only, text) { s.log.push({ i: s.logId++, only: only, text: text }); if (s.log.length > 120) s.log.shift(); }
  function nameOf(s, pid) { var p = playerOf(s, pid); return p ? p.name : '?'; }
  function playerOf(s, pid) {
    for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i];
    return null;
  }
  function current(s) { return s.players[s.turn]; }
  function err(m) { return { ok: false, error: m }; }
  var OK = { ok: true };

  function handCount(p) { var n = 0; RES.forEach(function (c) { n += p.res[c]; }); return n; }
  function canPay(p, cost) { for (var c in cost) if (p.res[c] < cost[c]) return false; return true; }
  function pay(s, p, cost) { for (var c in cost) { p.res[c] -= cost[c]; s.bank[c] += cost[c]; } }
  function take(s, p, c, n) {
    n = Math.min(n, s.bank[c]);
    p.res[c] += n; s.bank[c] -= n;
    return n;
  }
  function resText(map) {
    return RES.filter(function (c) { return map[c] > 0; })
      .map(function (c) { return RES_NAME[c] + (map[c] > 1 ? ' ' + map[c] : ''); }).join(' · ');
  }

  /* ---------------- 승점 ---------------- */

  function vpOf(s, p) {
    var v = p.settlements.length + p.cities.length * 2;
    if (s.longest.p === p.id) v += 2;
    if (s.army.p === p.id) v += 2;
    return v;
  }
  function vpFull(s, p) {
    return vpOf(s, p) + p.dev.filter(function (d) { return d.type === 'vp'; }).length;
  }
  function checkWin(s, p) {
    if (s.winner) return;
    if (vpFull(s, p) >= WIN_VP) {
      s.winner = p.id; s.phase = 'over';
      say(s, null, p.name + ' 승리 — ' + vpFull(s, p) + '점');
    }
  }

  /* ---------------- 최장 교역로 ---------------- */

  function blockedFor(s, vIdx, pid) {
    var b = s.board.verts[vIdx].b;
    return !!(b && b.p !== pid);
  }
  function roadLength(s, pid) {
    var edges = s.board.edges.filter(function (e) { return e.road === pid; });
    if (!edges.length) return 0;
    var best = 0;
    function walk(e, at, seen) {
      var len = 1;
      if (blockedFor(s, at, pid)) return len;
      var v = s.board.verts[at], add = 0;
      for (var k = 0; k < v.edges.length; k++) {
        var ni = v.edges[k];
        if (seen[ni]) continue;
        var ne = s.board.edges[ni];
        if (ne.road !== pid) continue;
        seen[ni] = 1;
        var far = ne.a === at ? ne.b : ne.a;
        var got = walk(ne, far, seen);
        seen[ni] = 0;
        if (got > add) add = got;
      }
      return len + add;
    }
    edges.forEach(function (e) {
      var seen = {}; seen[e.i] = 1;
      best = Math.max(best, walk(e, e.a, seen), walk(e, e.b, seen));
    });
    return best;
  }
  function updateLongest(s) {
    var lens = {}, top = 0;
    s.players.forEach(function (p) { lens[p.id] = p.out ? 0 : roadLength(s, p.id); top = Math.max(top, lens[p.id]); });
    var holder = s.longest.p;
    if (holder && lens[holder] >= LONGEST_MIN && lens[holder] >= top) {
      s.longest = { p: holder, len: lens[holder] };
      return;
    }
    if (top < LONGEST_MIN) {
      if (holder) say(s, null, '최장 교역로가 사라졌습니다.');
      s.longest = { p: null, len: top };
      return;
    }
    var tops = s.players.filter(function (p) { return lens[p.id] === top; });
    if (tops.length > 1) {
      if (holder && lens[holder] === top) { s.longest = { p: holder, len: top }; return; }
      if (holder) say(s, null, '최장 교역로가 동점이라 주인이 없어졌습니다.');
      s.longest = { p: null, len: top };
      return;
    }
    if (tops[0].id !== holder) say(s, null, tops[0].name + ' 최장 교역로 (' + top + ') — 2점');
    s.longest = { p: tops[0].id, len: top };
  }
  function updateArmy(s, p) {
    if (p.knights < ARMY_MIN) return;
    var cur = s.army.p ? playerOf(s, s.army.p) : null;
    if (!cur || p.knights > s.army.n) {
      if (!cur || cur.id !== p.id) say(s, null, p.name + ' 최강 기사단 (기사 ' + p.knights + ') — 2점');
      s.army = { p: p.id, n: p.knights };
    }
  }

  /* ---------------- 놓을 수 있는 자리 ---------------- */

  function spacingOK(s, v) {
    if (!s.board.verts[v]) return false;
    if (s.board.verts[v].b) return false;
    var adj = s.board.verts[v].adj;
    for (var i = 0; i < adj.length; i++) if (s.board.verts[adj[i]].b) return false;
    return true;
  }
  function touchesOwnRoad(s, v, pid) {
    var es = s.board.verts[v].edges;
    for (var i = 0; i < es.length; i++) if (s.board.edges[es[i]].road === pid) return true;
    return false;
  }
  function legalSettlements(s, pid) {
    var out = [];
    var setup = s.phase === 'setup';
    for (var v = 0; v < s.board.verts.length; v++) {
      if (!spacingOK(s, v)) continue;
      if (!setup && !touchesOwnRoad(s, v, pid)) continue;
      out.push(v);
    }
    return out;
  }
  function legalCities(s, pid) {
    return s.board.verts.filter(function (v) {
      return v.b && v.b.p === pid && v.b.t === 'settlement';
    }).map(function (v) { return v.i; });
  }
  function legalRoads(s, pid) {
    var out = [];
    for (var i = 0; i < s.board.edges.length; i++) {
      var e = s.board.edges[i];
      if (e.road) continue;
      if (s.phase === 'setup') {
        if (s.setupSpot === null) continue;
        if (e.a !== s.setupSpot && e.b !== s.setupSpot) continue;
        out.push(i);
        continue;
      }
      if (connects(s, e, pid)) out.push(i);
    }
    return out;
  }
  function connects(s, e, pid) {
    return [e.a, e.b].some(function (v) {
      var vb = s.board.verts[v].b;
      if (vb && vb.p === pid) return true;
      if (vb && vb.p !== pid) return false;          // 남의 마을은 못 뚫는다
      return touchesOwnRoad(s, v, pid);
    });
  }

  /* ---------------- 준비 단계 ---------------- */

  function setupPlayer(s) { return s.players[s.setupOrder[s.setupIdx]]; }

  function placeSettlement(s, pid, v) {
    if (s.phase !== 'setup') return err('지금은 마을을 놓을 때가 아닙니다.');
    if (s.setupSub !== 'settlement') return err('먼저 도로를 놓아야 합니다.');
    var p = setupPlayer(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (!spacingOK(s, v)) return err('다른 마을과 두 변 이상 떨어뜨려 놓아야 합니다.');
    s.board.verts[v].b = { t: 'settlement', p: pid };
    p.settlements.push(v); p.left.settlement--;
    if (s.board.verts[v].port) p.ports[s.board.verts[v].port] = true;
    s.setupSpot = v; s.setupSub = 'road';
    say(s, null, p.name + ' 마을');
    if (s.setupIdx >= s.players.length) {                 // 두 바퀴째 — 둘레 자원을 받는다
      var got = emptyRes();
      s.board.verts[v].hexes.forEach(function (h) {
        var hex = s.board.hexes[h];
        if (hex.res) got[hex.res] += take(s, p, hex.res, 1);
      });
      var t = resText(got);
      if (t) say(s, null, p.name + ' 첫 자원 — ' + t);
    }
    return OK;
  }

  function placeRoad(s, pid, e) {
    if (s.phase !== 'setup') return err('지금은 도로를 놓을 때가 아닙니다.');
    if (s.setupSub !== 'road') return err('먼저 마을을 놓아야 합니다.');
    var p = setupPlayer(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (legalRoads(s, pid).indexOf(e) < 0) return err('방금 놓은 마을에 붙여서 놓아야 합니다.');
    s.board.edges[e].road = pid;
    p.roads.push(e); p.left.road--;
    s.setupSpot = null; s.setupSub = 'settlement';
    s.setupIdx++;
    if (s.setupIdx >= s.setupOrder.length) {
      s.phase = 'roll'; s.turn = 0; s.turnCount = 1;
      updateLongest(s);
      say(s, null, '준비 끝. ' + s.players[0].name + '부터 주사위를 굴립니다.');
    }
    return OK;
  }

  /* ---------------- 주사위와 생산 ---------------- */

  function roll(s, pid) {
    if (s.phase !== 'roll') return err('지금은 주사위를 굴릴 때가 아닙니다.');
    if (current(s).id !== pid) return err('차례가 아닙니다.');
    var d1 = roll1(s), d2 = roll1(s), sum = d1 + d2;
    s.dice = [d1, d2];
    s.lastGain = null;
    say(s, null, nameOf(s, pid) + ' 주사위 ' + d1 + ' + ' + d2 + ' = ' + sum);
    if (sum === 7) { startRobber(s, 'main'); return OK; }
    produce(s, sum);
    s.phase = 'main';
    return OK;
  }

  function produce(s, sum) {
    var want = {};   // pid -> res -> n
    var total = emptyRes();
    var claims = [];                                    // {hex, p, res, n} — 연출용
    s.board.hexes.forEach(function (h, i) {
      if (h.number !== sum || i === s.robber || !h.res) return;
      h.corners.forEach(function (v) {
        var b = s.board.verts[v].b;
        if (!b) return;
        var n = b.t === 'city' ? 2 : 1;
        want[b.p] = want[b.p] || emptyRes();
        want[b.p][h.res] += n;
        total[h.res] += n;
        claims.push({ hex: i, p: b.p, res: h.res, n: n });
      });
    });
    // 은행이 모자라면 — 받을 사람이 하나뿐이면 남은 만큼, 여럿이면 아무도 못 받는다
    RES.forEach(function (c) {
      if (total[c] <= s.bank[c]) return;
      var claimants = Object.keys(want).filter(function (pid) { return want[pid][c] > 0; });
      if (claimants.length === 1) {
        want[claimants[0]][c] = s.bank[c];
        say(s, null, RES_NAME[c] + '이(가) 모자라 남은 만큼만 나갑니다.');
      } else {
        claimants.forEach(function (pid) { want[pid][c] = 0; });
        say(s, null, RES_NAME[c] + '이(가) 모자라 이번에는 아무도 못 받습니다.');
      }
    });
    var any = false;
    var received = {};                                  // pid -> res -> 실제 받은 장수
    s.players.forEach(function (p) {
      var w = want[p.id];
      if (!w) return;
      var got = emptyRes();
      RES.forEach(function (c) { if (w[c] > 0) got[c] = take(s, p, c, w[c]); });
      received[p.id] = got;
      var t = resText(got);
      if (t) { say(s, null, p.name + ' ← ' + t); any = true; }
    });
    if (!any) say(s, null, '아무도 못 받았습니다.');
    // 은행이 모자라 못 받은 몫은 연출에서도 뺀다
    s.lastGain = [];
    claims.forEach(function (cl) {
      var left = received[cl.p] ? received[cl.p][cl.res] : 0;
      if (left <= 0) return;
      var take2 = Math.min(cl.n, left);
      received[cl.p][cl.res] -= take2;
      s.lastGain.push({ hex: cl.hex, p: cl.p, res: cl.res, n: take2 });
    });
  }

  /* ---------------- 도둑 ---------------- */

  function startRobber(s, back) {
    s.robberBack = back;
    s.mustDiscard = {};
    s.players.forEach(function (p) {
      if (p.out) return;
      var n = handCount(p);
      if (n > HAND_LIMIT) s.mustDiscard[p.id] = Math.floor(n / 2);
    });
    var names = Object.keys(s.mustDiscard).map(function (pid) {
      return nameOf(s, pid) + ' ' + s.mustDiscard[pid] + '장';
    });
    if (names.length) {
      s.phase = 'discard';
      say(s, null, '7 — 절반 버리기: ' + names.join(', '));
    } else {
      s.phase = 'robber';
      say(s, null, '7 — 도둑을 옮깁니다.');
    }
  }

  function discard(s, pid, list) {
    if (s.phase !== 'discard') return err('지금은 버릴 때가 아닙니다.');
    var need = s.mustDiscard[pid];
    if (!need) return err('버릴 것이 없습니다.');
    if (!list || list.length !== need) return err(need + '장을 골라야 합니다.');
    var p = playerOf(s, pid), tmp = emptyRes();
    for (var i = 0; i < list.length; i++) {
      if (RES.indexOf(list[i]) < 0) return err('자원이 아닙니다.');
      tmp[list[i]]++;
      if (tmp[list[i]] > p.res[list[i]]) return err('가지고 있지 않은 자원입니다.');
    }
    RES.forEach(function (c) { p.res[c] -= tmp[c]; s.bank[c] += tmp[c]; });
    delete s.mustDiscard[pid];
    say(s, null, p.name + ' 버림 — ' + resText(tmp));
    if (!Object.keys(s.mustDiscard).length) {
      s.phase = 'robber';
      say(s, null, nameOf(s, current(s).id) + ' 차례 — 도둑을 옮깁니다.');
    }
    return OK;
  }

  function robberVictims(s, hex, pid) {
    var out = {};
    s.board.hexes[hex].corners.forEach(function (v) {
      var b = s.board.verts[v].b;
      if (!b || b.p === pid) return;
      var p = playerOf(s, b.p);
      if (!p || p.out || handCount(p) === 0) return;
      out[b.p] = true;
    });
    return Object.keys(out);
  }

  function moveRobber(s, pid, hex, victim) {
    if (s.phase !== 'robber') return err('지금은 도둑을 옮길 때가 아닙니다.');
    if (current(s).id !== pid) return err('차례가 아닙니다.');
    if (hex === s.robber) return err('다른 타일로 옮겨야 합니다.');
    if (hex < 0 || hex >= s.board.hexes.length) return err('그런 타일이 없습니다.');
    var cands = robberVictims(s, hex, pid);
    if (cands.length > 1 && !victim) return err('누구에게서 가져올지 골라 주세요.');
    if (victim && cands.indexOf(victim) < 0) return err('그 사람에게서는 가져올 수 없습니다.');
    s.robber = hex;
    var h = s.board.hexes[hex];
    say(s, null, nameOf(s, pid) + ' 도둑을 ' + TERRAIN_NAME[h.terrain] + (h.number ? ' ' + h.number : '') + '(으)로 옮김');
    var target = victim || (cands.length === 1 ? cands[0] : null);
    if (target) steal(s, pid, target);
    s.phase = s.robberBack;
    return OK;
  }

  function steal(s, pid, victimId) {
    var thief = playerOf(s, pid), v = playerOf(s, victimId);
    var pool = [];
    RES.forEach(function (c) { for (var i = 0; i < v.res[c]; i++) pool.push(c); });
    if (!pool.length) return;
    var c = pool[Math.floor(s.rnd() * pool.length)];
    v.res[c]--; thief.res[c]++;
    say(s, null, thief.name + '이(가) ' + v.name + '에게서 카드 한 장을 가져갔습니다.');
    say(s, pid, '가져온 것: ' + RES_NAME[c]);
    say(s, victimId, '빼앗긴 것: ' + RES_NAME[c]);
  }

  /* ---------------- 건설 ---------------- */

  function build(s, pid, kind, id) {
    if (s.phase !== 'main') return err('지금은 지을 때가 아닙니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (s.trade) return err('먼저 거래 제안을 정리해 주세요.');

    if (kind === 'road') {
      if (!p.left.road) return err('도로 말을 다 썼습니다.');
      var e = s.board.edges[id];
      if (!e) return err('그런 자리가 없습니다.');
      if (e.road) return err('이미 도로가 있습니다.');
      if (!connects(s, e, pid)) return err('내 도로나 마을에 붙여서 지어야 합니다.');
      var free = s.freeRoads > 0;
      if (!free && !canPay(p, COST.road)) return err('자원이 모자랍니다. (벽돌 1 · 나무 1)');
      if (free) s.freeRoads--; else pay(s, p, COST.road);
      e.road = pid; p.roads.push(id); p.left.road--;
      say(s, null, p.name + ' 도로' + (free ? ' (무료)' : ''));
      updateLongest(s);
      checkWin(s, p);
      return OK;
    }

    if (kind === 'settlement') {
      if (!p.left.settlement) return err('마을 말을 다 썼습니다. 도시로 올려야 합니다.');
      if (!spacingOK(s, id)) return err('다른 마을과 두 변 이상 떨어뜨려야 합니다.');
      if (!touchesOwnRoad(s, id, pid)) return err('내 도로에 이어서 지어야 합니다.');
      if (!canPay(p, COST.settlement)) return err('자원이 모자랍니다. (벽돌·나무·양·밀)');
      pay(s, p, COST.settlement);
      s.board.verts[id].b = { t: 'settlement', p: pid };
      p.settlements.push(id); p.left.settlement--;
      var port = s.board.verts[id].port;
      if (port) { p.ports[port] = true; say(s, null, p.name + ' 항구 확보 — ' + portName(port)); }
      say(s, null, p.name + ' 마을 — 1점');
      updateLongest(s);                                  // 남의 길을 끊을 수 있다
      checkWin(s, p);
      return OK;
    }

    if (kind === 'city') {
      var v = s.board.verts[id];
      if (!v || !v.b || v.b.p !== pid || v.b.t !== 'settlement') return err('내 마을 위에만 지을 수 있습니다.');
      if (!p.left.city) return err('도시 말을 다 썼습니다.');
      if (!canPay(p, COST.city)) return err('자원이 모자랍니다. (밀 2 · 철 3)');
      pay(s, p, COST.city);
      v.b.t = 'city';
      p.settlements = p.settlements.filter(function (x) { return x !== id; });
      p.cities.push(id);
      p.left.city--; p.left.settlement++;
      say(s, null, p.name + ' 도시 — 2점');
      checkWin(s, p);
      return OK;
    }
    return err('그런 건물이 없습니다.');
  }

  function portName(t) { return t === 'any' ? '3:1' : RES_NAME[t] + ' 2:1'; }

  /* ---------------- 발전 카드 ---------------- */

  function buyDev(s, pid) {
    if (s.phase !== 'main') return err('지금은 살 때가 아닙니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (!s.devDeck.length) return err('발전 카드가 다 떨어졌습니다.');
    if (!canPay(p, COST.dev)) return err('자원이 모자랍니다. (양 1 · 밀 1 · 철 1)');
    pay(s, p, COST.dev);
    var type = s.devDeck.pop();
    p.dev.push({ type: type, turn: s.turnCount });
    say(s, null, p.name + ' 발전 카드 한 장');
    say(s, pid, '뽑은 카드 — ' + DEV_NAME[type]);
    if (type === 'vp') checkWin(s, p);
    return OK;
  }

  function playDev(s, pid, type, args) {
    if (s.phase !== 'main' && s.phase !== 'roll') return err('지금은 쓸 수 없습니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (type === 'vp') return err('승점 카드는 그냥 점수로 셉니다.');
    if (s.playedDev) return err('발전 카드는 한 턴에 하나만 씁니다.');
    var idx = -1;
    for (var i = 0; i < p.dev.length; i++) {
      if (p.dev[i].type === type && p.dev[i].turn !== s.turnCount) { idx = i; break; }
    }
    if (idx < 0) {
      var hasFresh = p.dev.some(function (d) { return d.type === type; });
      return err(hasFresh ? '산 턴에는 쓸 수 없습니다.' : '그 카드가 없습니다.');
    }
    args = args || [];

    if (type === 'knight') {
      p.dev.splice(idx, 1); p.knights++; s.playedDev = true;
      say(s, null, p.name + ' 기사 — 도둑을 옮깁니다. (기사 ' + p.knights + ')');
      updateArmy(s, p);
      startRobberFromKnight(s);
      checkWin(s, p);
      return OK;
    }
    if (type === 'monopoly') {
      var c = args[0];
      if (RES.indexOf(c) < 0) return err('자원을 골라 주세요.');
      p.dev.splice(idx, 1); s.playedDev = true;
      var got = 0;
      s.players.forEach(function (q) {
        if (q.id === pid || q.out) return;
        got += q.res[c]; p.res[c] += q.res[c]; q.res[c] = 0;
      });
      say(s, null, p.name + ' 독점 — ' + RES_NAME[c] + ' ' + got + '장을 거둬 갔습니다.');
      return OK;
    }
    if (type === 'plenty') {
      var a = args[0], b = args[1];
      if (RES.indexOf(a) < 0 || RES.indexOf(b) < 0) return err('자원 두 장을 골라 주세요.');
      if (s.bank[a] + (a === b ? 0 : s.bank[b]) === 0) return err('은행에 그 자원이 없습니다.');
      p.dev.splice(idx, 1); s.playedDev = true;
      var got2 = emptyRes();
      got2[a] += take(s, p, a, 1);
      got2[b] += take(s, p, b, 1);
      say(s, null, p.name + ' 자원 발견 — ' + (resText(got2) || '은행이 비어 못 받음'));
      return OK;
    }
    if (type === 'road') {
      p.dev.splice(idx, 1); s.playedDev = true;
      s.freeRoads = Math.min(2, p.left.road);
      if (s.phase === 'roll') s.phase = 'main';           // 도로를 놓으려면 건설 단계여야 한다
      say(s, null, p.name + ' 도로 건설 — 도로 ' + s.freeRoads + '개를 공짜로 놓습니다.');
      if (!s.freeRoads || !legalRoads(s, pid).length) {
        s.freeRoads = 0;
        say(s, null, '놓을 자리가 없어 그냥 넘어갑니다.');
      }
      return OK;
    }
    return err('그런 카드가 없습니다.');
  }

  function startRobberFromKnight(s) {
    s.robberBack = s.phase === 'roll' ? 'roll' : 'main';
    s.phase = 'robber';
  }

  /* ---------------- 거래 ---------------- */

  function tradeRate(p, c) {
    if (p.ports[c]) return 2;
    if (p.ports.any) return 3;
    return 4;
  }
  function bankTrade(s, pid, give, get) {
    if (s.phase !== 'main') return err('지금은 거래할 때가 아닙니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (RES.indexOf(give) < 0 || RES.indexOf(get) < 0) return err('자원을 골라 주세요.');
    if (give === get) return err('같은 자원끼리는 바꾸지 않습니다.');
    var rate = tradeRate(p, give);
    if (p.res[give] < rate) return err(RES_NAME[give] + ' ' + rate + '장이 있어야 합니다.');
    if (s.bank[get] < 1) return err('은행에 ' + RES_NAME[get] + '이(가) 없습니다.');
    p.res[give] -= rate; s.bank[give] += rate;
    take(s, p, get, 1);
    say(s, null, p.name + ' 은행과 ' + rate + ':1 — ' + RES_NAME[give] + ' ' + rate + ' → ' + RES_NAME[get]);
    return OK;
  }

  function offerTrade(s, pid, give, want) {
    if (s.phase !== 'main') return err('지금은 거래할 때가 아닙니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (s.trade) return err('이미 제안이 올라가 있습니다.');
    var g = clean(give), w = clean(want);
    if (!count(g) || !count(w)) return err('주고받을 자원을 한 장 이상씩 넣어야 합니다.');
    for (var c in g) if (w[c]) return err('같은 자원을 주고받을 수는 없습니다.');
    for (var c2 in g) if (p.res[c2] < g[c2]) return err('가진 것보다 많이 줄 수는 없습니다.');
    if (s.players.filter(function (q) { return !q.out; }).length < 2) return err('거래할 사람이 없습니다.');
    s.trade = { from: pid, give: g, want: w, replies: {} };
    say(s, null, p.name + ' 거래 제안 — ' + resText(g) + ' 주고 ' + resText(w) + ' 받기');
    return OK;
  }
  function clean(m) {
    var out = {};
    RES.forEach(function (c) { var n = Math.floor((m && m[c]) || 0); if (n > 0) out[c] = n; });
    return out;
  }
  function count(m) { var n = 0; for (var c in m) n += m[c]; return n; }

  function replyTrade(s, pid, yes) {
    if (!s.trade) return err('올라온 제안이 없습니다.');
    if (s.trade.from === pid) return err('내가 낸 제안입니다.');
    var p = playerOf(s, pid);
    if (!p || p.out) return err('참가자가 아닙니다.');
    if (yes) {
      for (var c in s.trade.want) if (p.res[c] < s.trade.want[c]) return err('요구한 자원이 모자랍니다.');
    }
    s.trade.replies[pid] = yes ? 'yes' : 'no';
    say(s, null, p.name + (yes ? ' 받겠다고 했습니다.' : ' 거절했습니다.'));
    return OK;
  }

  function acceptTrade(s, pid, withPid) {
    if (!s.trade) return err('올라온 제안이 없습니다.');
    if (s.trade.from !== pid) return err('제안한 사람만 고를 수 있습니다.');
    if (s.trade.replies[withPid] !== 'yes') return err('그 사람은 받겠다고 하지 않았습니다.');
    var a = playerOf(s, pid), b = playerOf(s, withPid);
    var g = s.trade.give, w = s.trade.want, c;
    for (c in g) if (a.res[c] < g[c]) return err('줄 자원이 모자랍니다.');
    for (c in w) if (b.res[c] < w[c]) return err('상대의 자원이 모자랍니다.');
    for (c in g) { a.res[c] -= g[c]; b.res[c] += g[c]; }
    for (c in w) { b.res[c] -= w[c]; a.res[c] += w[c]; }
    say(s, null, a.name + ' ↔ ' + b.name + ' 거래 성사 — ' + resText(g) + ' ↔ ' + resText(w));
    s.trade = null;
    return OK;
  }
  function cancelTrade(s, pid) {
    if (!s.trade) return err('올라온 제안이 없습니다.');
    if (s.trade.from !== pid) return err('제안한 사람만 거둘 수 있습니다.');
    s.trade = null;
    say(s, null, nameOf(s, pid) + ' 제안을 거뒀습니다.');
    return OK;
  }

  /* ---------------- 차례 넘기기 ---------------- */

  function endTurn(s, pid) {
    if (s.phase !== 'main') return err('아직 차례를 끝낼 수 없습니다.');
    if (current(s).id !== pid) return err('차례가 아닙니다.');
    if (s.freeRoads > 0) return err('공짜 도로 ' + s.freeRoads + '개가 남았습니다.');
    s.trade = null; s.playedDev = false; s.dice = null;
    var n = s.players.length, guard = 0;
    do { s.turn = (s.turn + 1) % n; guard++; } while (s.players[s.turn].out && guard <= n);
    s.turnCount++;
    s.phase = 'roll';
    var np = current(s);
    if (vpFull(s, np) >= WIN_VP) { checkWin(s, np); return OK; }   // 어부지리로 넘긴 승리
    say(s, null, '— ' + np.name + ' 차례');
    return OK;
  }

  function dropPlayer(s, pid) {
    var p = playerOf(s, pid);
    if (!p || p.out) return;
    p.out = true;
    delete s.mustDiscard[pid];
    if (s.trade && s.trade.from === pid) s.trade = null;
    if (s.trade) delete s.trade.replies[pid];
    say(s, null, p.name + ' 나감');
    var live = s.players.filter(function (q) { return !q.out; });
    if (live.length <= 1) {
      s.phase = 'over';
      s.winner = live.length ? live[0].id : null;
      return;
    }
    if (s.phase === 'setup') {
      // 준비 단계에서 나가면 남은 자리를 건너뛴다
      while (s.setupIdx < s.setupOrder.length && s.players[s.setupOrder[s.setupIdx]].out) {
        s.setupIdx++; s.setupSub = 'settlement'; s.setupSpot = null;
      }
      if (s.setupIdx >= s.setupOrder.length) { s.phase = 'roll'; s.turn = 0; s.turnCount = 1; }
      return;
    }
    if (s.phase === 'discard' && !Object.keys(s.mustDiscard).length) s.phase = 'robber';
    if (current(s).out) {
      s.phase = 'main';
      endTurn(s, current(s).id);
    }
    updateLongest(s);
  }

  /* ---------------- 시야 ---------------- */

  function viewFor(s, pid) {
    var me = playerOf(s, pid);
    return {
      me: pid,
      phase: s.phase, turn: s.turn, dice: s.dice, robber: s.robber,
      turnCount: s.turnCount, winner: s.winner,
      bank: JSON.parse(JSON.stringify(s.bank)),
      devLeft: s.devDeck.length,
      freeRoads: s.freeRoads, playedDev: s.playedDev,
      lastGain: s.lastGain ? JSON.parse(JSON.stringify(s.lastGain)) : null,
      setup: { idx: s.setupIdx, sub: s.setupSub, spot: s.setupSpot, who: s.phase === 'setup' ? setupPlayer(s).id : null },
      mustDiscard: JSON.parse(JSON.stringify(s.mustDiscard)),
      trade: s.trade ? JSON.parse(JSON.stringify(s.trade)) : null,
      longest: JSON.parse(JSON.stringify(s.longest)),
      army: JSON.parse(JSON.stringify(s.army)),
      board: {
        hexes: s.board.hexes.map(function (h) {
          return { i: h.i, q: h.q, r: h.r, X: h.X, Y: h.Y, terrain: h.terrain, res: h.res, number: h.number, corners: h.corners };
        }),
        verts: s.board.verts.map(function (v) {
          return { i: v.i, X: v.X, Y: v.Y, port: v.port, b: v.b ? { t: v.b.t, p: v.b.p } : null, hexes: v.hexes, adj: v.adj, edges: v.edges };
        }),
        edges: s.board.edges.map(function (e) { return { i: e.i, a: e.a, b: e.b, road: e.road }; }),
        ports: s.board.ports
      },
      players: s.players.map(function (p) {
        var pub = {
          id: p.id, name: p.name, color: p.color, bot: p.bot, out: p.out,
          cards: handCount(p), devCount: p.dev.length, knights: p.knights,
          left: JSON.parse(JSON.stringify(p.left)),
          ports: JSON.parse(JSON.stringify(p.ports)),
          vp: vpOf(s, p),
          roadLen: roadLength(s, p.id)
        };
        if (p.id === pid) {
          pub.res = JSON.parse(JSON.stringify(p.res));
          pub.dev = p.dev.map(function (d) { return { type: d.type, fresh: d.turn === s.turnCount }; });
          pub.vpFull = vpFull(s, p);
        }
        if (s.phase === 'over') {                          // 끝나면 전부 공개
          pub.vpFull = vpFull(s, p);
          pub.vpCards = p.dev.filter(function (d) { return d.type === 'vp'; }).length;
        }
        return pub;
      }),
      log: s.log.filter(function (l) { return !l.only || l.only === pid; })
        .slice(-40).map(function (l) { return { i: l.i, text: l.text, mine: !!l.only }; }),
      legal: me && !me.out ? {
        settlements: legalSettlements(s, pid),
        cities: legalCities(s, pid),
        roads: legalRoads(s, pid)
      } : { settlements: [], cities: [], roads: [] }
    };
  }

  /* 지금 움직여야 하는 사람들 */
  function needsAction(s) {
    if (s.phase === 'over') return [];
    if (s.phase === 'discard') return Object.keys(s.mustDiscard);
    if (s.phase === 'setup') return [setupPlayer(s).id];
    return [current(s).id];
  }
  /* 거래 제안에 아직 대답하지 않은 사람들 */
  function tradePending(s) {
    if (!s.trade) return [];
    return s.players.filter(function (p) {
      return !p.out && p.id !== s.trade.from && !s.trade.replies[p.id];
    }).map(function (p) { return p.id; });
  }

  root.Rules = {
    RES: RES, RES_NAME: RES_NAME, TERRAIN_NAME: TERRAIN_NAME, TERRAIN_RES: TERRAIN_RES,
    COST: COST, PIECES: PIECES, PIPS: PIPS, DEV_NAME: DEV_NAME, COLORS: COLORS,
    WIN_VP: WIN_VP, HAND_LIMIT: HAND_LIMIT, LONGEST_MIN: LONGEST_MIN, ARMY_MIN: ARMY_MIN,
    newGame: newGame, viewFor: viewFor, needsAction: needsAction, tradePending: tradePending,
    playerOf: playerOf, current: current, handCount: handCount, canPay: canPay,
    vpOf: vpOf, vpFull: vpFull, roadLength: roadLength, tradeRate: tradeRate,
    legalSettlements: legalSettlements, legalCities: legalCities, legalRoads: legalRoads,
    robberVictims: robberVictims, portName: portName, resText: resText,
    placeSettlement: placeSettlement, placeRoad: placeRoad, roll: roll, discard: discard,
    moveRobber: moveRobber, build: build, buyDev: buyDev, playDev: playDev,
    bankTrade: bankTrade, offerTrade: offerTrade, replyTrade: replyTrade,
    acceptTrade: acceptTrade, cancelTrade: cancelTrade, endTurn: endTurn, dropPlayer: dropPlayer
  };
})(typeof self !== 'undefined' ? self : this);
