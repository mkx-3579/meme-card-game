/* Meme Card Game - Client */

// Server chỉ mở kết nối polling, nên không thử nâng lên WebSocket (tránh lỗi 400 trong console)
const socket = io({ transports: ['polling'] });

let gameState = {
    gameId: null,
    playerId: null,
    playerName: null,
    gameStarted: false
};

// Ghi nhớ trạng thái trước để biết khi nào cần phát hiệu ứng / âm thanh
let ui = {
    lastState: null,
    seenVotingId: 0,
    seenResultId: 0,
    seenTopicId: 0,
    voteDeadline: null,
    timerKey: null,
    drumrollKey: null,
    timerHandle: null,
    lastTickSecond: null,
    winShown: false
};

// ==================== Cài đặt (nhớ trong trình duyệt) ====================

function loadSetting(key, fallback) {
    try {
        const value = localStorage.getItem('memecard.' + key);
        return value === null ? fallback : JSON.parse(value);
    } catch (e) {
        return fallback;
    }
}

function saveSetting(key, value) {
    try {
        localStorage.setItem('memecard.' + key, JSON.stringify(value));
    } catch (e) { /* trình duyệt chặn lưu thì thôi */ }
}

// Tên + mã phòng gần nhất nhớ trong phiên (tab) hiện tại: rời phòng hay bị văng
// ra vẫn còn, mở tab / phiên web mới thì nhập lại
function loadSession(key) {
    try {
        return sessionStorage.getItem('memecard.' + key) || '';
    } catch (e) {
        return '';
    }
}

function saveSession(key, value) {
    try {
        sessionStorage.setItem('memecard.' + key, value);
    } catch (e) { /* trình duyệt chặn lưu thì thôi */ }
}

const prefersReducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let effectsOn = loadSetting('effects', !prefersReducedMotion);

function applyEffectsSetting() {
    document.body.classList.toggle('no-fx', !effectsOn);
    document.getElementById('fxBtn').classList.toggle('off', !effectsOn);
}

// ==================== Âm thanh ====================

/**
 * Mọi âm thanh đi qua đây. Có file thì phát file, không có thì phát tiếng
 * tổng hợp bằng Web Audio. Lỗi gì cũng bỏ qua, không làm hỏng game.
 */
class GameAudio {
    constructor(files) {
        this.files = files || {};
        this.muted = loadSetting('muted', false);
        this.volume = loadSetting('volume', 0.7);
        this.ctx = null;
        this.cache = {};
    }

    unlock() {
        // Trình duyệt chỉ cho phát tiếng sau lần bấm đầu tiên
        try {
            if (!this.ctx) {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (Ctx) this.ctx = new Ctx();
            }
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        } catch (e) { /* bỏ qua */ }
    }

    setMuted(muted) {
        this.muted = muted;
        saveSetting('muted', muted);
    }

    setVolume(volume) {
        this.volume = volume;
        saveSetting('volume', volume);
    }

    play(name) {
        // Mỗi âm thanh có thể có vài bản: chọn ngẫu nhiên một bản cho đỡ nhàm
        const variants = [].concat(this.files[name] || []);
        const url = variants.length ? variants[Math.floor(Math.random() * variants.length)] : null;
        this.playFile(url, name);
    }

    playMeme(card) {
        if (card && card.sound) {
            this.playFile(card.sound, 'card-play');
        } else {
            this.play('card-play');
        }
    }

    playFile(url, fallbackName) {
        if (this.muted || this.volume <= 0) return;
        if (!url) {
            this.synth(fallbackName);
            return;
        }
        try {
            if (!this.cache[url]) this.cache[url] = new Audio(url);
            const audio = this.cache[url].cloneNode();
            audio.volume = this.volume;
            const played = audio.play();
            if (played && played.catch) played.catch(() => this.synth(fallbackName));
        } catch (e) {
            this.synth(fallbackName);
        }
    }

    synth(name) {
        if (!this.ctx) return;
        // [tần số, thời điểm bắt đầu, độ dài, dạng sóng, tần số cuối (trượt), độ to]
        // Dạng 'noise' = tiếng xào xạc (lọc quanh tần số), dùng cho tiếng quẹt bài, tiếng trống
        const drumroll = Array.from({ length: 36 }, (_, i) =>
            [180 + (i % 2) * 40, i * 0.045, 0.05, 'noise', null, 0.25 + i / 48]);
        // Bộ âm thanh kiểu "game show": mỗi tiếng một màu riêng để nghe là biết chuyện gì
        const patterns = {
            // Lá bài vút ra rồi đập "bộp" xuống bàn
            'card-play': [[3200, 0, 0.18, 'noise', 500, 0.7], [140, 0.15, 0.14, 'sine', 45, 1.4], [2200, 0.15, 0.05, 'noise', null, 0.6]],
            // Xào bài: tiếng quẹt ngắn dồn dập, kết bằng tiếng gõ bài xuống bàn
            'deal': Array.from({ length: 8 }, (_, i) => [3400 - i * 180, i * 0.055, 0.05, 'noise', 1400, 0.55])
                .concat([[160, 8 * 0.055, 0.12, 'sine', 70, 1.1]]),
            // Rút một lá: tiếng trượt lá + "tách" nhẹ
            'draw': [[1600, 0, 0.14, 'noise', 4200, 0.55], [880, 0.11, 0.06, 'triangle', 1320, 0.7]],
            // Chọn lá trên tay: tiếng lá bài lướt nhẹ
            'select': [[2600, 0, 0.06, 'noise', 4800, 0.35], [1200, 0.02, 0.04, 'triangle', 1600, 0.25]],
            // Bấm bỏ phiếu: tiếng "póc" bong bóng
            'vote': [[420, 0, 0.09, 'sine', 980, 1.1]],
            // Được chấp nhận: hợp âm trưởng đi lên + tiếng lấp lánh
            'accept': [[523, 0, 0.1, 'square', null, 0.35], [659, 0.08, 0.1, 'square', null, 0.35], [784, 0.16, 0.1, 'square', null, 0.35],
                [1047, 0.24, 0.4, 'square', null, 0.4], [1047, 0.24, 0.4, 'triangle', null, 0.9], [5000, 0.24, 0.5, 'noise', 9000, 0.25]],
            // Bị từ chối: kèn buồn "wah wah wah waaah"
            'reject': [[392, 0, 0.3, 'sawtooth', 370, 0.6], [370, 0.32, 0.3, 'sawtooth', 349, 0.6], [349, 0.64, 0.3, 'sawtooth', 330, 0.6], [330, 0.96, 0.75, 'sawtooth', 290, 0.6]],
            // Đồng hồ: tiếng mõ gỗ
            'tick': [[1500, 0, 0.04, 'triangle', 900, 1.2]],
            'drumroll': drumroll.concat([[120, 36 * 0.045, 0.4, 'sine', 60, 1.4], [3000, 36 * 0.045, 0.4, 'noise', null, 0.6]]),
            // Có chủ đề mới: chuông "ding" ngân
            'topic': [[1319, 0, 0.6, 'sine'], [2637, 0, 0.3, 'sine', null, 0.35], [1760, 0.12, 0.7, 'sine', null, 0.7]],
            // Thắng: kèn chiến thắng
            'win': [[523, 0, 0.12, 'square', null, 0.35], [523, 0.14, 0.08, 'square', null, 0.35], [523, 0.24, 0.08, 'square', null, 0.35],
                [698, 0.34, 0.3, 'square', null, 0.4], [622, 0.66, 0.15, 'square', null, 0.35], [698, 0.82, 0.12, 'square', null, 0.35],
                [784, 0.96, 0.7, 'square', null, 0.45], [784, 0.96, 0.7, 'triangle', null, 0.9]],
            // Tới lượt mình đánh bài: hai tiếng mộc cầm "ting ting"
            'your-turn': [[784, 0, 0.18, 'triangle'], [1568, 0, 0.08, 'sine', null, 0.4], [1175, 0.13, 0.28, 'triangle'], [2349, 0.13, 0.1, 'sine', null, 0.4]],
            // Tới lượt mình ra đề: kèn hiệu ngắn ba nốt đi lên
            'your-topic': [[392, 0, 0.12, 'sawtooth', null, 0.3], [523, 0.12, 0.12, 'sawtooth', null, 0.3], [659, 0.24, 0.12, 'sawtooth', null, 0.3],
                [784, 0.36, 0.45, 'sawtooth', null, 0.35], [784, 0.36, 0.45, 'triangle', null, 0.8]]
        };
        const notes = patterns[name];
        if (!notes) return;
        try {
            const now = this.ctx.currentTime;
            notes.forEach(([freq, start, length, type, endFreq, loud]) => {
                const gain = this.ctx.createGain();
                const t0 = now + start;
                gain.gain.setValueAtTime(0.15 * this.volume * (loud || 1), t0);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
                let source;
                let tone;
                if (type === 'noise') {
                    source = this.ctx.createBufferSource();
                    source.buffer = this.noiseBuffer();
                    tone = this.ctx.createBiquadFilter();
                    tone.type = 'bandpass';
                    tone.Q.value = 1.2;
                    source.connect(tone).connect(gain);
                } else {
                    source = this.ctx.createOscillator();
                    source.type = type;
                    tone = source;
                    source.connect(gain);
                }
                tone.frequency.setValueAtTime(freq, t0);
                if (endFreq) tone.frequency.exponentialRampToValueAtTime(endFreq, t0 + length);
                gain.connect(this.ctx.destination);
                source.start(t0);
                source.stop(t0 + length + 0.02);
            });
        } catch (e) { /* bỏ qua */ }
    }

    noiseBuffer() {
        if (!this.noise) {
            const length = this.ctx.sampleRate;
            this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
            const data = this.noise.getChannelData(0);
            for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        }
        return this.noise;
    }
}

const audio = new GameAudio(window.UI_SOUNDS);

document.addEventListener('click', () => audio.unlock());
document.addEventListener('keydown', () => audio.unlock());

function applyAudioSettings() {
    const btn = document.getElementById('muteBtn');
    const off = audio.muted || audio.volume <= 0;
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', off ? '#i-mute' : '#i-sound');
    btn.classList.toggle('off', off);
    btn.setAttribute('aria-label', off ? 'Bật âm thanh' : 'Tắt âm thanh');
    document.getElementById('volumeSlider').value = Math.round(audio.volume * 100);
}

document.getElementById('muteBtn').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    applyAudioSettings();
});

document.getElementById('volumeSlider').addEventListener('input', (e) => {
    audio.setVolume(Number(e.target.value) / 100);
    if (audio.muted && audio.volume > 0) audio.setMuted(false);
    applyAudioSettings();
});

document.getElementById('fxBtn').addEventListener('click', () => {
    effectsOn = !effectsOn;
    saveSetting('effects', effectsOn);
    applyEffectsSetting();
});

// ==================== Screen Management ====================

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

// ==================== Login Screen Events ====================

document.getElementById('createGameBtn').addEventListener('click', () => {
    const name = document.getElementById('playerName').value.trim();
    if (!name) {
        showError('Vui lòng nhập tên của bạn');
        return;
    }
    gameState.playerName = name;
    saveSession('name', name);
    socket.emit('create_game', { name });
});

// Bản cũ có nút mở ô nhập mã; giao diện mới luôn hiện ô mã nên nút này có thể không còn
const joinGameBtn = document.getElementById('joinGameBtn');
if (joinGameBtn) {
    joinGameBtn.addEventListener('click', () => {
        const form = document.getElementById('joinGameForm');
        if (form) form.classList.toggle('hidden');
    });
}

document.getElementById('gameCodeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('confirmJoinBtn').click();
});

document.getElementById('confirmJoinBtn').addEventListener('click', () => {
    const gameCode = document.getElementById('gameCodeInput').value.trim().toLowerCase();
    const name = document.getElementById('playerName').value.trim();

    if (!gameCode) {
        showError('Vui lòng nhập mã game');
        return;
    }
    if (!name) {
        showError('Vui lòng nhập tên của bạn');
        return;
    }

    gameState.playerName = name;
    saveSession('name', name);
    socket.emit('join_game', { game_id: gameCode, name });
});

// ==================== Waiting Room Events ====================

document.getElementById('startGameBtn').addEventListener('click', () => {
    socket.emit('start_game');
});

document.getElementById('leaveGameBtn').addEventListener('click', () => {
    leaveGame();
});

function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    // Trang chạy http (mạng LAN) không có clipboard API: dùng cách cũ
    return new Promise((resolve, reject) => {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand && document.execCommand('copy');
        area.remove();
        ok ? resolve() : reject(new Error('copy failed'));
    });
}

let copyResetHandle = null;

function copyRoomCode() {
    if (!gameState.gameId) return;
    const code = gameState.gameId.toUpperCase();
    const btn = document.getElementById('copyCodeBtn');
    const hint = document.getElementById('copyCodeHint');
    const chip = document.getElementById('roomChip');
    copyText(code).then(() => {
        btn.classList.add('copied');
        hint.textContent = `Đã copy mã ${code}, dán gửi bạn bè thôi!`;
        chip.textContent = 'Đã copy mã!';
    }).catch(() => {
        hint.textContent = `Không copy được, hãy gửi mã ${code} cho bạn bè`;
    }).finally(() => {
        clearTimeout(copyResetHandle);
        copyResetHandle = setTimeout(() => {
            btn.classList.remove('copied');
            hint.textContent = 'Gửi mã này cho bạn bè để vào cùng bàn';
            if (gameState.gameId) chip.textContent = `Phòng ${gameState.gameId.toUpperCase()}`;
        }, 2000);
    });
}

document.getElementById('copyCodeBtn').addEventListener('click', copyRoomCode);
document.getElementById('roomChip').addEventListener('click', copyRoomCode);

const settingSelects = document.querySelectorAll('select[data-setting]');

function sendSettings() {
    const data = {};
    settingSelects.forEach(select => { data[select.dataset.setting] = Number(select.value); });
    socket.emit('update_settings', data);
}

settingSelects.forEach(select => select.addEventListener('change', sendSettings));

document.getElementById('winnerLobbyBtn').addEventListener('click', () => {
    document.getElementById('winnerModal').classList.add('hidden');
    // Chủ phòng bấm thì cả phòng về luôn, người khác chỉ đóng bảng và chờ
    if (ui.lastState && ui.lastState.host_id === gameState.playerId) {
        socket.emit('back_to_lobby');
    }
});

// ==================== Game Screen Events ====================

document.getElementById('leaveGameBtnFooter').addEventListener('click', () => {
    leaveGame();
});

function playCard(cardIndex, cardEl) {
    // Nhớ chỗ lá đang nằm trên tay để lá trên bàn bay ra đúng từ đó
    if (cardEl) {
        hand.pendingPlay = { rect: cardEl.getBoundingClientRect(), at: Date.now() };
        if (effectsOn) cardEl.classList.add('flying');
    }
    socket.emit('play_card', { card_index: cardIndex });
}

// ==================== Tay bài xòe ====================

// Lá đang chọn: chồi lên, hai bên dạt ra. Nhớ theo id lá để giữ khi state đổi.
// source = 'hover' (rê chuột) thì chuột rời tay bài là bỏ chọn
const hand = { selectedId: null, source: null, pendingPlay: null, canPlay: false };

function handCards() {
    return Array.from(document.querySelectorAll('#myHandCards .card'));
}

function selectedIndex(cards) {
    return cards.findIndex(el => el.dataset.cardId === hand.selectedId);
}

function selectCard(index, source) {
    const cards = handCards();
    if (!cards.length) return;
    index = Math.max(0, Math.min(cards.length - 1, index));
    const changed = cards[index].dataset.cardId !== hand.selectedId;
    hand.selectedId = cards[index].dataset.cardId;
    hand.source = source;
    layoutHand();
    if (changed) audio.play('select');
}

function clearSelection() {
    hand.selectedId = null;
    hand.source = null;
    layoutHand();
}

function stepSelection(delta) {
    const cards = handCards();
    if (!cards.length) return;
    const current = selectedIndex(cards);
    const start = current < 0 ? (delta > 0 ? -1 : cards.length) : current;
    selectCard(start + delta, 'nav');
}

function playSelected() {
    const cards = handCards();
    const index = selectedIndex(cards);
    if (!hand.canPlay || index < 0) return;
    playCard(Number(cards[index].dataset.index), cards[index]);
}

/**
 * Xếp các lá thành hình quạt vừa khung tay bài, không cuộn ngang.
 * Lá chọn nằm trên cùng, nhô lên; lá hai bên giãn ra để nhìn rõ.
 */
function layoutHand() {
    const container = document.getElementById('myHandCards');
    const cards = handCards();
    const nav = document.getElementById('handNav');
    nav.classList.toggle('hidden', cards.length === 0);
    if (!cards.length) {
        container.style.height = '';
        return;
    }

    const n = cards.length;
    const tilt = Math.min(4, 20 / n);  // quạt xòe tối đa khoảng ±10 độ
    const w = cards[0].offsetWidth;
    const h = Math.max(...cards.map(el => el.offsetHeight));
    const sel = selectedIndex(cards);
    const lift = Math.round(w * 0.2);
    // Lá ngoài cùng nghiêng nên góc trên chìa ra ngoài: chừa lề hai bên cho khỏi tràn khung
    const pad = Math.ceil(h * Math.sin(tilt * ((n - 1) / 2) * Math.PI / 180));
    const W = Math.max(w, container.clientWidth - 2 * pad);

    // Khoảng cách giữa hai lá liền nhau: đủ chỗ thì để rời, chật thì chồng lên nhau
    const avail = Math.max(0, W - w);
    const minStep = Math.max(10, w * 0.12);
    let step = n > 1 ? Math.min(w * 1.04, avail / (n - 1)) : 0;
    let gap = step;
    const sides = sel < 0 || n === 1 ? 0 : (sel > 0) + (sel < n - 1);
    if (sides && step < w * 0.85) {
        // Chừa khe rộng hai bên lá chọn, các lá còn lại khít lại
        gap = Math.min(w * 0.72, (avail - (n - 1 - sides) * minStep) / sides);
        gap = Math.max(gap, step);
        step = n - 1 - sides > 0 ? Math.max(minStep, (avail - sides * gap) / (n - 1 - sides)) : step;
    }

    const xs = [0];
    for (let i = 1; i < n; i++) {
        const wide = sel >= 0 && (i === sel || i - 1 === sel);
        xs.push(xs[i - 1] + (wide ? gap : step));
    }
    const offset = pad + Math.max(0, (W - (xs[n - 1] + w)) / 2);
    const mid = (n - 1) / 2;

    cards.forEach((el, i) => {
        const d = i - mid;
        let rot = d * tilt;
        let y = mid ? Math.pow(d / mid, 2) * Math.min(18, w * 0.1) : 0;
        let scale = 1;
        if (i === sel) {
            rot = 0;
            y = -lift;
            scale = 1.08;
        }
        el.classList.toggle('selected', i === sel);
        el.style.zIndex = i === sel ? 50 : i + 1;
        el.style.transform = `translate(${Math.round(offset + xs[i])}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${scale})`;
    });
    container.style.height = `${h + lift + 26}px`;

    const playBtn = document.getElementById('handPlayBtn');
    playBtn.disabled = !hand.canPlay || sel < 0;
    playBtn.textContent = hand.canPlay
        ? (sel < 0 ? 'Chọn một lá để đánh' : 'Đánh lá này')
        : 'Chưa tới lượt bạn';
}

(function setupHand() {
    const container = document.getElementById('myHandCards');
    container.addEventListener('pointerleave', e => {
        if (e.pointerType === 'mouse' && hand.source === 'hover') clearSelection();
    });
    container.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            stepSelection(e.key === 'ArrowLeft' ? -1 : 1);
            const el = handCards()[selectedIndex(handCards())];
            if (el) el.focus({ preventScroll: true });
        }
    });
    document.getElementById('handPrevBtn').addEventListener('click', () => stepSelection(-1));
    document.getElementById('handNextBtn').addEventListener('click', () => stepSelection(1));
    document.getElementById('handPlayBtn').addEventListener('click', playSelected);
    if (window.ResizeObserver) new ResizeObserver(() => layoutHand()).observe(container);
    else window.addEventListener('resize', layoutHand);
})();

document.getElementById('skipTurnBtn').addEventListener('click', () => {
    document.getElementById('skipTurnBtn').classList.add('hidden');
    socket.emit('skip_turn');
});

function sendVote(isValid) {
    audio.play('vote');
    socket.emit('vote', { is_valid: isValid });
    document.getElementById('voteOverlay').classList.add('hidden');
}

document.getElementById('validBtn').addEventListener('click', () => sendVote(true));
document.getElementById('invalidBtn').addEventListener('click', () => sendVote(false));
document.getElementById('overlayValidBtn').addEventListener('click', () => sendVote(true));
document.getElementById('overlayInvalidBtn').addEventListener('click', () => sendVote(false));

// ==================== Socket.IO Events ====================

socket.on('game_created', (data) => {
    gameState.gameId = data.game_id;
    gameState.playerId = data.player_id;
    saveSession('room', data.game_id);
    showScreen('waitingScreen');
    updateWaitingRoom();
});

socket.on('game_joined', (data) => {
    gameState.gameId = data.game_id;
    gameState.playerId = data.player_id;
    saveSession('room', data.game_id);
    showScreen('waitingScreen');
    updateWaitingRoom();
});

socket.on('game_state', (state) => {
    // Bỏ qua state đến muộn sau khi đã rời game
    if (!gameState.gameId || state.game_id !== gameState.gameId) return;

    if (state.state !== 'waiting') {
        if (!gameState.gameStarted) {
            gameState.gameStarted = true;
            showScreen('gameScreen');
        }
        updateGameScreen(state);
    } else {
        if (gameState.gameStarted) {
            // Hết ván: phòng vẫn còn, cả phòng quay lại phòng chờ
            gameState.gameStarted = false;
            resetGameUi();
            showScreen('waitingScreen');
        }
        ui.lastState = state;
        updateWaitingRoomPlayers(state);
        updateStartButton(state);
        updateSettingsPanel(state);
    }
});

// Bị văng (mất mạng, server khởi động lại): server đã cho mình rời phòng,
// đưa về trang chủ với tên và mã phòng điền sẵn để vào lại cho nhanh
socket.on('connect', () => {
    if (!gameState.gameId) return;
    const room = gameState.gameId;
    backToLogin();
    document.getElementById('gameCodeInput').value = room.toUpperCase();
    showError(`Bạn bị mất kết nối khỏi phòng ${room.toUpperCase()}. Bấm "Vào" để vào lại.`);
});

socket.on('notification', (data) => {
    if (data.type === 'winner') {
        setTimeout(() => {
            document.getElementById('winnerMessage').textContent = data.message;
            document.getElementById('winnerModal').classList.remove('hidden');
        }, 1200);
    }
});

socket.on('error', (data) => {
    showError(data.message);
});

// ==================== Lá bài meme ====================

// Màu nền giữ chỗ cố định theo mẫu meme (khi chưa có ảnh)
function templateColor(template) {
    let hash = 0;
    for (const ch of template || '') hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${hash}, 85%, 72%)`;
}

function makePlaceholder(card) {
    const box = document.createElement('div');
    box.className = 'meme-placeholder';
    box.style.background = templateColor(card.template);
    const emoji = document.createElement('div');
    emoji.className = 'meme-emoji';
    emoji.textContent = card.emoji || '🎴';
    const name = document.createElement('div');
    name.className = 'meme-name';
    name.textContent = card.name || 'Meme';
    box.appendChild(emoji);
    box.appendChild(name);
    return box;
}

/**
 * Vẽ một lá bài meme. size = 'small' (trên tay) hoặc 'big' (giữa bàn).
 * Chú thích dạng "A | B": 1–2 khung thì in đè lên ảnh như meme thật,
 * nhiều khung hơn thì liệt kê bên dưới ảnh.
 */
function renderMemeCard(card, size) {
    // Bản cũ của server gửi lá bài là chuỗi
    if (typeof card === 'string') card = { caption: card, name: '', emoji: '🎴', template: card };

    const el = document.createElement('div');
    el.className = `meme-card ${size}`;
    if (card.caption) el.title = card.caption;
    // Lá chỉ có ảnh: hiện nguyên tấm, không in chữ
    if (!card.caption && card.image) el.classList.add('image-only');

    const art = document.createElement('div');
    art.className = 'meme-art';
    if (card.image) {
        const img = document.createElement('img');
        img.src = card.image;
        img.alt = card.name || '';
        img.loading = 'lazy';
        img.onerror = () => img.replaceWith(makePlaceholder(card));
        art.appendChild(img);
    } else {
        art.appendChild(makePlaceholder(card));
    }
    el.appendChild(art);

    const parts = String(card.caption || '').split(' | ').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return el;

    if (size === 'big' && parts.length <= 2) {
        const top = document.createElement('div');
        top.className = 'meme-text top';
        const bottom = document.createElement('div');
        bottom.className = 'meme-text bottom';
        if (parts.length === 2) {
            top.textContent = parts[0];
            bottom.textContent = parts[1];
        } else {
            bottom.textContent = parts[0] || '';
        }
        art.appendChild(top);
        art.appendChild(bottom);
    } else if (size === 'big') {
        const list = document.createElement('ol');
        list.className = 'meme-panels';
        parts.forEach(part => {
            const li = document.createElement('li');
            li.textContent = part;
            list.appendChild(li);
        });
        el.appendChild(list);
    } else {
        const caption = document.createElement('div');
        caption.className = 'meme-caption';
        caption.textContent = parts.join(' / ');
        el.appendChild(caption);
    }

    return el;
}

// ==================== Utility Functions ====================

// Màu avatar theo thứ tự người chơi trong phòng
const AVATAR_COLORS = ['#ffd23f', '#3da5ff', '#ff5c8a', '#2ec27e', '#ff8a3d', '#b28dff', '#5ad1c8', '#ffb3c7'];

function makeAvatar(state, player) {
    const index = state.players.findIndex(p => p.player_id === player.player_id);
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.style.background = AVATAR_COLORS[Math.max(0, index) % AVATAR_COLORS.length];
    avatar.textContent = (Array.from(String(player.name || '?').trim())[0] || '?').toUpperCase();
    return avatar;
}

function makeTag(text, extra) {
    const tag = document.createElement('span');
    tag.className = 'tag' + (extra ? ' ' + extra : '');
    tag.textContent = text;
    return tag;
}

function updateWaitingRoom() {
    // Mã game hiển thị dạng HOA cho dễ đọc, server chấp nhận cả HOA lẫn thường
    document.getElementById('gameCodeDisplay').textContent = gameState.gameId.toUpperCase();
    socket.emit('get_game_state');
}

function updateWaitingRoomPlayers(state) {
    const container = document.getElementById('playersList');
    container.innerHTML = '';

    state.players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';

        const isMePlayer = player.player_id === gameState.playerId;
        div.appendChild(makeAvatar(state, player));

        // Dùng textContent để tên người chơi không thể chèn HTML/script
        const name = document.createElement('strong');
        name.className = 'player-name';
        name.textContent = player.name;
        div.appendChild(name);

        const tags = document.createElement('span');
        tags.className = 'player-tags';
        if (isMePlayer) tags.appendChild(makeTag('Bạn', 'tag-me'));
        if (player.player_id === state.host_id) tags.appendChild(makeTag('Chủ phòng', 'tag-host'));
        div.appendChild(tags);
        container.appendChild(div);
    });
}

function formatLimit(value, unit) {
    return value ? `${value} ${unit}` : 'Không giới hạn';
}

function fillSelect(select, choices, value, unit) {
    const key = choices.join(',');
    if (select.dataset.key !== key) {
        select.dataset.key = key;
        select.innerHTML = '';
        choices.forEach(choice => {
            const option = document.createElement('option');
            option.value = String(choice);
            option.textContent = formatLimit(choice, unit);
            select.appendChild(option);
        });
    }
    select.value = String(value);
}

function updateSettingsPanel(state) {
    const settings = state.settings || {};
    const choices = state.setting_choices || {};
    const isHost = state.host_id === gameState.playerId;
    settingSelects.forEach(select => {
        const key = select.dataset.setting;
        if (!(key in settings)) return;
        fillSelect(select, choices[key] || [settings[key]], settings[key], select.dataset.unit);
        select.disabled = !isHost;
    });
    document.getElementById('settingsNote').textContent =
        (isHost ? '' : 'Chủ phòng chỉnh các mục này. ')
        + 'Hết giờ chọn ảnh thì mất lượt. Hết số vòng mà chưa ai hết bài thì người còn ít bài nhất thắng.';
}

function updateStartButton(state) {
    const btn = document.getElementById('startGameBtn');
    const playerCount = state.players.length;

    const countDisplay = document.getElementById('waitingCount');
    if (countDisplay) {
        countDisplay.textContent = `Người chơi (${playerCount}/${state.max_players || 8})`;
    }

    if (state.host_id !== gameState.playerId) {
        btn.disabled = true;
        btn.textContent = 'Chờ chủ phòng bắt đầu...';
    } else if (playerCount >= 2) {
        btn.disabled = false;
        btn.textContent = `Bắt đầu chơi (${playerCount} người)`;
    } else {
        btn.disabled = true;
        btn.textContent = 'Bắt đầu (cần ít nhất 2 người)';
    }
}

// Giới hạn số vòng hiện trên thanh đầu trang
function updateMatchLimits(state) {
    const settings = state.settings || {};
    const roundChip = document.getElementById('roundLimitChip');
    roundChip.classList.toggle('hidden', !settings.max_rounds);
    if (settings.max_rounds) roundChip.textContent = `Tối đa ${settings.max_rounds} vòng`;
}

// ==================== Hiệu ứng lật bài ====================

/**
 * Lá bài bay úp từ `from` (chồng bài / chỗ ngồi người đánh) tới chỗ của nó,
 * rồi lật ngửa ra. Mặt sau là một lớp phủ, tắt đi đúng lúc lá nghiêng 90 độ.
 */
function flipReveal(el, opts) {
    if (!effectsOn || !el || !el.animate) return;
    opts = opts || {};
    const duration = opts.duration || 700;
    const delay = opts.delay || 0;
    const fromRect = opts.fromRect || (opts.from && opts.from.getBoundingClientRect());
    const flyPart = fromRect ? 0.5 : 0.15;  // phần thời gian bay, còn lại để lật
    const faceUp = !!opts.faceUp;            // lá của mình đánh ra: bay ngửa, không lật
    const spin = opts.spin || 0;             // xoay vòng lúc bay (độ)

    let cover = null;
    if (!faceUp) {
        cover = document.createElement('div');
        cover.className = 'card-cover card-back';
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        el.appendChild(cover);
    }

    let dx = 0, dy = 0, scale = 1;
    if (fromRect) {
        const b = el.getBoundingClientRect();
        if (fromRect.width && b.width) {
            dx = (fromRect.left + fromRect.width / 2) - (b.left + b.width / 2);
            dy = (fromRect.top + fromRect.height / 2) - (b.top + b.height / 2);
            scale = Math.max(0.2, Math.min(1, fromRect.width / b.width));
        }
    } else {
        dy = opts.lift || -40;
        scale = 0.85;
    }
    // Giữ vị trí + độ nghiêng sẵn có của lá (tay bài xòe) ở cuối hiệu ứng.
    // Tách phần dịch chuyển ra ngoài để phóng to/thu nhỏ quanh đúng chỗ lá nằm
    const base = getComputedStyle(el).transform;
    let lead = '', tail = '';
    if (base && base !== 'none' && window.DOMMatrix) {
        const m = new DOMMatrix(base);
        lead = `translate(${m.e}px, ${m.f}px) `;
        m.e = 0;
        m.f = 0;
        tail = ' ' + m.toString();
    }
    const at = (x, y, s, deg, z) =>
        `${lead}perspective(900px) translate(${x}px, ${y}px) scale(${s}) rotate(${z || 0}deg) rotateY(${deg}deg)${tail}`;
    const back = faceUp ? 0 : 180;
    const half = faceUp ? 0 : 90;
    const flipMid = flyPart + (1 - flyPart) / 2;
    // Bay theo đường vòng cung: điểm giữa đường bay nhô lên cao
    const hop = opts.arc ? -Math.max(60, Math.abs(dx) * 0.25) : 0;

    const frames = [{ transform: at(dx, dy, scale, back, spin), offset: 0 }];
    if (opts.arc) frames.push({ transform: at(dx * 0.45, dy * 0.45 + hop, (scale + 1.2) / 2, back, spin / 2), offset: flyPart * 0.55 });
    frames.push(
        { transform: at(0, -18, 1.14, back, spin / 6), offset: flyPart },
        { transform: at(0, -18, 1.14, half, 0), offset: flipMid },
        { transform: at(0, 4, 0.96, 0, 0), offset: 0.9 },
        { transform: at(0, 0, 1, 0, 0), offset: 1 }
    );
    const anim = el.animate(frames, { duration, delay, easing: 'ease-out', fill: 'backwards' });
    if (opts.onLand) anim.onfinish = opts.onLand;
    if (!cover) return;
    const coverAnim = cover.animate([
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: flipMid },
        { opacity: 0, offset: Math.min(1, flipMid + 0.001) },
        { opacity: 0, offset: 1 }
    ], { duration, delay, fill: 'both' });
    const cleanup = () => cover.remove();
    anim.addEventListener('finish', cleanup);
    anim.addEventListener('cancel', cleanup);
    coverAnim.oncancel = cleanup;
}

function bumpDrawPile(delay) {
    const pile = document.getElementById('drawPile');
    setTimeout(() => {
        replayAnimation(pile, 'drawing');
        audio.play('draw');
    }, delay);
}

function updateSpectators(state) {
    const spectators = state.spectators || [];
    document.getElementById('spectatorsBox').classList.toggle('hidden', spectators.length === 0);
    const list = document.getElementById('spectatorsList');
    list.innerHTML = '';
    spectators.forEach(s => {
        const li = document.createElement('li');
        li.textContent = s.name + (s.player_id === gameState.playerId ? ' (bạn)' : '');
        list.appendChild(li);
    });
    document.getElementById('spectatorNote').classList.toggle('hidden', !state.is_spectator);
}

function playerName(state, playerId) {
    const p = state.players.find(pl => pl.player_id === playerId);
    return p ? p.name : 'Ai đó';
}

// Ô tròn trên đầu bàn: avatar người đang đánh (lúc chấm thì là người vừa đánh)
function updateTurnSeat(state) {
    const seat = document.getElementById('turnSeat');
    const voting = state.state === 'voting' && state.current_card;
    const pid = voting ? state.current_card.played_by : state.current_player_id;
    const player = state.players.find(p => p.player_id === pid);
    const show = player && (state.state === 'playing' || voting);
    seat.classList.toggle('hidden', !show);
    if (!show) {
        seat.dataset.key = '';
        return;
    }
    const isMe = pid === gameState.playerId;
    const fresh = makeAvatar(state, player);
    const avatar = document.getElementById('turnSeatAvatar');
    avatar.style.background = fresh.style.background;
    avatar.textContent = fresh.textContent;
    seat.classList.toggle('me', isMe);
    seat.classList.toggle('voting', !!voting);
    document.getElementById('turnSeatLabel').textContent = voting
        ? (isMe ? 'Lá của bạn đang được chấm' : `Đang chấm lá của ${player.name}`)
        : (isMe ? 'Lượt bạn đánh!' : `${player.name} đang đánh`);
    seat.title = document.getElementById('turnSeatLabel').textContent;
    // Đổi người thì nảy lên một cái cho dễ thấy
    const key = `${state.state}-${pid}-${state.turn_id || ''}-${state.voting_id || ''}`;
    if (seat.dataset.key !== key) {
        seat.dataset.key = key;
        replayAnimation(seat, 'seat-pop');
    }
}

function updateGameScreen(state) {
    const prev = ui.lastState;
    ui.lastState = state;

    document.getElementById('roundNum').textContent = state.round;
    updateMatchLimits(state);
    // Chỉ để CSS đổi bố cục theo giai đoạn (ra đề / đánh / bỏ phiếu)
    document.getElementById('gameScreen').dataset.state = state.state;
    const roomChip = document.getElementById('roomChip');
    if (roomChip && gameState.gameId) roomChip.textContent = `Phòng ${gameState.gameId.toUpperCase()}`;

    updatePlayersStatus(state, prev);
    updateSpectators(state);
    updateTurnToast(state);
    updateTurnSeat(state);
    updateMyHand(state, prev);
    updateGameStatus(state);

    if (state.current_card) {
        updateCardDisplay(state);
    } else {
        document.getElementById('cardDisplayArea').classList.add('hidden');
    }

    updateTopic(state);

    if (state.state === 'voting') {
        updateVotingPanel(state);
    } else {
        document.getElementById('votingPanel').classList.add('hidden');
        document.getElementById('voteOverlay').classList.add('hidden');
        if (state.state !== 'topic' && state.state !== 'playing') stopTimer();
    }

    // Nút bỏ lượt: chỉ hiện khi tới lượt mình đánh
    const canSkip = state.state === 'playing' && state.current_player_id === gameState.playerId;
    document.getElementById('skipTurnBtn').classList.toggle('hidden', !canSkip);

    // Đồng hồ chọn ảnh của người đang tới lượt
    const playTimer = document.getElementById('playTimer');
    const playing = state.state === 'playing' && state.play_time_left !== null && state.play_time_left !== undefined;
    playTimer.classList.toggle('hidden', !playing);
    if (playing) {
        const isMyTurn = state.current_player_id === gameState.playerId;
        startTimer(state.play_time_left, state.play_seconds || 45, isMyTurn, 'play-' + state.turn_id);
    }

    handleEvents(state, prev);
}

// Phát âm thanh / hiệu ứng theo thay đổi giữa 2 lần cập nhật
function handleEvents(state, prev) {
    // Vừa chia bài đầu ván
    if (prev && prev.state === 'waiting' && state.state !== 'waiting') {
        audio.play('deal');
    }

    // Có chủ đề mới cho vòng này
    if (state.topic && state.topic_id !== ui.seenTopicId) {
        const firstSeen = ui.seenTopicId === 0 && !prev;
        ui.seenTopicId = state.topic_id;
        if (!firstSeen) {
            audio.play('topic');
            replayAnimation(document.getElementById('topicBanner'), 'topic-in');
        }
    }

    // Người khác bốc thêm lá (bỏ lượt, bị phạt): lá úp bay từ chồng bài về chỗ ngồi
    if (prev && prev.state !== 'waiting') {
        state.players.forEach(p => {
            if (p.player_id === gameState.playerId) return;
            const before = prev.players.find(q => q.player_id === p.player_id);
            const gained = before ? p.hand_count - before.hand_count : 0;
            if (gained <= 0) return;
            const seat = document.querySelector(
                `#playersStatus .player-item[data-player-id="${CSS.escape(p.player_id)}"]`);
            for (let i = 0; i < Math.min(gained, 4); i++) flyBackTo(seat, 150 + i * 200);
            setTimeout(() => audio.play('draw'), 150);
        });
    }

    // Lá mới được đánh ra
    if (state.state === 'voting' && state.voting_id !== ui.seenVotingId) {
        ui.seenVotingId = state.voting_id;
        audio.playMeme(state.current_card && state.current_card.content);
        // Lá bay úp từ chỗ người đánh xuống bàn rồi lật ngửa
        // Lá của mình: bay ngửa từ đúng chỗ trên tay. Lá người khác: bay úp từ chỗ ngồi rồi lật
        const mine = state.current_card.played_by === gameState.playerId;
        const pending = hand.pendingPlay;
        hand.pendingPlay = null;
        const seat = document.querySelector(
            `#playersStatus .player-item[data-player-id="${CSS.escape(state.current_card.played_by)}"]`);
        const tableCard = document.querySelector('#currentCardContent .meme-card');
        const land = () => replayAnimation(document.querySelector('#cardDisplayArea .stage'), 'thud');
        if (mine && pending && Date.now() - pending.at < 8000) {
            flipReveal(tableCard, { fromRect: pending.rect, faceUp: true, spin: -14, arc: true, duration: 800, onLand: land });
        } else {
            flipReveal(tableCard, { from: seat, spin: 200, arc: true, duration: 1100, onLand: land });
        }
    }

    // Có kết quả bỏ phiếu mới
    const result = state.last_result;
    if (result && result.voting_id !== ui.seenResultId) {
        const firstSeen = ui.seenResultId === 0 && !prev;
        ui.seenResultId = result.voting_id;
        if (!firstSeen) showResult(state, result);
    }

    // Đến lượt mình ra đề: âm thanh riêng
    if (state.state === 'topic' && state.current_player_id === gameState.playerId
            && ui.seenMyTopicId !== state.topic_id) {
        ui.seenMyTopicId = state.topic_id;
        setTimeout(() => audio.play('your-topic'), result && result.voting_id === ui.seenResultId ? 900 : 0);
    }

    // Đến lượt mình đánh
    const isMyTurn = state.state === 'playing' && state.current_player_id === gameState.playerId;
    const wasMyTurn = prev && prev.state === 'playing' && prev.current_player_id === gameState.playerId;
    if (isMyTurn && !wasMyTurn) {
        setTimeout(() => audio.play('your-turn'), result && result.voting_id === ui.seenResultId ? 900 : 0);
    }

    // Có người thắng
    if (state.state === 'game_end' && !ui.winShown) {
        ui.winShown = true;
        setTimeout(() => {
            audio.play('win');
            launchConfetti();
        }, 600);
    }
}

function showResult(state, result) {
    const stamp = document.getElementById('resultStamp');
    stamp.className = 'stamp ' + (result.is_valid ? 'ok' : 'no');
    stamp.textContent = result.is_valid
        ? `CHẤP NHẬN ${result.valid_votes}/${result.total_votes}`
        : `TỪ CHỐI ${result.valid_votes}/${result.total_votes}`;
    replayAnimation(stamp, 'stamp-in');

    audio.play(result.is_valid ? 'accept' : 'reject');

    const card = document.getElementById('currentCardContent');
    if (!result.is_valid) replayAnimation(card, 'shake');

    if (result.is_valid) floatPoint(result.played_by);

    clearTimeout(ui.stampTimer);
    ui.stampTimer = setTimeout(() => stamp.classList.add('hidden'), 2500);
}

function replayAnimation(el, className) {
    if (!el || !effectsOn) return;
    el.classList.remove(className);
    void el.offsetWidth; // Ép trình duyệt chạy lại animation
    el.classList.add(className);
}

function floatPoint(playerId) {
    if (!effectsOn) return;
    const row = document.querySelector(`#playersStatus [data-player-id="${CSS.escape(playerId)}"]`);
    if (!row) return;
    const plus = document.createElement('span');
    plus.className = 'float-point';
    plus.textContent = '+1';
    row.appendChild(plus);
    setTimeout(() => plus.remove(), 1500);
}

function updatePlayersStatus(state) {
    const container = document.getElementById('playersStatus');
    container.innerHTML = '';
    const currentPlayerId = state.state === 'game_end' ? null : state.current_player_id;
    const voted = {};
    (state.voters || []).forEach(v => { voted[v.player_id] = v.voted; });

    state.players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.dataset.playerId = player.player_id;

        const isCurrentPlayer = player.player_id === currentPlayerId;
        const isMePlayer = player.player_id === gameState.playerId;
        const isWinner = player.player_id === state.winner_id;
        if (isCurrentPlayer) div.classList.add('current');
        if (isWinner) div.classList.add('winner');

        div.appendChild(makeAvatar(state, player));

        const info = document.createElement('span');
        info.className = 'player-info';
        const name = document.createElement('strong');
        name.className = 'player-name';
        name.textContent = player.name + (isMePlayer ? ' (bạn)' : '');
        info.appendChild(name);

        const note = document.createElement('span');
        note.className = 'player-note';
        if (isWinner) {
            note.textContent = 'Thắng ván!';
        } else if (state.state === 'voting' && player.player_id in voted) {
            const badge = document.createElement('span');
            badge.className = 'vote-badge ' + (voted[player.player_id] ? 'done' : 'waiting');
            badge.textContent = voted[player.player_id] ? 'Đã chấm' : 'Đang chọn';
            note.appendChild(badge);
        } else if (state.state === 'voting' && state.current_card && state.current_card.played_by === player.player_id) {
            note.textContent = 'Vừa đánh bài';
        } else if (isCurrentPlayer) {
            note.textContent = state.state === 'topic' ? 'Đang ra đề...' : 'Đang chọn bài...';
        } else if (player.player_id === state.host_id) {
            note.textContent = 'Chủ phòng';
        } else {
            note.textContent = 'Đang chờ';
        }
        info.appendChild(note);
        div.appendChild(info);

        const score = document.createElement('span');
        score.className = 'player-score';
        const points = document.createElement('b');
        points.textContent = `${player.score} điểm`;
        const cards = document.createElement('span');
        cards.textContent = `${player.hand_count} lá`;
        score.appendChild(points);
        score.appendChild(cards);
        div.appendChild(score);

        container.appendChild(div);
    });
}

function updateMyHand(state, prev) {
    const container = document.getElementById('myHandCards');
    container.innerHTML = '';

    const myPlayer = state.players.find(p => p.player_id === gameState.playerId);
    if (!myPlayer) {
        document.getElementById('myHand').classList.remove('my-turn');
        document.getElementById('handStatus').textContent = state.state === 'game_end'
            ? 'Ván đã kết thúc, sắp vào phòng chờ...'
            : 'Bạn đang xem, ván sau sẽ được chia bài';
        layoutHand();
        return;
    }

    const isGameOver = state.state === 'game_end';
    const isVoting = state.state === 'voting';
    const isTopic = state.state === 'topic';
    const isMyTurn = !isGameOver && !isVoting && !isTopic && state.current_player_id === gameState.playerId;

    document.getElementById('myHand').classList.toggle('my-turn', isMyTurn);

    const statusEl = document.getElementById('handStatus');
    if (isGameOver) {
        statusEl.textContent = 'Ván đã kết thúc, sắp về phòng chờ...';
    } else if (isVoting && state.can_vote && state.my_vote === null) {
        statusEl.textContent = 'Đến lượt bạn bỏ phiếu!';
    } else if (isVoting) {
        statusEl.textContent = 'Đang chờ mọi người bỏ phiếu...';
    } else if (isTopic) {
        statusEl.textContent = state.current_player_id === gameState.playerId
            ? 'Bạn ra đề trước, rồi đánh lá đầu tiên'
            : `Chờ ${playerName(state, state.current_player_id)} ra đề...`;
    } else if (isMyTurn) {
        statusEl.textContent = 'Lượt của bạn! Chọn ảnh hợp đề rồi đánh';
    } else {
        statusEl.textContent = `Chờ ${playerName(state, state.current_player_id)} đánh bài...`;
    }

    // Lá nào mới vào tay thì cho bay vào
    const prevMe = prev && prev.players.find(p => p.player_id === gameState.playerId);
    const prevIds = new Set(((prevMe && prevMe.hand) || []).map(c => c && c.id));

    const newCards = [];
    const handList = myPlayer.hand || [];
    // Lá đang chọn vừa rời tay (đã đánh): chọn lá đứng cạnh nó, trừ khi đang rê chuột
    if (hand.selectedId && !handList.some(c => c && String(c.id) === hand.selectedId)) {
        const prevHand = (prevMe && prevMe.hand) || [];
        const oldIndex = prevHand.findIndex(c => c && String(c.id) === hand.selectedId);
        const keep = hand.source !== 'hover' && oldIndex >= 0 && handList.length;
        hand.selectedId = keep && handList[Math.min(oldIndex, handList.length - 1)]
            ? String(handList[Math.min(oldIndex, handList.length - 1)].id) : null;
        if (!hand.selectedId) hand.source = null;
    }
    hand.canPlay = isMyTurn;

    handList.forEach((card, index) => {
        const el = renderMemeCard(card, 'small');
        el.classList.add('card');
        el.dataset.index = String(index);
        el.dataset.cardId = String(card && card.id != null ? card.id : 'i' + index);
        if (!isMyTurn) el.classList.add('disabled');
        if (prev && card && !prevIds.has(card.id)) newCards.push(el);
        el.setAttribute('aria-label', `Lá bài ${index + 1}${card && card.name ? ': ' + card.name : ''}`);
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        if (!isMyTurn) el.setAttribute('aria-disabled', 'true');
        // Chuột: rê tới là lá chồi lên, bấm là đánh.
        // Cảm ứng: chạm lần đầu để chọn, chạm lần nữa (hoặc nút "Đánh lá này") để đánh
        el.addEventListener('pointerenter', e => {
            if (e.pointerType === 'mouse') selectCard(Number(el.dataset.index), 'hover');
        });
        el.onclick = () => {
            if (el.dataset.cardId !== hand.selectedId) {
                selectCard(Number(el.dataset.index), hand.source === 'hover' ? 'hover' : 'tap');
                if (hand.source !== 'hover') return;
            }
            if (isMyTurn) playCard(index, el);
        };
        el.onkeydown = e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (el.dataset.cardId !== hand.selectedId) selectCard(index, 'nav');
                else if (isMyTurn) playCard(index, el);
            }
        };
        // Chỉ khi đi bằng phím Tab; bấm chuột hay chạm thì để onclick lo
        el.onfocus = () => {
            if (el.matches(':focus-visible') && el.dataset.cardId !== hand.selectedId) selectCard(index, 'nav');
        };
        container.appendChild(el);
    });

    // Xếp quạt ngay, chưa cho trượt, để lá không bay từ góc trái vào mỗi lần vẽ lại
    container.classList.remove('animate');
    layoutHand();
    void container.offsetWidth;
    container.classList.add('animate');

    // Lá mới bốc: lần lượt bay từ chồng bài úp vào tay rồi lật ngửa
    const pile = deckSource();
    newCards.forEach((el, i) => {
        const delay = 200 + i * 260;
        flipReveal(el, { from: pile, delay, duration: 950, spin: -18, arc: true });
        bumpDrawPile(delay);
        markNew(el, delay + 950);
    });
}

// Chồng bài để bay ra: chồng to giữa bàn nếu đang nhìn thấy, không thì chồng nhỏ cạnh tay bài
function deckSource() {
    const big = document.querySelector('.play-table .deck-stack');
    if (big && big.offsetParent) {
        const r = big.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) return big;
    }
    return document.getElementById('drawPile');
}

// Lá vừa bốc sáng viền và gắn nhãn "MỚI" một lúc cho dễ thấy
function markNew(el, delay) {
    if (!effectsOn) return;
    setTimeout(() => {
        if (!el.isConnected) return;
        el.classList.add('just-drawn');
        setTimeout(() => el.classList.remove('just-drawn'), 2600);
    }, delay);
}

// Người khác bốc bài: một lá úp bay từ chồng bài tới chỗ ngồi của họ
function flyBackTo(target, delay) {
    const from = deckSource();
    if (!effectsOn || !from || !target || !document.body.animate) return;
    const a = from.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const ghost = document.createElement('div');
    ghost.className = 'card-back flying-back';
    ghost.style.left = `${a.left + a.width / 2 - 23}px`;
    ghost.style.top = `${a.top + a.height / 2 - 30}px`;
    document.body.appendChild(ghost);
    const dx = (b.left + Math.min(b.width, 60) / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    const anim = ghost.animate([
        { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 50}px) rotate(-160deg) scale(1.25)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(-340deg) scale(0.6)`, opacity: 0.2 }
    ], { duration: 800, delay, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'backwards' });
    anim.onfinish = () => {
        ghost.remove();
        replayAnimation(target, 'got-card');
    };
    anim.oncancel = () => ghost.remove();
    setTimeout(() => replayAnimation(from, 'drawing'), delay);
}

function updateGameStatus(state) {
    const statusEl = document.getElementById('gameStatus');
    const isMe = state.current_player_id === gameState.playerId;
    const who = isMe ? 'bạn' : playerName(state, state.current_player_id);
    if (state.state === 'topic') {
        statusEl.textContent = isMe ? 'Bạn ra đề!' : `${who} ra đề`;
    } else if (state.state === 'playing') {
        statusEl.textContent = isMe ? 'Lượt của bạn!' : `Lượt của ${who}`;
    } else if (state.state === 'voting') {
        statusEl.textContent = 'Bỏ phiếu';
    } else if (state.state === 'game_end') {
        statusEl.textContent = 'Kết thúc';
    } else {
        statusEl.textContent = state.state;
    }
}

function updateCardDisplay(state) {
    const area = document.getElementById('cardDisplayArea');
    area.classList.remove('hidden');

    area.querySelector('h3').textContent = state.state === 'voting'
        ? (state.current_card.is_final_card ? 'Lá cuối, cần 1/2 đồng ý' : 'Lá đang xét')
        : 'Lá vừa xét';

    const contentEl = document.getElementById('currentCardContent');
    const cardKey = state.voting_id;
    if (contentEl.dataset.key !== String(cardKey)) {
        contentEl.dataset.key = String(cardKey);
        contentEl.innerHTML = '';
        contentEl.appendChild(renderMemeCard(state.current_card.content, 'big'));
    }

    document.getElementById('cardPlayedBy').textContent =
        `${playerName(state, state.current_card.played_by)} vừa đánh lá này`;

    const votingInfo = document.getElementById('votingInfo');
    if (state.state === 'voting') {
        votingInfo.textContent = `Đã chấm ${state.votes_count}/${state.total_voters}`;
    } else {
        votingInfo.textContent = '';
    }
}

function updateVotingPanel(state) {
    const panel = document.getElementById('votingPanel');
    panel.classList.remove('hidden');

    const myVote = state.my_vote;
    const validBtn = document.getElementById('validBtn');
    const invalidBtn = document.getElementById('invalidBtn');
    const prompt = document.getElementById('votingPrompt');
    const overlay = document.getElementById('voteOverlay');
    const needsMyVote = state.can_vote && (myVote === null || myVote === undefined);

    if (!state.can_vote) {
        validBtn.classList.add('hidden');
        invalidBtn.classList.add('hidden');
        prompt.textContent = state.current_card.played_by === gameState.playerId
            ? 'Mọi người đang bình chọn lá bài của bạn...'
            : 'Mọi người đang bình chọn...';
    } else if (!needsMyVote) {
        validBtn.disabled = true;
        invalidBtn.disabled = true;
        validBtn.classList.remove('hidden');
        invalidBtn.classList.remove('hidden');
        prompt.textContent = myVote ? 'Bạn đã chấm: Hợp đề' : 'Bạn đã chấm: Không hợp';
    } else {
        validBtn.classList.remove('hidden');
        invalidBtn.classList.remove('hidden');
        validBtn.disabled = false;
        invalidBtn.disabled = false;
        prompt.textContent = state.topic ? 'Ảnh này có hợp với chủ đề không?' : 'Lá bài này có hợp lệ không?';
    }

    document.getElementById('votesDisplay').textContent =
        `Đã bỏ phiếu: ${state.votes_count}/${state.total_voters}`;

    // Danh sách ai đã vote / đang chờ ai
    ['voterList', 'overlayVoters'].forEach(id => {
        const list = document.getElementById(id);
        if (!list) return;
        list.innerHTML = '';
        (state.voters || []).forEach(v => {
            const li = document.createElement('li');
            li.className = v.voted ? 'done' : 'waiting';
            li.textContent = playerName(state, v.player_id)
                + (v.player_id === gameState.playerId ? ' (bạn)' : '')
                + (v.voted ? ' đã chấm' : ' đang chờ');
            list.appendChild(li);
        });
    });

    // Bảng vote lớn giữa màn hình cho người chưa vote
    if (needsMyVote) {
        const overlayCard = document.getElementById('overlayCard');
        const freshCard = overlayCard.dataset.key !== String(state.voting_id);
        if (freshCard) {
            overlayCard.dataset.key = String(state.voting_id);
            overlayCard.innerHTML = '';
            overlayCard.appendChild(renderMemeCard(state.current_card.content, 'big'));
        }
        document.getElementById('overlayPlayedBy').textContent =
            `${playerName(state, state.current_card.played_by)} vừa đánh lá này`;
        document.getElementById('overlayTopic').textContent = state.topic || '';
        const topicBox = document.getElementById('overlayTopicBox');
        if (topicBox) topicBox.classList.toggle('hidden', !state.topic);
        const hint = document.getElementById('overlayHint');
        hint.classList.toggle('final', !!state.current_card.is_final_card);
        hint.textContent = state.current_card.is_final_card
            ? 'Đây là lá cuối: chỉ cần 1/2 đồng ý là người đó thắng!'
            : 'Cần 3/4 số phiếu đồng ý để lá được chấp nhận.';
        overlay.classList.remove('hidden');
        if (freshCard) flipReveal(overlayCard.querySelector('.meme-card'), { duration: 650, delay: 150 });
    } else {
        overlay.classList.add('hidden');
    }

    startTimer(state.vote_time_left, state.vote_seconds || 30, needsMyVote, 'vote-' + state.voting_id);
}

// ==================== Chủ đề vòng ====================

function updateTopic(state) {
    const banner = document.getElementById('topicBanner');
    const panel = document.getElementById('topicPanel');
    const showBanner = state.topic && state.state !== 'topic' && state.state !== 'waiting';
    banner.classList.toggle('hidden', !showBanner);
    if (showBanner) {
        document.getElementById('topicRound').textContent = `Chủ đề vòng ${state.round}`;
        // textContent: chữ người chơi gõ không bao giờ được hiểu là HTML
        const topicText = document.getElementById('topicText');
        topicText.textContent = state.topic;
        topicText.classList.toggle('topic-long', state.topic.length > 70);
        document.getElementById('topicBy').textContent = `${playerName(state, state.round_opener_id)} ra đề`;
    }

    if (state.state !== 'topic') {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');
    const isSetter = state.current_player_id === gameState.playerId;
    document.getElementById('topicPanelTitle').textContent = isSetter
        ? `Vòng ${state.round}: bạn ra chủ đề!`
        : `Vòng ${state.round}: ${playerName(state, state.current_player_id)} đang ra chủ đề...`;
    document.getElementById('topicForm').classList.toggle('hidden', !isSetter);
    document.getElementById('topicWaiting').classList.toggle('hidden', isSetter);
    const input = document.getElementById('topicInput');
    input.maxLength = state.topic_max_length || 150;
    if (isSetter && panel.dataset.key !== String(state.topic_id)) {
        panel.dataset.key = String(state.topic_id);
        input.value = '';
        input.focus();
    }
    startTimer(state.topic_time_left, state.topic_seconds || 45, isSetter, 'topic-' + state.topic_id);
}

function submitTopic() {
    const input = document.getElementById('topicInput');
    const topic = input.value.trim();
    if (!topic) {
        input.focus();
        return;
    }
    socket.emit('set_topic', { topic });
}

function randomTopic() {
    const list = window.TOPIC_SUGGESTIONS || [];
    if (!list.length) return;
    const input = document.getElementById('topicInput');
    let pick = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && pick === input.value) pick = list[(list.indexOf(pick) + 1) % list.length];
    input.value = pick;
    input.focus();
}

document.getElementById('topicSubmitBtn').addEventListener('click', submitTopic);
document.getElementById('topicDiceBtn').addEventListener('click', randomTopic);
document.getElementById('topicInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitTopic();
});

// ==================== Đồng hồ (bỏ phiếu / ra đề) ====================

function startTimer(timeLeft, totalSeconds, needsTick, key) {
    if (timeLeft === null || timeLeft === undefined) return;
    ui.voteDeadline = Date.now() + timeLeft * 1000;
    ui.voteSeconds = totalSeconds;
    ui.timerNeedsTick = needsTick;
    if (ui.timerKey !== key) ui.lastTickSecond = null;
    ui.timerKey = key;
    if (!ui.timerHandle) {
        ui.timerHandle = setInterval(renderTimer, 200);
    }
    renderTimer();
}

function stopTimer() {
    clearInterval(ui.timerHandle);
    ui.timerHandle = null;
    ui.lastTickSecond = null;
}

function renderTimer() {
    if (!ui.voteDeadline) return;
    const msLeft = Math.max(0, ui.voteDeadline - Date.now());
    const seconds = Math.ceil(msLeft / 1000);
    const ratio = Math.min(1, msLeft / (ui.voteSeconds * 1000));
    document.querySelectorAll('.timer').forEach(timer => {
        timer.querySelector('.timer-fill').style.width = `${ratio * 100}%`;
        timer.querySelector('.timer-text').textContent = `${seconds}s`;
        timer.classList.toggle('urgent', seconds <= 5);
    });
    // Trống dồn 5 giây cuối khi bỏ phiếu, cho cả phòng
    if (ui.timerKey && ui.timerKey.startsWith('vote-') && seconds <= 5 && seconds > 0
            && ui.drumrollKey !== ui.timerKey) {
        ui.drumrollKey = ui.timerKey;
        audio.play('drumroll');
    }
    // Tíc tắc 3 giây cuối cho người còn phải làm gì đó (bỏ phiếu / ra đề)
    if (ui.timerNeedsTick && seconds <= 3 && seconds > 0 && seconds !== ui.lastTickSecond) {
        ui.lastTickSecond = seconds;
        audio.play('tick');
    }
}

// ==================== Pháo giấy ====================

function launchConfetti() {
    if (!effectsOn) return;
    const canvas = document.getElementById('confetti');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.classList.remove('hidden');

    const colors = ['#ffd23f', '#ff5c8a', '#3da5ff', '#2ec27e', '#ff4d3d', '#1a1a1a'];
    const pieces = Array.from({ length: 160 }, () => ({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.5,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        vx: -2 + Math.random() * 4,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: -0.2 + Math.random() * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)]
    }));

    const start = performance.now();
    function frame(now) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.rot += p.vr;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        if (now - start < 4000) {
            requestAnimationFrame(frame);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.classList.add('hidden');
        }
    }
    requestAnimationFrame(frame);
}

// ==================== Notifications & Modals ====================

// Pop-up góc phải: luôn cho biết đang tới lượt ai, nảy lên mỗi khi đổi lượt
function updateTurnToast(state) {
    const toast = document.getElementById('turnToast');
    const me = gameState.playerId;
    const isMe = state.current_player_id === me;
    const who = playerName(state, state.current_player_id);
    let icon = '', title = '', sub = '', mine = false;

    if (state.state === 'topic') {
        icon = '📣';
        mine = isMe;
        title = isMe ? 'Đến lượt bạn ra chủ đề!' : `${who} đang ra chủ đề`;
        sub = isMe ? 'Gõ một tình huống hoặc bấm xúc xắc' : 'Chờ một chút nhé...';
    } else if (state.state === 'playing') {
        icon = '🃏';
        mine = isMe;
        title = isMe ? 'Đến lượt bạn đánh!' : `Lượt của ${who}`;
        sub = isMe ? 'Chọn ảnh hợp đề, hoặc bỏ lượt rút 1 lá' : `${who} đang chọn ảnh...`;
    } else if (state.state === 'voting') {
        const needsMyVote = state.can_vote && (state.my_vote === null || state.my_vote === undefined);
        icon = '🗳️';
        mine = needsMyVote;
        title = needsMyVote ? 'Đến lượt bạn chấm!' : 'Đang bỏ phiếu';
        sub = `Lá của ${playerName(state, state.current_card && state.current_card.played_by)}`
            + ` · ${state.votes_count}/${state.total_voters} phiếu`;
    } else {
        toast.classList.add('hidden');
        toast.dataset.key = '';
        return;
    }

    if (state.is_spectator) sub = 'Bạn đang xem, ván sau sẽ được chơi';
    document.getElementById('turnToastIcon').textContent = icon;
    document.getElementById('turnToastTitle').textContent = title;
    document.getElementById('turnToastSub').textContent = sub;
    toast.classList.toggle('mine', mine);
    toast.classList.remove('hidden');

    // Đổi lượt (hoặc mình vừa bỏ phiếu xong) thì cho pop-up nảy lại
    const key = [state.state, state.current_player_id, state.topic_id, state.turn_id, state.voting_id, mine].join('|');
    if (toast.dataset.key !== key) {
        toast.dataset.key = key;
        replayAnimation(toast, 'toast-in');
    }
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorModal').classList.remove('hidden');
}

function closeErrorModal() {
    document.getElementById('errorModal').classList.add('hidden');
}

function leaveGame() {
    // Báo server để không còn bị tính lượt / chờ phiếu
    socket.emit('leave_game');
    backToLogin();
}

function backToLogin() {
    gameState.gameStarted = false;
    gameState.gameId = null;
    gameState.playerId = null;
    resetGameUi();
    showScreen('loginScreen');
    document.getElementById('winnerModal').classList.add('hidden');
    // Tên giữ nguyên trong phiên, chỉ xóa mã phòng
    document.getElementById('playerName').value = loadSession('name');
    document.getElementById('gameCodeInput').value = '';
}

// Dọn màn chơi (dùng khi rời phòng, và khi hết ván quay về phòng chờ)
function resetGameUi() {
    stopTimer();
    ui = {
        lastState: null,
        seenVotingId: 0,
        seenResultId: 0,
        seenTopicId: 0,
        voteDeadline: null,
        timerKey: null,
        drumrollKey: null,
        timerHandle: null,
        lastTickSecond: null,
        winShown: false
    };
    document.getElementById('voteOverlay').classList.add('hidden');
    document.getElementById('cardDisplayArea').classList.add('hidden');
    document.getElementById('currentCardContent').dataset.key = '';
    document.getElementById('overlayCard').dataset.key = '';
    document.getElementById('topicPanel').dataset.key = '';
    delete document.getElementById('gameScreen').dataset.state;
    const toast = document.getElementById('turnToast');
    toast.classList.add('hidden');
    toast.dataset.key = '';
}

// ==================== Initial Setup ====================

applyEffectsSetting();
applyAudioSettings();
document.getElementById('playerName').value = loadSession('name');
showScreen('loginScreen');
