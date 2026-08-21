/* 카탄 — 봇
   시야(viewFor 결과)만 보고 판단한다. 상태를 직접 만지지 않는다.
   자리의 값어치는 '주사위 눈 기대치(pip)'로 재고, 목표 하나를 정해 그쪽으로 모은다. */
(function (root) {
  'use strict';
  var R = root.Rules;
  var RES = ['b', 'l', 'w', 'g', 'o'];

  function pipsOf(v, vert) {
    var n = 0;
    vert.hexes.forEach(function (h) {
      var hex = v.board.hexes[h];
      if (hex.number && hex.res) n += R.PIPS[hex.number];
    });
    return n;
  }
  // 자리 점수 — 눈 기대치 + 자원 다양성 + 항구 약간
  function spotScore(v, vi, mine) {
    var vert = v.board.verts[vi];
    var score = pipsOf(v, vert);
    var kinds = {};
    vert.hexes.forEach(function (h) {
      var hex = v.board.hexes[h];
      if (hex.res && hex.number) kinds[hex.res] = Math.max(kinds[hex.res] || 0, R.PIPS[hex.number]);
    });
    var newKinds = 0;
    for (var c in kinds) if (!mine || !mine[c]) newKinds++;
    score += newKinds * 0.8;
    if (vert.port) score += vert.port === 'any' ? 0.5 : 1;
    return score;
  }
  // 내가 이미 받는 자원의 눈 기대치
  function myIncome(v, pid) {
    var inc = { b: 0, l: 0, w: 0, g: 0, o: 0 };
    v.board.verts.forEach(function (vert) {
      if (!vert.b || vert.b.p !== pid) return;
      var mult = vert.b.t === 'city' ? 2 : 1;
      vert.hexes.forEach(function (h) {
        var hex = v.board.hexes[h];
        if (hex.res && hex.number) inc[hex.res] += R.PIPS[hex.number] * mult;
      });
    });
    return inc;
  }
  function me(v) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === v.me) return v.players[i];
    return null;
  }
  function missing(res, cost) {
    var m = {}, total = 0;
    for (var c in cost) {
      var d = cost[c] - (res[c] || 0);
      if (d > 0) { m[c] = d; total += d; }
    }
    return { map: m, total: total };
  }
  function surplus(res, cost) {
    var out = [];
    RES.forEach(function (c) {
      var extra = (res[c] || 0) - (cost[c] || 0);
      for (var i = 0; i < extra; i++) out.push(c);
    });
    return out;
  }

  /* ---------------- 준비 단계 ---------------- */

  function chooseSetupSettlement(v) {
    var inc = myIncome(v, v.me);
    var best = null, bs = -1;
    v.legal.settlements.forEach(function (vi) {
      var s = spotScore(v, vi, inc);
      if (s > bs) { bs = s; best = vi; }
    });
    return best;
  }
  function chooseSetupRoad(v) {
    // 방금 놓은 마을에서, 다음에 마을을 지을 만한 방향으로 뻗는다
    var spot = v.setup.spot;
    var best = null, bs = -1;
    v.legal.roads.forEach(function (ei) {
      var e = v.board.edges[ei];
      var far = e.a === spot ? e.b : e.a;
      // 그 너머 자리들의 값어치
      var s = 0;
      v.board.verts[far].adj.forEach(function (nv) {
        if (nv === spot) return;
        s = Math.max(s, spotScore(v, nv, null));
      });
      s += spotScore(v, far, null) * 0.3;
      if (s > bs) { bs = s; best = ei; }
    });
    return best;
  }

  /* ---------------- 도둑 ---------------- */

  function leaderOf(v) {
    var lead = null;
    v.players.forEach(function (p) {
      if (p.id === v.me || p.out) return;
      if (!lead || p.vp > lead.vp) lead = p;
    });
    return lead;
  }
  function chooseRobber(v) {
    // 남(되도록 선두)의 생산을 가장 크게 막는 타일. 내 건물이 있는 타일은 피한다.
    var lead = leaderOf(v);
    var best = null, bs = -1, bestVictim = null;
    v.board.hexes.forEach(function (hex, hi) {
      if (hi === v.robber || !hex.res || !hex.number) return;
      var mineHere = false, gain = 0, victims = {};
      hex.corners.forEach(function (vi) {
        var b = v.board.verts[vi].b;
        if (!b) return;
        if (b.p === v.me) { mineHere = true; return; }
        var mult = b.t === 'city' ? 2 : 1;
        var w = R.PIPS[hex.number] * mult;
        if (lead && b.p === lead.id) w *= 2;
        gain += w;
        victims[b.p] = true;
      });
      if (mineHere || !gain) return;
      if (gain > bs) {
        bs = gain; best = hi;
        var vs = Object.keys(victims).filter(function (pid) {
          var p = null;
          v.players.forEach(function (q) { if (q.id === pid) p = q; });
          return p && p.cards > 0;
        });
        bestVictim = null;
        if (vs.length) {
          bestVictim = vs[0];
          if (lead && vs.indexOf(lead.id) >= 0) bestVictim = lead.id;
          else {
            var most = -1;
            vs.forEach(function (pid) {
              v.players.forEach(function (q) { if (q.id === pid && q.cards > most) { most = q.cards; bestVictim = pid; } });
            });
          }
        }
      }
    });
    if (best === null) {
      // 내 건물뿐이라도 옮겨야 한다 — 아무 데나, 되도록 사막
      v.board.hexes.forEach(function (hex, hi) {
        if (best !== null || hi === v.robber) return;
        if (!hex.res) best = hi;
      });
      if (best === null) best = (v.robber + 1) % v.board.hexes.length;
      return { hex: best, victim: null };
    }
    return { hex: best, victim: bestVictim };
  }

  /* ---------------- 버리기 ---------------- */

  function chooseDiscard(v) {
    var p = me(v), need = v.mustDiscard[v.me] || 0;
    var res = {};
    RES.forEach(function (c) { res[c] = p.res[c]; });
    var goal = chooseGoal(v);
    var keepCost = goal ? goal.cost : R.COST.city;
    var out = [];
    // 목표에 안 쓰는 것부터, 많은 것부터 버린다
    while (out.length < need) {
      var pickC = null, most = -1;
      RES.forEach(function (c) {
        var spare = res[c] - (keepCost[c] || 0);
        if (spare > 0 && res[c] > most) { most = res[c]; pickC = c; }
      });
      if (!pickC) {
        RES.forEach(function (c) { if (res[c] > most) { most = res[c]; pickC = c; } });
      }
      if (!pickC) break;
      res[pickC]--; out.push(pickC);
    }
    return out;
  }

  /* ---------------- 목표 정하기 ---------------- */

  function bestSettleSpot(v) {
    var inc = myIncome(v, v.me);
    var best = null, bs = -1;
    v.legal.settlements.forEach(function (vi) {
      var s = spotScore(v, vi, inc);
      if (s > bs) { bs = s; best = { vi: vi, score: s }; }
    });
    return best;
  }
  function bestCitySpot(v) {
    var best = null, bs = -1;
    v.legal.cities.forEach(function (vi) {
      var s = pipsOf(v, v.board.verts[vi]);
      if (s > bs) { bs = s; best = { vi: vi, score: s }; }
    });
    return best;
  }
  // 도로를 몇 개 이어야 새 마을 자리가 열리는가 — 세 칸 앞까지 내다본다
  function roadTowardSpot(v) {
    var inc = myIncome(v, v.me);
    var MAX = 3;
    var seenV = {}, best = null, bs = -Infinity;
    // (꼭짓점, 첫 도로, 거리) 를 넓혀 간다
    var queue = [];
    v.legal.roads.forEach(function (ei) {
      var e = v.board.edges[ei];
      [e.a, e.b].forEach(function (vi) {
        queue.push({ vi: vi, first: ei, d: 1 });
      });
    });
    while (queue.length) {
      var cur = queue.shift();
      var key = cur.vi;
      if (seenV[key] !== undefined && seenV[key] <= cur.d) continue;
      seenV[key] = cur.d;
      var vert = v.board.verts[cur.vi];
      if (vert.b && vert.b.p !== v.me) continue;            // 남의 마을 너머로는 못 간다
      if (!vert.b) {
        var okSpace = !vert.adj.some(function (nv) { return v.board.verts[nv].b; });
        if (okSpace) {
          var s = spotScore(v, cur.vi, inc) - (cur.d - 1) * 2;   // 멀수록 깎는다
          if (s > bs) { bs = s; best = { ei: cur.first, score: s, dist: cur.d }; }
        }
      }
      if (cur.d >= MAX) continue;
      vert.edges.forEach(function (ne) {
        var edge = v.board.edges[ne];
        if (edge.road) return;
        var far = edge.a === cur.vi ? edge.b : edge.a;
        queue.push({ vi: far, first: cur.first, d: cur.d + 1 });
      });
    }
    return best;
  }

  function chooseGoal(v) {
    var p = me(v);
    var city = bestCitySpot(v);
    var sett = bestSettleSpot(v);
    // 도시가 있으면 도시 먼저 — 2점에 생산도 배가 된다
    if (city && p.left.city > 0) {
      if (!sett || city.score * 1.15 >= sett.score || !p.left.settlement) {
        return { kind: 'city', id: city.vi, cost: R.COST.city };
      }
    }
    if (sett && p.left.settlement > 0) return { kind: 'settlement', id: sett.vi, cost: R.COST.settlement };
    if (city && p.left.city > 0) return { kind: 'city', id: city.vi, cost: R.COST.city };
    var toward = roadTowardSpot(v);
    if (toward && p.left.road > 0) return { kind: 'road', id: toward.ei, cost: R.COST.road };
    if (v.devLeft > 0) return { kind: 'dev', cost: R.COST.dev };
    return null;
  }

  /* ---------------- 본 차례 ---------------- */

  function knightWorthIt(v) {
    // 도둑이 내 타일에 앉아 있으면 치운다. 최강 기사단이 눈앞이어도 쓴다.
    var hex = v.board.hexes[v.robber];
    var onMine = hex.corners.some(function (vi) {
      var b = v.board.verts[vi].b;
      return b && b.p === v.me;
    });
    if (onMine) return true;
    var p = me(v);
    if (p.knights + 1 >= R.ARMY_MIN && (!v.army.p || (v.army.p !== v.me && p.knights + 1 > v.army.n))) return true;
    return false;
  }

  function act(v, skill) {
    var p = me(v);
    skill = skill === undefined ? 1 : skill;

    // 실력을 낮추면 가끔 아무 수나 둔다
    var sloppy = Math.random() > skill;

    if (v.phase === 'roll') {
      var fresh = p.dev && p.dev.some(function (d) { return d.type === 'knight' && !d.fresh; });
      if (!sloppy && fresh && !v.playedDev && knightWorthIt(v)) return { action: 'playDev', args: ['knight', []] };
      return { action: 'roll', args: [] };
    }

    if (v.phase !== 'main') return null;

    // 공짜 도로가 남아 있으면 그것부터
    if (v.freeRoads > 0) {
      if (!v.legal.roads.length || !p.left.road) return { action: 'endTurn', args: [] };
      var toward0 = roadTowardSpot(v);
      return { action: 'build', args: ['road', toward0 ? toward0.ei : v.legal.roads[0]] };
    }

    if (sloppy) return sloppyMove(v, p);

    var goal = chooseGoal(v);

    // 발전 카드 쓰기 — 한 턴에 하나
    if (!v.playedDev && p.dev) {
      var usable = p.dev.filter(function (d) { return !d.fresh && d.type !== 'vp'; });
      for (var i = 0; i < usable.length; i++) {
        var d = usable[i];
        if (d.type === 'knight' && knightWorthIt(v)) return { action: 'playDev', args: ['knight', []] };
        if (d.type === 'road' && p.left.road >= 2 && v.legal.roads.length) return { action: 'playDev', args: ['road', []] };
        if (d.type === 'plenty' && goal) {
          var miss = missing(p.res, goal.cost);
          if (miss.total >= 1 && miss.total <= 2) {
            var picks = [];
            for (var c in miss.map) for (var k = 0; k < miss.map[c] && picks.length < 2; k++) picks.push(c);
            while (picks.length < 2) picks.push(picks[0] || 'g');
            return { action: 'playDev', args: ['plenty', picks] };
          }
        }
        if (d.type === 'monopoly') {
          // 남들 손이 두툼할 때, 목표에 모자란 자원을 노린다
          var others = 0;
          v.players.forEach(function (q) { if (q.id !== v.me && !q.out) others += q.cards; });
          if (goal && others >= 6) {
            var miss2 = missing(p.res, goal.cost);
            var want = Object.keys(miss2.map)[0];
            if (want) return { action: 'playDev', args: ['monopoly', [want]] };
          }
        }
      }
    }

    if (goal) {
      var miss3 = missing(p.res, goal.cost);
      if (miss3.total === 0) {
        if (goal.kind === 'dev') return { action: 'buyDev', args: [] };
        return { action: 'build', args: [goal.kind, goal.id] };
      }
      // 은행 교환으로 메꿀 수 있으면 메꾼다
      var spare = surplus(p.res, goal.cost);
      var rates = {};
      RES.forEach(function (c) { rates[c] = R.tradeRate(p, c); });
      var byRes = {};
      spare.forEach(function (c) { byRes[c] = (byRes[c] || 0) + 1; });
      for (var cc in byRes) {
        if (byRes[cc] >= rates[cc]) {
          var wantC = Object.keys(miss3.map)[0];
          if (wantC && v.bank[wantC] > 0) return { action: 'bankTrade', args: [cc, wantC] };
        }
      }
      // 목표에 2장 이하로 모자라고 손이 여유로우면 발전 카드도 산다
      var canDev = v.devLeft > 0 && missing(p.res, R.COST.dev).total === 0;
      if (canDev && miss3.total >= 3 && surplus(p.res, R.COST.dev).length >= 2) {
        return { action: 'buyDev', args: [] };
      }
    } else if (v.devLeft > 0 && missing(p.res, R.COST.dev).total === 0) {
      return { action: 'buyDev', args: [] };
    }

    // 손이 8장 이상이면 7이 무섭다 — 뭐라도 소비한다
    var hand = 0;
    RES.forEach(function (c) { hand += p.res[c]; });
    if (hand > R.HAND_LIMIT) {
      if (v.devLeft > 0 && missing(p.res, R.COST.dev).total === 0) return { action: 'buyDev', args: [] };
      if (missing(p.res, R.COST.road).total === 0 && p.left.road > 0 && v.legal.roads.length) {
        var toward1 = roadTowardSpot(v);
        if (toward1) return { action: 'build', args: ['road', toward1.ei] };
      }
      // 아무 자원이나 4:1
      var most = null, mn = 0;
      RES.forEach(function (c) { if (p.res[c] > mn) { mn = p.res[c]; most = c; } });
      if (most && mn >= R.tradeRate(p, most)) {
        var lacks = RES.filter(function (c) { return c !== most && p.res[c] === 0 && v.bank[c] > 0; });
        if (lacks.length) return { action: 'bankTrade', args: [most, lacks[0]] };
      }
    }

    return { action: 'endTurn', args: [] };
  }

  function sloppyMove(v, p) {
    // 되는 것 중 아무거나 — 약한 봇의 실수
    var opts = [];
    if (missing(p.res, R.COST.road).total === 0 && p.left.road > 0 && v.legal.roads.length) {
      opts.push({ action: 'build', args: ['road', v.legal.roads[Math.floor(Math.random() * v.legal.roads.length)]] });
    }
    if (v.devLeft > 0 && missing(p.res, R.COST.dev).total === 0) opts.push({ action: 'buyDev', args: [] });
    opts.push({ action: 'endTurn', args: [] });
    return opts[Math.floor(Math.random() * opts.length)];
  }

  /* ---------------- 거래 응답 ---------------- */

  function replyToTrade(v) {
    var p = me(v), t = v.trade;
    if (!t) return false;
    // 요구를 낼 수 있어야 한다
    for (var c in t.want) if ((p.res[c] || 0) < t.want[c]) return false;
    // 받는 장수가 내는 장수보다 적으면 거절
    var give = 0, get = 0, cc;
    for (cc in t.want) give += t.want[cc];
    for (cc in t.give) get += t.give[cc];
    if (get < give) return false;
    // 내 목표에 쓰이는 자원을 내주는 거라면 거절
    var goal = chooseGoal(v);
    if (goal) {
      for (cc in t.want) {
        var keep = goal.cost[cc] || 0;
        if (p.res[cc] - t.want[cc] < keep) return false;
      }
      // 받는 것 중에 목표에 필요한 게 있으면 수락
      var miss = missing(p.res, goal.cost);
      for (cc in t.give) if (miss.map[cc]) return true;
    }
    // 목표와 무관하면 이득일 때만
    return get > give;
  }

  root.AI = {
    act: act,
    chooseSetupSettlement: chooseSetupSettlement,
    chooseSetupRoad: chooseSetupRoad,
    chooseRobber: chooseRobber,
    chooseDiscard: chooseDiscard,
    chooseGoal: chooseGoal,
    replyToTrade: replyToTrade,
    spotScore: spotScore, myIncome: myIncome
  };
})(typeof self !== 'undefined' ? self : this);
