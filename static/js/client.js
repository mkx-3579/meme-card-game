/* Meme Card Game - Client */

const socket = io();

let gameState = {
    gameId: null,
    playerId: null,
    playerName: null,
    gameStarted: false
};

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
    const gameCode = document.getElementById('gameCodeInput').value.trim().toUpperCase();
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
    backToLogin();
});

// ==================== Game Screen Events ====================

document.getElementById('leaveGameBtnFooter').addEventListener('click', () => {
    backToLogin();
});

function playCard(cardIndex) {
    socket.emit('play_card', { card_index: cardIndex });
}

document.getElementById('validBtn').addEventListener('click', () => {
    socket.emit('vote', { is_valid: true });
});

document.getElementById('invalidBtn').addEventListener('click', () => {
    socket.emit('vote', { is_valid: false });
});

// ==================== Socket.IO Events ====================

socket.on('game_created', (data) => {
    console.log('Game created:', data);
    gameState.gameId = data.game_id;
    gameState.playerId = data.player_id;
    showScreen('waitingScreen');
    updateWaitingRoom();
});

socket.on('game_joined', (data) => {
    console.log('Game joined:', data);
    gameState.gameId = data.game_id;
    gameState.playerId = data.player_id;
    showScreen('waitingScreen');
    addNotification(data.message);
    updateWaitingRoom();
});

socket.on('game_state', (state) => {
    console.log('Game state updated:', state);
    
    // Nếu game đã bắt đầu, chuyển sang màn hình game
    if (state.state === 'playing' || state.state === 'voting') {
        if (!gameState.gameStarted) {
            gameState.gameStarted = true;
            showScreen('gameScreen');
        }
        updateGameScreen(state);
    } else {
        // Còn trong phòng chờ
        updateWaitingRoomPlayers(state);
        updateStartButton(state);
    }
});

socket.on('notification', (data) => {
    addNotification(data.message);
    if (data.type === 'winner') {
        // Hiển thị modal thắng
        setTimeout(() => {
            document.getElementById('winnerMessage').textContent = data.message;
            document.getElementById('winnerModal').classList.remove('hidden');
        }, 500);
    }
});

socket.on('error', (data) => {
    showError(data.message);
});

// ==================== Utility Functions ====================

function updateWaitingRoom() {
    socket.emit('get_game_state');
    
    setTimeout(() => {
        const gameCode = gameState.gameId.toUpperCase();
        document.getElementById('gameCodeDisplay').textContent = gameCode;
    }, 100);
}

function updateWaitingRoomPlayers(state) {
    const container = document.getElementById('playersList');
    container.innerHTML = '';
    
    state.players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        
        const isMePlayer = player.player_id === gameState.playerId;
        let prefix = isMePlayer ? '👤 ' : '';
        
        div.innerHTML = `${prefix}<strong>${player.name}</strong>`;
        container.appendChild(div);
    });
}

function updateStartButton(state) {
    const btn = document.getElementById('startGameBtn');
    const playerCount = state.players.length;
    
    const countDisplay = document.querySelector('.room-box h3');
    if (countDisplay) {
        countDisplay.innerHTML = `👥 Người chơi (${playerCount}/8)`;
    }
    
    if (playerCount >= 2) {
        btn.disabled = false;
        btn.textContent = `▶️ Bắt Đầu Game (${playerCount} người)`;
    } else {
        btn.disabled = true;
        btn.textContent = `▶️ Bắt Đầu Game (Cần ≥2 người)`;
    }
}

function updateGameScreen(state) {
    // Update round
    document.getElementById('roundNum').textContent = state.round;
    
    // Update players status
    updatePlayersStatus(state.players, state.current_player_id);
    
    // Update my hand
    updateMyHand(state);
    
    // Update game status
    updateGameStatus(state);
    
    // Update card display and voting
    if (state.current_card) {
        updateCardDisplay(state);
    } else {
        document.getElementById('cardDisplayArea').classList.add('hidden');
    }
    
    // Update voting panel
    if (state.state === 'voting') {
        updateVotingPanel(state);
    } else {
        document.getElementById('votingPanel').classList.add('hidden');
    }
}

function updatePlayersStatus(players, currentPlayerId) {
    const container = document.getElementById('playersStatus');
    container.innerHTML = '';
    
    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        
        const isCurrentPlayer = player.player_id === currentPlayerId;
        const isMePlayer = player.player_id === gameState.playerId;
        
        let prefix = '';
        if (isCurrentPlayer) prefix = '👉 ';
        if (isMePlayer) prefix += '👤 ';
        
        div.innerHTML = `
            ${prefix}<strong>${player.name}</strong>
            <span class="player-score">🎴 ${player.hand_count} | ⭐ ${player.score}</span>
        `;
        
        container.appendChild(div);
    });
}

function updateMyHand(state) {
    const container = document.getElementById('myHandCards');
    container.innerHTML = '';
    
    const myPlayer = state.players.find(p => p.player_id === gameState.playerId);
    if (!myPlayer) return;
    
    const isMyTurn = state.current_player_id === gameState.playerId;
    const isVoting = state.state === 'voting';
    
    const statusEl = document.getElementById('handStatus');
    if (isVoting) {
        statusEl.textContent = '🗳️ Đang bỏ phiếu...';
    } else if (isMyTurn) {
        statusEl.textContent = '👉 Lượt của bạn! Chọn 1 lá bài để đánh';
    } else {
        statusEl.textContent = '⏳ Đang chờ người chơi khác...';
    }
    
    // Hiển thị tay bài của tôi
    if (myPlayer.hand && Array.isArray(myPlayer.hand)) {
        myPlayer.hand.forEach((cardContent, index) => {
            const card = document.createElement('div');
            card.className = `card ${isMyTurn && !isVoting ? '' : 'disabled'}`;
            card.innerHTML = cardContent;
            card.title = cardContent; // Tooltip khi hover
            if (isMyTurn && !isVoting) {
                card.onclick = () => playCard(index);
            }
            container.appendChild(card);
        });
    } else {
        // Fallback nếu backend chưa gửi chi tiết hand
        for (let i = 0; i < myPlayer.hand_count; i++) {
            const card = document.createElement('div');
            card.className = `card ${isMyTurn && !isVoting ? '' : 'disabled'}`;
            card.innerHTML = `🎴 Bài ${i + 1}`;
            if (isMyTurn && !isVoting) {
                card.onclick = () => playCard(i);
            }
            container.appendChild(card);
        }
    }
}

function updateGameStatus(state) {
    const statusEl = document.getElementById('gameStatus');
    if (state.state === 'playing') {
        statusEl.textContent = '⏳ Đang chơi';
    } else if (state.state === 'voting') {
        statusEl.textContent = '🗳️ Bỏ phiếu';
    } else {
        statusEl.textContent = state.state;
    }
}

function updateCardDisplay(state) {
    const area = document.getElementById('cardDisplayArea');
    if (!state.current_card) {
        area.classList.add('hidden');
        return;
    }
    
    area.classList.remove('hidden');
    
    const contentEl = document.getElementById('currentCardContent');
    contentEl.textContent = state.current_card.content;
    
    const playedBy = state.players.find(p => p.player_id === state.current_card.played_by);
    document.getElementById('cardPlayedBy').textContent = `👤 ${playedBy ? playedBy.name : 'Unknown'} đã đánh`;
    
    const votingInfo = document.getElementById('votingInfo');
    if (state.state === 'voting') {
        votingInfo.innerHTML = `
            🗳️ Bỏ phiếu: ${state.votes_count}/${state.total_voters}
        `;
    } else {
        votingInfo.innerHTML = '';
    }
}

function updateVotingPanel(state) {
    const panel = document.getElementById('votingPanel');
    panel.classList.remove('hidden');
    
    // Kiểm tra xem tôi đã bỏ phiếu chưa
    const myVote = state.votes[gameState.playerId];
    
    if (myVote !== null && myVote !== undefined) {
        // Tôi đã bỏ phiếu
        document.getElementById('validBtn').disabled = true;
        document.getElementById('invalidBtn').disabled = true;
        
        const voteText = myVote ? '✅ Bạn bỏ phiếu HỢPLỆ' : '❌ Bạn bỏ phiếu KHÔNG HỢP LỆ';
        document.getElementById('votingPrompt').textContent = voteText;
    } else {
        // Tôi chưa bỏ phiếu
        document.getElementById('validBtn').disabled = false;
        document.getElementById('invalidBtn').disabled = false;
        document.getElementById('votingPrompt').textContent = 'Lá bài này có hợp lệ không?';
    }
    
    // Hiển thị số phiếu bỏ
    const votesDisplay = document.getElementById('votesDisplay');
    votesDisplay.textContent = `Đã bỏ phiếu: ${state.votes_count}/${state.total_voters}`;
}

// ==================== Notifications & Modals ====================

function addNotification(message) {
    const container = document.getElementById('notifications');
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = message;
    container.appendChild(notif);
    
    // Tự động xóa sau 10 giây
    setTimeout(() => {
        notif.remove();
    }, 10000);
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorModal').classList.remove('hidden');
}

function closeErrorModal() {
    document.getElementById('errorModal').classList.add('hidden');
}

function backToLogin() {
    gameState.gameStarted = false;
    gameState.gameId = null;
    gameState.playerId = null;
    showScreen('loginScreen');
    document.getElementById('playerName').value = '';
    document.getElementById('gameCodeInput').value = '';
    document.getElementById('joinGameForm').classList.add('hidden');
}

// ==================== Initial Setup ====================

showScreen('loginScreen');

// Request game state periodically when in waiting room
let stateCheckInterval;

socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});
