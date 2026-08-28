// ============================================================
// REPLAY DRIVER
// ============================================================
// index.html のインライン script より前に読み込まれる。
// ?replay=1 が無ければ window.REPLAY = null にして即終了するので通常プレイには影響しない。
//
// 仕組み: io() の代わりに偽ソケットを index.html に渡す。サーバーが記録した
// socket イベントを同じ間隔で発火させることで、既存の描画ハンドラがそのまま
// 対戦を再現する。描画コードを複製しないので本体を直せばリプレイにも反映される。
(function () {
  if (!new URLSearchParams(location.search).has('replay')) { window.REPLAY = null; return; }

  // --- 偽ソケット: index.html の socket.on(...) をそのまま受け取る ---
  const handlers = {};
  const fakeSocket = {
    connected: true,
    on(ev, cb) { (handlers[ev] = handlers[ev] || []).push(cb); },
    emit() {}, connect() {}, disconnect() {}
  };
  function fire(ev, payload) {
    (handlers[ev] || []).forEach(cb => { try { cb(payload); } catch (e) { console.error(ev, e); } });
  }

  // 結果演出(11.1s)を見せきってから 5 秒待ってループする
  const RESULT_ANIM_MS = 11100;
  const HOLD_AFTER_RESULT_MS = 5000;

  let recording = null;
  let timers = [];
  let pendingNewReplay = false;
  let running = false;

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  async function fetchLatest() {
    const res = await fetch('/api/replay/latest', { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  }

  // 記録されたイベントを再生用に変換して発火する
  function fireRecorded(ev) {
    const { event, pid } = ev;
    const payload = ev.payload ? JSON.parse(JSON.stringify(ev.payload)) : ev.payload;

    // 個人宛イベントは持ち主を渡す。myPlayerId は 'p1' 固定なので
    // p2 宛のインベントリ更新は相手側イベントに読み替える。
    if (pid) {
      if (event === 'itemReceived') {
        if (pid === 'p1') fire('itemReceived', payload);
        else fire('oppItemReceived', { inventory: payload.inventory });
        return;
      }
      if (event === 'itemUsed') {
        if (pid === 'p1') fire('itemUsed', payload);
        else fire('oppItemUsed', { inventory: payload.inventory });
        return;
      }
      // 旗系は両プレイヤー分を色分けして表示する（対戦中は自分の分しか見えなかった情報）
      payload.owner = pid;
    }
    fire(event, payload);
  }

  function playOnce(onDone) {
    clearTimers();
    if (window.AUDIO) window.AUDIO.stopBgm();

    const events = recording.events;
    events.forEach(ev => later(() => fireRecorded(ev), ev.t));

    const last = events.length ? events[events.length - 1].t : 0;
    later(onDone, last + RESULT_ANIM_MS + HOLD_AFTER_RESULT_MS);
  }

  async function loop() {
    // 新しい試合が終わっていれば、ここ（ループの切れ目）で差し替える
    if (pendingNewReplay) {
      const fresh = await fetchLatest();
      if (fresh) recording = fresh;
      pendingNewReplay = false;
    }
    updateMeta();
    playOnce(() => loop());
  }

  function updateMeta() {
    const el = document.getElementById('replayMeta');
    if (!el || !recording) return;
    const names = recording.players.map(p => p.name).join('  vs  ');
    el.textContent = `REPLAY — ${names}`;
  }

  // --- 開始オーバーレイ ---
  // 自動再生ポリシーによりタブを開いた直後は音を鳴らせないため、1クリックで再生権を得る
  function showStartOverlay(message, enabled) {
    let ov = document.getElementById('replayStart');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'replayStart';
      ov.className = 'replay-start-overlay';
      ov.innerHTML = '<div class="replay-start-box"><div class="replay-start-title">REPLAY</div>'
                   + '<div class="replay-start-msg" id="replayStartMsg"></div></div>';
      document.body.appendChild(ov);
    }
    document.getElementById('replayStartMsg').textContent = message;
    ov.style.display = 'flex';
    ov.style.cursor = enabled ? 'pointer' : 'default';
    return ov;
  }

  async function start() {
    if (running) return;
    recording = await fetchLatest();

    if (!recording) {
      showStartOverlay('まだ対戦の記録がありません。1試合終わると自動で再生を開始します。', false);
      // 試合が終わるのを待つ
      const wait = setInterval(async () => {
        const r = await fetchLatest();
        if (r) { clearInterval(wait); recording = r; armStart(); }
      }, 3000);
      listenForNewReplays();
      return;
    }
    armStart();
    listenForNewReplays();
  }

  function armStart() {
    const ov = showStartOverlay('クリックして再生を開始', true);
    ov.onclick = () => {
      ov.style.display = 'none';
      ov.onclick = null;
      running = true;
      if (window.AUDIO) window.AUDIO.prime();
      loop();
    };
  }

  // 実ソケットを1本張り、新しい試合の完了通知だけを受け取る
  function listenForNewReplays() {
    if (typeof io !== 'function') return;
    const real = io({ reconnection: true, reconnectionDelay: 2000 });
    real.on('replayReady', ({ id }) => {
      if (!recording || recording.id !== id) pendingNewReplay = true;
    });
  }

  window.REPLAY = { active: true, socket: fakeSocket, fire, start };
})();
