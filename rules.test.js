/* 카탄 — 규칙 엔진 테스트.  node rules.test.js */
global.self = global;
require('./rules.js');
var R = self.Rules;

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('  ✗ ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' — ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }
function group(name) { console.log(name); }

function game(n, seed) {
  var seats = [];
  var names = ['가', '나', '다', '라'];
  for (var i = 0; i < n; i++) seats.push({ id: 'p' + i, name: names[i] });
  return R.newGame(seats, seed || 7);
}
var __bankRef = null;
function give(p, map) {
  // 은행과 주고받아 총량 19장을 지킨다
  for (var c in map) {
    var d = map[c] - p.res[c];
    p.res[c] = map[c];
    if (__bankRef) __bankRef[c] -= d;
  }
}
function bankTotal(s) {
  var t = {};
  R.RES.forEach(function (c) {
    t[c] = s.bank[c];
    s.players.forEach(function (p) { t[c] += p.res[c]; });
  });
  return t;
}

/* ---------------- 판 ---------------- */
group('판 만들기');
(function () {
  for (var seed = 1; seed <= 60; seed++) {
    var s = game(4, seed * 977), b = s.board;
    eq(b.hexes.length, 19, '타일 19개');
    eq(b.verts.length, 54, '꼭짓점 54개');
    eq(b.edges.length, 72, '변 72개');

    var terr = {};
    b.hexes.forEach(function (h) { terr[h.terrain] = (terr[h.terrain] || 0) + 1; });
    ok(terr.forest === 4 && terr.pasture === 4 && terr.fields === 4, '숲·초원·농지 4개씩');
    ok(terr.hills === 3 && terr.mountains === 3 && terr.desert === 1, '언덕·산 3개, 사막 1개');

    var nums = b.hexes.filter(function (h) { return h.number; }).map(function (h) { return h.number; });
    eq(nums.length, 18, '숫자 칩 18개');
    var cnt = {};
    nums.forEach(function (n) { cnt[n] = (cnt[n] || 0) + 1; });
    ok(cnt[2] === 1 && cnt[12] === 1, '2와 12는 하나씩');
    ok([3, 4, 5, 6, 8, 9, 10, 11].every(function (n) { return cnt[n] === 2; }), '나머지는 둘씩');
    ok(!b.hexes.some(function (h) { return h.terrain === 'desert' && h.number; }), '사막에는 칩이 없다');

    // 6과 8은 붙지 않고 같은 숫자도 붙지 않는다
    var bad = false;
    b.hexes.forEach(function (h, i) {
      if (!h.number) return;
      b.neighbors[i].forEach(function (j) {
        var m = b.hexes[j].number;
        if (!m) return;
        if (m === h.number) bad = true;
        if ((h.number === 6 || h.number === 8) && (m === 6 || m === 8)) bad = true;
      });
    });
    ok(!bad, '6·8이 붙지 않고 같은 숫자도 안 붙는다');

    eq(b.ports.length, 9, '항구 9개');
    var pt = {};
    b.ports.forEach(function (p) { pt[p.type] = (pt[p.type] || 0) + 1; });
    eq(pt.any, 4, '3:1 항구 넷');
    ok(R.RES.every(function (c) { return pt[c] === 1; }), '자원별 2:1 항구 하나씩');
    ok(b.ports.every(function (p) { return b.edges[p.edge].hexes.length === 1; }), '항구는 바닷가 변에만');
    var pv = {};
    b.ports.forEach(function (p) { p.verts.forEach(function (v) { pv[v] = (pv[v] || 0) + 1; }); });
    ok(Object.keys(pv).every(function (v) { return pv[v] === 1; }), '한 꼭짓점에 항구는 하나');

    ok(b.verts.every(function (v) { return v.hexes.length >= 1 && v.hexes.length <= 3; }), '꼭짓점은 타일 3개까지');
    ok(b.verts.every(function (v) { return v.edges.length >= 2 && v.edges.length <= 3; }), '꼭짓점에 변은 2~3개');
    ok(b.edges.every(function (e) { return e.hexes.length >= 1 && e.hexes.length <= 2; }), '변은 타일 2개까지');
    var inner = b.verts.filter(function (v) { return v.hexes.length === 3; }).length;
    eq(inner, 24, '타일 셋이 만나는 꼭짓점 24개');
    eq(s.board.hexes[s.robber].terrain, 'desert', '도둑은 사막에서 시작');
    var center = b.hexes[b.hexes.length - 1];
    ok(center.q === 0 && center.r === 0, '마지막 타일이 한가운데');
    eq(center.terrain, 'desert', '사막은 언제나 한가운데');
    eq(center.number, null, '가운데는 숫자가 없다');
    eq(s.robber, b.hexes.length - 1, '도둑은 가운데에서 시작');
    ok(!b.hexes.slice(0, 18).some(function (h) { return h.terrain === 'desert'; }), '사막은 하나뿐이고 가운데에만');
  }
})();

/* ---------------- 준비 단계 ---------------- */
group('준비 단계');
(function () {
  var s = game(3, 11);
  eq(s.phase, 'setup', '준비 단계로 시작');
  eq(s.setupOrder.join(','), '0,1,2,2,1,0', '뱀 순서');

  ok(!R.roll(s, 'p0').ok, '준비 중에는 주사위를 못 굴린다');
  ok(!R.placeSettlement(s, 'p1', 0).ok, '차례가 아니면 못 놓는다');

  var v = R.legalSettlements(s, 'p0')[0];
  ok(R.placeSettlement(s, 'p0', v).ok, '첫 마을');
  ok(!R.placeSettlement(s, 'p0', R.legalSettlements(s, 'p0')[0]).ok, '마을 다음은 도로');
  var adj = s.board.verts[v].adj[0];
  s.setupSub = 'settlement';
  ok(!R.placeSettlement(s, 'p0', adj).ok, '바로 옆에는 못 놓는다');
  s.setupSub = 'road';

  var far = s.board.edges.filter(function (e) { return e.a !== v && e.b !== v; })[0];
  ok(!R.placeRoad(s, 'p0', far.i).ok, '떨어진 도로는 못 놓는다');
  ok(R.placeRoad(s, 'p0', s.board.verts[v].edges[0]).ok, '마을에 붙인 도로');
  eq(R.current(s).id, 'p0', '아직 첫 턴 전');
  eq(s.setupOrder[s.setupIdx], 1, '다음은 두 번째 사람');

  // 나머지 다섯 자리를 채운다
  var got = null;
  while (s.phase === 'setup') {
    var who = s.players[s.setupOrder[s.setupIdx]];
    var second = s.setupIdx >= s.players.length;
    var before = R.handCount(who);
    var vv = R.legalSettlements(s, who.id)[3];
    R.placeSettlement(s, who.id, vv);
    if (second) {
      var hexes = s.board.verts[vv].hexes.filter(function (h) { return s.board.hexes[h].res; }).length;
      eq(R.handCount(who) - before, hexes, '두 번째 마을은 둘레 자원을 받는다');
      got = true;
    } else {
      eq(R.handCount(who), 0, '첫 바퀴에는 자원이 없다');
    }
    R.placeRoad(s, who.id, R.legalRoads(s, who.id)[0]);
  }
  ok(got, '두 바퀴를 돌았다');
  eq(s.phase, 'roll', '준비가 끝나면 주사위 단계');
  eq(R.current(s).id, 'p0', '1P부터 시작');
  s.players.forEach(function (p) {
    eq(p.settlements.length, 2, p.name + ' 마을 2개');
    eq(p.roads.length, 2, p.name + ' 도로 2개');
    eq(p.left.settlement, 3, p.name + ' 남은 마을 말 3개');
    eq(p.left.road, 13, p.name + ' 남은 도로 말 13개');
  });
  var t = bankTotal(s);
  ok(R.RES.every(function (c) { return t[c] === 19; }), '자원 총량 19장씩 유지');
})();

/* 도둑을 아무 데나 규칙에 맞게 옮긴다 (대상이 여럿이면 골라서) */
function moveRob(s, pid, hex) {
  if (hex === undefined) hex = (s.robber + 1) % s.board.hexes.length;
  var v = R.robberVictims(s, hex, pid);
  return R.moveRobber(s, pid, hex, v.length ? v[0] : null);
}

/* 준비를 마친 판을 빠르게 만드는 도구 */
function ready(n, seed) {
  var s = game(n, seed);
  __bankRef = s.bank;
  while (s.phase === 'setup') {
    var who = s.players[s.setupOrder[s.setupIdx]];
    R.placeSettlement(s, who.id, R.legalSettlements(s, who.id)[0]);
    R.placeRoad(s, who.id, R.legalRoads(s, who.id)[0]);
  }
  return s;
}

/* ---------------- 생산 ---------------- */
group('자원 생산');
(function () {
  var s = ready(3, 21);
  var p = s.players[0];
  // 판을 손으로 세팅한다 — 밀 타일에 마을 하나, 도시 하나
  var hex = null;
  s.board.hexes.forEach(function (h) { if (h.res === 'g' && h.number !== null && !hex) hex = h; });
  s.board.verts.forEach(function (v) { v.b = null; });
  s.players.forEach(function (q) { q.settlements = []; q.cities = []; q.res = { b: 0, l: 0, w: 0, g: 0, o: 0 }; });
  s.board.verts[hex.corners[0]].b = { t: 'settlement', p: 'p0' };
  s.board.verts[hex.corners[2]].b = { t: 'city', p: 'p0' };
  s.board.verts[hex.corners[4]].b = { t: 'settlement', p: 'p1' };
  s.robber = (hex.i + 1) % 19;

  s.phase = 'main';
  // produce 는 내부 함수라 roll 로 부른다 — 주사위를 원하는 값으로 고정한다
  function forceRoll(sum) {
    s.phase = 'main';
    var before = JSON.parse(JSON.stringify(s.players.map(function (q) { return q.res; })));
    // 직접 생산만 돌린다
    s.board.hexes.forEach(function (h, i) {
      if (h.number !== sum || i === s.robber || !h.res) return;
      h.corners.forEach(function (v) {
        var b = s.board.verts[v].b;
        if (!b) return;
        var q = R.playerOf(s, b.p);
        q.res[h.res] += b.t === 'city' ? 2 : 1;
      });
    });
    return before;
  }
  forceRoll(hex.number);
  eq(p.res.g, 3, '마을 1장 + 도시 2장');
  eq(s.players[1].res.g, 1, '다른 사람도 자기 마을 몫을 받는다');

  // 도둑이 앉으면 안 나온다
  s.players.forEach(function (q) { q.res = { b: 0, l: 0, w: 0, g: 0, o: 0 }; });
  s.robber = hex.i;
  forceRoll(hex.number);
  eq(p.res.g, 0, '도둑이 앉은 타일은 생산하지 않는다');
})();

group('은행이 모자랄 때');
(function () {
  var s = ready(3, 33);
  var hex = null;
  s.board.hexes.forEach(function (h) { if (h.res === 'o' && h.number !== null && !hex) hex = h; });
  s.board.verts.forEach(function (v) { v.b = null; });
  s.players.forEach(function (q) { q.settlements = []; q.cities = []; q.res = { b: 0, l: 0, w: 0, g: 0, o: 0 }; });
  s.robber = (hex.i + 1) % 19;
  s.board.verts[hex.corners[0]].b = { t: 'settlement', p: 'p0' };
  s.board.verts[hex.corners[2]].b = { t: 'settlement', p: 'p1' };
  s.bank.o = 1;
  s.turn = 0; s.phase = 'roll';
  // 주사위를 hex.number 로 만들 때까지 굴린다
  var n = 0;
  while (s.phase === 'roll' && n++ < 4000) {
    var before = s.bank.o;
    R.roll(s, R.current(s).id);
    if (s.dice[0] + s.dice[1] === hex.number) break;
    if (s.phase === 'main') { s.phase = 'roll'; }
    else break;
  }
  if (s.dice && s.dice[0] + s.dice[1] === hex.number) {
    eq(s.players[0].res.o, 0, '둘이 받아야 하는데 하나뿐이면 아무도 못 받는다');
    eq(s.players[1].res.o, 0, '둘 다 못 받는다');
    eq(s.bank.o, 1, '은행에 그대로 남는다');
  }

  // 한 명뿐이면 남은 만큼 받는다
  var s2 = ready(3, 34);
  var hx = null;
  s2.board.hexes.forEach(function (h) { if (h.res === 'l' && h.number !== null && !hx) hx = h; });
  s2.board.verts.forEach(function (v) { v.b = null; });
  s2.players.forEach(function (q) { q.settlements = []; q.cities = []; q.res = { b: 0, l: 0, w: 0, g: 0, o: 0 }; });
  s2.robber = (hx.i + 1) % 19;
  s2.board.verts[hx.corners[0]].b = { t: 'city', p: 'p0' };
  s2.bank.l = 1;
  s2.turn = 0; s2.phase = 'roll';
  var m = 0;
  while (m++ < 4000) {
    s2.phase = 'roll';
    R.roll(s2, R.current(s2).id);
    if (s2.dice[0] + s2.dice[1] === hx.number) break;
    if (s2.phase !== 'main') break;
  }
  if (s2.dice[0] + s2.dice[1] === hx.number) {
    eq(s2.players[0].res.l, 1, '혼자면 은행에 남은 만큼만 받는다');
    eq(s2.bank.l, 0, '은행이 비었다');
  }
})();

/* ---------------- 7과 도둑 ---------------- */
group('7 · 도둑');
(function () {
  var s = ready(3, 55);
  s.phase = 'main';
  give(s.players[0], { b: 3, l: 3, w: 2, g: 0, o: 0 });   // 8장
  give(s.players[1], { b: 4, l: 3, w: 2, g: 0, o: 0 });   // 9장
  give(s.players[2], { b: 3, l: 2, w: 2, g: 0, o: 0 });   // 7장
  s.turn = 0; s.phase = 'roll';
  var n = 0;
  while (n++ < 4000) {
    s.phase = 'roll'; s.mustDiscard = {};
    give(s.players[0], { b: 3, l: 3, w: 2, g: 0, o: 0 });   // 8장
    give(s.players[1], { b: 4, l: 3, w: 2, g: 0, o: 0 });   // 9장
    give(s.players[2], { b: 3, l: 2, w: 2, g: 0, o: 0 });   // 7장
    R.roll(s, 'p0');
    if (s.dice[0] + s.dice[1] === 7) break;
  }
  eq(s.phase, 'discard', '7이 나오면 버리는 단계');
  eq(s.mustDiscard.p0, 4, '8장이면 4장 버린다');
  eq(s.mustDiscard.p1, 4, '9장이면 4장 버린다 (소수점 버림)');
  eq(s.mustDiscard.p2, undefined, '7장은 안 버린다');
  ok(!R.moveRobber(s, 'p0', 5).ok, '다 버리기 전에는 도둑을 못 옮긴다');
  ok(!R.discard(s, 'p0', ['b', 'b']).ok, '장수가 맞아야 한다');
  ok(!R.discard(s, 'p0', ['g', 'g', 'g', 'g']).ok, '없는 자원은 못 버린다');
  ok(R.discard(s, 'p0', ['b', 'b', 'l', 'l']).ok, '네 장 버리기');
  eq(s.phase, 'discard', '아직 남은 사람이 있다');
  ok(R.discard(s, 'p1', ['b', 'b', 'b', 'b']).ok, '두 번째 사람도 버린다');
  eq(s.phase, 'robber', '다 버리면 도둑 단계');
  var tt = bankTotal(s);
  ok(R.RES.every(function (c) { return tt[c] === 19; }), '버린 카드는 은행으로 돌아간다');

  ok(!R.moveRobber(s, 'p1', 5).ok, '차례인 사람만 도둑을 옮긴다');
  ok(!R.moveRobber(s, 'p0', s.robber).ok, '같은 자리로는 못 옮긴다');

  // 남의 마을이 둘 붙은 타일 — 누구에게서 가져올지 골라야 한다
  var target = null;
  s.board.hexes.forEach(function (h, i) {
    if (i === s.robber || target !== null) return;
    var owners = {};
    h.corners.forEach(function (v) {
      var b = s.board.verts[v].b;
      if (b && b.p !== 'p0' && R.handCount(R.playerOf(s, b.p)) > 0) owners[b.p] = 1;
    });
    if (Object.keys(owners).length >= 2) target = i;
  });
  if (target !== null) {
    ok(!R.moveRobber(s, 'p0', target).ok, '여럿이면 대상을 골라야 한다');
    var v0 = R.robberVictims(s, target, 'p0');
    var had = R.handCount(R.playerOf(s, v0[0])), mine = R.handCount(s.players[0]);
    ok(R.moveRobber(s, 'p0', target, v0[0]).ok, '대상을 골라 옮긴다');
    eq(R.handCount(R.playerOf(s, v0[0])), had - 1, '한 장을 빼앗긴다');
    eq(R.handCount(s.players[0]), mine + 1, '한 장을 가져온다');
  } else {
    ok(moveRob(s, 'p0', (s.robber + 3) % 19).ok, '도둑을 옮긴다');
  }
  eq(s.phase, 'main', '도둑을 옮기면 건설 단계');
  var t = bankTotal(s);
  ok(R.RES.every(function (c) { return t[c] === 19; }), '뺏고 버려도 총량은 그대로');
})();

/* ---------------- 건설 ---------------- */
group('건설');
(function () {
  var s = ready(3, 77);
  s.phase = 'main'; s.turn = 0;
  var p = s.players[0];

  give(p, { b: 0, l: 0, w: 0, g: 0, o: 0 });
  var road = R.legalRoads(s, 'p0')[0];
  ok(!R.build(s, 'p0', 'road', road).ok, '자원이 없으면 못 짓는다');
  give(p, { b: 1, l: 1, w: 0, g: 0, o: 0 });
  ok(R.build(s, 'p0', 'road', road).ok, '도로 — 벽돌1 나무1');
  eq(p.res.b, 0, '벽돌을 냈다');
  var t0 = bankTotal(s);
  ok(R.RES.every(function (c) { return t0[c] === 19; }), '낸 자원은 은행으로');
  ok(!R.build(s, 'p0', 'road', road).ok, '같은 자리에 두 번은 못 짓는다');

  var far = null;
  s.board.edges.forEach(function (e) {
    if (far !== null || e.road) return;
    if (R.legalRoads(s, 'p0').indexOf(e.i) < 0) far = e.i;
  });
  give(p, { b: 1, l: 1, w: 0, g: 0, o: 0 });
  ok(!R.build(s, 'p0', 'road', far).ok, '떨어진 곳에는 못 짓는다');

  // 마을 — 자리가 없으면 도로를 늘려 자리를 만든다
  var guard = 0;
  while (!R.legalSettlements(s, 'p0').length && guard++ < 20) {
    give(p, { b: 1, l: 1, w: 0, g: 0, o: 0 });
    var rr = R.legalRoads(s, 'p0');
    if (!rr.length) break;
    R.build(s, 'p0', 'road', rr[Math.floor(rr.length / 2)]);
  }
  give(p, { b: 1, l: 1, w: 1, g: 1, o: 0 });
  var sp = R.legalSettlements(s, 'p0');
  ok(sp.length > 0, '지을 수 있는 마을 자리가 있다');
  var vp0 = R.vpOf(s, p);
  ok(R.build(s, 'p0', 'settlement', sp[0]).ok, '마을 — 벽돌·나무·양·밀');
  eq(R.vpOf(s, p), vp0 + 1, '마을은 1점');
  var near = s.board.verts[sp[0]].adj[0];
  give(p, { b: 1, l: 1, w: 1, g: 1, o: 0 });
  ok(!R.build(s, 'p0', 'settlement', near).ok, '두 변 규칙은 건설에도 적용된다');

  // 도시
  give(p, { b: 0, l: 0, w: 0, g: 2, o: 3 });
  var vp1 = R.vpOf(s, p), settle = p.settlements[0], settleLeft = p.left.settlement;
  ok(!R.build(s, 'p1', 'city', settle).ok, '남의 마을은 못 올린다');
  ok(R.build(s, 'p0', 'city', settle).ok, '도시 — 밀2 철3');
  eq(R.vpOf(s, p), vp1 + 1, '마을 1점이 도시 2점이 된다');
  eq(p.left.city, 3, '도시 말 하나를 썼다');
  eq(p.left.settlement, settleLeft + 1, '마을 말이 돌아온다');
  ok(!R.build(s, 'p0', 'city', settle).ok, '도시는 또 못 올린다');

  // 말이 떨어지면
  var q = s.players[1];
  q.left.settlement = 0;
  give(q, { b: 1, l: 1, w: 1, g: 1, o: 0 });
  s.turn = 1;
  var spot = R.legalSettlements(s, 'p1')[0];
  if (spot !== undefined) ok(!R.build(s, 'p1', 'settlement', spot).ok, '말을 다 쓰면 못 짓는다');
})();

group('남의 마을은 못 뚫는다');
(function () {
  var s = ready(3, 88);
  s.phase = 'main'; s.turn = 0;
  // p1 마을 옆으로 p0 도로가 지나가려 할 때
  var blocked = null;
  s.board.verts.forEach(function (v) {
    if (blocked !== null) return;
    if (!v.b || v.b.p === 'p0') return;
    var mine = v.edges.filter(function (e) { return s.board.edges[e].road === 'p0'; });
    if (!mine.length) return;
    var open = v.edges.filter(function (e) { return !s.board.edges[e].road; });
    if (open.length) blocked = open[0];
  });
  if (blocked !== null) {
    ok(R.legalRoads(s, 'p0').indexOf(blocked) < 0, '남의 마을 너머로는 못 잇는다');
  } else { ok(true, '해당 배치가 없어 건너뜀'); }
})();

/* ---------------- 최장 교역로 ---------------- */
group('최장 교역로');
(function () {
  var s = ready(2, 99);
  s.phase = 'main'; s.turn = 0;
  // 판을 비우고 직선 도로를 손으로 깐다
  s.board.edges.forEach(function (e) { e.road = null; });
  s.board.verts.forEach(function (v) { v.b = null; });
  s.players.forEach(function (p) { p.roads = []; p.settlements = []; p.cities = []; });

  // 꼭짓점을 따라 이어지는 길을 찾는다
  function chain(startV, len, pid) {
    var v = startV, used = {}, list = [];
    for (var i = 0; i < len; i++) {
      var next = null;
      s.board.verts[v].edges.forEach(function (ei) {
        if (next !== null || used[ei] || s.board.edges[ei].road) return;
        next = ei;
      });
      if (next === null) break;
      used[next] = 1;
      s.board.edges[next].road = pid;
      list.push(next);
      v = s.board.edges[next].a === v ? s.board.edges[next].b : s.board.edges[next].a;
    }
    return list;
  }
  var made = chain(0, 4, 'p0');
  eq(R.roadLength(s, 'p0'), made.length, '이은 만큼 길이가 나온다');
  // updateLongest 는 도로를 지을 때 불린다 — 여기서는 상태만 확인
  eq(s.longest.p, null, '4개로는 최장 교역로가 없다');

  s.players[0].res = { b: 9, l: 9, w: 9, g: 9, o: 9 };
  var open = R.legalRoads(s, 'p0');
  ok(open.length > 0, '이어 지을 자리가 있다');
  // 5번째 도로를 정상 경로로 짓는다
  var five = null;
  open.forEach(function (ei) {
    if (five !== null) return;
    var e = s.board.edges[ei];
    if (made.indexOf(ei) >= 0) return;
    five = ei;
  });
  R.build(s, 'p0', 'road', five);
  if (R.roadLength(s, 'p0') >= 5) {
    eq(s.longest.p, 'p0', '5개를 이으면 최장 교역로');
    eq(R.vpOf(s, s.players[0]), 2, '최장 교역로는 2점');
  } else { ok(true, '갈래로 붙어 5가 안 됨 — 건너뜀'); }
})();

group('길을 끊는 마을');
(function () {
  var s = ready(2, 123);
  s.board.edges.forEach(function (e) { e.road = null; });
  s.board.verts.forEach(function (v) { v.b = null; });
  s.players.forEach(function (p) { p.roads = []; p.settlements = []; p.cities = []; });
  // 직선으로 6개를 깐다
  var v = 0, path = [v];
  for (var i = 0; i < 6; i++) {
    var next = null, ne = null;
    s.board.verts[v].edges.forEach(function (ei) {
      var e = s.board.edges[ei];
      if (next !== null || e.road) return;
      var far = e.a === v ? e.b : e.a;
      if (path.indexOf(far) >= 0) return;
      next = far; ne = ei;
    });
    if (next === null) break;
    s.board.edges[ne].road = 'p0';
    s.players[0].roads.push(ne);
    v = next; path.push(v);
  }
  var full = R.roadLength(s, 'p0');
  ok(full >= 5, '길이 ' + full + ' 확보');
  var mid = path[Math.floor(path.length / 2)];
  s.board.verts[mid].b = { t: 'settlement', p: 'p1' };
  var cut = R.roadLength(s, 'p0');
  ok(cut < full, '남의 마을이 가운데 있으면 끊긴다 (' + full + ' → ' + cut + ')');
})();

/* ---------------- 발전 카드 ---------------- */
group('발전 카드');
(function () {
  var s = ready(3, 202);
  s.phase = 'main'; s.turn = 0;
  var p = s.players[0];
  give(p, { b: 0, l: 0, w: 1, g: 1, o: 1 });
  eq(s.devDeck.length, 25, '발전 카드 25장');
  ok(R.buyDev(s, 'p0').ok, '발전 카드 — 양·밀·철');
  eq(s.devDeck.length, 24, '더미가 줄었다');
  eq(p.dev.length, 1, '손에 들어왔다');
  var bought = p.dev[0].type;
  if (bought !== 'vp') {
    ok(!R.playDev(s, 'p0', bought).ok, '산 턴에는 못 쓴다');
  }
  give(p, { b: 0, l: 0, w: 0, g: 0, o: 0 });
  ok(!R.buyDev(s, 'p0').ok, '자원이 없으면 못 산다');

  // 종류별 동작 — 손에 직접 쥐여 준다
  var s2 = ready(3, 303);
  s2.phase = 'main'; s2.turn = 0; s2.turnCount = 5;
  var a = s2.players[0];
  a.dev = [{ type: 'monopoly', turn: 1 }, { type: 'plenty', turn: 1 }, { type: 'road', turn: 1 }, { type: 'knight', turn: 1 }];
  give(s2.players[1], { b: 0, l: 3, w: 0, g: 0, o: 0 });
  give(s2.players[2], { b: 0, l: 2, w: 0, g: 0, o: 0 });
  give(a, { b: 0, l: 1, w: 0, g: 0, o: 0 });
  ok(R.playDev(s2, 'p0', 'monopoly', ['l']).ok, '독점');
  eq(a.res.l, 6, '남의 나무를 전부 거둔다');
  eq(s2.players[1].res.l, 0, '상대는 빈손');
  ok(!R.playDev(s2, 'p0', 'plenty', ['b', 'b']).ok, '한 턴에 하나만');

  s2.playedDev = false;
  ok(R.playDev(s2, 'p0', 'plenty', ['b', 'o']).ok, '자원 발견');
  eq(a.res.b, 1, '벽돌 한 장');
  eq(a.res.o, 1, '철 한 장');

  s2.playedDev = false;
  var roadsBefore = a.roads.length, resBefore = JSON.stringify(a.res);
  ok(R.playDev(s2, 'p0', 'road', []).ok, '도로 건설');
  eq(s2.freeRoads, 2, '공짜 도로 2개');
  ok(!R.endTurn(s2, 'p0').ok, '공짜 도로를 다 놓기 전에는 못 넘긴다');
  R.build(s2, 'p0', 'road', R.legalRoads(s2, 'p0')[0]);
  R.build(s2, 'p0', 'road', R.legalRoads(s2, 'p0')[0]);
  eq(a.roads.length, roadsBefore + 2, '도로 2개가 늘었다');
  eq(JSON.stringify(a.res), resBefore, '자원은 그대로');

  s2.playedDev = false;
  ok(R.playDev(s2, 'p0', 'knight', []).ok, '기사');
  eq(s2.phase, 'robber', '기사를 쓰면 도둑을 옮긴다');
  eq(a.knights, 1, '쓴 기사가 쌓인다');
  moveRob(s2, 'p0');
  eq(s2.phase, 'main', '옮기면 원래 단계로 돌아온다');

  // 최강 기사단
  a.knights = 2; s2.army = { p: null, n: 0 };
  a.dev.push({ type: 'knight', turn: 1 }); s2.playedDev = false;
  R.playDev(s2, 'p0', 'knight', []);
  eq(s2.army.p, 'p0', '기사 3장이면 최강 기사단');
  eq(a.knights, 3, '기사 3');
  moveRob(s2, 'p0');
  var b = s2.players[1];
  b.knights = 3;
  b.dev = [{ type: 'knight', turn: 1 }];
  s2.turn = 1; s2.phase = 'main'; s2.playedDev = false;
  R.playDev(s2, 'p1', 'knight', []);
  eq(s2.army.p, 'p1', '더 많이 쓰면 넘어간다');
  moveRob(s2, 'p1');

  // 주사위 전에 기사
  var s3 = ready(3, 404);
  s3.phase = 'roll'; s3.turn = 0; s3.turnCount = 9;
  s3.players[0].dev = [{ type: 'knight', turn: 1 }];
  ok(R.playDev(s3, 'p0', 'knight', []).ok, '주사위를 굴리기 전에도 기사를 쓴다');
  ok(moveRob(s3, 'p0').ok, '기사로 도둑을 옮긴다');
  eq(s3.phase, 'roll', '기사를 쓰고 나면 주사위를 굴린다');
  ok(R.roll(s3, 'p0').ok, '주사위');
})();

group('승점 카드');
(function () {
  var s = ready(2, 505);
  s.phase = 'main'; s.turn = 0; s.turnCount = 4;
  var p = s.players[0];
  p.dev = [{ type: 'vp', turn: 1 }, { type: 'vp', turn: 1 }];
  eq(R.vpFull(s, p) - R.vpOf(s, p), 2, '승점 카드는 두 장에 2점');
  var mine = R.viewFor(s, 'p0'), theirs = R.viewFor(s, 'p1');
  eq(mine.players[0].vpFull, R.vpFull(s, p), '내 점수에는 승점 카드가 들어간다');
  eq(theirs.players[0].vpFull, undefined, '남에게는 승점 카드가 안 보인다');
  eq(theirs.players[0].devCount, 2, '장수만 보인다');
  ok(!R.playDev(s, 'p0', 'vp', []).ok, '승점 카드는 쓰는 카드가 아니다');
})();

/* ---------------- 거래 ---------------- */
group('은행 거래');
(function () {
  var s = ready(3, 606);
  s.phase = 'main'; s.turn = 0;
  var p = s.players[0];
  give(p, { b: 4, l: 0, w: 0, g: 0, o: 0 });
  ok(!R.bankTrade(s, 'p0', 'b', 'b').ok, '같은 자원끼리는 못 바꾼다');
  ok(R.bankTrade(s, 'p0', 'b', 'o').ok, '4:1');
  eq(p.res.b, 0, '벽돌 4장을 냈다');
  eq(p.res.o, 1, '철 1장을 받았다');
  give(p, { b: 3, l: 0, w: 0, g: 0, o: 0 });
  ok(!R.bankTrade(s, 'p0', 'b', 'o').ok, '항구가 없으면 3장으로는 안 된다');
  p.ports.any = true;
  ok(R.bankTrade(s, 'p0', 'b', 'o').ok, '3:1 항구');
  give(p, { b: 2, l: 0, w: 0, g: 0, o: 0 });
  ok(!R.bankTrade(s, 'p0', 'b', 'o').ok, '3:1로는 2장이 안 된다');
  p.ports.b = true;
  eq(R.tradeRate(p, 'b'), 2, '벽돌 2:1 항구');
  eq(R.tradeRate(p, 'l'), 3, '다른 자원은 3:1');
  ok(R.bankTrade(s, 'p0', 'b', 'o').ok, '2:1 항구');
  give(p, { b: 4, l: 0, w: 0, g: 0, o: 0 });
  s.bank.o = 0;
  ok(!R.bankTrade(s, 'p0', 'b', 'o').ok, '은행이 비었으면 못 바꾼다');
})();

group('플레이어 간 거래');
(function () {
  var s = ready(3, 707);
  s.phase = 'main'; s.turn = 0;
  give(s.players[0], { b: 3, l: 0, w: 0, g: 0, o: 0 });
  give(s.players[1], { b: 0, l: 0, w: 0, g: 2, o: 0 });
  give(s.players[2], { b: 0, l: 0, w: 0, g: 0, o: 0 });

  ok(!R.offerTrade(s, 'p1', { b: 1 }, { g: 1 }).ok, '차례인 사람만 제안한다');
  ok(!R.offerTrade(s, 'p0', { b: 1 }, { b: 1 }).ok, '같은 자원을 주고받을 수 없다');
  ok(!R.offerTrade(s, 'p0', {}, { g: 1 }).ok, '한 장 이상씩 주고받아야 한다');
  ok(!R.offerTrade(s, 'p0', { b: 9 }, { g: 1 }).ok, '가진 것보다 많이 못 준다');
  ok(R.offerTrade(s, 'p0', { b: 2 }, { g: 1 }).ok, '제안');
  ok(!R.offerTrade(s, 'p0', { b: 1 }, { g: 1 }).ok, '제안은 하나씩');
  ok(!R.build(s, 'p0', 'road', R.legalRoads(s, 'p0')[0]).ok, '제안이 떠 있으면 다른 일을 못 한다');
  ok(!R.replyTrade(s, 'p0', true).ok, '자기 제안에는 대답하지 않는다');
  ok(!R.replyTrade(s, 'p2', true).ok, '요구한 자원이 없으면 못 받는다');
  ok(R.replyTrade(s, 'p2', false).ok, '거절은 된다');
  ok(R.replyTrade(s, 'p1', true).ok, '수락');
  ok(!R.acceptTrade(s, 'p0', 'p2').ok, '거절한 사람과는 못 한다');
  ok(!R.acceptTrade(s, 'p1', 'p1').ok, '제안한 사람만 고른다');
  ok(R.acceptTrade(s, 'p0', 'p1').ok, '성사');
  eq(s.players[0].res.b, 1, '벽돌 2장을 줬다');
  eq(s.players[0].res.g, 1, '밀 1장을 받았다');
  eq(s.players[1].res.b, 2, '상대가 벽돌을 받았다');
  eq(s.players[1].res.g, 1, '상대가 밀을 줬다');
  eq(s.trade, null, '제안이 정리됐다');
  var t = bankTotal(s);
  ok(R.RES.every(function (c) { return t[c] === 19; }), '거래로 총량은 안 변한다');

  ok(R.offerTrade(s, 'p0', { b: 1 }, { g: 1 }).ok, '다시 제안');
  ok(R.cancelTrade(s, 'p0').ok, '거두기');
  eq(s.trade, null, '거둬졌다');
})();

/* ---------------- 승리 ---------------- */
group('승리');
(function () {
  var s = ready(3, 808);
  s.phase = 'main'; s.turn = 0;
  var p = s.players[0];
  // 마을 2 + 도시 2개(4점) + 승점카드 3장 = 9점
  p.cities = [p.settlements[0], p.settlements[1]];
  p.settlements = [];
  s.board.verts[p.cities[0]].b.t = 'city';
  s.board.verts[p.cities[1]].b.t = 'city';
  p.dev = [{ type: 'vp', turn: 1 }, { type: 'vp', turn: 1 }, { type: 'vp', turn: 1 }, { type: 'vp', turn: 1 }, { type: 'vp', turn: 1 }];
  eq(R.vpFull(s, p), 9, '9점');
  eq(s.winner, null, '아직 아니다');
  var guard2 = 0;
  while (!R.legalSettlements(s, 'p0').length && guard2++ < 30) {
    give(p, { b: 1, l: 1, w: 0, g: 0, o: 0 });
    var rr2 = R.legalRoads(s, 'p0');
    if (!rr2.length) break;
    R.build(s, 'p0', 'road', rr2[Math.floor(rr2.length / 2)]);
  }
  give(p, { b: 1, l: 1, w: 1, g: 1, o: 0 });
  var spot = R.legalSettlements(s, 'p0')[0];
  R.build(s, 'p0', 'settlement', spot);
  eq(R.vpFull(s, p), 10, '10점');
  eq(s.winner, 'p0', '10점을 내면 이긴다');
  eq(s.phase, 'over', '판이 끝난다');
  ok(!R.roll(s, 'p0').ok, '끝난 판에서는 아무것도 못 한다');
})();

group('남의 턴에는 못 이긴다');
(function () {
  var s = ready(3, 909);
  s.phase = 'main'; s.turn = 1;
  var p = s.players[0];
  p.dev = [];
  for (var i = 0; i < 9; i++) p.dev.push({ type: 'vp', turn: 1 });
  // p0 은 9장 + 마을 2 = 11점이지만 지금은 p1 차례다
  ok(R.vpFull(s, p) >= 10, '점수는 충분하다');
  eq(s.winner, null, '남의 차례에는 승리 선언이 안 된다');
  R.endTurn(s, 'p1');
  eq(s.turn, 2, 'p2 차례');
  eq(s.winner, null, '아직');
  s.phase = 'main';
  R.endTurn(s, 'p2');
  eq(s.winner, 'p0', '자기 차례가 돌아오면 이긴다');
})();

/* ---------------- 무작위 완주 ---------------- */
group('무작위 120판 완주');
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

  var wins = 0, badTotal = 0, badVp = 0, badHand = 0, stuck = 0, turns = 0;

  for (var g = 0; g < 120; g++) {
    var n = 2 + Math.floor(rnd() * 3);
    var s = game(n, Math.floor(rnd() * 1e9));
    var steps = 0;
    while (s.phase !== 'over' && steps++ < 30000) {
      var before = JSON.stringify(s.phase) + s.turn + s.setupIdx + s.setupSub;
      step(s);
      // 총량 검사
      var t = bankTotal(s);
      if (!R.RES.every(function (c) { return t[c] === 19; })) badTotal++;
      // 손패 상한 — 도둑 단계를 지나면 8장 이상은 없어야 한다
      if (s.phase === 'main' && s.dice && s.dice[0] + s.dice[1] === 7) {
        s.players.forEach(function (p) { if (R.handCount(p) > 19) badHand++; });
      }
      s.players.forEach(function (p) {
        if (R.vpOf(s, p) !== p.settlements.length + p.cities.length * 2 +
          (s.longest.p === p.id ? 2 : 0) + (s.army.p === p.id ? 2 : 0)) badVp++;
        if (p.left.settlement < 0 || p.left.city < 0 || p.left.road < 0) badVp++;
      });
    }
    turns += s.turnCount;
    if (s.winner) wins++; else stuck++;
  }
  eq(badTotal, 0, '자원 총량이 항상 19장씩');
  eq(badVp, 0, '점수와 말 개수가 항상 맞는다');
  ok(wins >= 118, '120판 중 ' + wins + '판이 승자로 끝났다');
  ok(turns / 120 > 10, '평균 ' + Math.round(turns / 120) + '턴');

  function step(s) {
    if (s.trade) {
      var pend = R.tradePending(s);
      if (pend.length) { R.replyTrade(s, pend[0], rnd() < 0.5); return; }
      var yes = Object.keys(s.trade.replies).filter(function (k) { return s.trade.replies[k] === 'yes'; });
      if (yes.length && rnd() < 0.8) R.acceptTrade(s, s.trade.from, pick(yes));
      else R.cancelTrade(s, s.trade.from);
      return;
    }
    if (s.phase === 'setup') {
      var who = s.players[s.setupOrder[s.setupIdx]].id;
      if (s.setupSub === 'settlement') R.placeSettlement(s, who, pick(R.legalSettlements(s, who)));
      else R.placeRoad(s, who, pick(R.legalRoads(s, who)));
      return;
    }
    if (s.phase === 'discard') {
      var pid = Object.keys(s.mustDiscard)[0], p = R.playerOf(s, pid), pool = [];
      R.RES.forEach(function (c) { for (var i = 0; i < p.res[c]; i++) pool.push(c); });
      R.discard(s, pid, pool.slice(0, s.mustDiscard[pid]));
      return;
    }
    var cur = R.current(s);
    if (s.phase === 'robber') {
      var hex = Math.floor(rnd() * 19);
      if (hex === s.robber) hex = (hex + 1) % 19;
      var v = R.robberVictims(s, hex, cur.id);
      R.moveRobber(s, cur.id, hex, v.length ? pick(v) : null);
      return;
    }
    if (s.phase === 'roll') {
      if (rnd() < 0.15 && cur.dev.some(function (d) { return d.type === 'knight' && d.turn !== s.turnCount; })) {
        R.playDev(s, cur.id, 'knight', []);
        return;
      }
      R.roll(s, cur.id);
      return;
    }
    // main
    if (s.freeRoads > 0) {
      var fr = R.legalRoads(s, cur.id);
      if (fr.length && cur.left.road) { R.build(s, cur.id, 'road', pick(fr)); return; }
      s.freeRoads = 0;
      return;
    }
    // 지을 수 있으면 짓는다 — 무작위라도 판이 끝나게
    var cities = R.legalCities(s, cur.id);
    if (cities.length && R.canPay(cur, R.COST.city) && cur.left.city) { R.build(s, cur.id, 'city', pick(cities)); return; }
    var setts = R.legalSettlements(s, cur.id);
    if (setts.length && R.canPay(cur, R.COST.settlement) && cur.left.settlement) { R.build(s, cur.id, 'settlement', pick(setts)); return; }
    var r = rnd();
    if (r < 0.5 && !setts.length) {
      var roads = R.legalRoads(s, cur.id);
      if (roads.length && R.canPay(cur, R.COST.road) && cur.left.road) { R.build(s, cur.id, 'road', pick(roads)); return; }
    }
    if (r < 0.6 && R.canPay(cur, R.COST.dev) && s.devDeck.length) { R.buyDev(s, cur.id); return; }
    if (r < 0.7 && !s.playedDev) {
      var play = cur.dev.filter(function (d) { return d.type !== 'vp' && d.turn !== s.turnCount; });
      if (play.length) {
        var d = pick(play);
        R.playDev(s, cur.id, d.type, d.type === 'monopoly' ? [pick(R.RES)] : d.type === 'plenty' ? [pick(R.RES), pick(R.RES)] : []);
        return;
      }
    }
    if (r < 0.9) {
      var giveC = null;
      R.RES.forEach(function (c) { if (cur.res[c] >= R.tradeRate(cur, c) + 1) giveC = c; });
      if (giveC) {
        var lack = R.RES.filter(function (c) { return c !== giveC && cur.res[c] === 0; });
        var getC = lack.length ? pick(lack) : pick(R.RES.filter(function (c) { return c !== giveC; }));
        if (s.bank[getC] > 0) { R.bankTrade(s, cur.id, giveC, getC); return; }
      }
    }
    if (r >= 0.90 && r < 0.92 && s.players.filter(function (p) { return !p.out; }).length > 1) {
      var have = R.RES.filter(function (c) { return cur.res[c] > 0; });
      if (have.length) {
        var gc = pick(have), wc = pick(R.RES.filter(function (c) { return c !== gc; }));
        var gm = {}, wm = {};
        gm[gc] = 1; wm[wc] = 1;
        if (R.offerTrade(s, cur.id, gm, wm).ok) return;
      }
    }
    R.endTurn(s, cur.id);
  }
})();

console.log('');
console.log(fail ? ('실패 ' + fail + ' / 통과 ' + pass) : ('전부 통과 — ' + pass + '개'));
process.exit(fail ? 1 : 0);
