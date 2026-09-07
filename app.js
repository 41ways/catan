/* 카탄 — 화면과 진행
   방장(또는 혼자 하기)의 브라우저가 심판이다. 참가자는 자기 시야만 받아서 그린다. */
(function () {
  'use strict';
  var R = window.Rules, AI = window.AI;
  var CK = window.CK, CKAI = window.CKAI;
  // 지금 판이 쓰는 엔진과 봇
  function E() { return App.ext ? CK : R; }
  function BOT() { return App.ext ? CKAI : AI; }
  function isExt(v) { return !!(v && v.ext === 'ck'); }
  var $ = function (id) { return document.getElementById(id); };
  var RES = R.RES;
  var RN = { b: '벽돌', l: '나무', w: '양', g: '밀', o: '철', c: '옷감', p: '종이', n: '화폐' };
  // 확장에서는 흙이라 부른다
  function resName(c) { return App.ext && c === 'b' ? '흙' : RN[c]; }
  function cardsOf(v) { return isExt(v) ? CK.ALL : RES; }
  var PCOLOR = { red: '#d95f4a', blue: '#5a8fd9', orange: '#e09a3e', white: '#d8dce6' };
  var EMOJI = {
    b: '\uD83E\uDDF1', l: '\uD83E\uDEB5', w: '\uD83D\uDC11', g: '\uD83C\uDF3E', o: '\uD83E\uDEA8',
    c: '\uD83E\uDDF6', p: '\uD83D\uDCDC', n: '\uD83E\uDE99'          // 🧶 옷감 · 📜 종이 · 🪙 화폐
  };
  function rchip(c) { return el('i', 'rc r-' + c, EMOJI[c]); }
  var S = 52;                                     // 육각형 한 변(px)
  var SVGNS = 'http://www.w3.org/2000/svg';

  var App = {
    ext: false, feed: [], feedBusy: false, feedTimer: null, bigTimer: null, lastLogId: undefined,
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
    App.ext = (App.mode === 'solo' || App.mode === 'host') ? App.wantExt : App.ext;
    if (App.seats.length < 2) { toast('2명 이상이어야 시작할 수 있습니다.'); return; }
    App.started = true;
    App.state = E().newGame(App.seats.map(function (s) {
      return { id: s.id, name: s.name, bot: s.bot };
    }), Math.floor(Math.random() * 1e9));
    App.build = null; App.discardSel = [];
    show('game');
    pushViews();
  }

  function pushViews() {
    var s = App.state;
    if (App.mode === 'host' && App.net) {
      App.net.broadcast(function (pid) { return { t: 'view', view: E().viewFor(s, pid) }; });
    }
    applyView(E().viewFor(s, App.me));
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
        var roller = v.players[v.turn];
        showDiceRoll(v.dice, roller, v, function () {
          if (isSeven) litRobber();
          else if (gains) flyGains(gains);
          else showBlocked(v);
        });
      }
    }
    render();
    // 지난 차례에 무슨 일이 있었는지 한 줄씩 풀어 준다
    pushFeed(v);
    renderNow(v);
    if (prev && prev.turn !== v.turn && v.phase !== 'over') announceTurn(v);
    if (v.lastTrade) playTradeAnim(v);
    if (v.lastBank) playBankAnim(v);
    if (v.lastRobber) playRobberAnim(v);
    if (v.lastSteal) playStealAnim(v);
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
    if (!s) return;
    var allowed = ['placeSettlement', 'placeRoad', 'roll', 'discard', 'moveRobber',
      'build', 'buyDev', 'playDev', 'bankTrade', 'offerTrade', 'replyTrade',
      'acceptTrade', 'cancelTrade', 'endTurn',
      // 도시와 기사
      'placeKnight', 'activateKnight', 'upgradeKnight', 'moveKnight', 'chaseRobber',
      'develop', 'playCard'];
    if (allowed.indexOf(action) < 0) return;
    var eng = E();
    if (typeof eng[action] !== 'function') return;
    var r = eng[action].apply(null, [s, pid].concat(args || []));
    if (!r.ok) {
      if (pid === App.me) toast(r.error);
      else if (App.net) App.net.toPlayer(pid, { t: 'err', msg: r.error });
      return;
    }
    App.build = null;
    App.knightSel = null;
    pushViews();
  }


  /* ---------------- 봇 ---------------- */

  function scheduleBot() {
    if (App.mode === 'client') return;
    var s = App.state, eng = E();
    if (!s || s.phase === 'over') return;
    clearTimeout(App.botTimer);
    // 거래 응답이 먼저다
    var pend = eng.tradePending(s).filter(function (pid) { return eng.playerOf(s, pid).bot; });
    if (pend.length) {
      var w = 700 + Math.min(1400, App.feed.length * 340);
      App.botTimer = setTimeout(function () { botTradeReply(pend[0]); }, w);
      return;
    }
    // 제안이 떠 있는데 응답이 다 모였으면 사람(제안자)의 몫 — 봇은 제안하지 않는다
    if (s.trade) return;
    var need = eng.needsAction(s).filter(function (pid) { return eng.playerOf(s, pid).bot; });
    if (!need.length) return;
    var wait = s.phase === 'setup' ? 620 : s.phase === 'roll' ? 700 : 620;
    // 아직 중계할 줄이 남아 있으면 그만큼 늦춘다 (한 수씩 눈에 들어오게)
    wait += Math.min(1800, App.feed.length * 380 + (App.feedBusy ? 260 : 0));
    App.botTimer = setTimeout(function () { botStep(need[0]); }, wait);
  }

  function botTradeReply(pid) {
    var s = App.state, eng = E();
    if (!s || !s.trade) { scheduleBot(); return; }
    eng.replyTrade(s, pid, BOT().replyToTrade(eng.viewFor(s, pid)));
    pushViews();
  }

  function botStep(pid) {
    var s = App.state, eng = E(), bot = BOT();
    if (!s || s.phase === 'over') return;
    var p = eng.playerOf(s, pid);
    if (!p || !p.bot) return;
    var v = eng.viewFor(s, pid), r = null;
    var cards = App.ext ? CK.ALL : RES;

    if (s.phase === 'setup') {
      if (s.setupSub === 'settlement') {
        r = eng.placeSettlement(s, pid, bot.chooseSetupSettlement(v));
        if (!r.ok) r = eng.placeSettlement(s, pid, eng.legalSettlements(s, pid)[0]);
      } else {
        r = eng.placeRoad(s, pid, bot.chooseSetupRoad(v));
        if (!r.ok) r = eng.placeRoad(s, pid, eng.legalRoads(s, pid)[0]);
      }
    } else if (s.phase === 'discard') {
      var need = s.mustDiscard[pid];
      r = eng.discard(s, pid, bot.chooseDiscard(v, need));
      if (!r.ok) {
        var pool = [];
        cards.forEach(function (c) { for (var i = 0; i < p.res[c]; i++) pool.push(c); });
        r = eng.discard(s, pid, pool.slice(0, need));
      }
    } else if (s.phase === 'robber') {
      var rb = bot.chooseRobber(v);
      var cands = eng.robberVictims(s, rb.hex, pid);
      r = eng.moveRobber(s, pid, rb.hex, cands.length ? (rb.victim && cands.indexOf(rb.victim) >= 0 ? rb.victim : cands[0]) : null);
      if (!r.ok) {
        var hx = (s.robber + 1) % 19, cd = eng.robberVictims(s, hx, pid);
        r = eng.moveRobber(s, pid, hx, cd.length ? cd[0] : null);
      }
    } else {
      var a = bot.act(v, App.skill);
      if (a && typeof eng[a.action] === 'function') r = eng[a.action].apply(null, [s, pid].concat(a.args));
      if (!r || !r.ok) {
        if (s.phase === 'roll') r = eng.roll(s, pid);
        else { if (s.freeRoads > 0) s.freeRoads = 0; r = eng.endTurn(s, pid); }
      }
    }
    if (!r || !r.ok) { toast('봇이 막혔습니다.'); return; }
    pushViews();
  }

  // 판 테두리를 지금 차례인 사람 색으로 물들인다 — 내 차례면 더 진하게
  function paintTurnFrame(v) {
    var box = $('boardBox');
    if (!box) return;
    var cur = v.phase === 'setup' ? playerIn(v, v.setup.who) : v.players[v.turn];
    if (!cur || v.phase === 'over') {
      box.style.boxShadow = '';
      box.classList.remove('myTurnFrame');
      return;
    }
    var col = PCOLOR[cur.color] || '#888';
    var mine = cur.id === v.me;
    box.style.boxShadow = 'inset 0 0 0 ' + (mine ? '3px' : '2px') + ' ' + col +
      (mine ? ', 0 0 18px -4px ' + col : '');
    box.classList.toggle('myTurnFrame', mine);
  }

  /* ---------------- 중계 — 로그를 한 줄씩 풀어 보여준다 ---------------- */

  // 로그 한 줄이 무슨 일인지 알아본다 (표시 전용)
  // big:true 는 화면 가운데 큰 알림까지 띄운다
  function readLine(text) {
    var t = text;
    function has() {
      for (var i = 0; i < arguments.length; i++) if (t.indexOf(arguments[i]) >= 0) return true;
      return false;
    }
    // ── 판을 뒤흔드는 일 ──────────────────────────────
    if (has('승리')) return { icon: '\uD83C\uDFC6', hold: 2000, big: true };
    if (has('야만족 상륙')) return { icon: '\u2694\uFE0F', hold: 1700, big: true };
    if (has('약탈이 없습니다')) return { icon: '\uD83D\uDE0C', hold: 1100 };
    if (has('약탈')) return { icon: '\uD83D\uDD25', hold: 1500, big: true };
    if (has('카탄의 수호자')) return { icon: '\uD83C\uDF96\uFE0F', hold: 1500, big: true };
    if (has('최장 교역로가 사라', '최장 교역로가 동점')) return { icon: '\uD83D\uDEE3\uFE0F', hold: 1300, big: true };
    if (has('최장 교역로')) return { icon: '\uD83D\uDEE3\uFE0F', hold: 1500, big: true };
    if (has('최강 기사단')) return { icon: '\uD83D\uDEE1\uFE0F', hold: 1500, big: true };
    if (has('수도 건설', '수도를 빼앗')) return { icon: '\uD83C\uDFF0', hold: 1500, big: true };
    if (has('절반 버리기')) return { icon: '\uD83D\uDDD1\uFE0F', hold: 1600, big: true };
    if (has('독점')) return { icon: '\uD83E\uDDF2', hold: 1500, big: true };

    // ── 주사위와 생산 ────────────────────────────────
    if (has('주사위')) return { icon: '\uD83C\uDFB2', hold: 700 };
    if (has('도둑이', '막고 있어')) return { icon: '\uD83D\uDEAB', hold: 1400, big: true };
    if (has('모자라')) return { icon: '\u26A0\uFE0F', hold: 1200 };
    if (has('아무도 못 받')) return { icon: '\uD83D\uDCA8', hold: 900 };
    if (has('\u2190', '첫 자원', '거둬', '받았습니다', '캤습니다', '거뒀습니다 —')) return { icon: '\uD83D\uDCE6', hold: 850 };

    // ── 도둑 ────────────────────────────────────────
    if (has('(으)로 옮김')) return { icon: '\uD83D\uDD75\uFE0F', hold: 1500, big: true };
    if (has('도둑을 옮깁니다', '도둑을 쫓')) return { icon: '\uD83D\uDD75\uFE0F', hold: 1200 };
    if (has('가져갔습니다')) return { icon: '\uD83E\uDD1A', hold: 1600, big: true };
    if (has('가져온 것', '빼앗긴 것')) return { icon: '\uD83D\uDC40', hold: 1300 };
    if (has('도둑은 움직이지', '도둑은 그대로')) return { icon: '\uD83D\uDE34', hold: 1200 };
    if (has('버림 —')) return { icon: '\uD83D\uDDD1\uFE0F', hold: 1100 };

    // ── 짓기 ────────────────────────────────────────
    if (has('성벽')) return { icon: '\uD83E\uDDF1', hold: 1200 };
    if (has('도시 — 2점', '도시\n', '도시')) return { icon: '\uD83C\uDFDB\uFE0F', hold: 1200 };
    if (has('마을')) return { icon: '\uD83C\uDFE0', hold: 1100 };
    if (has('항구 확보')) return { icon: '\u2693', hold: 1300 };
    if (has('도로')) return { icon: '\uD83D\uDEE4\uFE0F', hold: 850 };

    // ── 기사 (확장) ─────────────────────────────────
    if (has('기사를 놓', '기사를 활동', '승급', '밀어냈', '추방', '기사가 이동')) {
      return { icon: '\u2694\uFE0F', hold: 1200 };
    }
    if (has('야만족 함대')) return { icon: '\u26F5', hold: 1100 };

    // ── 카드 ────────────────────────────────────────
    if (has('자원 발견')) return { icon: '\uD83C\uDF81', hold: 1200 };
    if (has('도로 건설 —')) return { icon: '\uD83D\uDEA7', hold: 1200 };
    if (has('성문 —', '진보카드')) return { icon: '\uD83D\uDCDC', hold: 1200 };
    if (has('발전 카드', '뽑은 카드')) return { icon: '\uD83C\uDCCF', hold: 1000 };
    if (has('단계 —')) return { icon: '\uD83D\uDCDA', hold: 1300 };

    // ── 거래 ────────────────────────────────────────
    if (has('거래 성사')) return { icon: '\uD83E\uDD1D', hold: 1400 };
    if (has('거래 제안')) return { icon: '\uD83D\uDCAC', hold: 1200 };
    if (has('받겠다고')) return { icon: '\uD83D\uDC4D', hold: 900 };
    if (has('거절')) return { icon: '\uD83D\uDC4E', hold: 900 };
    if (has('제안을 거뒀')) return { icon: '\u21A9\uFE0F', hold: 900 };
    if (has('은행과')) return { icon: '\uD83C\uDFE6', hold: 1000 };

    // ── 진행 ────────────────────────────────────────
    if (has('준비 끝')) return { icon: '\uD83C\uDFC1', hold: 1200 };
    if (has('나감')) return { icon: '\uD83D\uDEAA', hold: 1200 };
    if (has('놓을 자리가 없어', '넘어갑니다')) return { icon: '\u23ED\uFE0F', hold: 1000 };
    if (has('차례')) return { icon: '\u23ED\uFE0F', hold: 700 };
    return { icon: '\u2022', hold: 900 };
  }

  // 그 줄이 누구 이야기인지 — 이름으로 찾아 색을 입힌다
  function lineOwner(v, text) {
    var best = null;
    v.players.forEach(function (p) {
      if (text.indexOf(p.name) === 0) best = p;
    });
    if (best) return best;
    v.players.forEach(function (p) {
      if (!best && text.indexOf(p.name) >= 0) best = p;
    });
    return best;
  }

  function pushFeed(v) {
    var lines = v.log || [];
    if (App.lastLogId === undefined) {
      // 첫 화면에서는 지난 줄을 몰아 보여주지 않는다
      App.lastLogId = lines.length ? lines[lines.length - 1].i : -1;
      return;
    }
    lines.forEach(function (l) {
      if (l.i <= App.lastLogId) return;
      App.lastLogId = l.i;
      if (l.text.indexOf('— ') === 0 && l.text.indexOf('차례') > 0) return;  // 큰 배너가 알려 준다
      var info = readLine(l.text);
      App.feed.push({ text: l.text, icon: info.icon, hold: info.hold, big: info.big, owner: lineOwner(v, l.text) });
    });
    if (App.feed.length > 14) App.feed = App.feed.slice(-14);   // 너무 밀리면 앞을 버린다
    pumpFeed();
  }

  function pumpFeed() {
    if (App.feedBusy || !App.feed.length) return;
    App.feedBusy = true;
    var item = App.feed.shift();
    showNow(item.icon, item.text, item.owner);
    if (item.big) showBigNews(item);
    // 밀려 있으면 조금씩 빨리 넘긴다
    var hold = item.hold * (App.feed.length > 5 ? 0.45 : App.feed.length > 2 ? 0.7 : 1);
    clearTimeout(App.feedTimer);
    App.feedTimer = setTimeout(function () {
      App.feedBusy = false;
      if (App.feed.length) pumpFeed();
      else renderNow(App.view);          // 할 말이 없으면 지금 상황으로 돌아간다
    }, Math.max(320, hold));
  }

  function showNow(icon, text, owner) {
    var bar = $('nowBar'), dot = $('nowDot'), txt = $('nowText');
    bar.classList.remove('step');
    void bar.offsetWidth;                 // 애니메이션 다시 태우기
    bar.classList.add('step');
    dot.style.background = owner ? (PCOLOR[owner.color] || 'var(--faint)') : 'var(--faint)';
    txt.textContent = icon + '  ' + text;
    bar.classList.toggle('mine', !!(owner && App.view && owner.id === App.view.me));
    var vv = App.view;
    if (vv) {
      bar.classList.toggle('urgent', !!vv.mustDiscard[vv.me] ||
        (!!vv.trade && vv.trade.from !== vv.me && !vv.trade.replies[vv.me]));
    }
  }

  // 지금 누가 무엇을 할 차례인지 (중계할 게 없을 때)
  function renderNow(v) {
    if (!v || App.feedBusy) return;
    var bar = $('nowBar'), dot = $('nowDot'), txt = $('nowText');
    var actor = null, msg = '';
    var mine = isMyTurn(v);

    if (v.phase === 'over') {
      var w = playerIn(v, v.winner);
      showNow('\uD83C\uDFC6', w ? (w.name + ' 승리!') : '판이 끝났습니다.', w);
      return;
    }
    if (v.trade) {
      actor = playerIn(v, v.trade.from);
      var waiting = v.players.filter(function (p) {
        return !p.out && p.id !== v.trade.from && !v.trade.replies[p.id];
      });
      var yes = Object.keys(v.trade.replies).filter(function (k) { return v.trade.replies[k] === 'yes'; });
      var mineOffer = v.trade.from === v.me;
      if (waiting.length) {
        msg = (mineOffer ? '내 거래 제안' : actor.name + '의 거래 제안') + ' — ' +
          waiting.map(function (p) { return p.name; }).join(', ') + '의 답을 기다리는 중';
      } else if (yes.length) {
        msg = (mineOffer ? '내 제안' : actor.name + '의 제안') + ' — ' +
          yes.map(function (k) { return (playerIn(v, k) || {}).name; }).join(', ') + '이(가) 받겠다고 했습니다' +
          (mineOffer ? '. 누구와 바꿀지 고르세요' : '');
      } else {
        msg = (mineOffer ? '내 제안' : actor.name + '의 제안') + ' — 모두 거절했습니다' +
          (mineOffer ? '. 조건을 바꾸거나 제안을 거두세요' : '');
      }
      if (!mineOffer && !v.trade.replies[v.me]) msg = actor.name + '의 제안 — 받을지 말지 고르세요';
    } else if (v.phase === 'setup') {
      actor = playerIn(v, v.setup.who);
      var second = v.setup.idx >= v.players.length;
      var what = (isExt(v) && second) ? '도시' : '마을';
      msg = (actor && actor.id === v.me)
        ? '내 차례 — ' + (v.setup.sub === 'settlement' ? what + '을(를) 놓으세요' : '도로를 놓으세요')
        : (actor ? actor.name : '?') + '이(가) 자리를 고르는 중';
    } else if (v.phase === 'discard') {
      var who = Object.keys(v.mustDiscard).map(function (pid) { return playerIn(v, pid); }).filter(Boolean);
      actor = who[0] || null;
      msg = v.mustDiscard[v.me]
        ? '내 손패가 넘칩니다 — ' + v.mustDiscard[v.me] + '장을 골라 버리세요'
        : who.map(function (p) { return p.name; }).join(', ') + '이(가) 카드를 버리는 중';
    } else if (v.phase === 'robber') {
      actor = v.players[v.turn];
      msg = mine ? '내 차례 — 도둑을 옮길 타일을 누르세요' : actor.name + '이(가) 도둑을 옮기는 중';
    } else if (v.phase === 'roll') {
      actor = v.players[v.turn];
      msg = mine ? '내 차례 — 주사위를 굴리세요' : actor.name + '이(가) 주사위를 굴릴 차례';
    } else {
      actor = v.players[v.turn];
      if (v.freeRoads > 0) msg = mine ? '공짜 도로 ' + v.freeRoads + '개를 놓으세요' : actor.name + '이(가) 도로를 놓는 중';
      else msg = mine ? '내 차례 — 짓거나 거래하세요' : actor.name + '이(가) 짓고 거래하는 중';
    }

    bar.classList.remove('step');
    dot.style.background = actor ? (PCOLOR[actor.color] || 'var(--faint)') : 'var(--faint)';
    txt.textContent = msg;
    bar.classList.toggle('mine', mine && !v.trade);
    // 내가 지금 꼭 해야 하는 일이면 눈에 띄게 재촉한다
    var urgent = !!v.mustDiscard[v.me] ||
      (v.trade && v.trade.from !== v.me && !v.trade.replies[v.me]) ||
      (mine && v.phase === 'robber');
    bar.classList.toggle('urgent', !!urgent);
    // 남을 기다리는 중이면 점 세 개
    var wait = bar.querySelector('.nowWait');
    var waitingForOther = !mine || v.phase === 'discard' || !!v.trade;
    if (waitingForOther && !wait) {
      var w2 = el('span', 'nowWait');
      w2.appendChild(el('i')); w2.appendChild(el('i')); w2.appendChild(el('i'));
      bar.appendChild(w2);
    } else if (!waitingForOther && wait) wait.remove();
  }

  // 색이 붙은 이름표 — 누가 누구에게 했는지 한눈에
  function nameTag(p) {
    var t = el('span', 'bnName', p ? p.name : '?');
    if (p) {
      t.style.borderColor = PCOLOR[p.color] || '';
      t.style.color = PCOLOR[p.color] || '';
    }
    return t;
  }

  // 큰 소식 — 잠깐 화면 가운데에. 업적은 더 오래, 더 크게
  function showBigNews(item) {
    var box = $('bigNews'), inner = box.querySelector('.bigNewsInner');
    var text = item.text, title = text, sub = '';
    var m = text.indexOf(' — ');
    if (m > 0) { title = text.slice(0, m); sub = text.slice(m + 3); }

    var award = false;
    if (text.indexOf('최장 교역로') >= 0) {
      award = true;
      title = (item.owner ? item.owner.name : '') + ' 최장 교역로!';
      sub = '가장 긴 길을 이었습니다 — 2점';
    } else if (text.indexOf('최강 기사단') >= 0) {
      award = true;
      title = (item.owner ? item.owner.name : '') + ' 최강 기사단!';
      sub = '기사를 가장 많이 썼습니다 — 2점';
    } else if (text.indexOf('수도 건설') >= 0) {
      award = true;
      sub = '수도를 세웠습니다 — 2점';
    } else if (text.indexOf('수도를 빼앗') >= 0) {
      award = true;
      sub = '더 높이 개발해 수도를 가져왔습니다 — 2점';
    } else if (text.indexOf('야만족 상륙') >= 0) {
      title = '야만족 상륙!';
      sub = text.replace(/^.*상륙!\s*/, '');
    } else if (text.indexOf('절반 버리기') >= 0) {
      var mineNeed = App.view && App.view.mustDiscard ? App.view.mustDiscard[App.view.me] : 0;
      title = mineNeed ? ('7! 내 카드 ' + mineNeed + '장을 버립니다') : '7! 카드를 버립니다';
      sub = text.replace('7 — 절반 버리기: ', '') || '손패가 8장 이상인 사람은 절반을 버립니다';
      $('bnIcon').textContent = '\uD83D\uDDD1\uFE0F';
    } else if (text.indexOf('막고 있어') >= 0) {
      title = '도둑이 막았습니다';
      sub = text.replace(/^도둑이 /, '').replace('막고 있어 ', '막고 있어\n');
    } else if (text.indexOf('독점') >= 0) {
      title = (item.owner ? item.owner.name : '') + ' 독점!';
      sub = text.replace(/^.*독점 — /, '');
    } else if (text.indexOf('가져갔습니다') >= 0) {
      // 도둑으로 카드를 빼앗았다 — 무슨 카드인지는 숨긴다
      var v0 = App.view;
      var st = v0 && v0.lastSteal;
      title = '카드를 빼앗았습니다';
      sub = '무슨 카드인지는 두 사람만 압니다';
      $('bnIcon').textContent = '\uD83C\uDCCF';
      if (st) {
        item.pair = { from: playerIn(v0, st.victim), to: playerIn(v0, st.thief), icon: '\u2192' };
      }
    } else if (text.indexOf('(으)로 옮김') >= 0) {
      var v1 = App.view, rb = v1 && v1.lastRobber;
      title = (item.owner ? item.owner.name : '') + '이(가) 도둑을 옮겼습니다';
      if (rb && v1.board.hexes[rb.to]) {
        var toHex = v1.board.hexes[rb.to];
        sub = toHex.number ? (toHex.number + ' 타일이 막혔습니다') : '사막으로 옮겼습니다';
      } else sub = '';
    } else if (text.indexOf('수호자') >= 0) {
      award = true;
      title = (item.owner ? item.owner.name : '') + ' 카탄의 수호자!';
      sub = '야만족을 막아낸 공로 — 승점 1';
    } else if (text.indexOf('약탈') >= 0) {
      title = '도시가 약탈당했습니다';
      sub = text.replace('의 도시가 약탈당해 마을로 내려갔습니다.', ' — 도시가 마을로');
    }

    $('bnIcon').textContent = item.icon;
    $('bnTitle').textContent = title;
    $('bnTitle').style.color = item.owner ? (PCOLOR[item.owner.color] || '') : '';
    $('bnSub').textContent = sub;
    // 두 사람 사이에 일어난 일이면 '누가 → 누구' 를 색으로 보여준다
    var pair = $('bnPair');
    if (pair) {
      pair.innerHTML = '';
      if (item.pair) {
        pair.appendChild(nameTag(item.pair.from));
        var arrow = el('span', 'bnArrow', item.pair.icon || '\u2192');
        pair.appendChild(arrow);
        pair.appendChild(nameTag(item.pair.to));
        pair.classList.remove('hidden');
      } else pair.classList.add('hidden');
    }
    inner.classList.toggle('award', award);
    box.classList.remove('hidden', 'out');
    clearTimeout(App.bigTimer);
    App.bigTimer = setTimeout(function () {
      box.classList.add('out');
      setTimeout(function () {
        box.classList.add('hidden');
        $('bnTitle').style.color = '';
        inner.classList.remove('award');
      }, 300);
    }, award ? 2600 : (item.pair ? 2400 : 1900));
  }

  // 차례가 넘어갈 때 — 누구 차례인지 확실히 알려준다
  function announceTurn(v) {
    var p = v.players[v.turn];
    if (!p) return;
    var box = $('bigNews');
    $('bnIcon').textContent = p.id === v.me ? '\uD83D\uDC4B' : '\u23ED\uFE0F';
    $('bnTitle').textContent = p.id === v.me ? '내 차례' : p.name + '의 차례';
    $('bnTitle').style.color = PCOLOR[p.color] || '';
    $('bnSub').textContent = p.id === v.me ? '주사위를 굴려 시작하세요' : '';
    box.classList.remove('hidden', 'out');
    clearTimeout(App.bigTimer);
    App.bigTimer = setTimeout(function () {
      box.classList.add('out');
      setTimeout(function () {
        box.classList.add('hidden');
        $('bnTitle').style.color = '';
      }, 300);
    }, p.id === v.me ? 1100 : 800);
  }

  // 거래 — 카드가 두 사람 사이를 실제로 건너간다
  function playTradeAnim(v) {
    var t = v.lastTrade;
    if (!t) return;
    var key = t.turn + ':' + t.a + '>' + t.b + ':' + JSON.stringify(t.give) + JSON.stringify(t.want);
    if (App.tradeKey === key) return;
    App.tradeKey = key;
    var ra = chipRect(t.a), rb = chipRect(t.b);
    if (!ra || !rb) return;
    var delay = 0;
    Object.keys(t.give).forEach(function (c) {
      for (var i = 0; i < t.give[c]; i++) { flyBetween(ra, rb, c, delay); delay += 130; }
    });
    Object.keys(t.want).forEach(function (c) {
      for (var i = 0; i < t.want[c]; i++) { flyBetween(rb, ra, c, delay); delay += 130; }
    });
  }
  function chipRect(pid) {
    var e = document.querySelector('.pl[data-pid="' + pid + '"]');
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, host: e };
  }
  // 은행 교환 — 내 손패에서 나갔다가 들어온다
  function playBankAnim(v) {
    var t = v.lastBank;
    if (!t) return;
    var key = t.turn + ':' + t.p + ':' + t.give + t.rate + t.get;
    if (App.bankKey === key) return;
    App.bankKey = key;
    var from = chipRect(t.p) || null;
    var toStack = document.querySelector('.rstack[data-res="' + t.get + '"]');
    var giveStack = document.querySelector('.rstack[data-res="' + t.give + '"]');
    if (t.p === v.me && giveStack && toStack) {
      var g = giveStack.getBoundingClientRect(), h = toStack.getBoundingClientRect();
      var bankPt = { left: (g.left + h.left) / 2, top: g.top - 70, width: 0, height: 0 };
      for (var i = 0; i < t.rate; i++) flyBetween(g, bankPt, t.give, i * 90);
      flyBetween(bankPt, h, t.get, t.rate * 90 + 160);
    }
  }

  function flyBetween(fromRect, toRect, resC, delay) {
    setTimeout(function () {
      var card = el('div', 'flyCard', EMOJI[resC]);
      var x0 = fromRect.left + (fromRect.width || 0) / 2 - 15;
      var y0 = fromRect.top + (fromRect.height || 0) / 2 - 20;
      card.style.left = x0 + 'px';
      card.style.top = y0 + 'px';
      document.body.appendChild(card);
      var tx = toRect.left + (toRect.width || 0) / 2 - 15 - x0;
      var ty = toRect.top + (toRect.height || 0) / 2 - 20 - y0;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.6)';
        });
      });
      setTimeout(function () {
        card.style.opacity = '0';
        setTimeout(function () { card.remove(); }, 280);
        if (toRect.host) {
          toRect.host.classList.add('gotIt');
          setTimeout(function () { toRect.host.classList.remove('gotIt'); }, 520);
        }
      }, 780);
    }, delay);
  }

  // 도둑 — 어디서 어디로 갔는지 미끄러져 보여준다
  function playRobberAnim(v) {
    var t = v.lastRobber;
    if (!t) return;
    var key = t.turn + ':' + t.from + '>' + t.to + ':' + t.p;
    if (App.robberKey === key) return;
    App.robberKey = key;
    if (t.from === t.to) return;
    var a = v.board.hexes[t.from], b = v.board.hexes[t.to];
    if (!a || !b) return;
    var from = boardToScreen(px(a.X) - 27, py(a.Y) + 19);
    var to = boardToScreen(px(b.X) - 27, py(b.Y) + 19);
    var ghost = el('div', 'robberGhost', '\uD83D\uDD75\uFE0F');
    ghost.style.left = (from.x - 16) + 'px';
    ghost.style.top = (from.y - 16) + 'px';
    document.body.appendChild(ghost);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ghost.style.transform = 'translate(' + (to.x - from.x) + 'px,' + (to.y - from.y) + 'px)';
      });
    });
    setTimeout(function () {
      ghost.style.opacity = '0';
      setTimeout(function () { ghost.remove(); }, 260);
      // 도착한 칸을 잠깐 붉게
      var poly = $('board').querySelector('.hex[data-hex="' + t.to + '"]');
      if (poly) {
        poly.classList.add('litRob');
        setTimeout(function () { poly.classList.remove('litRob'); }, 1600);
      }
    }, 760);
  }

  // 강탈 — 빼앗긴 사람에게서 훔친 사람에게 뒷면 카드가 건너간다
  function playStealAnim(v) {
    var t = v.lastSteal;
    if (!t) return;
    var key = t.turn + ':' + t.thief + '<' + t.victim;
    if (App.stealKey === key) return;
    App.stealKey = key;
    var rv = chipRect(t.victim), rt = chipRect(t.thief);
    if (!rv || !rt) return;
    setTimeout(function () {
      var card = el('div', 'flyCard back', '?');
      var x0 = rv.left + rv.width / 2 - 15, y0 = rv.top + rv.height / 2 - 20;
      card.style.left = x0 + 'px';
      card.style.top = y0 + 'px';
      document.body.appendChild(card);
      var tx = rt.left + rt.width / 2 - 15 - x0, ty = rt.top + rt.height / 2 - 20 - y0;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.6)';
        });
      });
      setTimeout(function () {
        card.style.opacity = '0';
        setTimeout(function () { card.remove(); }, 280);
      }, 800);
    }, 900);
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
  function showDiceRoll(d, roller, v, done) {
    var ov = $('diceOverlay');
    ov.classList.remove('hidden'); ov.classList.remove('out');
    $('diceSum').textContent = ''; $('diceNote').textContent = '';
    var who = $('diceWho');
    if (who) {
      who.textContent = roller ? (roller.id === (v && v.me) ? '내가 굴립니다' : roller.name + '이(가) 굴립니다') : '';
      who.style.color = roller ? (PCOLOR[roller.color] || '') : '';
    }
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
        var note;
        if (sum === 7) {
          note = '\uD83D\uDD75\uFE0F 도둑이 움직입니다 — 8장 이상은 절반을 버립니다';
        } else {
          var names = [];
          if (v && v.lastGain) {
            var seen = {};
            v.lastGain.forEach(function (gg) {
              if (seen[gg.p]) return;
              seen[gg.p] = 1;
              var q = playerIn(v, gg.p);
              if (q) names.push(q.name);
            });
          }
          note = names.length
            ? sum + ' 타일에서 자원 — ' + names.join(', ') + '이(가) 받습니다'
            : sum + ' 타일 — 받는 사람이 없습니다';
        }
        $('diceNote').textContent = note;
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

  // 도둑이 막아 못 받은 타일 — 붉게 짚어 준다
  function showBlocked(v) {
    var b = v.blocked;
    if (!b) return;
    var key = b.turn + ':' + b.hex;
    if (App.blockedKey === key) return;
    App.blockedKey = key;
    var poly = $('board').querySelector('.hex[data-hex="' + b.hex + '"]');
    if (poly) {
      poly.classList.add('litRob');
      setTimeout(function () { poly.classList.remove('litRob'); }, 2200);
    }
    var hex = v.board.hexes[b.hex];
    if (!hex) return;
    var pt = boardToScreen(px(hex.X), py(hex.Y));
    var mark = el('div', 'blockMark', '\uD83D\uDEAB');
    mark.style.left = (pt.x - 20) + 'px';
    mark.style.top = (pt.y - 20) + 'px';
    document.body.appendChild(mark);
    setTimeout(function () {
      mark.style.opacity = '0';
      setTimeout(function () { mark.remove(); }, 300);
    }, 1700);
  }

  function flyGains(gains) {
    var v = App.view;
    if (!v) return;
    showBlocked(v);

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
        // 받는 쪽을 잠깐 밝혀 어디로 갔는지 확실히 보이게
        var host = (pid === App.view.me)
          ? document.querySelector('.rstack[data-res="' + resC + '"]')
          : document.querySelector('.pl[data-pid="' + pid + '"]');
        if (host) {
          host.classList.add('gotIt');
          setTimeout(function () { host.classList.remove('gotIt'); }, 520);
        }
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

    // 기사 말 — 등급과 활동 상태
    if (isExt(v)) {
      v.players.forEach(function (q) {
        (q.knights || []).forEach(function (k) {
          var vt = v.board.verts[k.v];
          if (!vt) return;
          var cx = px(vt.X), cy = py(vt.Y);
          var col = PCOLOR[q.color] || '#fff';
          var kg = svgEl('g', { class: 'knight' + (k.active ? ' act' : '') });
          kg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 11, fill: col, stroke: '#14171f', 'stroke-width': 1.6 }));
          // 깃발 — 뾰족한 부분 수가 등급
          var flag = svgEl('path', {
            d: 'M' + (cx - 1) + ' ' + (cy - 9) + ' v13',
            stroke: '#14171f', 'stroke-width': 1.6, fill: 'none'
          });
          kg.appendChild(flag);
          for (var i = 0; i < k.rank; i++) {
            kg.appendChild(svgEl('path', {
              d: 'M' + (cx - 1) + ' ' + (cy - 8 + i * 3.6) + ' l6 1.6 l-6 1.6 z',
              fill: k.active ? '#f5c542' : '#e8e2d4', stroke: '#14171f', 'stroke-width': 0.7
            }));
          }
          if (q.id === v.me && isMyTurn(v) && v.phase === 'main') {
            kg.setAttribute('class', kg.getAttribute('class') + ' mine');
            kg.style.cursor = 'pointer';
            kg.onclick = function () { clickVertex(k.v); };
          }
          if (App.knightSel === k.v) {
            kg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 15, class: 'knightSel' }));
          }
          g.appendChild(kg);
        });
      });
      // 성벽
      v.board.verts.forEach(function (vt) {
        if (!vt.wall || !vt.b) return;
        var col = PCOLOR[(playerIn(v, vt.b.p) || {}).color] || '#fff';
        g.appendChild(svgEl('path', {
          d: 'M' + (px(vt.X) - 13) + ' ' + (py(vt.Y) + 9) + ' h26',
          stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round', class: 'wallMark'
        }));
      });
      // 상인 말
      if (v.merchant) {
        var mh = v.board.hexes[v.merchant.hex];
        if (mh) {
          var mx = px(mh.X) + 26, my = py(mh.Y) - 20;
          g.appendChild(svgEl('circle', { cx: mx, cy: my, r: 11, class: 'merchantMark' }));
          var mt = svgEl('text', { x: mx, y: my + 4, 'font-size': 11, 'text-anchor': 'middle', class: 'chipT' });
          mt.textContent = '商';
          g.appendChild(mt);
        }
      }
    }

    // 방금 지은 것 — 어디에 놓았는지 눈에 걸리게
    (v.recent || []).forEach(function (r) {
      if (r.p === v.me) return;                          // 내가 지은 건 이미 안다
      var pc = PCOLOR[(playerIn(v, r.p) || {}).color] || '#fff';
      if (r.kind === 'road') {
        var e = v.board.edges[r.id];
        if (!e) return;
        var a = v.board.verts[e.a], b = v.board.verts[e.b];
        g.appendChild(svgEl('line', {
          x1: px(a.X), y1: py(a.Y), x2: px(b.X), y2: py(b.Y),
          class: 'justBuiltRoad', stroke: pc
        }));
      } else {
        var vt = v.board.verts[r.id];
        if (!vt) return;
        g.appendChild(svgEl('circle', {
          cx: px(vt.X), cy: py(vt.Y), r: 17, class: 'justBuilt', stroke: pc
        }));
      }
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

    // 도로 — 갓돌을 두른 길바닥에 짧은 침목을 깐다
    v.board.edges.forEach(function (e) {
      if (!e.road) return;
      var a = v.board.verts[e.a], b = v.board.verts[e.b];
      var col = PCOLOR[(playerIn(v, e.road) || {}).color] || '#fff';
      var ax0 = px(a.X), ay0 = py(a.Y), bx0 = px(b.X), by0 = py(b.Y);
      var dx = bx0 - ax0, dy = by0 - ay0, len = Math.hypot(dx, dy) || 1;
      var ux = dx / len, uy = dy / len, pad = len * 0.15;
      var x1 = ax0 + ux * pad, y1 = ay0 + uy * pad;
      var x2 = bx0 - ux * pad, y2 = by0 - uy * pad;
      var rg = svgEl('g', { class: 'roadG' });
      // 갓돌 — 길 양옆의 어두운 턱
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadEdge' }));
      // 노반과 포장
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadBed', stroke: shade(col, 0.6) }));
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadTop', stroke: col }));
      // 윗면 하이라이트 — 빛 받는 쪽
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadShine', stroke: shade(col, 1.35) }));
      // 가운데 차선
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadLane' }));
      g.appendChild(rg);
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
        // 마을 — 작고 낮은 오두막 하나
        shape.appendChild(svgEl('rect', { x: cx - 5.5, y: cy - 1, width: 11, height: 8, fill: col, class: 'bld' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 7.5) + ' ' + (cy - 0.4) + ' L' + cx + ' ' + (cy - 7.5) + ' L' + (cx + 7.5) + ' ' + (cy - 0.4) + ' z',
          fill: roof, class: 'bld'
        }));
        shape.appendChild(svgEl('rect', { x: cx - 1.5, y: cy + 2.4, width: 3, height: 4.6, rx: 1, fill: '#1a1410', stroke: 'none' }));
      } else {
        // 도시 — 성벽 위에 탑 둘과 본채. 마을보다 확실히 크고 높다
        // 바닥 성벽
        shape.appendChild(svgEl('rect', { x: cx - 14, y: cy + 1, width: 28, height: 8, fill: wallHi, class: 'bld' }));
        // 성가퀴
        for (var bi = 0; bi < 5; bi++) {
          shape.appendChild(svgEl('rect', {
            x: cx - 14 + bi * 5.6, y: cy - 1.6, width: 3.4, height: 3, fill: wallHi, class: 'bld'
          }));
        }
        // 왼쪽 큰 탑
        shape.appendChild(svgEl('rect', { x: cx - 13, y: cy - 13, width: 10, height: 14, fill: col, class: 'bld' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 15) + ' ' + (cy - 12.4) + ' L' + (cx - 8) + ' ' + (cy - 21) + ' L' + (cx - 1) + ' ' + (cy - 12.4) + ' z',
          fill: roof, class: 'bld'
        }));
        // 오른쪽 작은 탑
        shape.appendChild(svgEl('rect', { x: cx + 2, y: cy - 8, width: 9, height: 9, fill: col, class: 'bld' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + cx + ' ' + (cy - 7.4) + ' L' + (cx + 6.5) + ' ' + (cy - 15) + ' L' + (cx + 13) + ' ' + (cy - 7.4) + ' z',
          fill: roof, class: 'bld'
        }));
        // 창문과 성문
        shape.appendChild(svgEl('rect', { x: cx - 10.6, y: cy - 10, width: 3, height: 3.6, rx: 0.7, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('rect', { x: cx - 6, y: cy - 10, width: 3, height: 3.6, rx: 0.7, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('rect', { x: cx + 5, y: cy - 5.4, width: 3, height: 3.4, rx: 0.7, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 2.6) + ' ' + (cy + 9) + ' v-4.4 a2.6 2.6 0 0 1 5.2 0 V' + (cy + 9) + ' z',
          fill: '#1a1410', stroke: 'none'
        }));
        // 깃대
        shape.appendChild(svgEl('line', { x1: cx - 8, y1: cy - 21, x2: cx - 8, y2: cy - 26, stroke: '#0b0e14', 'stroke-width': 1.1 }));
        shape.appendChild(svgEl('path', { d: 'M' + (cx - 8) + ' ' + (cy - 26) + ' h6 l-1.9 2.1 1.9 2.1 h-6 z', fill: roof, stroke: 'none' }));
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
    // 진보카드가 자리를 고르는 중
    if (App.pickVert) {
      var pk = App.pickVert;
      if (pk.list.indexOf(vi) < 0) { toast('고를 수 있는 자리가 아닙니다.'); return; }
      App.pickVert = null;
      act('playCard', [pk.kind, [vi]]);
      return;
    }
    // 기사 조작
    if (isExt(v)) {
      var p = meOf(v);
      var mine = (p.knights || []).filter(function (k) { return k.v === vi; })[0];
      if (App.knightSel !== null && App.knightSel !== undefined) {
        var from = App.knightSel;
        App.knightSel = null;
        act('moveKnight', [from, vi]);
        return;
      }
      if (mine) { openKnightMenu(v, mine); return; }
      if (App.build === 'knight') {
        if (v.legal.knightSpots.indexOf(vi) < 0) { toast('내 도로가 닿은 빈 꼭짓점에만 놓을 수 있습니다.'); return; }
        App.build = null;
        act('placeKnight', [vi]);
        return;
      }
      if (App.build === 'wall') {
        App.build = null;
        act('build', ['wall', vi]);
        return;
      }
    }
    if (v.phase === 'setup') { act('placeSettlement', [vi]); return; }
    if (App.build === 'settlement') { act('build', ['settlement', vi]); App.build = null; return; }
    if (App.build === 'city') { act('build', ['city', vi]); App.build = null; return; }
  }
  function clickEdge(ei) {
    var v = App.view;
    if (App.pickEdge) {
      App.pickEdge = null;
      act('playCard', ['diplomat', [ei]]);
      return;
    }
    if (v.phase === 'setup') { act('placeRoad', [ei]); return; }
    // 공짜 도로가 남아 있으면 계속 놓는다. 아니면 한 번 짓고 모드를 푼다.
    if (v.freeRoads <= 1) App.build = null;
    act('build', ['road', ei]);
  }
  function clickRobber(hex) {
    if (App.pickHex) {
      var pk = App.pickHex;
      if (pk.kind === 'inventor') {
        if (pk.list.indexOf(hex) < 0) { toast('2 · 12 · 6 · 8 은 바꿀 수 없습니다.'); return; }
        if (pk.first === null) { pk.first = hex; toast('바꿀 다른 칩을 누르세요.'); render(); return; }
        if (pk.first === hex) { toast('다른 칩을 골라 주세요.'); return; }
        var a = pk.first;
        App.pickHex = null;
        act('playCard', ['inventor', [a, hex]]);
        return;
      }
      App.pickHex = null;
      act('playCard', [pk.kind, [hex]]);
      return;
    }
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
      var isTurn = (v.phase === 'setup' ? v.setup.who === p.id : v.turn === i) && v.phase !== 'over';
      if (isTurn) {
        d.classList.add('turn');
        d.classList.add(p.id === v.me ? 'turnMine' : 'turnOther');
        var mark = el('span', 'turnMark', '\u25B6');
        mark.style.color = PCOLOR[p.color];
        mark.title = '지금 차례';
        d.appendChild(mark);
      }
      var nm = el('span', 'nm', p.name);
      d.appendChild(nm);
      if (p.id === v.me) d.appendChild(el('span', 'meTag', '나'));
      if (isTurn) d.appendChild(el('span', 'turnTag', p.id === v.me ? '내 차례' : '차례'));
      d.appendChild(el('span', 'vp', (p.id === v.me && p.vpFull !== undefined ? p.vpFull : p.vp) + '점'));
      var cardIc = el('span', 'st');
      cardIc.appendChild(el('i', 'cardIc'));
      cardIc.appendChild(document.createTextNode(String(p.cards)));
      cardIc.title = '자원 카드';
      d.appendChild(cardIc);
      if (!isExt(v) && p.devCount) { var dv = el('span', 'st', '⚙' + p.devCount); dv.title = '발전 카드'; d.appendChild(dv); }
      if (isExt(v) && p.cardCount) { var pc = el('span', 'st', '📜' + p.cardCount); pc.title = '진보카드'; d.appendChild(pc); }
      if (!isExt(v) && p.knights) { var kn = el('span', 'st', '⚔' + p.knights); kn.title = '쓴 기사'; d.appendChild(kn); }
      // 남은 말 — 도로 / 마을 / 도시
      var left = el('span', 'left');
      left.title = '남은 말 — 도로 ' + p.left.road + ' · 마을 ' + p.left.settlement + ' · 도시 ' + p.left.city;
      left.textContent = p.left.road + '/' + p.left.settlement + '/' + p.left.city;
      d.appendChild(left);
      if (v.longest.p === p.id) d.appendChild(el('span', 'badge', '교역로'));
      if (!isExt(v) && v.army && v.army.p === p.id) d.appendChild(el('span', 'badge', '기사단'));
      if (p.roadLen >= 3 && v.longest.p !== p.id) {
        var rl = el('span', 'st road', '\uD83D\uDEE3' + p.roadLen);
        rl.title = '이어진 도로 ' + p.roadLen + '개 — 5개부터 최장 교역로';
        d.appendChild(rl);
      }
      if (isExt(v)) {
        var mm = 0;
        CK.TRACKS.forEach(function (t) { if (p.metro[t]) mm++; });
        if (mm) d.appendChild(el('span', 'badge', '수도' + (mm > 1 ? ' ' + mm : '')));
        if (p.power) d.appendChild(el('span', 'st', '⚔' + p.power));
      }
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
    cardsOf(v).forEach(function (c) {
      var n = p.res[c] || 0;
      var picked = App.discardSel.filter(function (x) { return x === c; }).length;
      var d = el('div', 'rstack' + (n ? '' : ' zero') + (isExt(v) && CK.COM.indexOf(c) >= 0 ? ' com' : ''));
      d.dataset.res = c;
      d.appendChild(rchip(c));
      d.appendChild(el('span', 'rname', resName(c)));
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
      d.title = resName(c);
      box.appendChild(d);
    });

    // 7이 나오면 버려야 하는 상태를 미리 경고한다
    var total = 0;
    cardsOf(v).forEach(function (c) { total += p.res[c] || 0; });
    var limit = isExt(v) ? (p.handLimit || 7) : R.HAND_LIMIT;
    if (!discarding && total > limit) {
      var warn = el('span', 'handWarn');
      warn.textContent = '\u26A0\uFE0F 손패 ' + total + '장 — 7이 나오면 ' + Math.floor(total / 2) + '장을 버립니다';
      warn.title = '한도는 ' + limit + '장입니다' + (isExt(v) ? ' (성벽 하나마다 +2)' : '');
      box.appendChild(warn);
    }

    if (isExt(v)) {
      // 진보카드 — 넉 장까지
      (p.cardList || []).forEach(function (c) {
        var b = el('button', 'devchip trk-' + c.track, CK.CARD_NAME[c.type]);
        b.title = CK.TRACK_NAME[c.track] + ' 진보카드';
        b.onclick = function () { playProgressUI(c.type); };
        box.appendChild(b);
      });
      if (p.vpCards) box.appendChild(el('span', 'devchip vp', '승점 ' + p.vpCards));
      if (p.defender) box.appendChild(el('span', 'devchip vp', '수호자 ' + p.defender));
      return;
    }

    // 발전 카드
    (p.dev || []).forEach(function (d) {
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
        return { label: resName(c), res: c, fn: function () { act('playDev', ['monopoly', [c]]); } };
      }));
      return;
    }
    if (type === 'plenty') {
      var first = null;
      openPick('자원 발견 — 첫 장', '은행에서 두 장을 가져옵니다.', RES.map(function (c) {
        return { label: resName(c), res: c, fn: function () {
          first = c;
          openPick('자원 발견 — 둘째 장', '', RES.map(function (c2) {
            return { label: resName(c2), res: c2, fn: function () { act('playDev', ['plenty', [first, c2]]); } };
          }));
        } };
      }));
    }
  }

  /* ---------------- 도시와 기사 — 전용 화면 ---------------- */

  // 내 기사를 누르면 할 수 있는 일을 보여준다
  function openKnightMenu(v, k) {
    var p = meOf(v);
    var opts = [];
    var rankName = k.rank === 1 ? '하급' : k.rank === 2 ? '중급' : '상급';
    if (!k.active) {
      opts.push({ label: '활동 상태로 (밀 1)', res: 'g', fn: function () { act('activateKnight', [k.v]); } });
    }
    if (k.rank < 3) {
      var canUp = k.rank === 1 || p.level.politics >= 3;
      opts.push({
        label: '승급 (철 1 · 양 1)' + (canUp ? '' : ' — 요새 필요'),
        fn: function () {
          if (!canUp) { toast('상급으로 올리려면 정치 3단계(요새)가 필요합니다.'); return; }
          act('upgradeKnight', [k.v]);
        }
      });
    }
    if (k.canAct) {
      opts.push({ label: '이동 / 추방', fn: function () {
        App.knightSel = k.v;
        toast('갈 자리나 밀어낼 상대 기사를 누르세요.');
        render();
      } });
      if (v.board.verts[k.v].hexes.indexOf(v.robber) >= 0) {
        opts.push({ label: '도둑 쫓아내기', fn: function () { act('chaseRobber', [k.v]); } });
      }
    }
    if (!opts.length) { toast(rankName + ' 기사 — 이번 차례에는 할 수 있는 일이 없습니다.'); return; }
    openPick(rankName + ' 기사', k.active ? '활동 상태' : '비활동 상태', opts);
  }



  // 진보카드 사용 — 고를 게 있으면 창을 띄운다
  function playProgressUI(type) {
    var v = App.view, p = meOf(v);
    var opp = v.players.filter(function (q) { return q.id !== v.me && !q.out; });
    function go(args) { act('playCard', [type, args || []]); }

    if (type === 'alchemist') {
      if (v.phase !== 'roll') { toast('연금술사는 주사위를 굴리기 전에만 씁니다.'); return; }
      var faces = [1, 2, 3, 4, 5, 6];
      openPick('연금술사 — 흰 주사위', '이번에 나올 눈을 고릅니다.', faces.map(function (a) {
        return { label: String(a), fn: function () {
          openPick('연금술사 — 빨간 주사위', '빨간 눈도 고릅니다. (진보카드 조건에 쓰입니다)', faces.map(function (b) {
            return { label: String(b), fn: function () { go([a, b]); } };
          }));
        } };
      }));
      return;
    }
    if (type === 'resMono') {
      openPick('자원 독점', '고른 자원을 모두에게서 두 장씩 가져옵니다.', CK.RES.map(function (c) {
        return { label: resName(c), res: c, fn: function () { go([c]); } };
      }));
      return;
    }
    if (type === 'commMono') {
      openPick('상품 독점', '고른 상품을 모두에게서 한 장씩 가져옵니다.', CK.COM.map(function (c) {
        return { label: resName(c), res: c, fn: function () { go([c]); } };
      }));
      return;
    }
    if (type === 'fleet') {
      openPick('상선대', '이번 차례에 2:1로 바꿀 것을 고릅니다.', CK.ALL.map(function (c) {
        return { label: resName(c), res: c, fn: function () { go([c]); } };
      }));
      return;
    }
    if (type === 'spy' || type === 'deserter' || type === 'trader') {
      var title = type === 'spy' ? '첩자 — 진보카드를 가져올 상대'
        : type === 'deserter' ? '변절자 — 기사를 데려올 상대' : '전문 상인 — 손을 볼 상대';
      var list = opp;
      if (type === 'trader') list = opp.filter(function (q) { return q.vp > p.vp; });
      if (!list.length) { toast(type === 'trader' ? '나보다 점수가 높은 사람이 없습니다.' : '고를 상대가 없습니다.'); return; }
      openPick(title, '', list.map(function (q) {
        return { label: q.name, fn: function () {
          if (type !== 'trader') { go([q.id]); return; }
          // 전문 상인은 두 장을 고른다 — 상대 손은 안 보이므로 종류만 지정
          openPick('전문 상인 — 무엇을 가져올까요', q.name + '에게서 두 장을 가져옵니다.', CK.ALL.map(function (c) {
            return { label: resName(c) + ' 두 장', res: c, fn: function () { go([q.id, [c, c]]); } };
          }));
        } };
      }));
      return;
    }
    if (type === 'medicine') {
      if (!v.legal.cities.length) { toast('올릴 마을이 없습니다.'); return; }
      App.pickVert = { kind: 'medicine', list: v.legal.cities };
      toast('도시로 올릴 내 마을을 판에서 누르세요.');
      render();
      return;
    }
    if (type === 'engineer') {
      if (!v.legal.walls.length) { toast('성벽을 쌓을 도시가 없습니다.'); return; }
      App.pickVert = { kind: 'engineer', list: v.legal.walls };
      toast('성벽을 쌓을 도시를 판에서 누르세요.');
      render();
      return;
    }
    if (type === 'bishop' || type === 'merchant') {
      App.pickHex = { kind: type };
      toast(type === 'bishop' ? '도둑을 옮길 타일을 누르세요.' : '상인을 놓을 내 땅을 누르세요.');
      render();
      return;
    }
    if (type === 'intrigue') {
      var spots = [];
      v.players.forEach(function (q) {
        if (q.id === v.me) return;
        (q.knights || []).forEach(function (k) { spots.push(k.v); });
      });
      if (!spots.length) { toast('밀어낼 상대 기사가 없습니다.'); return; }
      App.pickVert = { kind: 'intrigue', list: spots };
      toast('밀어낼 상대 기사를 누르세요.');
      render();
      return;
    }
    if (type === 'inventor') {
      var ok = [];
      v.board.hexes.forEach(function (h, i) {
        if (h.number && [2, 12, 6, 8].indexOf(h.number) < 0) ok.push(i);
      });
      if (ok.length < 2) { toast('바꿀 수 있는 숫자 칩이 없습니다.'); return; }
      App.pickHex = { kind: 'inventor', list: ok, first: null };
      toast('자리를 바꿀 숫자 칩 두 개를 차례로 누르세요.');
      render();
      return;
    }
    if (type === 'diplomat') {
      App.pickEdge = { kind: 'diplomat' };
      toast('없앨 도로(맨 끝)를 누르세요.');
      render();
      return;
    }
    if (type === 'smith') {
      var ks = (p.knights || []).filter(function (k) { return k.rank < 3; }).map(function (k) { return k.v; });
      if (!ks.length) { toast('승급시킬 기사가 없습니다.'); return; }
      go([ks.slice(0, 2)]);
      return;
    }
    if (type === 'harbor') {
      // 각 상대에게 자원 하나를 주고 상품 하나를 받는다 — 간단히 한 명씩 고른다
      if (!opp.length) { toast('상대가 없습니다.'); return; }
      var mine = CK.RES.filter(function (c) { return p.res[c] > 0; });
      if (!mine.length) { toast('줄 자원이 없습니다.'); return; }
      openPick('무역항 — 내가 줄 자원', '상대마다 자원 1장을 주고 상품 1장을 받습니다.', mine.map(function (giveC) {
        return { label: resName(giveC), res: giveC, fn: function () {
          openPick('무역항 — 받을 상품', '', CK.COM.map(function (wantC) {
            return { label: resName(wantC), res: wantC, fn: function () {
              var picks = {};
              opp.forEach(function (q) { picks[q.id] = [giveC, wantC]; });
              go([picks]);
            } };
          }));
        } };
      }));
      return;
    }
    go([]);                                              // 고를 게 없는 카드
  }

  // 야만족 트랙과 도시 개발판
  function renderCkBar(v) {
    var bar = $('ckBar');
    if (!isExt(v)) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    var track = $('barbTrack');
    track.innerHTML = '';
    for (var i = 0; i < v.barbMax; i++) {
      var dot = el('i', i < v.barb ? 'on' : null);
      track.appendChild(dot);
    }
    var cityTotal = 0, power = 0;
    v.players.forEach(function (q) {
      if (q.out) return;
      cityTotal += q.cities.length;
      power += q.power;
    });
    $('barbInfo').textContent = '힘 ' + cityTotal + ' vs 기사 ' + power +
      (v.barb >= v.barbMax - 1 ? ' — 곧 상륙!' : '');
    $('barbInfo').className = 'barbInfo' + (power < cityTotal ? ' danger' : '');

    var box = $('ckTracks');
    box.innerHTML = '';
    var p = meOf(v);
    CK.TRACKS.forEach(function (t) {
      var row = el('div', 'trk trk-' + t);
      var head = el('span', 'trkName', CK.TRACK_NAME[t]);
      head.appendChild(rchip(CK.TRACK_COM[t]));
      row.appendChild(head);
      var lv = p ? p.level[t] : 0;
      var pips = el('span', 'trkPips');
      for (var i2 = 1; i2 <= CK.MAX_LEVEL; i2++) {
        var pip = el('i', i2 <= lv ? 'on' : null);
        pip.title = i2 + '단계 — ' + CK.LEVEL_NAME[t][i2 - 1];
        pips.appendChild(pip);
      }
      row.appendChild(pips);
      if (p && p.metro[t]) row.appendChild(el('span', 'metro', '수도'));
      // 개발 버튼
      var can = p && isMyTurn(v) && v.phase === 'main' && lv < CK.MAX_LEVEL;
      var cost = lv + 1;
      var b = el('button', 'trkBtn', lv < CK.MAX_LEVEL ? ('개발 ' + cost) : '완료');
      if (can && p.res[CK.TRACK_COM[t]] >= cost) {
        b.classList.add('can');
        b.onclick = function () { act('develop', [t, false]); };
      } else {
        b.disabled = lv >= CK.MAX_LEVEL;
        b.onclick = function () {
          if (lv >= CK.MAX_LEVEL) return;
          if (!isMyTurn(v) || v.phase !== 'main') { toast('내 차례에 지을 수 있습니다.'); return; }
          toast(resName(CK.TRACK_COM[t]) + ' ' + cost + '장이 필요합니다. (지금 ' + p.res[CK.TRACK_COM[t]] + '장)');
        };
      }
      row.appendChild(b);
      box.appendChild(row);
    });
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
    var buildRow = el('div', 'buildRow' + (isExt(v) ? ' five' : ''));
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
    function whyKnight(v2, p2) {
      if (!myTurn) return '내 차례에만 놓을 수 있습니다.';
      if (v2.phase === 'roll') return '먼저 주사위를 굴리세요.';
      var n = 0;
      (p2.knights || []).forEach(function (k) { if (k.rank === 1) n++; });
      if (n >= 2) return '하급 기사는 둘까지입니다. 하나를 승급시키면 더 놓을 수 있습니다.';
      if (!v2.legal.knightSpots.length) return '내 도로가 닿은 빈 꼭짓점이 없습니다. 도로를 더 이어 보세요.';
      return '자원이 모자랍니다 — 철 1 · 양 1이 필요합니다.';
    }
    function whyWall(v2, p2) {
      if (!myTurn) return '내 차례에만 쌓을 수 있습니다.';
      if (v2.phase === 'roll') return '먼저 주사위를 굴리세요.';
      if (p2.walls >= CK.WALL_MAX) return '성벽은 3개까지입니다.';
      if (!v2.legal.walls.length) return '성벽을 쌓을 도시가 없습니다. (마을에는 못 쌓습니다)';
      return '자원이 모자랍니다 — 흙 2장이 필요합니다.';
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
    if (isExt(v)) {
      var canKnight = buildable && afford(['o', 'w']) && v.legal.knightSpots.length &&
        (function () {
          var n = 0;
          (p.knights || []).forEach(function (k) { if (k.rank === 1) n++; });
          return n < 2;
        })();
      var canWall = buildable && afford(['b', 'b']) && v.legal.walls.length && p.walls < CK.WALL_MAX;
      bbtn('기사', '방어', ['o', 'w'], canKnight, function () {
        App.build = App.build === 'knight' ? null : 'knight';
        toast('기사를 놓을 자리를 판에서 누르세요.');
        render();
      }, 'knight', whyKnight(v, p));
      bbtn('성벽', '손패+2', ['b', 'b'], canWall, function () {
        App.build = App.build === 'wall' ? null : 'wall';
        toast('성벽을 쌓을 내 도시를 누르세요.');
        render();
      }, 'wall', whyWall(v, p));
    } else {
      bbtn('발전 카드', '?점', ['w', 'g', 'o'], canDev, function () { act('buyDev', []); }, null, why('dev'));
    }
    box.appendChild(el('p', 'panelFoot', isExt(v)
      ? '수도 2점 · 최장 교역로 2점 · 야만족을 막아내면 수호자 1점. 13점을 먼저 넘기면 이깁니다.'
      : '최장 교역로 2점 · 최강 기사단 2점 — 더 잘한 사람이 나오면 넘어갑니다.'));

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
        var second = v.setup.idx >= v.players.length;
        var what = (isExt(v) && second) ? '도시' : '마을';
        msg.innerHTML = v.setup.sub === 'settlement'
          ? '<b>' + what + '을(를) 놓을 자리</b>를 판에서 누르세요.' + (second ? ' 이번 ' + what + ' 둘레의 자원을 받습니다.' : '')
          : '방금 놓은 ' + what + '에 <b>이을 도로</b>를 누르세요.';
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
    else if (App.build === 'knight') msg.innerHTML = '<b>기사를 놓을 꼭짓점</b>을 누르세요.';
    else if (App.build === 'wall') msg.innerHTML = '<b>성벽을 쌓을 내 도시</b>를 누르세요.';
    else if (App.knightSel !== null && App.knightSel !== undefined) msg.innerHTML = '<b>기사가 갈 자리</b>나 밀어낼 상대 기사를 누르세요.';
    else if (App.pickVert || App.pickHex || App.pickEdge) msg.innerHTML = '<b>진보카드</b> — 판에서 대상을 고르세요.';
    else msg.innerHTML = isExt(v)
      ? '내 차례 — 짓거나 거래하거나, 도시를 개발하세요.'
      : '내 차례 — 짓거나 거래하거나, 차례를 넘기세요.';

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
      return { label: resName(o.c) + ' ' + o.rate + '장 내기', res: o.c, fn: function () {
        openPick('무엇을 받을까요?', '', RES.filter(function (c) { return c !== o.c && v.bank[c] > 0; }).map(function (c) {
          return { label: resName(c) + ' 1장 (은행에 ' + v.bank[c] + ')', res: c, fn: function () { act('bankTrade', [o.c, c]); } };
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
    v.log.forEach(function (l, i) {
      var row = el('div', 'logRow' + (l.mine ? ' mine' : '') + (i === v.log.length - 1 ? ' last' : ''));
      var who = lineOwner(v, l.text);
      var dot = el('i', 'logDot');
      dot.style.background = who ? (PCOLOR[who.color] || 'transparent') : 'transparent';
      row.appendChild(dot);
      row.appendChild(el('span', 'logTxt', l.text));
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  function winTarget(v) { return isExt(v) ? CK.WIN_VP : R.WIN_VP; }

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
        (!isExt(v) && v.army && v.army.p === p.id ? ' · 최강 기사단' : '') +
        (p.out ? ' · 나감' : '');
      body.appendChild(line);
    });
    $('over').classList.remove('hidden');
  }

  function render() {
    if (App.view) {
      renderCkBar(App.view);
      paintTurnFrame(App.view);
    }
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
        App.ext = msg.view.ext === 'ck';
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

  $('mode').onchange = function () {
    var ck = $('mode').value === 'ck';
    App.wantExt = ck;
    $('modeNote').textContent = ck
      ? '상품·기사·야만족이 더해진 확장. 도시를 개발해 수도를 세우고 13점을 먼저 넘기면 이깁니다.'
      : '주사위로 자원을 모아 도로·마을·도시를 짓습니다. 처음이면 여기부터.';
    try { localStorage.setItem('catan.mode', ck ? 'ck' : 'base'); } catch (e) {}
  };
  (function () {
    var saved = null;
    try { saved = localStorage.getItem('catan.mode'); } catch (e) {}
    if (saved === 'ck') { $('mode').value = 'ck'; }
    $('mode').onchange();
  })();

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

  App.readLine = readLine;
  App.act = act; App.doAction = doAction; App.pushViews = pushViews; App.render = render;
  window.__ct = App;
})();
