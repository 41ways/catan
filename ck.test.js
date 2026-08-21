/* 카탄: 도시와 기사 — 규칙 테스트.  node ck.test.js */
global.self = global;
require('./rules.js');
require('./ck.js');
var CK = self.CK;

var pass = 0, fail = 0;
function ok(c, n) { if (c) pass++; else { fail++; console.log('  ✗ ' + n); } }
function eq(a, b, n) { ok(a === b, n + ' — ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }
function group(n) { console.log(n); }

function game(n, seed) {
  var seats = [], names = ['가', '나', '다', '라'];
  for (var i = 0; i < n; i++) seats.push({ id: 'p' + i, name: names[i] });
  return CK.newGame(seats, seed || 7);
}
function ready(n, seed) {
  var s = game(n, seed);
  while (s.phase === 'setup') {
    var w = CK.setupPlayer(s).id;
    if (s.setupSub === 'settlement') CK.placeSettlement(s, w, CK.legalSettlements(s, w)[0]);
    else CK.placeRoad(s, w, CK.legalRoads(s, w)[0]);
  }
  return s;
}
function give(s, p, map) {
  for (var c in map) { var d = map[c] - p.res[c]; p.res[c] = map[c]; s.bank[c] -= d; }
}
function totals(s) {
  var t = {};
  CK.ALL.forEach(function (c) {
    t[c] = s.bank[c];
    s.players.forEach(function (p) { t[c] += p.res[c]; });
  });
  return t;
}
function conserved(s) {
  var t = totals(s);
  return CK.RES.every(function (c) { return t[c] === 19; }) &&
         CK.COM.every(function (c) { return t[c] === 12; });
}

group('구성');
(function () {
  var s = game(3, 5);
  eq(s.progress.trade.length, 18, '상업 진보카드 18장');
  eq(s.progress.politics.length, 18, '정치 진보카드 18장');
  eq(s.progress.science.length, 18, '과학 진보카드 18장');
  CK.RES.forEach(function (c) { eq(s.bank[c], 19, CK.NAME[c] + ' 19장'); });
  CK.COM.forEach(function (c) { eq(s.bank[c], 12, CK.NAME[c] + ' 12장'); });
  eq(CK.WIN_VP, 13, '13점 승리');
  eq(s.board.hexes[18].terrain, 'desert', '가운데 사막');
  eq(s.barb, 0, '야만족은 출발선에서 시작');
  var faces = {};
  CK.EVENT_FACES.forEach(function (f) { faces[f] = (faces[f] || 0) + 1; });
  eq(faces.ship, 3, '이벤트 주사위 야만선 세 면');
  ok(faces.trade === 1 && faces.politics === 1 && faces.science === 1, '성문 세 면');
})();

group('준비 — 마을 하나와 도시 하나');
(function () {
  var s = ready(3, 21);
  s.players.forEach(function (p) {
    eq(p.settlements.length, 1, p.name + ' 마을 1개');
    eq(p.cities.length, 1, p.name + ' 도시 1개');
    eq(p.roads.length, 2, p.name + ' 도로 2개');
    ok(CK.handCount(p) > 0, p.name + ' 도시 둘레 자원을 받았다');
  });
  eq(s.phase, 'roll', '준비가 끝나면 주사위 단계');
  ok(conserved(s), '카드 총량 유지');
})();

group('도시 생산 — 자원과 상품');
(function () {
  var s = ready(2, 33);
  var p = s.players[0];
  // 손으로 판을 세운다
  s.board.verts.forEach(function (v) { v.b = null; });
  s.players.forEach(function (q) {
    q.settlements = []; q.cities = [];
    CK.ALL.forEach(function (c) { s.bank[c] += q.res[c]; q.res[c] = 0; });
  });
  function firstHex(terr) {
    for (var i = 0; i < s.board.hexes.length; i++) {
      if (s.board.hexes[i].terrain === terr && s.board.hexes[i].number) return s.board.hexes[i];
    }
    return null;
  }
  // 산에 도시 → 철1 + 화폐1
  var mt = firstHex('mountains');
  s.board.verts[mt.corners[0]].b = { t: 'city', p: 'p0' };
  p.cities = [mt.corners[0]];
  s.robber = (mt.i + 1) % 19;
  s.turn = 0; s.phase = 'roll';
  p.knights = [{ v: 0, rank: 3, active: true }];        // 야만족에 도시를 잃지 않게
  var n = 0;
  while (n++ < 3000) {
    s.phase = 'roll'; s.dice = null;
    p.knights.forEach(function (k) { k.active = true; });
    CK.roll(s, 'p0');
    if (s.dice[0] + s.dice[1] === mt.number) break;
    if (s.phase === 'discard' || s.phase === 'robber') { s.phase = 'main'; }
  }
  if (s.dice[0] + s.dice[1] === mt.number) {
    eq(p.res.o, 1, '산의 도시 — 철 1장');
    eq(p.res.n, 1, '산의 도시 — 화폐 1장');
  }

  // 마을은 상품을 못 받는다
  var s2 = ready(2, 34);
  var q2 = s2.players[0];
  s2.board.verts.forEach(function (v) { v.b = null; });
  s2.players.forEach(function (x) {
    x.settlements = []; x.cities = [];
    CK.ALL.forEach(function (c) { s2.bank[c] += x.res[c]; x.res[c] = 0; });
  });
  var fo = null;
  for (var i = 0; i < s2.board.hexes.length; i++) {
    if (s2.board.hexes[i].terrain === 'forest' && s2.board.hexes[i].number) { fo = s2.board.hexes[i]; break; }
  }
  s2.board.verts[fo.corners[0]].b = { t: 'settlement', p: 'p0' };
  q2.settlements = [fo.corners[0]];
  s2.robber = (fo.i + 1) % 19;
  s2.turn = 0;
  q2.knights = [{ v: 0, rank: 3, active: true }];
  var m = 0;
  while (m++ < 3000) {
    s2.phase = 'roll'; s2.dice = null;
    q2.knights.forEach(function (k) { k.active = true; });
    CK.roll(s2, 'p0');
    if (s2.dice[0] + s2.dice[1] === fo.number) break;
    if (s2.phase === 'discard' || s2.phase === 'robber') s2.phase = 'main';
  }
  if (s2.dice[0] + s2.dice[1] === fo.number) {
    eq(q2.res.l, 1, '숲의 마을 — 나무 1장');
    eq(q2.res.p, 0, '마을은 상품을 못 받는다');
  }

  // 언덕 도시는 흙 2장 (상품 없음)
  var s3 = ready(2, 35);
  var q3 = s3.players[0];
  s3.board.verts.forEach(function (v) { v.b = null; });
  s3.players.forEach(function (x) {
    x.settlements = []; x.cities = [];
    CK.ALL.forEach(function (c) { s3.bank[c] += x.res[c]; x.res[c] = 0; });
  });
  var hl = null;
  for (var k = 0; k < s3.board.hexes.length; k++) {
    if (s3.board.hexes[k].terrain === 'hills' && s3.board.hexes[k].number) { hl = s3.board.hexes[k]; break; }
  }
  if (hl) {
    s3.board.verts[hl.corners[0]].b = { t: 'city', p: 'p0' };
    q3.cities = [hl.corners[0]];
    s3.robber = (hl.i + 1) % 19;
    s3.turn = 0;
    q3.knights = [{ v: 0, rank: 3, active: true }];
    var j = 0;
    while (j++ < 3000) {
      s3.phase = 'roll'; s3.dice = null;
      q3.knights.forEach(function (k) { k.active = true; });
      CK.roll(s3, 'p0');
      if (s3.dice[0] + s3.dice[1] === hl.number) break;
      if (s3.phase === 'discard' || s3.phase === 'robber') s3.phase = 'main';
    }
    if (s3.dice[0] + s3.dice[1] === hl.number) eq(q3.res.b, 2, '언덕의 도시 — 흙 2장');
  }
})();

group('도시 개발과 수도');
(function () {
  var s = ready(2, 44);
  var p = s.players[0];
  s.turn = 0; s.phase = 'main';
  give(s, p, { c: 15 });
  eq(CK.devCost(0), 1, '1단계는 상품 1장');
  eq(CK.devCost(3), 4, '4단계는 상품 4장');
  ok(CK.develop(s, 'p0', 'trade').ok, '상업 1단계');
  eq(p.level.trade, 1, '단계가 올랐다');
  ok(CK.develop(s, 'p0', 'trade').ok, '상업 2단계');
  ok(CK.develop(s, 'p0', 'trade').ok, '상업 3단계');
  eq(p.metro.trade, false, '3단계로는 수도가 아니다');
  ok(CK.develop(s, 'p0', 'trade').ok, '상업 4단계');
  eq(p.metro.trade, true, '4단계에서 수도');
  ok(CK.vpOf(s, p) >= 2, '수도는 2점');
  // 다른 색 상품으로는 못 올린다
  give(s, p, { n: 0 });
  ok(!CK.develop(s, 'p0', 'politics').ok, '화폐가 없으면 정치를 못 올린다');
  // 수도 뺏기
  var q = s.players[1];
  give(s, q, { c: 15 });
  s.turn = 1;
  for (var i = 0; i < 4; i++) CK.develop(s, 'p1', 'trade');
  eq(q.metro.trade, false, '같은 단계로는 못 뺏는다');
  ok(CK.develop(s, 'p1', 'trade').ok, '5단계');
  eq(q.metro.trade, true, '더 높이 올리면 수도를 뺏는다');
  eq(p.metro.trade, false, '원래 주인은 잃는다');
})();

group('기사');
(function () {
  var s = ready(2, 55);
  var p = s.players[0];
  s.turn = 0; s.phase = 'main';
  give(s, p, { b: 8, l: 8, o: 8, w: 8, g: 8 });
  for (var i = 0; i < 4; i++) {
    var rd = CK.legalRoads(s, 'p0');
    if (rd.length) CK.build(s, 'p0', 'road', rd[0]);
  }
  var spot = CK.legalKnightSpots(s, 'p0')[0];
  ok(CK.placeKnight(s, 'p0', spot).ok, '하급 기사 놓기 (철1 양1)');
  eq(p.knights.length, 1, '기사가 판에 섰다');
  eq(p.knights[0].active, false, '처음엔 비활동');
  eq(CK.knightPower(s, p), 0, '비활동 기사는 힘이 없다');
  ok(CK.placeKnight(s, 'p0', CK.legalKnightSpots(s, 'p0')[0]).ok, '하급 기사 둘째');
  ok(!CK.placeKnight(s, 'p0', CK.legalKnightSpots(s, 'p0')[0]).ok, '하급 기사는 둘까지');

  ok(CK.activateKnight(s, 'p0', spot).ok, '활성화 (밀1)');
  eq(CK.knightPower(s, p), 1, '활동 하급 기사 힘 1');
  ok(!CK.moveKnight(s, 'p0', spot, CK.knightMoves(s, 'p0', spot)[0]).ok, '활성화한 턴에는 못 움직인다');
  s.turnCount++;
  ok(CK.upgradeKnight(s, 'p0', spot).ok, '중급으로 승급 (철1 양1)');
  eq(p.knights[0].rank, 2, '중급');
  eq(CK.knightPower(s, p), 2, '활동 중급 기사 힘 2');
  ok(!CK.upgradeKnight(s, 'p0', spot).ok, '요새 없이는 상급으로 못 간다');
  p.level.politics = 3;
  s.turnCount++;
  give(s, p, { o: 4, w: 4 });
  ok(CK.upgradeKnight(s, 'p0', spot).ok, '요새가 있으면 상급');
  eq(CK.knightPower(s, p), 3, '활동 상급 기사 힘 3');

  // 기사가 선 자리에는 마을을 못 짓는다
  ok(CK.legalSettlements(s, 'p0').indexOf(spot) < 0, '기사 자리에는 마을을 못 짓는다');
  ok(conserved(s), '카드 총량 유지');
})();

group('야만족 침략');
(function () {
  // 기사가 이기면 수호자 승점
  var s = ready(3, 66);
  var p = s.players[0];
  s.turn = 0;
  p.knights = [{ v: 0, rank: 3, active: true }, { v: 1, rank: 3, active: true }];
  s.players[1].knights = [];
  s.players[2].knights = [];
  var citiesBefore = s.players.map(function (q) { return q.cities.length; });
  s.barb = CK.BARB_TRACK - 1;
  var guard = 0;
  while (guard++ < 3000) {
    s.phase = 'roll'; s.dice = null;
    CK.roll(s, CK.current(s).id);
    if (s.event === 'ship') break;
    if (s.phase !== 'roll') { s.phase = 'main'; s.turn = 0; }
  }
  ok(s.barbResult && s.barbResult.win, '기사 힘 6 vs 도시 3 — 방어 성공');
  eq(p.defender, 1, '가장 크게 기여한 사람이 카탄의 수호자 1점');
  ok(p.knights.every(function (k) { return !k.active; }), '전투가 끝나면 모두 비활동');
  eq(s.barb, 0, '함대는 출발선으로');

  // 기사가 지면 도시가 마을로
  var s2 = ready(3, 77);
  s2.players.forEach(function (q) { q.knights = []; });
  var v0 = s2.players[0];
  s2.barb = CK.BARB_TRACK - 1;
  var before = s2.players.map(function (q) { return q.cities.length; });
  var g2 = 0;
  while (g2++ < 3000) {
    s2.phase = 'roll'; s2.dice = null;
    CK.roll(s2, CK.current(s2).id);
    if (s2.event === 'ship') break;
    if (s2.phase !== 'roll') { s2.phase = 'main'; s2.turn = 0; }
  }
  ok(s2.barbResult && !s2.barbResult.win, '기사가 없으면 방어 실패');
  var after = s2.players.map(function (q) { return q.cities.length; });
  var lost = before.filter(function (b, i) { return after[i] < b; }).length;
  ok(lost >= 1, '도시 하나가 마을로 내려갔다');
})();

group('성벽과 손패 한도');
(function () {
  var s = ready(2, 88);
  var p = s.players[0];
  s.turn = 0; s.phase = 'main';
  eq(CK.handLimit(p), 7, '기본 손패 한도 7장');
  give(s, p, { b: 6 });
  var city = p.cities[0];
  ok(CK.build(s, 'p0', 'wall', city).ok, '성벽 (흙 2)');
  eq(CK.handLimit(p), 9, '성벽 하나에 한도 +2');
  ok(!CK.build(s, 'p0', 'wall', city).ok, '같은 도시에 두 번은 못 쌓는다');
  var sett = p.settlements[0];
  ok(!CK.build(s, 'p0', 'wall', sett).ok, '마을에는 성벽을 못 쌓는다');
})();

group('진보카드');
(function () {
  var s = ready(3, 99);
  var p = s.players[0];
  s.turn = 0; s.phase = 'main'; s.turnCount = 4;

  // 광산 — 내 건물이 닿은 산 하나당 철 2장
  p.cards = [{ type: 'mining', track: 'science' }];
  var mines = CK.adjacentTerrainCount(s, p, 'mountains');
  var before = p.res.o;
  var r = CK.playCard(s, 'p0', 'mining', []);
  if (mines) {
    ok(r.ok, '광산');
    eq(p.res.o - before, mines * 2, '산 하나당 철 2장');
  } else ok(!r.ok, '닿은 산이 없으면 못 쓴다');

  // 자원 독점 — 모두에게서 두 장씩
  give(s, s.players[1], { l: 3 });
  give(s, s.players[2], { l: 1 });
  give(s, p, { l: 0 });
  p.cards = [{ type: 'resMono', track: 'trade' }];
  ok(CK.playCard(s, 'p0', 'resMono', ['l']).ok, '자원 독점');
  eq(p.res.l, 3, '두 장 + 한 장뿐인 사람에게선 한 장');
  eq(s.players[1].res.l, 1, '상대는 두 장을 뺏겼다');

  // 상품 독점 — 한 장씩
  give(s, s.players[1], { p: 2 });
  give(s, s.players[2], { p: 2 });
  give(s, p, { p: 0 });
  p.cards = [{ type: 'commMono', track: 'trade' }];
  ok(CK.playCard(s, 'p0', 'commMono', ['p']).ok, '상품 독점');
  eq(p.res.p, 2, '한 사람당 한 장');

  // 연금술사 — 주사위 전에만
  p.cards = [{ type: 'alchemist', track: 'science' }];
  ok(!CK.playCard(s, 'p0', 'alchemist', [3, 4]).ok, '건설 단계에는 못 쓴다');
  s.phase = 'roll';
  ok(CK.playCard(s, 'p0', 'alchemist', [3, 4]).ok, '주사위 전에 사용');
  CK.roll(s, 'p0');
  ok(s.dice[0] === 3 && s.dice[1] === 4, '정한 눈 그대로 나온다');

  // 기중기 — 개발 한 번을 한 장 싸게
  var s2 = ready(2, 111);
  var q = s2.players[0];
  s2.turn = 0; s2.phase = 'main';
  q.cards = [{ type: 'crane', track: 'science' }];
  give(s2, q, { p: 1 });
  q.level.science = 1;
  ok(!CK.develop(s2, 'p0', 'science', false).ok, '종이 1장으로 2단계는 못 올린다');
  ok(CK.playCard(s2, 'p0', 'crane', []).ok, '기중기');
  ok(CK.develop(s2, 'p0', 'science', true).ok, '기중기로 한 장 싸게 2단계');
  eq(q.level.science, 2, '2단계');

  // 의료 기술 — 철2 밀1로 도시
  var s3 = ready(2, 122);
  var m = s3.players[0];
  s3.turn = 0; s3.phase = 'main';
  give(s3, m, { o: 2, g: 1 });
  m.cards = [{ type: 'medicine', track: 'science' }];
  var sv = m.settlements[0];
  ok(CK.playCard(s3, 'p0', 'medicine', [sv]).ok, '의료 기술');
  eq(m.cities.length, 2, '마을이 도시가 됐다');
  eq(m.res.o, 0, '철 2장을 냈다');

  // 첩자 — 남의 진보카드를 가져온다
  var s4 = ready(2, 133);
  var a = s4.players[0], b = s4.players[1];
  s4.turn = 0; s4.phase = 'main';
  b.cards = [{ type: 'harbor', track: 'trade' }];
  a.cards = [{ type: 'spy', track: 'politics' }];
  ok(CK.playCard(s4, 'p0', 'spy', ['p1']).ok, '첩자');
  eq(b.cards.length, 0, '상대 카드가 줄었다');
  eq(a.cards.length, 1, '내 손에 들어왔다');
})();


group('룰북 교차 확인 — 제한 규칙');
(function () {
  // 진보카드는 넉 장까지
  var s = ready(2, 202);
  var p = s.players[0];
  p.cards = [{ type: 'spy' }, { type: 'spy' }, { type: 'warlord' }, { type: 'bishop' }];
  p.level.politics = 5;
  s.progress.politics = ['diplomat', 'diplomat'];
  s.turn = 0;
  var n = 0;
  while (n++ < 500) {
    s.phase = 'roll'; s.dice = null;
    CK.roll(s, 'p0');
    if (s.event === 'politics') break;
    if (s.phase !== 'roll') s.phase = 'main';
  }
  ok(p.cards.length <= CK.MAX_CARDS, '진보카드는 넉 장을 넘지 않는다');
  eq(CK.MAX_CARDS, 4, '보유 한도 4장');

  // 첩자로도 넉 장을 넘지 못한다
  var s2 = ready(2, 203);
  var a = s2.players[0], b = s2.players[1];
  s2.turn = 0; s2.phase = 'main';
  a.cards = [{ type: 'spy' }, { type: 'spy' }, { type: 'spy' }, { type: 'warlord' }];
  b.cards = [{ type: 'harbor' }];
  ok(!CK.playCard(s2, 'p0', 'spy', ['p1']).ok, '넉 장이면 첩자로도 못 가져온다');

  // 수도는 올릴 도시가 있어야 한다
  var s3 = ready(2, 204);
  var q = s3.players[0];
  s3.turn = 0; s3.phase = 'main';
  give(s3, q, { c: 20, n: 20 });
  q.level.trade = 3; q.level.politics = 3;
  eq(q.cities.length, 1, '도시 하나로 시작');
  ok(CK.develop(s3, 'p0', 'trade').ok, '첫 4단계는 된다');
  eq(q.metro.trade, true, '수도가 섰다');
  ok(!CK.develop(s3, 'p0', 'politics').ok, '남은 도시가 없으면 두 번째 4단계는 막힌다');
  give(s3, q, { g: 2, o: 3 });
  CK.build(s3, 'p0', 'city', CK.legalCities(s3, 'p0')[0]);
  ok(CK.develop(s3, 'p0', 'politics').ok, '도시를 더 지으면 열린다');
  ok(CK.metroCount(q) <= q.cities.length, '수도 수가 도시 수를 넘지 않는다');

  // 승점 진보카드는 손에 안 들어오고 즉시 점수가 된다
  var s4 = ready(2, 205);
  var r = s4.players[0];
  r.level.science = 5;
  s4.progress.science = ['printer'];
  s4.turn = 0;
  var m = 0, before = CK.vpFull(s4, r);
  while (m++ < 500) {
    s4.phase = 'roll'; s4.dice = null;
    CK.roll(s4, 'p0');
    if (s4.event === 'science') break;
    if (s4.phase !== 'roll') s4.phase = 'main';
  }
  eq(r.cards.length, 0, '인쇄소는 손에 들어오지 않는다');
  eq(CK.vpFull(s4, r) - before, 1, '받는 즉시 1점');

  // 연금술사는 주사위 전에만
  var s5 = ready(2, 206);
  var z = s5.players[0];
  s5.turn = 0; s5.phase = 'roll';
  z.cards = [{ type: 'alchemist', track: 'science' }];
  ok(CK.playCard(s5, 'p0', 'alchemist', [6, 5]).ok, '주사위 전 연금술사');
  CK.roll(s5, 'p0');
  ok(s5.dice[0] === 6 && s5.dice[1] === 5, '정한 눈이 그대로 나온다');
  ok(!!s5.event, '이벤트 주사위는 정상적으로 굴러간다');
})();

group('무작위 60판 완주');
(function () {
  var rnd = (function (seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  })(20260821);
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  var done = 0, badTotal = 0, badVp = 0, turns = 0;

  for (var g = 0; g < 60; g++) {
    var n = 2 + Math.floor(rnd() * 3);
    var s = game(n, Math.floor(rnd() * 1e9));
    var steps = 0;
    while (s.phase !== 'over' && steps++ < 40000) {
      step(s);
      if (!conserved(s)) badTotal++;
      s.players.forEach(function (p) {
        if (p.left.settlement < 0 || p.left.city < 0 || p.left.road < 0) badVp++;
        CK.ALL.forEach(function (c) { if (p.res[c] < 0) badVp++; });
        if (p.knights.length > 6) badVp++;
      });
    }
    turns += s.turnCount;
    if (s.winner) done++;
  }
  eq(badTotal, 0, '카드 총량이 항상 유지된다');
  eq(badVp, 0, '말 개수와 손패가 음수가 되지 않는다');
  ok(done >= 57, '60판 중 ' + done + '판이 승자로 끝났다');

  function step(s) {
    if (s.trade) {
      var pend = CK.tradePending(s);
      if (pend.length) { CK.replyTrade(s, pend[0], rnd() < 0.4); return; }
      var yes = Object.keys(s.trade.replies).filter(function (k) { return s.trade.replies[k] === 'yes'; });
      if (yes.length && rnd() < 0.8) CK.acceptTrade(s, s.trade.from, pick(yes));
      else CK.cancelTrade(s, s.trade.from);
      return;
    }
    if (s.phase === 'setup') {
      var w = CK.setupPlayer(s).id;
      if (s.setupSub === 'settlement') CK.placeSettlement(s, w, pick(CK.legalSettlements(s, w)));
      else CK.placeRoad(s, w, pick(CK.legalRoads(s, w)));
      return;
    }
    if (s.phase === 'discard') {
      var pid = Object.keys(s.mustDiscard)[0], p = CK.playerOf(s, pid), pool = [];
      CK.ALL.forEach(function (c) { for (var i = 0; i < p.res[c]; i++) pool.push(c); });
      CK.discard(s, pid, pool.slice(0, s.mustDiscard[pid]));
      return;
    }
    var cur = CK.current(s);
    if (s.phase === 'robber') {
      var hex = Math.floor(rnd() * 19);
      if (hex === s.robber) hex = (hex + 1) % 19;
      var v = CK.robberVictims(s, hex, cur.id);
      CK.moveRobber(s, cur.id, hex, v.length ? pick(v) : null);
      return;
    }
    if (s.phase === 'roll') { CK.roll(s, cur.id); return; }

    if (s.freeRoads > 0) {
      var fr = CK.legalRoads(s, cur.id);
      if (fr.length && cur.left.road) { CK.build(s, cur.id, 'road', pick(fr)); return; }
      s.freeRoads = 0;
      return;
    }
    // 도시 개발 → 도시 → 마을 → 기사 → 도로 순으로 욕심낸다
    var t = pick(CK.TRACKS);
    if (cur.level[t] < 5 && cur.res[CK.TRACK_COM[t]] >= CK.devCost(cur.level[t]) &&
        (cur.level[t] < 3 || cur.cities.length)) {
      if (CK.develop(s, cur.id, t).ok) return;
    }
    var cities = CK.legalCities(s, cur.id);
    if (cities.length && CK.canPay(cur, CK.COST.city) && cur.left.city) { CK.build(s, cur.id, 'city', pick(cities)); return; }
    var setts = CK.legalSettlements(s, cur.id);
    if (setts.length && CK.canPay(cur, CK.COST.settlement) && cur.left.settlement) { CK.build(s, cur.id, 'settlement', pick(setts)); return; }
    var r = rnd();
    if (r < 0.3 && CK.canPay(cur, CK.COST.knight) && CK.knightCount(s, cur, 1) < 2) {
      var ks = CK.legalKnightSpots(s, cur.id);
      if (ks.length) { CK.placeKnight(s, cur.id, pick(ks)); return; }
    }
    if (r < 0.45 && cur.knights.length) {
      var k = pick(cur.knights);
      if (!k.active && CK.canPay(cur, CK.COST.activate)) { CK.activateKnight(s, cur.id, k.v); return; }
    }
    if (r < 0.6 && !setts.length) {
      var roads = CK.legalRoads(s, cur.id);
      if (roads.length && CK.canPay(cur, CK.COST.road) && cur.left.road) { CK.build(s, cur.id, 'road', pick(roads)); return; }
    }
    if (r < 0.75) {
      var giveC = null;
      CK.ALL.forEach(function (c) { if (cur.res[c] >= CK.tradeRate(cur, c) + 1) giveC = c; });
      if (giveC) {
        var lack = CK.ALL.filter(function (c) { return c !== giveC && cur.res[c] === 0 && s.bank[c] > 0; });
        if (lack.length) { CK.bankTrade(s, cur.id, giveC, pick(lack)); return; }
      }
    }
    if (r < 0.85 && cur.cards.length) {
      var card = pick(cur.cards);
      var args = [];
      if (card.type === 'resMono') args = [pick(CK.RES)];
      else if (card.type === 'commMono') args = [pick(CK.COM)];
      else if (card.type === 'fleet') args = [pick(CK.ALL)];
      else if (card.type === 'bishop') args = [Math.floor(rnd() * 19)];
      else if (card.type === 'spy' || card.type === 'deserter' || card.type === 'trader') {
        var o = s.players.filter(function (q) { return q.id !== cur.id && !q.out; });
        args = [pick(o).id, [pick(CK.ALL)]];
      } else if (card.type === 'medicine' || card.type === 'engineer') {
        args = [cur.settlements.concat(cur.cities)[0]];
      } else if (card.type === 'merchant') args = [Math.floor(rnd() * 19)];
      else if (card.type === 'inventor') args = [Math.floor(rnd() * 19), Math.floor(rnd() * 19)];
      else if (card.type === 'diplomat') args = [Math.floor(rnd() * 72)];
      else if (card.type === 'intrigue') args = [Math.floor(rnd() * 54)];
      else if (card.type === 'smith') args = [cur.knights.map(function (x) { return x.v; })];
      else if (card.type === 'harbor') args = [{}];
      CK.playCard(s, cur.id, card.type, args);
      return;
    }
    CK.endTurn(s, cur.id);
  }
})();

console.log('');
console.log(fail ? ('실패 ' + fail + ' / 통과 ' + pass) : ('전부 통과 — ' + pass + '개'));
process.exit(fail ? 1 : 0);
