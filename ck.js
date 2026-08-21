/* 카탄: 도시와 기사 — 규칙 엔진
   기본판(rules.js)의 판 생성과 기하만 빌려 쓰고, 진행 규칙은 여기서 따로 다룬다.
   상품 3종, 주사위 3개, 도시 개발, 기사, 야만족, 진보카드 54장, 13점 승리. */
(function (root) {
  'use strict';
  var R = root.Rules;

  /* ---------------- 상수 ---------------- */

  var RES = ['b', 'l', 'w', 'g', 'o'];                  // 벽돌(흙) 나무 양 밀 철
  var COM = ['c', 'p', 'n'];                            // 옷감 종이 화폐
  var ALL = RES.concat(COM);
  var NAME = {
    b: '흙', l: '나무', w: '양', g: '밀', o: '철',
    c: '옷감', p: '종이', n: '화폐'
  };
  // 도시가 있을 때 땅이 주는 것 — 산·숲·초원은 자원1+상품1, 언덕·농지는 자원2
  var CITY_YIELD = {
    hills: { b: 2 }, fields: { g: 2 },
    mountains: { o: 1, n: 1 }, forest: { l: 1, p: 1 }, pasture: { w: 1, c: 1 }
  };
  // 도시 개발 세 분야 — 상업(노랑·옷감), 정치(파랑·화폐), 과학(초록·종이)
  var TRACKS = ['trade', 'politics', 'science'];
  var TRACK_NAME = { trade: '상업', politics: '정치', science: '과학' };
  var TRACK_COM = { trade: 'c', politics: 'n', science: 'p' };
  var TRACK_COLOR = { trade: '노랑', politics: '파랑', science: '초록' };
  var LEVEL_NAME = {
    trade: ['시장', '협동조합', '길드', '은행', '종합 거래소'],
    politics: ['시청', '교회', '요새', '대성당', '카탄 의회'],
    science: ['수도원', '도서관', '수로', '극장', '대학']
  };
  var MAX_LEVEL = 5;
  var METRO_LEVEL = 4;                                   // 4단계를 처음 올리면 수도
  var WIN_VP = 13;
  var BARB_TRACK = 7;                                    // 야만족이 일곱 칸을 오면 상륙
  var KNIGHT_MAX_PER_RANK = 2;
  var WALL_MAX = 3;
  var MAX_CARDS = 4;                                     // 진보카드는 넉 장까지
  var HAND_BASE = 7;                                     // 성벽 하나마다 +2

  var COST = {
    road: { b: 1, l: 1 },
    settlement: { b: 1, l: 1, w: 1, g: 1 },
    city: { g: 2, o: 3 },
    wall: { b: 2 },
    knight: { o: 1, w: 1 },
    upgrade: { o: 1, w: 1 },
    activate: { g: 1 }
  };
  var PIECES = { road: 15, settlement: 5, city: 4 };

  // 이벤트 주사위 여섯 면 — 야만선 셋, 성문 셋
  var EVENT_FACES = ['ship', 'ship', 'ship', 'trade', 'politics', 'science'];

  /* ---------------- 진보카드 54장 ---------------- */

  var PROGRESS = {
    science: [
      ['alchemist', '연금술사', 2], ['crane', '기중기', 2], ['mining', '광산', 2],
      ['irrigation', '관개 시설', 2], ['printer', '인쇄소', 1], ['inventor', '발명가', 2],
      ['engineer', '기술자', 1], ['medicine', '의료 기술', 2], ['smith', '제련술', 2],
      ['roadbuild', '도로 건설', 2]
    ],
    politics: [
      ['bishop', '주교', 2], ['diplomat', '외교관', 2], ['constitution', '헌법', 1],
      ['deserter', '변절자', 2], ['saboteur', '방해자', 2], ['spy', '첩자', 3],
      ['intrigue', '음모', 2], ['wedding', '결혼', 2], ['warlord', '사령관', 2]
    ],
    trade: [
      ['merchant', '상인', 6], ['harbor', '무역항', 2], ['fleet', '상선대', 2],
      ['trader', '전문 상인', 2], ['commMono', '상품 독점', 2], ['resMono', '자원 독점', 4]
    ]
  };
  var CARD_NAME = {};
  Object.keys(PROGRESS).forEach(function (t) {
    PROGRESS[t].forEach(function (c) { CARD_NAME[c[0]] = c[1]; });
  });
  // 얻는 즉시 공개하는 승점 카드
  var VP_CARDS = { printer: 1, constitution: 1 };

  function makeProgressDecks(rnd) {
    var decks = {};
    TRACKS.forEach(function (t) {
      var d = [];
      PROGRESS[t].forEach(function (c) {
        for (var i = 0; i < c[2]; i++) d.push(c[0]);
      });
      decks[t] = R.shuffle(d, rnd);
    });
    return decks;
  }

  /* ---------------- 상태 ---------------- */

  function emptyHand() {
    var h = {};
    ALL.forEach(function (c) { h[c] = 0; });
    return h;
  }
  function err(m) { return { ok: false, error: m }; }
  var OK = { ok: true };

  function newGame(seats, seed) {
    var rnd = R.mulberry(seed >>> 0 || 1);
    var board = R.makeBoard(rnd);
    var s = {
      ext: 'ck',
      seed: seed >>> 0 || 1,
      rnd: rnd,
      board: board,
      bank: (function () {
        var b = {};
        RES.forEach(function (c) { b[c] = 19; });
        COM.forEach(function (c) { b[c] = 12; });   // 상품은 종류당 12장
        return b;
      })(),
      progress: makeProgressDecks(rnd),
      players: seats.map(function (st, i) {
        return {
          id: st.id, name: st.name, bot: !!st.bot, color: R.COLORS[i], seat: i,
          res: emptyHand(),
          cards: [],                                  // 진보카드 (사용 전)
          vpCards: 0,                                 // 인쇄소·헌법 등 공개 승점
          defender: 0,                                // 카탄의 수호자 승점
          level: { trade: 0, politics: 0, science: 0 },
          metro: { trade: false, politics: false, science: false },
          left: { road: PIECES.road, settlement: PIECES.settlement, city: PIECES.city },
          walls: 0,
          ports: { any: false, b: false, l: false, w: false, g: false, o: false },
          settlements: [], cities: [], roads: [],
          knights: [],                                // {v, rank:1..3, active, movedTurn}
          knightsLeft: { 1: KNIGHT_MAX_PER_RANK, 2: KNIGHT_MAX_PER_RANK, 3: KNIGHT_MAX_PER_RANK },
          out: false
        };
      }),
      turn: 0, phase: 'setup', dice: null, event: null,
      setupIdx: 0, setupSub: 'settlement', setupSpot: null,
      robber: 0, robberBack: 'main', merchant: null,
      mustDiscard: {}, freeRoads: 0,
      barb: 0, barbResult: null,
      playedCardThisTurn: false, boughtCards: [],
      knightActed: {},                                // 이번 차례에 행동한 기사
      trade: null,
      longest: { p: null, len: 0 },
      pending: null,                                  // 카드 처리 중 기다리는 선택
      turnCount: 0, winner: null, log: [], logId: 0, recent: []
    };
    board.hexes.forEach(function (h, i) { if (h.terrain === 'desert') s.robber = i; });
    s.setupOrder = [];
    for (var i = 0; i < s.players.length; i++) s.setupOrder.push(i);
    for (var j = s.players.length - 1; j >= 0; j--) s.setupOrder.push(j);
    say(s, null, '마을과 도로를 하나씩 놓고, 두 바퀴째는 역순으로 도시와 도로를 놓습니다. 도시 둘레의 자원을 받고 시작합니다.');
    return s;
  }

  function note(s, kind, id, pid) {
    s.recent = s.recent || [];
    s.recent.push({ kind: kind, id: id, p: pid, turn: s.turnCount });
    if (s.recent.length > 30) s.recent.shift();
  }

  function say(s, only, text) {
    s.log.push({ i: s.logId++, only: only, text: text });
    if (s.log.length > 140) s.log.shift();
  }
  function playerOf(s, pid) {
    for (var i = 0; i < s.players.length; i++) if (s.players[i].id === pid) return s.players[i];
    return null;
  }
  function current(s) { return s.players[s.turn]; }
  function setupPlayer(s) { return s.players[s.setupOrder[s.setupIdx]]; }
  function handCount(p) {
    var n = 0;
    ALL.forEach(function (c) { n += p.res[c]; });
    return n;
  }
  function handLimit(p) { return HAND_BASE + p.walls * 2; }
  function canPay(p, cost) { for (var c in cost) if (p.res[c] < cost[c]) return false; return true; }
  function pay(s, p, cost) { for (var c in cost) { p.res[c] -= cost[c]; s.bank[c] += cost[c]; } }
  function take(s, p, c, n) {
    n = Math.min(n, s.bank[c]);
    p.res[c] += n; s.bank[c] -= n;
    return n;
  }
  function handText(map) {
    return ALL.filter(function (c) { return map[c] > 0; })
      .map(function (c) { return NAME[c] + (map[c] > 1 ? ' ' + map[c] : ''); }).join(' · ');
  }
  function roll1(s) { return 1 + Math.floor(s.rnd() * 6); }

  /* ---------------- 승점 ---------------- */

  function vpOf(s, p) {
    var v = p.settlements.length + p.cities.length * 2;
    TRACKS.forEach(function (t) { if (p.metro[t]) v += 2; });
    if (s.longest.p === p.id) v += 2;
    v += p.defender;
    if (p.merchantVP) v += p.merchantVP;
    return v;
  }
  function vpFull(s, p) { return vpOf(s, p) + p.vpCards; }
  function checkWin(s, p) {
    if (s.winner) return;
    if (vpFull(s, p) >= WIN_VP) {
      s.winner = p.id; s.phase = 'over';
      say(s, null, p.name + ' 승리 — ' + vpFull(s, p) + '점');
    }
  }

  /* ---------------- 자리 판정 ---------------- */

  function spacingOK(s, v) {
    var vert = s.board.verts[v];
    if (!vert || vert.b) return false;
    for (var i = 0; i < vert.adj.length; i++) if (s.board.verts[vert.adj[i]].b) return false;
    return true;
  }
  function touchesOwnRoad(s, v, pid) {
    var es = s.board.verts[v].edges;
    for (var i = 0; i < es.length; i++) if (s.board.edges[es[i]].road === pid) return true;
    return false;
  }
  function knightAt(s, v) {
    for (var i = 0; i < s.players.length; i++) {
      var ks = s.players[i].knights;
      for (var j = 0; j < ks.length; j++) if (ks[j].v === v) return { p: s.players[i], k: ks[j] };
    }
    return null;
  }
  function legalSettlements(s, pid) {
    var out = [];
    var setup = s.phase === 'setup';
    for (var v = 0; v < s.board.verts.length; v++) {
      if (!spacingOK(s, v)) continue;
      if (knightAt(s, v)) continue;                       // 기사가 서 있으면 못 짓는다
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
  function connects(s, e, pid) {
    return [e.a, e.b].some(function (v) {
      var vb = s.board.verts[v].b;
      if (vb && vb.p === pid) return true;
      if (vb && vb.p !== pid) return false;               // 남의 건물은 못 뚫는다
      var kn = knightAt(s, v);
      if (kn && kn.p.id !== pid) return false;            // 남의 기사도 길을 막는다
      return touchesOwnRoad(s, v, pid);
    });
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
  // 기사를 새로 놓을 수 있는 빈 꼭짓점 — 내 도로에 닿아 있어야 하고, 간격 규칙은 없다
  function legalKnightSpots(s, pid) {
    var out = [];
    for (var v = 0; v < s.board.verts.length; v++) {
      if (s.board.verts[v].b) continue;
      if (knightAt(s, v)) continue;
      if (!touchesOwnRoad(s, v, pid)) continue;
      out.push(v);
    }
    return out;
  }

  /* ---------------- 최장 교역로 ---------------- */

  function blockedFor(s, vIdx, pid) {
    var b = s.board.verts[vIdx].b;
    if (b && b.p !== pid) return true;
    var kn = knightAt(s, vIdx);
    return !!(kn && kn.p.id !== pid);                     // 기사도 길을 끊는다
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
    if (holder && lens[holder] >= 5 && lens[holder] >= top) { s.longest = { p: holder, len: lens[holder] }; return; }
    if (top < 5) {
      if (holder) say(s, null, '최장 교역로가 사라졌습니다.');
      s.longest = { p: null, len: top };
      return;
    }
    var tops = s.players.filter(function (p) { return lens[p.id] === top; });
    if (tops.length > 1) {
      if (holder && lens[holder] === top) { s.longest = { p: holder, len: top }; return; }
      s.longest = { p: null, len: top };
      return;
    }
    if (tops[0].id !== holder) say(s, null, tops[0].name + ' 최장 교역로 (' + top + ') — 2점');
    s.longest = { p: tops[0].id, len: top };
  }


  /* ---------------- 준비 단계 ---------------- */

  function placeSettlement(s, pid, v) {
    if (s.phase !== 'setup') return err('지금은 놓을 때가 아닙니다.');
    if (s.setupSub !== 'settlement') return err('먼저 도로를 놓아야 합니다.');
    var p = setupPlayer(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (!spacingOK(s, v)) return err('다른 건물과 두 변 이상 떨어뜨려 놓아야 합니다.');
    var second = s.setupIdx >= s.players.length;
    if (second) {
      if (!p.left.city) return err('도시 말이 없습니다.');
      s.board.verts[v].b = { t: 'city', p: pid };
      p.cities.push(v); p.left.city--;
      note(s, 'city', v, pid);
      say(s, null, p.name + ' 도시');
    } else {
      s.board.verts[v].b = { t: 'settlement', p: pid };
      p.settlements.push(v); p.left.settlement--;
      note(s, 'settlement', v, pid);
      say(s, null, p.name + ' 마을');
    }
    if (s.board.verts[v].port) p.ports[s.board.verts[v].port] = true;
    s.setupSpot = v; s.setupSub = 'road';
    if (second) {                                        // 도시 둘레 자원 한 장씩
      var got = emptyHand();
      s.board.verts[v].hexes.forEach(function (h) {
        var hex = s.board.hexes[h];
        if (hex.res) got[hex.res] += take(s, p, hex.res, 1);
      });
      var t = handText(got);
      if (t) say(s, null, p.name + ' 첫 자원 — ' + t);
    }
    return OK;
  }

  function placeRoad(s, pid, e) {
    if (s.phase !== 'setup') return err('지금은 놓을 때가 아닙니다.');
    if (s.setupSub !== 'road') return err('먼저 건물을 놓아야 합니다.');
    var p = setupPlayer(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (legalRoads(s, pid).indexOf(e) < 0) return err('방금 놓은 건물에 붙여서 놓아야 합니다.');
    s.board.edges[e].road = pid;
    p.roads.push(e); p.left.road--;
    note(s, 'road', e, pid);
    s.setupSpot = null; s.setupSub = 'settlement';
    s.setupIdx++;
    if (s.setupIdx >= s.setupOrder.length) {
      s.phase = 'roll';
      s.turn = s.setupOrder[s.setupOrder.length - 1];     // 마지막에 놓은 사람부터
      s.turnCount = 1;
      updateLongest(s);
      say(s, null, '준비 끝. ' + current(s).name + '부터 주사위를 굴립니다.');
    }
    return OK;
  }

  /* ---------------- 주사위 세 개 ---------------- */

  function roll(s, pid) {
    if (s.phase !== 'roll') return err('지금은 주사위를 굴릴 때가 아닙니다.');
    if (current(s).id !== pid) return err('차례가 아닙니다.');
    var white = roll1(s), red = roll1(s);
    if (s.alchemist) { white = s.alchemist[0]; red = s.alchemist[1]; s.alchemist = null; }
    var ev = EVENT_FACES[Math.floor(s.rnd() * 6)];
    s.dice = [white, red];
    s.event = ev;
    s.lastGain = null;
    var sum = white + red;
    say(s, null, current(s).name + ' 주사위 ' + white + ' + ' + red + ' = ' + sum +
      ' · 이벤트 ' + (ev === 'ship' ? '야만선' : TRACK_COLOR[ev] + ' 성문'));

    // ① 야만족 함대 / 성문
    if (ev === 'ship') {
      s.barb++;
      if (s.barb >= BARB_TRACK) { barbarianAttack(s); s.barb = 0; }
      else say(s, null, '야만족 함대가 한 칸 다가옵니다. (' + s.barb + '/' + BARB_TRACK + ')');
    } else {
      giveProgress(s, ev, red);
    }
    if (s.winner) return OK;

    // ② 자원과 상품
    if (sum === 7) { startRobber(s, 'main'); return OK; }
    produce(s, sum);
    s.phase = 'main';
    return OK;
  }

  // 성문 색과 빨간 주사위로 진보카드를 나눠 준다
  function giveProgress(s, track, red) {
    var got = [];
    var order = [];
    for (var i = 0; i < s.players.length; i++) order.push(s.players[(s.turn + i) % s.players.length]);
    order.forEach(function (p) {
      if (p.out) return;
      var lv = p.level[track];
      if (!lv) return;
      if (red > lv + 1) return;                          // 개발 단계만큼만 눈이 보인다
      if (!s.progress[track].length) return;
      var card = s.progress[track].pop();
      if (VP_CARDS[card]) {
        p.vpCards += VP_CARDS[card];
        say(s, null, p.name + ' ' + TRACK_NAME[track] + ' 진보카드 — ' + CARD_NAME[card] + ' (승점 1, 즉시 공개)');
        checkWin(s, p);
      } else if (p.cards.length >= MAX_CARDS) {
        // 손에 넉 장을 이미 들고 있으면 받자마자 더미 맨 아래로 보낸다
        s.progress[track].unshift(card);
        say(s, p.id, '진보카드가 넉 장이라 ' + CARD_NAME[card] + '을(를) 받지 못했습니다.');
        say(s, null, p.name + '은(는) 진보카드가 넉 장이라 받지 못했습니다.');
      } else {
        p.cards.push({ type: card, track: track });
        got.push(p.name);
        say(s, p.id, '진보카드를 받았습니다 — ' + CARD_NAME[card]);
      }
    });
    if (got.length) say(s, null, TRACK_COLOR[track] + ' 성문 — ' + got.join(', ') + ' 진보카드 획득');
  }

  /* ---------------- 생산 ---------------- */

  function produce(s, sum) {
    var want = {}, total = {};
    var claims = [];
    ALL.forEach(function (c) { total[c] = 0; });
    s.board.hexes.forEach(function (h, i) {
      if (h.number !== sum || i === s.robber || !h.res) return;
      h.corners.forEach(function (v) {
        var b = s.board.verts[v].b;
        if (!b) return;
        var yield_ = {};
        if (b.t === 'city') yield_ = CITY_YIELD[h.terrain] || {};
        else yield_[h.res] = 1;
        want[b.p] = want[b.p] || emptyHand();
        for (var c in yield_) {
          want[b.p][c] += yield_[c];
          total[c] += yield_[c];
          claims.push({ hex: i, p: b.p, res: c, n: yield_[c] });
        }
      });
    });
    // 은행이 모자라면 — 한 명뿐이면 남은 만큼, 여럿이면 아무도 못 받는다 (상품도 같다)
    ALL.forEach(function (c) {
      if (total[c] <= s.bank[c]) return;
      var claimants = Object.keys(want).filter(function (pid) { return want[pid][c] > 0; });
      if (claimants.length === 1) {
        want[claimants[0]][c] = s.bank[c];
        say(s, null, NAME[c] + '이(가) 모자라 남은 만큼만 나갑니다.');
      } else {
        claimants.forEach(function (pid) { want[pid][c] = 0; });
        say(s, null, NAME[c] + '이(가) 모자라 이번에는 아무도 못 받습니다.');
      }
    });
    var any = false, received = {};
    s.players.forEach(function (p) {
      var w = want[p.id];
      if (!w) { received[p.id] = emptyHand(); return; }
      var got = emptyHand();
      ALL.forEach(function (c) { if (w[c] > 0) got[c] = take(s, p, c, w[c]); });
      received[p.id] = got;
      var t = handText(got);
      if (t) { say(s, null, p.name + ' ← ' + t); any = true; }
    });
    if (!any) say(s, null, '아무도 못 받았습니다.');

    // 수로(과학 3단계) — 한 장도 못 받았으면 원하는 자원 하나를 받는다
    s.players.forEach(function (p) {
      if (p.out || p.level.science < 3) return;
      var none = true;
      ALL.forEach(function (c) { if (received[p.id] && received[p.id][c] > 0) none = false; });
      if (none) {
        s.aqueduct = s.aqueduct || [];
        s.aqueduct.push(p.id);
      }
    });
    s.lastGain = [];
    claims.forEach(function (cl) {
      var left = received[cl.p] ? received[cl.p][cl.res] : 0;
      if (left <= 0) return;
      var t2 = Math.min(cl.n, left);
      received[cl.p][cl.res] -= t2;
      s.lastGain.push({ hex: cl.hex, p: cl.p, res: cl.res, n: t2 });
    });
  }

  /* ---------------- 야만족 ---------------- */

  function knightPower(s, p) {
    var n = 0;
    p.knights.forEach(function (k) { if (k.active) n += k.rank; });
    return n;
  }
  function barbarianAttack(s) {
    var cityCount = 0;
    s.players.forEach(function (p) { if (!p.out) cityCount += p.cities.length; });
    var powers = {}, defTotal = 0;
    s.players.forEach(function (p) {
      powers[p.id] = p.out ? 0 : knightPower(s, p);
      defTotal += powers[p.id];
    });
    say(s, null, '⚔ 야만족 상륙! 야만족 힘 ' + cityCount + ' vs 기사 힘 ' + defTotal);

    if (defTotal >= cityCount) {
      var top = 0;
      s.players.forEach(function (p) { if (powers[p.id] > top) top = powers[p.id]; });
      var heroes = s.players.filter(function (p) { return !p.out && powers[p.id] === top && top > 0; });
      if (heroes.length === 1) {
        heroes[0].defender++;
        say(s, null, heroes[0].name + ' 카탄의 수호자 — 승점 1');
        checkWin(s, heroes[0]);
      } else if (heroes.length > 1) {
        heroes.forEach(function (p) {
          var t = pickBestTrack(s, p);
          if (s.progress[t] && s.progress[t].length) {
            var card = s.progress[t].pop();
            if (VP_CARDS[card]) { p.vpCards += VP_CARDS[card]; checkWin(s, p); }
            else if (p.cards.length >= MAX_CARDS) { s.progress[t].unshift(card); }
            else p.cards.push({ type: card, track: t });
            say(s, null, p.name + ' 방어 공로로 ' + TRACK_NAME[t] + ' 진보카드');
          }
        });
      }
      s.barbResult = { win: true, power: defTotal, barb: cityCount };
    } else {
      var low = Infinity;
      s.players.forEach(function (p) {
        if (p.out || !p.cities.length) return;           // 도시가 없으면 약탈 대상이 아니다
        if (powers[p.id] < low) low = powers[p.id];
      });
      var victims = s.players.filter(function (p) {
        return !p.out && p.cities.length && powers[p.id] === low;
      });
      victims.forEach(function (p) {
        var v = weakestCity(s, p);
        if (v === null) return;
        s.board.verts[v].b = { t: 'settlement', p: p.id };
        p.cities = p.cities.filter(function (x) { return x !== v; });
        p.settlements.push(v);
        p.left.city++; p.left.settlement--;
        if (p.walls > 0) { p.walls--; }
        say(s, null, p.name + '의 도시가 약탈당해 마을로 내려갔습니다.');
      });
      if (!victims.length) say(s, null, '도시를 가진 사람이 없어 약탈이 없습니다.');
      s.barbResult = { win: false, power: defTotal, barb: cityCount };
    }
    // 전투가 끝나면 모든 기사가 비활동이 된다
    s.players.forEach(function (p) { p.knights.forEach(function (k) { k.active = false; }); });
  }
  function pickBestTrack(s, p) {
    var best = TRACKS[0], bl = -1;
    TRACKS.forEach(function (t) {
      if (s.progress[t].length && p.level[t] > bl) { bl = p.level[t]; best = t; }
    });
    return best;
  }
  function weakestCity(s, p) {
    if (!p.cities.length) return null;
    var best = p.cities[0], bs = Infinity;
    p.cities.forEach(function (v) {
      var pipsum = 0;
      s.board.verts[v].hexes.forEach(function (h) {
        var hx = s.board.hexes[h];
        if (hx.number) pipsum += R.PIPS[hx.number];
      });
      if (pipsum < bs) { bs = pipsum; best = v; }
    });
    return best;
  }

  /* ---------------- 도둑과 버리기 ---------------- */

  function startRobber(s, back) {
    s.robberBack = back;
    s.mustDiscard = {};
    if (s.barb === 0 && !s.barbEverLanded) {
      say(s, null, '7 — 야만족이 아직 상륙한 적이 없어 도둑은 움직이지 않습니다.');
      s.phase = back;
      return;
    }
    s.players.forEach(function (p) {
      if (p.out) return;
      var n = handCount(p);
      if (n > handLimit(p)) s.mustDiscard[p.id] = Math.floor(n / 2);
    });
    var names = Object.keys(s.mustDiscard).map(function (pid) {
      return playerOf(s, pid).name + ' ' + s.mustDiscard[pid] + '장';
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
    var p = playerOf(s, pid), tmp = emptyHand();
    for (var i = 0; i < list.length; i++) {
      if (ALL.indexOf(list[i]) < 0) return err('그런 카드가 없습니다.');
      tmp[list[i]]++;
      if (tmp[list[i]] > p.res[list[i]]) return err('가지고 있지 않은 카드입니다.');
    }
    ALL.forEach(function (c) { p.res[c] -= tmp[c]; s.bank[c] += tmp[c]; });
    delete s.mustDiscard[pid];
    say(s, null, p.name + ' 버림 — ' + handText(tmp));
    if (!Object.keys(s.mustDiscard).length) {
      if (s.saboteurBack) { s.phase = s.saboteurBack; s.saboteurBack = null; }
      else {
        s.phase = 'robber';
        say(s, null, current(s).name + ' 차례 — 도둑을 옮깁니다.');
      }
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
    say(s, null, playerOf(s, pid).name + ' 도둑을 ' + (h.number ? h.number + ' 타일' : '사막') + '(으)로 옮김');
    var target = victim || (cands.length === 1 ? cands[0] : null);
    if (target) steal(s, pid, target);
    s.phase = s.robberBack;
    return OK;
  }

  function steal(s, pid, victimId) {
    var thief = playerOf(s, pid), v = playerOf(s, victimId);
    var pool = [];
    ALL.forEach(function (c) { for (var i = 0; i < v.res[c]; i++) pool.push(c); });
    if (!pool.length) return;
    var c = pool[Math.floor(s.rnd() * pool.length)];
    v.res[c]--; thief.res[c]++;
    say(s, null, thief.name + '이(가) ' + v.name + '에게서 카드 한 장을 가져갔습니다.');
    say(s, pid, '가져온 것: ' + NAME[c]);
    say(s, victimId, '빼앗긴 것: ' + NAME[c]);
  }



  /* ---------------- 건설 ---------------- */

  function build(s, pid, kind, id) {
    if (s.phase !== 'main') return err('지금은 지을 때가 아닙니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (s.trade) return err('먼저 거래 제안을 정리해 주세요.');
    if (s.pending) return err('먼저 진행 중인 선택을 끝내 주세요.');

    if (kind === 'road') {
      if (!p.left.road) return err('도로 말을 다 썼습니다.');
      var e = s.board.edges[id];
      if (!e) return err('그런 자리가 없습니다.');
      if (e.road) return err('이미 도로가 있습니다.');
      if (!connects(s, e, pid)) return err('내 도로나 건물에 붙여서 지어야 합니다.');
      var free = s.freeRoads > 0;
      if (!free && !canPay(p, COST.road)) return err('자원이 모자랍니다. (흙 1 · 나무 1)');
      if (free) s.freeRoads--; else pay(s, p, COST.road);
      e.road = pid; p.roads.push(id); p.left.road--;
      note(s, 'road', id, pid);
      say(s, null, p.name + ' 도로' + (free ? ' (무료)' : ''));
      if (s.freeRoads > 0 && (!p.left.road || !legalRoads(s, pid).length)) {
        s.freeRoads = 0;
        say(s, null, '더 놓을 자리가 없어 남은 공짜 도로는 넘어갑니다.');
      }
      updateLongest(s);
      checkWin(s, p);
      return OK;
    }

    if (kind === 'settlement') {
      if (!p.left.settlement) return err('마을 말을 다 썼습니다.');
      if (!spacingOK(s, id)) return err('다른 건물과 두 변 이상 떨어뜨려야 합니다.');
      if (knightAt(s, id)) return err('기사가 서 있는 자리입니다.');
      if (!touchesOwnRoad(s, id, pid)) return err('내 도로에 이어서 지어야 합니다.');
      if (!canPay(p, COST.settlement)) return err('자원이 모자랍니다. (흙·나무·양·밀)');
      pay(s, p, COST.settlement);
      s.board.verts[id].b = { t: 'settlement', p: pid };
      p.settlements.push(id); p.left.settlement--;
      note(s, 'settlement', id, pid);
      var port = s.board.verts[id].port;
      if (port) p.ports[port] = true;
      say(s, null, p.name + ' 마을 — 1점');
      updateLongest(s);
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
      note(s, 'city', id, pid);
      p.settlements = p.settlements.filter(function (x) { return x !== id; });
      p.cities.push(id);
      p.left.city--; p.left.settlement++;
      say(s, null, p.name + ' 도시 — 2점');
      checkWin(s, p);
      return OK;
    }

    if (kind === 'wall') {
      var vw = s.board.verts[id];
      if (!vw || !vw.b || vw.b.p !== pid || vw.b.t !== 'city') return err('내 도시에만 성벽을 쌓을 수 있습니다.');
      if (vw.wall) return err('이미 성벽이 있습니다.');
      if (p.walls >= WALL_MAX) return err('성벽은 3개까지만 지을 수 있습니다.');
      if (!canPay(p, COST.wall)) return err('자원이 모자랍니다. (흙 2)');
      pay(s, p, COST.wall);
      vw.wall = true; p.walls++;
      say(s, null, p.name + ' 도시 성벽 — 손패 한도 ' + handLimit(p) + '장');
      return OK;
    }
    return err('그런 건물이 없습니다.');
  }

  /* ---------------- 기사 ---------------- */

  function knightCount(s, p, rank) {
    var n = 0;
    p.knights.forEach(function (k) { if (k.rank === rank) n++; });
    return n;
  }
  function placeKnight(s, pid, v) {
    if (s.phase !== 'main') return err('지금은 놓을 때가 아닙니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (knightCount(s, p, 1) >= KNIGHT_MAX_PER_RANK) return err('하급 기사는 둘까지입니다. 하나를 승급시켜야 합니다.');
    if (legalKnightSpots(s, pid).indexOf(v) < 0) return err('내 도로가 닿은 빈 꼭짓점에만 놓을 수 있습니다.');
    if (!canPay(p, COST.knight)) return err('자원이 모자랍니다. (철 1 · 양 1)');
    pay(s, p, COST.knight);
    p.knights.push({ v: v, rank: 1, active: false, id: 'k' + (s.logId) + p.knights.length });
    say(s, null, p.name + ' 하급 기사를 놓았습니다.');
    updateLongest(s);
    return OK;
  }

  function findKnight(p, v) {
    for (var i = 0; i < p.knights.length; i++) if (p.knights[i].v === v) return p.knights[i];
    return null;
  }

  function activateKnight(s, pid, v) {
    if (s.phase !== 'main') return err('지금은 할 수 없습니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    var k = findKnight(p, v);
    if (!k) return err('내 기사가 아닙니다.');
    if (k.active) return err('이미 활동 상태입니다.');
    if (!canPay(p, COST.activate)) return err('밀 1장이 필요합니다.');
    pay(s, p, COST.activate);
    k.active = true;
    k.activatedTurn = s.turnCount;                       // 이번 차례에는 행동 못 한다
    say(s, null, p.name + ' 기사를 활동 상태로 바꿨습니다.');
    return OK;
  }

  function upgradeKnight(s, pid, v) {
    if (s.phase !== 'main') return err('지금은 할 수 없습니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    var k = findKnight(p, v);
    if (!k) return err('내 기사가 아닙니다.');
    if (k.rank >= 3) return err('이미 상급 기사입니다.');
    if (k.rank === 2 && p.level.politics < 3) return err('상급으로 올리려면 정치 3단계(요새)가 필요합니다.');
    if (knightCount(s, p, k.rank + 1) >= KNIGHT_MAX_PER_RANK) return err('그 등급의 기사는 둘까지입니다.');
    if (k.upgradedTurn === s.turnCount) return err('기사는 한 차례에 한 단계만 승급합니다.');
    if (!canPay(p, COST.upgrade)) return err('자원이 모자랍니다. (철 1 · 양 1)');
    pay(s, p, COST.upgrade);
    k.rank++;
    k.upgradedTurn = s.turnCount;
    say(s, null, p.name + ' 기사를 ' + (k.rank === 2 ? '중급' : '상급') + '으로 승급시켰습니다.');
    return OK;
  }

  // 기사가 갈 수 있는 곳 — 내 도로를 따라, 건물이 없고 기사가 없는 꼭짓점
  function knightMoves(s, pid, from) {
    var p = playerOf(s, pid);
    var k = findKnight(p, from);
    if (!k || !k.active) return [];
    var seen = {}, out = [], queue = [from];
    seen[from] = 1;
    while (queue.length) {
      var v = queue.shift();
      s.board.verts[v].edges.forEach(function (ei) {
        var e = s.board.edges[ei];
        if (e.road !== pid) return;
        var far = e.a === v ? e.b : e.a;
        if (seen[far]) return;
        seen[far] = 1;
        var b = s.board.verts[far].b;
        var kn = knightAt(s, far);
        if (b && b.p !== pid) return;                    // 남의 건물에서 길이 끊긴다
        if (!b && !kn) out.push(far);
        if (!kn) queue.push(far);
      });
    }
    return out;
  }
  // 추방할 수 있는 상대 기사 — 내 기사보다 등급이 낮아야 한다
  function knightDisplaceTargets(s, pid, from) {
    var p = playerOf(s, pid), k = findKnight(p, from);
    if (!k || !k.active) return [];
    var out = [];
    var reach = {}, queue = [from];
    reach[from] = 1;
    while (queue.length) {
      var v = queue.shift();
      s.board.verts[v].edges.forEach(function (ei) {
        var e = s.board.edges[ei];
        if (e.road !== pid) return;
        var far = e.a === v ? e.b : e.a;
        if (reach[far]) return;
        reach[far] = 1;
        var b = s.board.verts[far].b;
        var kn = knightAt(s, far);
        if (kn && kn.p.id !== pid && kn.k.rank < k.rank) out.push(far);
        if (b && b.p !== pid) return;
        if (!kn) queue.push(far);
      });
    }
    return out;
  }

  function moveKnight(s, pid, from, to) {
    if (s.phase !== 'main') return err('지금은 할 수 없습니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    var k = findKnight(p, from);
    if (!k) return err('내 기사가 아닙니다.');
    if (!k.active) return err('비활동 기사는 움직일 수 없습니다. 먼저 밀 1장으로 활성화하세요.');
    if (k.activatedTurn === s.turnCount) return err('이번 차례에 활동 상태가 된 기사는 아직 움직일 수 없습니다.');
    if (k.actedTurn === s.turnCount) return err('이 기사는 이번 차례에 이미 움직였습니다.');

    var target = knightAt(s, to);
    if (target && target.p.id !== pid) {
      // 추방
      if (knightDisplaceTargets(s, pid, from).indexOf(to) < 0) {
        return err('내 도로로 이어져 있고 내 기사보다 등급이 낮아야 추방할 수 있습니다.');
      }
      var victim = target.p, vk = target.k;
      var spots = knightRetreatSpots(s, victim.id, to);
      if (!spots.length) {
        victim.knights = victim.knights.filter(function (x) { return x !== vk; });
        say(s, null, p.name + '이(가) ' + victim.name + '의 기사를 추방했고, 갈 곳이 없어 기사가 사라졌습니다.');
      } else {
        vk.v = spots[0];
        s.displaced = { pid: victim.id, knight: vk, options: spots };
        say(s, null, p.name + '이(가) ' + victim.name + '의 기사를 밀어냈습니다.');
      }
      k.v = to;
    } else {
      if (knightMoves(s, pid, from).indexOf(to) < 0) return err('내 도로를 따라 빈 꼭짓점으로만 갈 수 있습니다.');
      k.v = to;
      say(s, null, p.name + ' 기사가 이동했습니다.');
    }
    k.active = false;                                     // 행동한 기사는 비활동
    k.actedTurn = s.turnCount;
    updateLongest(s);
    return OK;
  }
  function knightRetreatSpots(s, pid, from) {
    var out = [];
    var seen = {}, queue = [from];
    seen[from] = 1;
    while (queue.length) {
      var v = queue.shift();
      s.board.verts[v].edges.forEach(function (ei) {
        var e = s.board.edges[ei];
        if (e.road !== pid) return;
        var far = e.a === v ? e.b : e.a;
        if (seen[far]) return;
        seen[far] = 1;
        var b = s.board.verts[far].b;
        if (!b && !knightAt(s, far)) out.push(far);
        if (!b || b.p === pid) queue.push(far);
      });
    }
    return out;
  }

  // 기사로 도둑 쫓아내기
  function chaseRobber(s, pid, from) {
    if (s.phase !== 'main') return err('지금은 할 수 없습니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    var k = findKnight(p, from);
    if (!k) return err('내 기사가 아닙니다.');
    if (!k.active) return err('활동 상태인 기사만 도둑을 쫓을 수 있습니다.');
    if (k.activatedTurn === s.turnCount) return err('이번 차례에 활동 상태가 된 기사는 아직 행동할 수 없습니다.');
    if (k.actedTurn === s.turnCount) return err('이 기사는 이번 차례에 이미 행동했습니다.');
    if (s.board.verts[from].hexes.indexOf(s.robber) < 0) return err('도둑이 있는 땅에 닿은 기사만 쫓을 수 있습니다.');
    k.active = false; k.actedTurn = s.turnCount;
    s.robberBack = 'main';
    s.phase = 'robber';
    say(s, null, p.name + '의 기사가 도둑을 쫓아냅니다.');
    return OK;
  }

  /* ---------------- 도시 개발 ---------------- */

  function devCost(level) { return level + 1; }           // 1단계 상품1 … 5단계 상품5
  function canDevelop(s, p, track) {
    if (p.level[track] >= MAX_LEVEL) return false;
    return p.res[TRACK_COM[track]] >= devCost(p.level[track]) - (p.level.science >= 0 && p.craneUsed ? 0 : 0);
  }
  function develop(s, pid, track, useCrane) {
    if (s.phase !== 'main') return err('지금은 할 수 없습니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (TRACKS.indexOf(track) < 0) return err('그런 분야가 없습니다.');
    if (p.level[track] >= MAX_LEVEL) return err('이미 마지막 단계입니다.');
    if (p.level[track] >= METRO_LEVEL - 1 && !hasFreeCity(p)) {
      return err('수도를 올릴 도시가 없습니다. 도시를 하나 더 지어야 ' + METRO_LEVEL + '단계로 갈 수 있습니다.');
    }
    var need = devCost(p.level[track]);
    if (useCrane) {
      if (!p.craneReady) return err('기중기를 쓸 수 없습니다.');
      need -= 1;
    }
    var com = TRACK_COM[track];
    if (p.res[com] < need) return err(NAME[com] + ' ' + need + '장이 필요합니다.');
    p.res[com] -= need; s.bank[com] += need;
    if (useCrane) p.craneReady = false;
    p.level[track]++;
    var lv = p.level[track];
    say(s, null, p.name + ' ' + TRACK_NAME[track] + ' ' + lv + '단계 — ' + LEVEL_NAME[track][lv - 1]);
    if (lv >= METRO_LEVEL) grantMetro(s, p, track);
    checkWin(s, p);
    return OK;
  }
  // 4단계를 처음 넘기면 수도. 더 높이 올린 사람이 나오면 뺏긴다.
  function metroCount(p) {
    var n = 0;
    TRACKS.forEach(function (t) { if (p.metro[t]) n++; });
    return n;
  }
  // 수도는 도시 위에 올린다 — 아직 수도가 아닌 내 도시가 있어야 한다
  function hasFreeCity(p) { return p.cities.length > metroCount(p); }

  function grantMetro(s, p, track) {
    var holder = null;
    s.players.forEach(function (q) { if (q.metro[track]) holder = q; });
    if (!holder) {
      if (!hasFreeCity(p)) return;
      p.metro[track] = true;
      say(s, null, p.name + ' ' + TRACK_NAME[track] + ' 수도 건설 — 2점');
      return;
    }
    if (holder.id === p.id) return;
    if (p.level[track] > holder.level[track]) {
      if (!hasFreeCity(p)) return;
      holder.metro[track] = false;
      p.metro[track] = true;
      say(s, null, p.name + '이(가) ' + holder.name + '에게서 ' + TRACK_NAME[track] + ' 수도를 빼앗았습니다.');
      checkWin(s, p);
    }
  }

  /* ---------------- 거래 ---------------- */

  function tradeRate(p, c) {
    if (RES.indexOf(c) >= 0 && p.ports[c]) return 2;
    if (p.fleetPick === c) return 2;                       // 상선대
    if (p.ports.any) return 3;
    return 4;
  }
  function bankTrade(s, pid, give, get) {
    if (s.phase !== 'main') return err('지금은 거래할 때가 아닙니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (ALL.indexOf(give) < 0 || ALL.indexOf(get) < 0) return err('그런 카드가 없습니다.');
    if (give === get) return err('같은 것끼리는 바꾸지 않습니다.');
    var rate = tradeRate(p, give);
    if (p.res[give] < rate) return err(NAME[give] + ' ' + rate + '장이 있어야 합니다.');
    if (s.bank[get] < 1) return err('은행에 ' + NAME[get] + '이(가) 없습니다.');
    p.res[give] -= rate; s.bank[give] += rate;
    take(s, p, get, 1);
    say(s, null, p.name + ' 은행과 ' + rate + ':1 — ' + NAME[give] + ' → ' + NAME[get]);
    return OK;
  }

  function clean(m) {
    var out = {};
    ALL.forEach(function (c) { var n = Math.floor((m && m[c]) || 0); if (n > 0) out[c] = n; });
    return out;
  }
  function count(m) { var n = 0; for (var c in m) n += m[c]; return n; }

  function offerTrade(s, pid, give, want) {
    if (s.phase !== 'main') return err('지금은 거래할 때가 아닙니다.');
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (s.trade) return err('이미 제안이 올라가 있습니다.');
    var g = clean(give), w = clean(want);
    if (!count(g) || !count(w)) return err('주고받을 카드를 한 장 이상씩 넣어야 합니다.');
    for (var c in g) if (w[c]) return err('같은 것을 주고받을 수는 없습니다.');
    for (var c2 in g) if (p.res[c2] < g[c2]) return err('가진 것보다 많이 줄 수는 없습니다.');
    s.trade = { from: pid, give: g, want: w, replies: {} };
    say(s, null, p.name + ' 거래 제안 — ' + handText(g) + ' 주고 ' + handText(w) + ' 받기');
    return OK;
  }
  function replyTrade(s, pid, yes) {
    if (!s.trade) return err('올라온 제안이 없습니다.');
    if (s.trade.from === pid) return err('내가 낸 제안입니다.');
    var p = playerOf(s, pid);
    if (!p || p.out) return err('참가자가 아닙니다.');
    if (yes) for (var c in s.trade.want) if (p.res[c] < s.trade.want[c]) return err('요구한 카드가 모자랍니다.');
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
    for (c in g) if (a.res[c] < g[c]) return err('줄 카드가 모자랍니다.');
    for (c in w) if (b.res[c] < w[c]) return err('상대의 카드가 모자랍니다.');
    for (c in g) { a.res[c] -= g[c]; b.res[c] += g[c]; }
    for (c in w) { b.res[c] -= w[c]; a.res[c] += w[c]; }
    say(s, null, a.name + ' ↔ ' + b.name + ' 거래 성사 — ' + handText(g) + ' ↔ ' + handText(w));
    s.trade = null;
    return OK;
  }
  function cancelTrade(s, pid) {
    if (!s.trade) return err('올라온 제안이 없습니다.');
    if (s.trade.from !== pid) return err('제안한 사람만 거둘 수 있습니다.');
    s.trade = null;
    say(s, null, playerOf(s, pid).name + ' 제안을 거뒀습니다.');
    return OK;
  }

  /* ---------------- 차례 넘기기 ---------------- */

  function endTurn(s, pid) {
    if (s.phase === 'roll') return err('먼저 주사위를 굴려야 합니다.');
    if (s.phase === 'discard') return err('버릴 카드를 먼저 고르세요.');
    if (s.phase === 'robber') return err('먼저 도둑을 옮겨야 합니다.');
    if (s.phase !== 'main') return err('아직 차례를 끝낼 수 없습니다.');
    if (current(s).id !== pid) return err('차례가 아닙니다.');
    if (s.pending) return err('진행 중인 선택을 먼저 끝내 주세요.');
    if (s.freeRoads > 0) {
      var p0 = current(s);
      if (p0.left.road && legalRoads(s, pid).length) return err('공짜 도로 ' + s.freeRoads + '개가 남았습니다.');
      s.freeRoads = 0;
    }
    s.players.forEach(function (q) { if (q.fleetTurn !== s.turnCount) { q.fleetPick = null; } });
    s.trade = null; s.playedCardThisTurn = false; s.dice = null; s.event = null;
    s.aqueduct = null; s.displaced = null; s.barbResult = null;
    var n = s.players.length, guard = 0;
    do { s.turn = (s.turn + 1) % n; guard++; } while (s.players[s.turn].out && guard <= n);
    s.turnCount++;
    s.phase = 'roll';
    var np = current(s);
    np.craneReady = false;
    if (vpFull(s, np) >= WIN_VP) { checkWin(s, np); return OK; }
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
      while (s.setupIdx < s.setupOrder.length && s.players[s.setupOrder[s.setupIdx]].out) {
        s.setupIdx++; s.setupSub = 'settlement'; s.setupSpot = null;
      }
      if (s.setupIdx >= s.setupOrder.length) { s.phase = 'roll'; s.turnCount = 1; }
      return;
    }
    if (s.phase === 'discard' && !Object.keys(s.mustDiscard).length) s.phase = 'robber';
    if (current(s).out) { s.phase = 'main'; endTurn(s, current(s).id); }
    updateLongest(s);
  }

  function needsAction(s) {
    if (s.phase === 'over') return [];
    if (s.phase === 'discard') return Object.keys(s.mustDiscard);
    if (s.phase === 'setup') return [setupPlayer(s).id];
    return [current(s).id];
  }
  function tradePending(s) {
    if (!s.trade) return [];
    return s.players.filter(function (p) {
      return !p.out && p.id !== s.trade.from && !s.trade.replies[p.id];
    }).map(function (p) { return p.id; });
  }



  /* ---------------- 진보카드 사용 ---------------- */

  // 카드마다 언제 쓸 수 있는지 — 연금술사만 주사위 전에 쓴다
  function cardPhaseOK(s, type) {
    if (type === 'alchemist') return s.phase === 'roll';
    return s.phase === 'main';
  }

  function hasCard(p, type) {
    for (var i = 0; i < p.cards.length; i++) if (p.cards[i].type === type) return i;
    return -1;
  }

  function playCard(s, pid, type, args) {
    var p = current(s);
    if (p.id !== pid) return err('차례가 아닙니다.');
    if (s.pending) return err('먼저 진행 중인 선택을 끝내 주세요.');
    if (!cardPhaseOK(s, type)) {
      return err(type === 'alchemist' ? '연금술사는 주사위를 굴리기 전에만 씁니다.' : '주사위를 굴린 뒤에 쓸 수 있습니다.');
    }
    var idx = hasCard(p, type);
    if (idx < 0) return err('그 카드가 없습니다.');
    args = args || [];
    var r = CARD_FN[type] ? CARD_FN[type](s, p, args) : err('아직 쓸 수 없는 카드입니다.');
    if (!r.ok) return r;
    p.cards.splice(idx, 1);
    say(s, null, p.name + ' 진보카드 — ' + CARD_NAME[type]);
    if (r.log) say(s, null, r.log);
    checkWin(s, p);
    return OK;
  }

  function others(s, p) {
    return s.players.filter(function (q) { return q.id !== p.id && !q.out; });
  }
  function randomFrom(s, p) {
    var pool = [];
    ALL.forEach(function (c) { for (var i = 0; i < p.res[c]; i++) pool.push(c); });
    if (!pool.length) return null;
    return pool[Math.floor(s.rnd() * pool.length)];
  }

  var CARD_FN = {
    /* --- 과학(초록) --- */
    // 연금술사 — 이번에 던질 흰·빨강 눈을 내가 정한다
    alchemist: function (s, p, a) {
      var w = Math.floor(a[0]), r2 = Math.floor(a[1]);
      if (!(w >= 1 && w <= 6 && r2 >= 1 && r2 <= 6)) return err('주사위 눈 두 개를 1~6으로 골라 주세요.');
      s.alchemist = [w, r2];
      return { ok: true, log: '이번 주사위를 ' + w + ' · ' + r2 + '로 정했습니다.' };
    },
    // 기중기 — 이번 차례 도시 개발 한 번을 상품 1장 싸게
    crane: function (s, p) {
      if (p.craneReady) return err('이미 기중기를 준비해 두었습니다.');
      p.craneReady = true;
      return { ok: true, log: '이번 차례 도시 개발 한 번이 상품 1장 싸집니다.' };
    },
    // 광산 — 내 건물이 닿은 산 하나당 철 2장
    mining: function (s, p) {
      var n = adjacentTerrainCount(s, p, 'mountains');
      if (!n) return err('내 건물이 닿은 산이 없습니다.');
      var got = take(s, p, 'o', n * 2);
      return { ok: true, log: '철 ' + got + '장을 캤습니다.' };
    },
    // 관개 시설 — 내 건물이 닿은 농지 하나당 밀 2장
    irrigation: function (s, p) {
      var n = adjacentTerrainCount(s, p, 'fields');
      if (!n) return err('내 건물이 닿은 농지가 없습니다.');
      var got = take(s, p, 'g', n * 2);
      return { ok: true, log: '밀 ' + got + '장을 거뒀습니다.' };
    },
    // 발명가 — 숫자칩 두 개를 맞바꾼다 (2·12·6·8 제외)
    inventor: function (s, p, a) {
      var h1 = Math.floor(a[0]), h2 = Math.floor(a[1]);
      var A = s.board.hexes[h1], B = s.board.hexes[h2];
      if (!A || !B || h1 === h2) return err('서로 다른 타일 두 개를 골라 주세요.');
      var bad = [2, 12, 6, 8];
      if (!A.number || !B.number) return err('숫자 칩이 있는 타일이어야 합니다.');
      if (bad.indexOf(A.number) >= 0 || bad.indexOf(B.number) >= 0) return err('2 · 12 · 6 · 8 은 바꿀 수 없습니다.');
      var t = A.number; A.number = B.number; B.number = t;
      return { ok: true, log: '숫자 칩 ' + B.number + ' 와 ' + A.number + ' 의 자리를 바꿨습니다.' };
    },
    // 기술자 — 도시 성벽 하나를 공짜로
    engineer: function (s, p, a) {
      var v = Math.floor(a[0]);
      var vert = s.board.verts[v];
      if (!vert || !vert.b || vert.b.p !== p.id || vert.b.t !== 'city') return err('내 도시를 골라 주세요.');
      if (vert.wall) return err('이미 성벽이 있습니다.');
      if (p.walls >= WALL_MAX) return err('성벽은 3개까지입니다.');
      vert.wall = true; p.walls++;
      return { ok: true, log: '성벽을 공짜로 쌓았습니다. 손패 한도 ' + handLimit(p) + '장' };
    },
    // 의료 기술 — 철2 밀1로 마을을 도시로
    medicine: function (s, p, a) {
      var v = Math.floor(a[0]);
      var vert = s.board.verts[v];
      if (!vert || !vert.b || vert.b.p !== p.id || vert.b.t !== 'settlement') return err('내 마을을 골라 주세요.');
      if (!p.left.city) return err('도시 말을 다 썼습니다.');
      if (p.res.o < 2 || p.res.g < 1) return err('철 2장과 밀 1장이 필요합니다.');
      p.res.o -= 2; p.res.g -= 1; s.bank.o += 2; s.bank.g += 1;
      vert.b.t = 'city';
      p.settlements = p.settlements.filter(function (x) { return x !== v; });
      p.cities.push(v);
      p.left.city--; p.left.settlement++;
      return { ok: true, log: '싸게 도시를 올렸습니다 — 2점' };
    },
    // 제련술 — 기사 둘을 공짜로 승급
    smith: function (s, p, a) {
      var list = (a[0] || []).slice(0, 2);
      if (!list.length) return err('승급할 기사를 골라 주세요.');
      var done = 0;
      for (var i = 0; i < list.length; i++) {
        var k = findKnight(p, Math.floor(list[i]));
        if (!k || k.rank >= 3) continue;
        if (k.rank === 2 && p.level.politics < 3) continue;
        if (knightCount(s, p, k.rank + 1) >= KNIGHT_MAX_PER_RANK) continue;
        k.rank++; done++;
      }
      if (!done) return err('승급시킬 수 있는 기사가 없습니다.');
      return { ok: true, log: '기사 ' + done + '명을 공짜로 승급시켰습니다.' };
    },
    // 도로 건설 — 도로 2개를 공짜로
    roadbuild: function (s, p) {
      if (!p.left.road) return err('도로 말이 없습니다.');
      s.freeRoads = Math.min(2, p.left.road);
      if (!legalRoads(s, p.id).length) { s.freeRoads = 0; return err('놓을 자리가 없습니다.'); }
      return { ok: true, log: '도로 ' + s.freeRoads + '개를 공짜로 놓습니다.' };
    },

    /* --- 정치(파랑) --- */
    // 주교 — 도둑을 옮기고, 그 땅에 닿은 모든 상대에게서 한 장씩
    bishop: function (s, p, a) {
      var hex = Math.floor(a[0]);
      if (!(hex >= 0 && hex < s.board.hexes.length)) return err('타일을 골라 주세요.');
      if (hex === s.robber) return err('다른 타일로 옮겨야 합니다.');
      s.robber = hex;
      var taken = [];
      var seen = {};
      s.board.hexes[hex].corners.forEach(function (v) {
        var b = s.board.verts[v].b;
        if (!b || b.p === p.id || seen[b.p]) return;
        seen[b.p] = 1;
        var q = playerOf(s, b.p);
        if (!q || q.out) return;
        var c = randomFrom(s, q);
        if (!c) return;
        q.res[c]--; p.res[c]++;
        taken.push(q.name);
        say(s, p.id, q.name + '에게서 가져온 것: ' + NAME[c]);
        say(s, q.id, p.name + '에게 빼앗긴 것: ' + NAME[c]);
      });
      return { ok: true, log: '도둑을 옮기고 ' + (taken.length ? taken.join(', ') + '에게서 한 장씩 가져왔습니다.' : '가져올 카드가 없었습니다.') };
    },
    // 외교관 — 맨 끝 도로 하나를 없앤다 (내 것이면 다시 놓을 수 있다)
    diplomat: function (s, p, a) {
      var ei = Math.floor(a[0]);
      var e = s.board.edges[ei];
      if (!e || !e.road) return err('도로를 골라 주세요.');
      if (!isOpenRoad(s, ei)) return err('맨 끝(열린) 도로만 없앨 수 있습니다.');
      var owner = playerOf(s, e.road);
      var wasMine = e.road === p.id;
      e.road = null;
      owner.roads = owner.roads.filter(function (x) { return x !== ei; });
      owner.left.road++;
      updateLongest(s);
      if (wasMine) {
        s.freeRoads = Math.min(1, p.left.road);
        return { ok: true, log: '내 도로를 걷어 다른 곳에 다시 놓습니다.' };
      }
      return { ok: true, log: owner.name + '의 도로 하나를 없앴습니다.' };
    },
    // 사령관 — 내 기사 전부를 공짜로 활동 상태로
    warlord: function (s, p) {
      var n = 0;
      p.knights.forEach(function (k) { if (!k.active) { k.active = true; k.activatedTurn = s.turnCount; n++; } });
      if (!n) return err('활동 상태로 바꿀 기사가 없습니다.');
      return { ok: true, log: '기사 ' + n + '명이 공짜로 활동 상태가 됐습니다.' };
    },
    // 결혼 — 나보다 점수가 높은 사람에게서 한 장씩
    wedding: function (s, p) {
      var mine = vpFull(s, p), got = [];
      others(s, p).forEach(function (q) {
        if (vpFull(s, q) <= mine) return;
        var n = Math.min(2, handCount(q) >= 2 ? 2 : handCount(q));
        for (var i = 0; i < n; i++) {
          var c = randomFrom(s, q);
          if (!c) break;
          q.res[c]--; p.res[c]++;
          say(s, q.id, p.name + '에게 준 것: ' + NAME[c]);
        }
        if (n) got.push(q.name);
      });
      if (!got.length) return err('나보다 점수가 높은 사람이 없습니다.');
      return { ok: true, log: got.join(', ') + '에게서 카드를 받았습니다.' };
    },
    // 방해자 — 나보다 점수가 높거나 같은 사람은 손패 절반을 버린다
    saboteur: function (s, p) {
      var mine = vpFull(s, p), hit = [];
      others(s, p).forEach(function (q) {
        if (vpFull(s, q) < mine) return;
        var n = Math.floor(handCount(q) / 2);
        if (!n) return;
        s.mustDiscard[q.id] = n;
        hit.push(q.name + ' ' + n + '장');
      });
      if (!hit.length) return err('버리게 할 사람이 없습니다.');
      s.saboteurBack = s.phase;
      s.phase = 'discard';
      return { ok: true, log: hit.join(', ') + '이(가) 절반을 버립니다.' };
    },
    // 첩자 — 한 사람의 진보카드를 보고 한 장 가져온다
    spy: function (s, p, a) {
      var target = playerOf(s, a[0]);
      if (!target || target.id === p.id || target.out) return err('상대를 골라 주세요.');
      if (!target.cards.length) return err('그 사람은 진보카드가 없습니다.');
      var i = Math.floor(s.rnd() * target.cards.length);
      if (p.cards.length >= MAX_CARDS) return err('내 진보카드가 이미 넉 장입니다.');
      var card = target.cards.splice(i, 1)[0];
      p.cards.push(card);
      say(s, p.id, '가져온 카드: ' + CARD_NAME[card.type]);
      say(s, target.id, p.name + '이(가) 가져간 카드: ' + CARD_NAME[card.type]);
      return { ok: true, log: target.name + '의 진보카드를 한 장 가져왔습니다.' };
    },
    // 음모 — 상대 기사 하나를 내 도로가 닿은 빈 자리로 밀어낸다
    intrigue: function (s, p, a) {
      var v = Math.floor(a[0]);
      var kn = knightAt(s, v);
      if (!kn || kn.p.id === p.id) return err('상대 기사를 골라 주세요.');
      if (!touchesOwnRoad(s, v, p.id)) return err('내 도로가 닿은 자리의 기사만 밀어낼 수 있습니다.');
      var spots = knightRetreatSpots(s, kn.p.id, v);
      if (!spots.length) {
        kn.p.knights = kn.p.knights.filter(function (x) { return x !== kn.k; });
        updateLongest(s);
        return { ok: true, log: kn.p.name + '의 기사가 갈 곳이 없어 사라졌습니다.' };
      }
      kn.k.v = spots[0];
      updateLongest(s);
      return { ok: true, log: kn.p.name + '의 기사를 밀어냈습니다.' };
    },
    // 변절자 — 상대 기사 하나를 없애고 같은 등급 기사를 내가 놓는다
    deserter: function (s, p, a) {
      var target = playerOf(s, a[0]);
      if (!target || target.id === p.id || target.out) return err('상대를 골라 주세요.');
      if (!target.knights.length) return err('그 사람은 기사가 없습니다.');
      var weakest = target.knights[0];
      target.knights.forEach(function (k) { if (k.rank < weakest.rank) weakest = k; });
      var rank = weakest.rank;
      target.knights = target.knights.filter(function (x) { return x !== weakest; });
      var spots = legalKnightSpots(s, p.id);
      if (!spots.length || knightCount(s, p, rank) >= KNIGHT_MAX_PER_RANK) {
        updateLongest(s);
        return { ok: true, log: target.name + '의 기사를 없앴지만 내가 놓을 자리는 없었습니다.' };
      }
      p.knights.push({ v: spots[0], rank: rank, active: false });
      updateLongest(s);
      return { ok: true, log: target.name + '의 기사를 데려왔습니다.' };
    },

    /* --- 상업(노랑) --- */
    // 상인 — 내 건물이 닿은 땅에 상인 말을 놓는다 (그 자원 2:1, 승점 1)
    merchant: function (s, p, a) {
      var hex = Math.floor(a[0]);
      var h = s.board.hexes[hex];
      if (!h || !h.res) return err('자원이 나는 땅을 골라 주세요.');
      var mine = h.corners.some(function (v) {
        var b = s.board.verts[v].b;
        return b && b.p === p.id;
      });
      if (!mine) return err('내 마을이나 도시가 닿은 땅이어야 합니다.');
      s.players.forEach(function (q) { q.merchantVP = 0; });
      s.merchant = { hex: hex, p: p.id, res: h.res };
      p.merchantVP = 1;
      return { ok: true, log: NAME[h.res] + ' 땅에 상인을 놓았습니다. 그 자원을 2:1로 바꿀 수 있고 승점 1점입니다.' };
    },
    // 무역항 — 각 상대에게 자원 1장을 주고 상품 1장을 받는다
    harbor: function (s, p, a) {
      var picks = a[0] || {};                            // {pid: [주는 자원, 받을 상품]}
      var done = [];
      others(s, p).forEach(function (q) {
        var pick = picks[q.id];
        if (!pick) return;
        var give = pick[0], want = pick[1];
        if (RES.indexOf(give) < 0 || COM.indexOf(want) < 0) return;
        if (p.res[give] < 1 || q.res[want] < 1) return;
        p.res[give]--; q.res[give]++;
        q.res[want]--; p.res[want]++;
        done.push(q.name);
      });
      if (!done.length) return err('교환할 상대가 없습니다.');
      return { ok: true, log: done.join(', ') + '와(과) 자원↔상품을 바꿨습니다.' };
    },
    // 상선대 — 이번 차례 동안 고른 것 하나를 2:1로
    fleet: function (s, p, a) {
      var c = a[0];
      if (ALL.indexOf(c) < 0) return err('무엇을 2:1로 쓸지 골라 주세요.');
      p.fleetPick = c;
      p.fleetTurn = s.turnCount;
      return { ok: true, log: '이번 차례에 ' + NAME[c] + '을(를) 2:1로 바꿉니다.' };
    },
    // 전문 상인 — 점수가 더 높은 사람의 손을 보고 두 장 가져온다
    trader: function (s, p, a) {
      var target = playerOf(s, a[0]);
      if (!target || target.id === p.id || target.out) return err('상대를 골라 주세요.');
      if (vpFull(s, target) <= vpFull(s, p)) return err('나보다 점수가 높은 사람만 고를 수 있습니다.');
      var picks = (a[1] || []).slice(0, 2);
      if (!picks.length) return err('가져올 카드를 골라 주세요.');
      var tmp = {};
      for (var i = 0; i < picks.length; i++) {
        var c = picks[i];
        if (ALL.indexOf(c) < 0) return err('그런 카드가 없습니다.');
        tmp[c] = (tmp[c] || 0) + 1;
        if (target.res[c] < tmp[c]) return err('상대가 그만큼 가지고 있지 않습니다.');
      }
      picks.forEach(function (c) { target.res[c]--; p.res[c]++; });
      return { ok: true, log: target.name + '에게서 ' + picks.map(function (c) { return NAME[c]; }).join(' · ') + '을(를) 가져왔습니다.' };
    },
    // 상품 독점 — 상품 하나를 모두에게서 한 장씩
    commMono: function (s, p, a) {
      var c = a[0];
      if (COM.indexOf(c) < 0) return err('상품을 골라 주세요.');
      var n = 0;
      others(s, p).forEach(function (q) {
        if (q.res[c] > 0) { q.res[c]--; p.res[c]++; n++; }
      });
      return { ok: true, log: NAME[c] + ' ' + n + '장을 거둬 갔습니다.' };
    },
    // 자원 독점 — 자원 하나를 모두에게서 두 장씩
    resMono: function (s, p, a) {
      var c = a[0];
      if (RES.indexOf(c) < 0) return err('자원을 골라 주세요.');
      var n = 0;
      others(s, p).forEach(function (q) {
        var take2 = Math.min(2, q.res[c]);
        q.res[c] -= take2; p.res[c] += take2; n += take2;
      });
      return { ok: true, log: NAME[c] + ' ' + n + '장을 거둬 갔습니다.' };
    }
  };

  function adjacentTerrainCount(s, p, terrain) {
    var n = 0;
    s.board.hexes.forEach(function (h, i) {
      if (h.terrain !== terrain) return;
      var touch = h.corners.some(function (v) {
        var b = s.board.verts[v].b;
        return b && b.p === p.id;
      });
      if (touch) n++;
    });
    return n;
  }
  // 끝이 열린 도로 — 한쪽 끝에 내 건물·기사·다른 도로가 이어지지 않은 도로
  function isOpenRoad(s, ei) {
    var e = s.board.edges[ei];
    return [e.a, e.b].some(function (v) {
      var vert = s.board.verts[v];
      if (vert.b) return false;
      if (knightAt(s, v)) return false;
      var links = vert.edges.filter(function (x) { return x !== ei && s.board.edges[x].road; });
      return links.length === 0;
    });
  }


  root.CK = {
    RES: RES, COM: COM, ALL: ALL, NAME: NAME, TRACKS: TRACKS, TRACK_NAME: TRACK_NAME,
    TRACK_COM: TRACK_COM, TRACK_COLOR: TRACK_COLOR, LEVEL_NAME: LEVEL_NAME,
    CARD_NAME: CARD_NAME, PROGRESS: PROGRESS, VP_CARDS: VP_CARDS,
    COST: COST, PIECES: PIECES, WIN_VP: WIN_VP, BARB_TRACK: BARB_TRACK,
    MAX_LEVEL: MAX_LEVEL, METRO_LEVEL: METRO_LEVEL, WALL_MAX: WALL_MAX,
    CITY_YIELD: CITY_YIELD, EVENT_FACES: EVENT_FACES,
    newGame: newGame, playerOf: playerOf, current: current, setupPlayer: setupPlayer,
    placeSettlement: placeSettlement, placeRoad: placeRoad, roll: roll,
    discard: discard, moveRobber: moveRobber, robberVictims: robberVictims,
    knightPower: knightPower, build: build, placeKnight: placeKnight,
    activateKnight: activateKnight, upgradeKnight: upgradeKnight, moveKnight: moveKnight,
    knightMoves: knightMoves, knightDisplaceTargets: knightDisplaceTargets, chaseRobber: chaseRobber,
    knightCount: knightCount, findKnight: findKnight, metroCount: metroCount, hasFreeCity: hasFreeCity,
    MAX_CARDS: MAX_CARDS,
    develop: develop, devCost: devCost, tradeRate: tradeRate,
    bankTrade: bankTrade, offerTrade: offerTrade, replyTrade: replyTrade,
    acceptTrade: acceptTrade, cancelTrade: cancelTrade,
    endTurn: endTurn, dropPlayer: dropPlayer, needsAction: needsAction, tradePending: tradePending,
    playCard: playCard, hasCard: hasCard, cardPhaseOK: cardPhaseOK, isOpenRoad: isOpenRoad,
    adjacentTerrainCount: adjacentTerrainCount,
    handCount: handCount, handLimit: handLimit, canPay: canPay, handText: handText,
    vpOf: vpOf, vpFull: vpFull, roadLength: roadLength, updateLongest: updateLongest,
    legalSettlements: legalSettlements, legalCities: legalCities, legalRoads: legalRoads,
    legalKnightSpots: legalKnightSpots, knightAt: knightAt, spacingOK: spacingOK,
    _internal: { say: say, err: err, OK: OK, take: take, pay: pay, emptyHand: emptyHand, roll1: roll1, checkWin: checkWin }
  };
})(typeof self !== 'undefined' ? self : this);
