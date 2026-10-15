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
        const patterns = {
            // Lá bài vút ra rồi đập xuống bàn
            'card-play': [[2500, 0, 0.16, 'noise', 600, 0.6], [110, 0.14, 0.12, 'sine', 50, 1.2], [1800, 0.14, 0.05, 'noise', null, 0.5]],
            // Tiếng xào bài: nhiều tiếng quẹt ngắn liên tiếp
            'deal': Array.from({ length: 6 }, (_, i) => [3000 - i * 150, i * 0.07, 0.06, 'noise', 1200, 0.5]),
            'vote': [[660, 0, 0.07, 'sine']],
            'accept': [[523, 0, 0.1, 'triangle'], [659, 0.1, 0.1, 'triangle'], [784, 0.2, 0.18, 'triangle'], [1047, 0.3, 0.3, 'triangle']],
            // Kèn buồn "wah wah wah waaah"
            'reject': [[392, 0, 0.3, 'sawtooth', 370, 0.7], [370, 0.32, 0.3, 'sawtooth', 349, 0.7], [349, 0.64, 0.3, 'sawtooth', 330, 0.7], [330, 0.96, 0.7, 'sawtooth', 300, 0.7]],
            'tick': [[1000, 0, 0.03, 'square']],
            'drumroll': drumroll.concat([[120, 36 * 0.045, 0.4, 'sine', 60, 1.4], [3000, 36 * 0.045, 0.4, 'noise', null, 0.6]]),
            'topic': [[1319, 0, 0.25, 'sine'], [1760, 0.08, 0.35, 'sine']],
            'win': [[523, 0, 0.12, 'triangle'], [659, 0.12, 0.12, 'triangle'], [784, 0.24, 0.12, 'triangle'], [1047, 0.36, 0.35, 'triangle']],
            'your-turn': [[880, 0, 0.08, 'sine'], [1175, 0.1, 0.12, 'sine']]
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
    socket.emit('join_game', { game_id: gameCode, name });
});

// ==================== Waiting Room Events ====================

document.getElementById('startGameBtn').addEventListener('click', () => {
    socket.emit('start_game');
});

document.getElementById('leaveGameBtn').addEventListener('click', () => {
    leaveGame();
});

// ==================== Game Screen Events ====================

document.getElementById('leaveGameBtnFooter').addEventListener('click', () => {
    leaveGame();
});

function playCard(cardIndex, cardEl) {
    if (cardEl && effectsOn) cardEl.classList.add('flying');
    socket.emit('play_card', { card_index: cardIndex });
}

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
    showScreen('waitingScreen');
    updateWaitingRoom();
});

socket.on('game_joined', (data) => {
    gameState.gameId = data.game_id;
    gameState.playerId = data.player_id;
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
        updateWaitingRoomPlayers(state);
        updateStartButton(state);
    }
});

socket.on('notification', (data) => {
    addNotification(data.message, data.type);
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

function updateStartButton(state) {
    const btn = document.getElementById('startGameBtn');
    const playerCount = state.players.length;

    const countDisplay = document.getElementById('waitingCount');
    if (countDisplay) {
        countDisplay.textContent = `Người chơi (${playerCount}/8)`;
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

function playerName(state, playerId) {
    const p = state.players.find(pl => pl.player_id === playerId);
    return p ? p.name : 'Ai đó';
}

function updateGameScreen(state) {
    const prev = ui.lastState;
    ui.lastState = state;

    document.getElementById('roundNum').textContent = state.round;
    // Chỉ để CSS đổi bố cục theo giai đoạn (ra đề / đánh / bỏ phiếu)
    document.getElementById('gameScreen').dataset.state = state.state;
    const roomChip = document.getElementById('roomChip');
    if (roomChip && gameState.gameId) roomChip.textContent = `Phòng ${gameState.gameId.toUpperCase()}`;

    updatePlayersStatus(state, prev);
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
        if (state.state !== 'topic') stopTimer();
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

    // Lá mới được đánh ra
    if (state.state === 'voting' && state.voting_id !== ui.seenVotingId) {
        ui.seenVotingId = state.voting_id;
        audio.playMeme(state.current_card && state.current_card.content);
        replayAnimation(document.getElementById('currentCardContent'), 'card-enter');
        if (state.can_vote) setTimeout(() => audio.play('your-turn'), 700);
    }

    // Có kết quả bỏ phiếu mới
    const result = state.last_result;
    if (result && result.voting_id !== ui.seenResultId) {
        const firstSeen = ui.seenResultId === 0 && !prev;
        ui.seenResultId = result.voting_id;
        if (!firstSeen) showResult(state, result);
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

    // Cho mọi người thấy ai vote gì
    const details = Object.entries(result.votes || {})
        .map(([pid, v]) => `${playerName(state, pid)} ${v ? 'hợp đề' : 'không hợp'}`)
        .join(', ');
    if (details) addNotification(`Phiếu bầu: ${details}`);

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
    if (!myPlayer) return;

    const isGameOver = state.state === 'game_end';
    const isVoting = state.state === 'voting';
    const isTopic = state.state === 'topic';
    const isMyTurn = !isGameOver && !isVoting && !isTopic && state.current_player_id === gameState.playerId;

    document.getElementById('myHand').classList.toggle('my-turn', isMyTurn);

    const statusEl = document.getElementById('handStatus');
    if (isGameOver) {
        statusEl.textContent = 'Ván đã kết thúc';
    } else if (isVoting && state.can_vote && state.my_vote === null) {
        statusEl.textContent = 'Đến lượt bạn bỏ phiếu!';
    } else if (isVoting) {
        statusEl.textContent = 'Đang chờ mọi người bỏ phiếu...';
    } else if (isTopic) {
        statusEl.textContent = state.current_player_id === gameState.playerId
            ? 'Bạn ra đề trước, rồi đánh lá đầu tiên'
            : `Chờ ${playerName(state, state.current_player_id)} ra đề...`;
    } else if (isMyTurn) {
        statusEl.textContent = 'Lượt của bạn! Chạm một ảnh hợp đề để đánh';
    } else {
        statusEl.textContent = `Chờ ${playerName(state, state.current_player_id)} đánh bài...`;
    }

    // Lá nào mới vào tay thì cho bay vào
    const prevMe = prev && prev.players.find(p => p.player_id === gameState.playerId);
    const prevIds = new Set(((prevMe && prevMe.hand) || []).map(c => c && c.id));

    (myPlayer.hand || []).forEach((card, index) => {
        const el = renderMemeCard(card, 'small');
        el.classList.add('card');
        if (!isMyTurn) el.classList.add('disabled');
        if (prev && card && !prevIds.has(card.id) && effectsOn) {
            el.classList.add('deal-in');
            el.style.animationDelay = `${index * 60}ms`;
        }
        el.setAttribute('aria-label', `Lá bài ${index + 1}${card && card.name ? ': ' + card.name : ''}`);
        if (isMyTurn) {
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
            el.onclick = () => playCard(index, el);
            el.onkeydown = e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playCard(index, el);
                }
            };
        } else {
            el.setAttribute('aria-disabled', 'true');
        }
        container.appendChild(el);
    });
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
        if (overlayCard.dataset.key !== String(state.voting_id)) {
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
        document.getElementById('topicText').textContent = state.topic;
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
    input.maxLength = state.topic_max_length || 100;
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

// Khung "Diễn biến": một danh sách liền, có thể thu gọn
const LOG_MAX_LINES = 40;
let logCollapsed = loadSetting('logCollapsed', true);
let logUnread = 0;

function applyLogCollapsed() {
    const box = document.getElementById('notificationBox');
    box.classList.toggle('collapsed', logCollapsed);
    document.getElementById('logToggle').setAttribute('aria-expanded', String(!logCollapsed));
    if (!logCollapsed) {
        logUnread = 0;
        const list = document.getElementById('notifications');
        list.scrollTop = list.scrollHeight;
    }
    const badge = document.getElementById('logUnread');
    badge.textContent = logUnread;
    badge.classList.toggle('hidden', logUnread === 0);
}

document.getElementById('logToggle').addEventListener('click', () => {
    logCollapsed = !logCollapsed;
    saveSetting('logCollapsed', logCollapsed);
    applyLogCollapsed();
});
applyLogCollapsed();

function addNotification(message, type) {
    const container = document.getElementById('notifications');
    const notif = document.createElement('div');
    notif.className = 'notification' + (type === 'winner' ? ' winner' : '');
    notif.textContent = message;
    container.appendChild(notif);
    while (container.children.length > LOG_MAX_LINES) container.firstChild.remove();
    container.scrollTop = container.scrollHeight;

    document.getElementById('logLatest').textContent = message;
    if (logCollapsed) logUnread += 1;
    applyLogCollapsed();
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
    showScreen('loginScreen');
    document.getElementById('playerName').value = '';
    document.getElementById('gameCodeInput').value = '';
    document.getElementById('winnerModal').classList.add('hidden');
    document.getElementById('voteOverlay').classList.add('hidden');
    document.getElementById('cardDisplayArea').classList.add('hidden');
    document.getElementById('currentCardContent').dataset.key = '';
    document.getElementById('overlayCard').dataset.key = '';
    document.getElementById('notifications').innerHTML = '';
    delete document.getElementById('gameScreen').dataset.state;
    document.getElementById('logLatest').textContent = '';
    logUnread = 0;
    applyLogCollapsed();
}

// ==================== Initial Setup ====================

applyEffectsSetting();
applyAudioSettings();
showScreen('loginScreen');
