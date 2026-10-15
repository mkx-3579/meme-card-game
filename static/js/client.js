/* Meme Card Game - Client */

const socket = io();

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
    voteDeadline: null,
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
        this.playFile(this.files[name], name);
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
        // [tần số, thời điểm bắt đầu, độ dài, dạng sóng]
        const patterns = {
            'card-play': [[520, 0, 0.06, 'triangle'], [780, 0.05, 0.08, 'triangle']],
            'vote': [[660, 0, 0.07, 'sine']],
            'accept': [[523, 0, 0.1, 'triangle'], [659, 0.1, 0.1, 'triangle'], [784, 0.2, 0.18, 'triangle']],
            'reject': [[200, 0, 0.18, 'sawtooth'], [150, 0.16, 0.25, 'sawtooth']],
            'tick': [[1000, 0, 0.03, 'square']],
            'win': [[523, 0, 0.12, 'triangle'], [659, 0.12, 0.12, 'triangle'], [784, 0.24, 0.12, 'triangle'], [1047, 0.36, 0.35, 'triangle']],
            'your-turn': [[880, 0, 0.08, 'sine'], [1175, 0.1, 0.12, 'sine']]
        };
        const notes = patterns[name];
        if (!notes) return;
        try {
            const now = this.ctx.currentTime;
            notes.forEach(([freq, start, length, type]) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = type;
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.15 * this.volume, now + start);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(now + start);
                osc.stop(now + start + length + 0.02);
            });
        } catch (e) { /* bỏ qua */ }
    }
}

const audio = new GameAudio(window.UI_SOUNDS);

document.addEventListener('click', () => audio.unlock());
document.addEventListener('keydown', () => audio.unlock());

function applyAudioSettings() {
    document.getElementById('muteBtn').textContent = audio.muted ? '🔇' : '🔊';
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

document.getElementById('joinGameBtn').addEventListener('click', () => {
    const form = document.getElementById('joinGameForm');
    form.classList.toggle('hidden');
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
    return `hsl(${hash}, 70%, 55%)`;
}

function makePlaceholder(card) {
    const box = document.createElement('div');
    box.className = 'meme-placeholder';
    box.style.background = `linear-gradient(135deg, ${templateColor(card.template)}, #312e81)`;
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
        let prefix = isMePlayer ? '👤 ' : '';
        if (player.player_id === state.host_id) prefix += '👑 ';

        // Dùng textContent để tên người chơi không thể chèn HTML/script
        div.appendChild(document.createTextNode(prefix));
        const name = document.createElement('strong');
        name.textContent = player.name;
        div.appendChild(name);
        container.appendChild(div);
    });
}

function updateStartButton(state) {
    const btn = document.getElementById('startGameBtn');
    const playerCount = state.players.length;

    const countDisplay = document.querySelector('.room-box h3');
    if (countDisplay) {
        countDisplay.textContent = `👥 Người chơi (${playerCount}/8)`;
    }

    if (state.host_id !== gameState.playerId) {
        btn.disabled = true;
        btn.textContent = '⏳ Chờ chủ phòng bắt đầu...';
    } else if (playerCount >= 2) {
        btn.disabled = false;
        btn.textContent = `▶️ Bắt Đầu Game (${playerCount} người)`;
    } else {
        btn.disabled = true;
        btn.textContent = `▶️ Bắt Đầu Game (Cần ≥2 người)`;
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

    updatePlayersStatus(state, prev);
    updateMyHand(state, prev);
    updateGameStatus(state);

    if (state.current_card) {
        updateCardDisplay(state);
    } else {
        document.getElementById('cardDisplayArea').classList.add('hidden');
    }

    if (state.state === 'voting') {
        updateVotingPanel(state);
    } else {
        document.getElementById('votingPanel').classList.add('hidden');
        document.getElementById('voteOverlay').classList.add('hidden');
        stopTimer();
    }

    handleEvents(state, prev);
}

// Phát âm thanh / hiệu ứng theo thay đổi giữa 2 lần cập nhật
function handleEvents(state, prev) {
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
        .map(([pid, v]) => `${playerName(state, pid)} ${v ? '✅' : '❌'}`)
        .join(', ');
    if (details) addNotification(`🗳️ ${details}`);

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
    plus.textContent = '+1 ⭐';
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
        if (isCurrentPlayer) div.classList.add('current');

        let prefix = '';
        if (isCurrentPlayer) prefix = '👉 ';
        if (isMePlayer) prefix += '👤 ';
        if (player.player_id === state.winner_id) prefix += '🏆 ';

        div.appendChild(document.createTextNode(prefix));
        const name = document.createElement('strong');
        name.textContent = player.name;
        div.appendChild(name);

        if (state.state === 'voting' && player.player_id in voted) {
            const badge = document.createElement('span');
            badge.className = 'vote-badge ' + (voted[player.player_id] ? 'done' : 'waiting');
            badge.textContent = voted[player.player_id] ? '✓ đã vote' : '⏳ đang chọn';
            div.appendChild(badge);
        }

        const score = document.createElement('span');
        score.className = 'player-score';
        score.textContent = ` 🎴 ${player.hand_count} | ⭐ ${player.score}`;
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
    const isMyTurn = !isGameOver && !isVoting && state.current_player_id === gameState.playerId;

    document.getElementById('myHand').classList.toggle('my-turn', isMyTurn);

    const statusEl = document.getElementById('handStatus');
    if (isGameOver) {
        statusEl.textContent = '🏁 Ván đã kết thúc';
    } else if (isVoting && state.can_vote && state.my_vote === null) {
        statusEl.textContent = '🗳️ Đến lượt bạn bỏ phiếu!';
    } else if (isVoting) {
        statusEl.textContent = '🗳️ Đang chờ mọi người bỏ phiếu...';
    } else if (isMyTurn) {
        statusEl.textContent = '👉 Lượt của bạn! Chọn 1 lá bài để đánh';
    } else {
        statusEl.textContent = `⏳ Đang chờ ${playerName(state, state.current_player_id)} đánh bài...`;
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
        if (isMyTurn) {
            el.onclick = () => playCard(index, el);
        }
        container.appendChild(el);
    });
}

function updateGameStatus(state) {
    const statusEl = document.getElementById('gameStatus');
    if (state.state === 'playing') {
        statusEl.textContent = '⏳ Đang chơi';
    } else if (state.state === 'voting') {
        statusEl.textContent = '🗳️ Bỏ phiếu';
    } else if (state.state === 'game_end') {
        statusEl.textContent = '🏁 Kết thúc';
    } else {
        statusEl.textContent = state.state;
    }
}

function updateCardDisplay(state) {
    const area = document.getElementById('cardDisplayArea');
    area.classList.remove('hidden');

    area.querySelector('h3').textContent = state.state === 'voting'
        ? (state.current_card.is_final_card ? 'Lá bài đang xét (LÁ CUỐI, cần 1/2):' : 'Lá bài đang xét:')
        : 'Lá bài vừa xét:';

    const contentEl = document.getElementById('currentCardContent');
    const cardKey = state.voting_id;
    if (contentEl.dataset.key !== String(cardKey)) {
        contentEl.dataset.key = String(cardKey);
        contentEl.innerHTML = '';
        contentEl.appendChild(renderMemeCard(state.current_card.content, 'big'));
    }

    document.getElementById('cardPlayedBy').textContent =
        `👤 ${playerName(state, state.current_card.played_by)} đã đánh`;

    const votingInfo = document.getElementById('votingInfo');
    if (state.state === 'voting') {
        votingInfo.textContent = `🗳️ Bỏ phiếu: ${state.votes_count}/${state.total_voters}`;
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
        prompt.textContent = myVote ? '✅ Bạn bỏ phiếu HỢP LỆ' : '❌ Bạn bỏ phiếu KHÔNG HỢP LỆ';
    } else {
        validBtn.classList.remove('hidden');
        invalidBtn.classList.remove('hidden');
        validBtn.disabled = false;
        invalidBtn.disabled = false;
        prompt.textContent = 'Lá bài này có hợp lệ không?';
    }

    document.getElementById('votesDisplay').textContent =
        `Đã bỏ phiếu: ${state.votes_count}/${state.total_voters}`;

    // Danh sách ai đã vote / đang chờ ai
    const list = document.getElementById('voterList');
    list.innerHTML = '';
    (state.voters || []).forEach(v => {
        const li = document.createElement('li');
        li.className = v.voted ? 'done' : 'waiting';
        li.textContent = `${v.voted ? '✓' : '⏳'} ${playerName(state, v.player_id)}`
            + (v.player_id === gameState.playerId ? ' (bạn)' : '');
        list.appendChild(li);
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
        document.getElementById('overlayHint').textContent = state.current_card.is_final_card
            ? '⚠️ Đây là LÁ CUỐI: chỉ cần 1/2 đồng ý là người đó thắng!'
            : 'Cần 3/4 số phiếu đồng ý để lá được chấp nhận.';
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }

    startTimer(state);
}

// ==================== Đồng hồ bỏ phiếu ====================

function startTimer(state) {
    if (state.vote_time_left === null || state.vote_time_left === undefined) return;
    ui.voteDeadline = Date.now() + state.vote_time_left * 1000;
    ui.voteSeconds = state.vote_seconds || 30;
    ui.timerNeedsTick = state.can_vote && (state.my_vote === null || state.my_vote === undefined);
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
        timer.querySelector('.timer-text').textContent = `⏰ ${seconds}s`;
        timer.classList.toggle('urgent', seconds <= 5);
    });
    // Tíc tắc 5 giây cuối cho người chưa vote
    if (ui.timerNeedsTick && seconds <= 5 && seconds > 0 && seconds !== ui.lastTickSecond) {
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

    const colors = ['#f59e0b', '#10b981', '#ef4444', '#667eea', '#ec4899', '#fde047'];
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

function addNotification(message, type) {
    const container = document.getElementById('notifications');
    const notif = document.createElement('div');
    notif.className = 'notification' + (type === 'winner' ? ' winner' : '');
    notif.textContent = message;
    container.appendChild(notif);

    // Tự động xóa sau 10 giây
    setTimeout(() => {
        notif.remove();
    }, 10000);

    container.scrollTop = container.scrollHeight;
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
        voteDeadline: null,
        timerHandle: null,
        lastTickSecond: null,
        winShown: false
    };
    showScreen('loginScreen');
    document.getElementById('playerName').value = '';
    document.getElementById('gameCodeInput').value = '';
    document.getElementById('joinGameForm').classList.add('hidden');
    document.getElementById('winnerModal').classList.add('hidden');
    document.getElementById('voteOverlay').classList.add('hidden');
    document.getElementById('cardDisplayArea').classList.add('hidden');
    document.getElementById('currentCardContent').dataset.key = '';
    document.getElementById('overlayCard').dataset.key = '';
    document.getElementById('notifications').innerHTML = '';
}

// ==================== Initial Setup ====================

applyEffectsSetting();
applyAudioSettings();
showScreen('loginScreen');
