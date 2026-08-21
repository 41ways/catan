/* 카탄 — 봇 테스트.  node ai.test.js */
global.self = global;
require('./rules.js');
require('./ai.js');
var R = self.Rules, AI = self.AI;

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('  ✗ ' + name); } }
function group(name) { console.log(name); }

function game(n, seed) {
  var seats = [];
  for (var i = 0; i < n; i++) seats.push({ id: 'p' + i, name: 'p' + i, bot: true });
  return R.newGame(seats, seed);
}

/* 봇으로 한 판을 끝까지 돌린다 */
function playBots(n, seed, skills) {
  var s = game(n, seed);
  var steps = 0;
  while (s.phase !== 'over' && steps++ < 8000) {
    botTick(s, skills || {});
  }
  return { s: s, steps: steps };
}
function botTick(s, skills) {
  if (s.trade) {
    var pend = R.tradePending(s);
    if (pend.length) {
      var v0 = R.viewFor(s, pend[0]);
      R.replyTrade(s, pend[0], AI.replyToTrade(v0));
      return;
    }
    var yes = Object.keys(s.trade.replies).filter(function (k) { return s.trade.replies[k] === 'yes'; });
    if (yes.length) R.acceptTrade(s, s.trade.from, yes[0]);
    else R.cancelTrade(s, s.trade.from);
    return;
  }
  if (s.phase === 'setup') {
    var who = s.players[s.setupOrder[s.setupIdx]].id;
    var v1 = R.viewFor(s, who);
    if (s.setupSub === 'settlement') {
      var r1 = R.placeSettlement(s, who, AI.chooseSetupSettlement(v1));
      if (!r1.ok) R.placeSettlement(s, who, R.legalSettlements(s, who)[0]);
    } else {
      var r2 = R.placeRoad(s, who, AI.chooseSetupRoad(v1));
      if (!r2.ok) R.placeRoad(s, who, R.legalRoads(s, who)[0]);
    }
    return;
  }
  if (s.phase === 'discard') {
    var pid = Object.keys(s.mustDiscard)[0];
    var v2 = R.viewFor(s, pid);
    var r3 = R.discard(s, pid, AI.chooseDiscard(v2));
    if (!r3.ok) {
      var p = R.playerOf(s, pid), pool = [];
      R.RES.forEach(function (c) { for (var i = 0; i < p.res[c]; i++) pool.push(c); });
      R.discard(s, pid, pool.slice(0, s.mustDiscard[pid]));
    }
    return;
  }
  var cur = R.current(s);
  if (s.phase === 'robber') {
    var v3 = R.viewFor(s, cur.id);
    var rb = AI.chooseRobber(v3);
    var cands = R.robberVictims(s, rb.hex, cur.id);
    var r4 = R.moveRobber(s, cur.id, rb.hex, cands.length ? (rb.victim && cands.indexOf(rb.victim) >= 0 ? rb.victim : cands[0]) : null);
    if (!r4.ok) {
      var hx = (s.robber + 1) % 19;
      var cd = R.robberVictims(s, hx, cur.id);
      R.moveRobber(s, cur.id, hx, cd.length ? cd[0] : null);
    }
    return;
  }
  var v = R.viewFor(s, cur.id);
  var a = AI.act(v, skills[cur.id] !== undefined ? skills[cur.id] : 1);
  var r = a ? R[a.action].apply(null, [s, cur.id].concat(a.args)) : { ok: false };
  if (!r.ok) {
    // 안전망
    if (s.phase === 'roll') R.roll(s, cur.id);
    else if (s.freeRoads > 0) { s.freeRoads = 0; }
    else R.endTurn(s, cur.id);
  }
}

group('준비 자리 고르기');
(function () {
  var s = game(3, 5);
  var v = R.viewFor(s, 'p0');
  var vi = AI.chooseSetupSettlement(v);
  ok(vi !== null && v.legal.settlements.indexOf(vi) >= 0, '합법 자리를 고른다');
  // 고른 자리는 눈 기대치가 상위권이어야 한다
  var scores = v.legal.settlements.map(function (x) { return AI.spotScore(v, x, null); });
  scores.sort(function (a, b) { return b - a; });
  ok(AI.spotScore(v, vi, null) >= scores[Math.floor(scores.length * 0.1)], '상위 10% 자리');
  ok(R.placeSettlement(s, 'p0', vi).ok, '실제로 놓인다');
  var v2 = R.viewFor(s, 'p0');
  var ei = AI.chooseSetupRoad(v2);
  ok(R.placeRoad(s, 'p0', ei).ok, '도로도 놓인다');
})();

group('봇끼리 완주');
(function () {
  var done = 0, total = 30, turnSum = 0;
  for (var i = 0; i < total; i++) {
    var out = playBots(2 + (i % 3), 1000 + i * 37);
    if (out.s.winner) { done++; turnSum += out.s.turnCount; }
    // 규칙 위반이 없어야 한다 — 총량 검사
    var t = {};
    R.RES.forEach(function (c) {
      t[c] = out.s.bank[c];
      out.s.players.forEach(function (p) { t[c] += p.res[c]; });
    });
    ok(R.RES.every(function (c) { return t[c] === 19; }), i + '판 자원 총량 유지');
  }
  ok(done === total, total + '판 중 ' + done + '판 완주');
  ok(turnSum / done < 200, '평균 ' + Math.round(turnSum / done) + '턴에 끝난다');
})();

group('버리기');
(function () {
  var s = game(3, 909);
  while (s.phase === 'setup') botTick(s, {});
  var p = s.players[0];
  R.RES.forEach(function (c) { s.bank[c] += p.res[c]; p.res[c] = 0; });
  p.res.b = 5; p.res.l = 4; s.bank.b -= 5; s.bank.l -= 4;   // 9장
  s.mustDiscard = { p0: 4 }; s.phase = 'discard';
  var v = R.viewFor(s, 'p0');
  var list = AI.chooseDiscard(v);
  ok(list.length === 4, '딱 필요한 만큼 버린다');
  ok(R.discard(s, 'p0', list).ok, '규칙에 맞는다');
})();

group('도둑 자리');
(function () {
  var s = game(3, 606);
  while (s.phase === 'setup') botTick(s, {});
  s.phase = 'robber'; s.turn = 0; s.robberBack = 'main';
  var v = R.viewFor(s, 'p0');
  var rb = AI.chooseRobber(v);
  ok(rb.hex !== s.robber, '같은 자리는 안 고른다');
  var hex = s.board.hexes[rb.hex];
  var mineHere = hex.corners.some(function (vi) {
    var b = s.board.verts[vi].b;
    return b && b.p === 'p0';
  });
  ok(!mineHere, '내 타일은 피한다');
  ok(R.moveRobber(s, 'p0', rb.hex, rb.victim).ok, '실제로 옮겨진다');
})();

group('실력 차이');
(function () {
  // 어려움(1)이 쉬움(0.35)을 상대로 과반을 이긴다
  var wins = 0, total = 40;
  for (var i = 0; i < total; i++) {
    var out = playBots(2, 5000 + i * 13, { p0: 1, p1: 0.35 });
    if (out.s.winner === 'p0') wins++;
  }
  ok(wins > total * 0.5, '어려움이 ' + wins + '/' + total + ' 승');
})();

console.log('');
console.log(fail ? ('실패 ' + fail + ' / 통과 ' + pass) : ('전부 통과 — ' + pass + '개'));
process.exit(fail ? 1 : 0);
