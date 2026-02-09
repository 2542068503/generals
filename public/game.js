//game.js
class Deque {
  constructor() { this.items = []; }
  push_front(e) { this.items.unshift(e); }
  push_back(e)  { this.items.push(e); }
  pop_front()   { return this.items.shift(); }
  pop_back()    { return this.items.pop(); }
  front()       { return this.items.length ? this.items[0] : null; }
  back()        { return this.items.length ? this.items[this.items.length - 1] : null; }
  empty()       { return this.items.length === 0; }
  size()        { return this.items.length; }
  clear()       { this.items = []; }
}

class Player {
  constructor(game, playerId) {
    this.game = game;
    this.playerId = playerId;
    this.moveQueue = [];
    this.moveInterval = null;
    this.pendingMoves = new Map();
  }

  //game.js
  // 修改Player类的startMoveInterval方法
  startMoveInterval() {
    if (this.moveInterval) clearInterval(this.moveInterval);
    this.moveInterval = setInterval(() => {
      if (this.moveQueue.length > 0) {
        const move = this.moveQueue.shift();
        this.executeMove(move);
      }
    }, 500);
  }

  stopMoveInterval() {
    if (this.moveInterval) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
  }

  //game.js
  // 在Player类的executeMove方法中，修改无效移动的处理逻辑
  executeMove(move) {
    const { source, target, arrow } = move;
    
    // 注意：这里的 source 和 target 已经是原始坐标
    const sourceTile = this.game.tileStatus[source.x][source.y];
    const targetTile = this.game.tileStatus[target.x][target.y];
    
    const sourceKey = `${source.x},${source.y}`;
    
    // 检查移动是否有效
    if (!sourceTile || !targetTile ||
        sourceTile.owner !== this.playerId ||
        targetTile.type === 'mountain' ||
        Math.abs(source.x - target.x) + Math.abs(source.y - target.y) !== 1 ||
        sourceTile.army <= 1) {
      
      // 无效移动：从队列和pendingMoves中移除
      this.moveQueue = this.moveQueue.filter(m => 
        !(m.source.x === source.x && m.source.y === source.y && 
          m.target.x === target.x && m.target.y === target.y));
      
      // 从pendingMoves中移除这个特定的移动
      const pending = this.pendingMoves.get(sourceKey);
      if (pending) {
        const newPending = pending.filter(m => 
          !(m.target.x === target.x && m.target.y === target.y));
        if (newPending.length === 0) {
          this.pendingMoves.delete(sourceKey);
        } else {
          this.pendingMoves.set(sourceKey, newPending);
        }
      }
      
      this.game.renderGrid();
      
      // 修复：立即处理下一个移动，不等待interval
      if (this.moveQueue.length > 0) {
        const nextMove = this.moveQueue.shift();
        this.executeMove(nextMove);
      }
      return;
    }

    // 有效移动：从pendingMoves中移除这个移动
    const pending = this.pendingMoves.get(sourceKey);
    if (pending) {
      const newPending = pending.filter(m => 
        !(m.target.x === target.x && m.target.y === target.y));
      if (newPending.length === 0) {
        this.pendingMoves.delete(sourceKey);
      } else {
        this.pendingMoves.set(sourceKey, newPending);
      }
    }

    this.game.socket.emit('moveArmy', {
      roomId: this.game.roomId,
      playerId: this.playerId,
      source: source,
      target: target,
      arrow: arrow
    });

    this.game.renderGrid();
    this.game.updateStats();
  }

  addMoveToQueue(source, target, arrow) {
    const sourceKey = `${source.x},${source.y}`;
    const move = { source, target, arrow };
    this.moveQueue.push(move);
    if (!this.pendingMoves.has(sourceKey)) {
      this.pendingMoves.set(sourceKey, []);
    }
    this.pendingMoves.get(sourceKey).push(move);
    if (!this.moveInterval) {
      this.startMoveInterval();
    }
    this.game.renderGrid();
  }

  canMoveFrom(source) {
    if (!source) return false;
    if (source.owner !== this.playerId) return false;
    if (source.army <= 1) return false;
    return true;
  }

  clearMoves() {
    this.moveQueue = [];
    this.pendingMoves.clear();
    this.stopMoveInterval();
    this.game.renderGrid();
  }
}

class Game {
  constructor() {
    this.tileStatus = [];
    this.selectedTile = null;
    this.gameOver = false;
    this.currentTurn = 1;
    this.playerId = null;
    this.roomId = null;
    this.player = null;
    this.stats = null;
    this.vision = new Set();
    this.username = localStorage.getItem('generals_username') || 'undefined';
    this.playerColor = null;
    this.allPlayerColors = {}; // 新增：保存所有玩家的颜色映射，修复多玩家颜色问题
    this.gameStarted = false;
    this.hasJoinedRoom = false;
    this.visionTransform = 0; // 0:不变,1:旋转90,2:旋转180,3:旋转270,4:上下翻转,5:水平翻转,6:上下水平翻转
    this.usernameMaxLength = 12;
    this.defeated = false; // 新增：标记玩家是否被击败
    this.domGrid = []; 

    this.gridElement = document.getElementById('grid');
    this.turnNumberElement = document.getElementById('turn-number');
    this.leaderPlayerNameElement = document.getElementById('leader-player-name');
    this.leaderPlayerArmyElement = document.getElementById('leader-player-army');
    this.leaderPlayerTilesElement = document.getElementById('leader-player-tiles');
    this.leaderOpponentNameElement = document.getElementById('leader-opponent-name');
    this.leaderOpponentArmyElement = document.getElementById('leader-opponent-army');
    this.leaderOpponentTilesElement = document.getElementById('leader-opponent-tiles');
    this.statusMessage = document.getElementById('status-message');

    this.socket = io();
    this.setupEventListeners();
    this.initUI();
    this.hideGameElements();
    this.showUsernameModalIfNeeded();
    this.socket.on('connect_error', (err) => {
      console.error('Socket.IO 连接错误:', err);
      this.showMessage('无法连接到服务器，请检查网络或服务器状态');
    });
    this.socket.on('reconnect_failed', () => this.showMessage('重连失败，请刷新页面重试'));
    this.socket.on('invalidUsername', (data) => {
      this.showMessage((data && data.reason) ? data.reason : '用户名无效');
    });
  }

  showUsernameModalIfNeeded() {
    if (!this.username || !this.username.trim()) {
      this.showUsernameModal();
    } else {
      const disp = document.getElementById('username-display');
      if (disp) disp.textContent = `用户名: ${this.username}`;
      const joinBtn = document.getElementById('join-create-btn');
      if (joinBtn) joinBtn.disabled = false;
    }
  }

  showUsernameModal() {
    const modal = document.createElement('div');
    modal.id = 'username-modal';
    modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);z-index:3000;';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:#222;padding:24px;border-radius:8px;min-width:300px;color:#fff;text-align:center;';
    const h = document.createElement('h2'); h.textContent = '请输入用户名'; h.style.marginBottom = '12px';
    const inp = document.createElement('input'); inp.type='text'; inp.maxLength=12; inp.placeholder='显示名（最多12字符）';
    inp.style.cssText = 'padding:10px;width:100%;margin-bottom:12px;font-size:16px;';
    const btn = document.createElement('button'); btn.textContent='保存并继续'; btn.style.cssText = 'padding:10px 16px;background:#4CAF50;border:none;color:#fff;cursor:pointer;';
    const info = document.createElement('div'); info.style.cssText='color:#ddd;font-size:12px;margin-top:10px;'; info.textContent='该名称会保存在本地，仅用于房间显示';

    wrap.appendChild(h); wrap.appendChild(inp); wrap.appendChild(btn); wrap.appendChild(info);
    modal.appendChild(wrap);
    document.body.appendChild(modal);

    inp.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') btn.click(); });

    btn.addEventListener('click', () => {
      const v = inp.value.trim();
      if (!v) {
        info.textContent = '用户名不能为空';
        return;
      }
      this.username = v;
      localStorage.setItem('generals_username', v);
      const disp = document.getElementById('username-display');
      if (disp) disp.textContent = `用户名: ${v}`;
      const joinBtn = document.getElementById('join-create-btn');
      if (joinBtn) joinBtn.disabled = false;
      document.body.removeChild(modal);
      this.showMessage('用户名已保存');
    });

    modal.addEventListener('click', (e) => { if (e.target === modal) { inp.focus(); } });
    inp.focus();
  }

  hideGameElements() {
    const elTurn = document.getElementById('turn-counter');
    const elLeaderboard = document.getElementById('game-leaderboard');
    const elGrid = document.getElementById('grid');
    if (elTurn) elTurn.style.display = 'none';
    if (elLeaderboard) elLeaderboard.style.display = 'none';
    if (elGrid) elGrid.style.display = 'none';
  }

  showGameElements() {
    const elTurn = document.getElementById('turn-counter');
    const elLeaderboard = document.getElementById('game-leaderboard');
    const elGrid = document.getElementById('grid');
    
    if (elTurn) {
      elTurn.style.display = 'flex';
    }
    if (elLeaderboard) {
      elLeaderboard.style.display = 'block';
    }
    if (elGrid) {
      // 修复：确保棋盘完全可见
      elGrid.style.display = 'grid';
      elGrid.style.visibility = 'visible';
      elGrid.style.opacity = '1';
      elGrid.style.position = 'relative';
      elGrid.style.zIndex = '10';
    } else {
      // 尝试重新获取棋盘元素
      this.gridElement = document.getElementById('grid');
      if (this.gridElement) {
        this.showGameElements();
      }
    }
  }

  initUI() {
    const gameContainer = document.querySelector('.container');

    this.roomUI = document.createElement('div');
    this.roomUI.id = 'room-ui';
    this.roomUI.innerHTML = `
      <div class="room-section">
        <div id="username-display">用户名: ${this.username}</div>
        <input type="text" id="room-id-input" placeholder="输入房间ID (4位小写英文字母)" maxlength="4">
        <button id="join-create-btn">加入房间</button>
      </div>
    `;
    gameContainer.insertBefore(this.roomUI, gameContainer.firstChild);

    this.readyButton = document.createElement('button');
    this.readyButton.id = 'ready-btn';
    this.readyButton.textContent = '准备';
    this.readyButton.style.display = 'none';
    gameContainer.appendChild(this.readyButton);
    
    this.settingsButton = document.getElementById('settings-btn');

    const joinCreateBtn = document.getElementById('join-create-btn');
    joinCreateBtn.addEventListener('click', () => this.joinOrCreateRoom());
    if (!this.username || !this.username.trim()) joinCreateBtn.disabled = true;

    this.readyButton.addEventListener('click', () => this.playerReady());
    this.settingsButton.addEventListener('click', () => this.showSettings());

    const pathRoomId = (window.location.pathname || '/').replace(/\//g, '');
    if (pathRoomId && pathRoomId.length === 4 && /^[a-z]{4}$/.test(pathRoomId)) {
      document.getElementById('room-id-input').value = pathRoomId;
    }

    // --- 修改：优化的事件绑定逻辑 ---
    if (!this.gridElement) this.gridElement = document.getElementById('grid');
    
    if (this.gridElement) {
        // 关键 1: 启用硬件加速和禁止双击缩放
        this.gridElement.style.touchAction = 'manipulation';
        
        // 关键 2: 使用 pointerup 提升点击响应速度
        // 移除旧的监听器以防重复绑定 (如果这是热更新)
        if (this._boundGridHandler) {
            this.gridElement.removeEventListener('pointerup', this._boundGridHandler);
        }
        
        this._boundGridHandler = this.handleGridClick.bind(this);
        this.gridElement.addEventListener('pointerup', this._boundGridHandler);
    }
  }

  setupEventListeners() {
    this.socket.on('roomCreated', (data) => this.handleRoomCreated(data));
    this.socket.on('roomJoined', (data) => this.handleRoomJoined(data));
    this.socket.on('roomLobbyUpdate', (data) => this.renderLobbyList(data));
    this.socket.on('gameStart', (data) => this.handleGameStart(data));
    this.socket.on('tileSelected', (data) => this.handleTileSelected(data));
    this.socket.on('armyMoved', (data) => this.handleArmyMoved(data));
    this.socket.on('armySplit', (data) => this.handleArmySplit(data));
    this.socket.on('armyIncreased', (data) => this.handleArmyIncreased(data));
    this.socket.on('turnEnded', (data) => this.handleTurnEnded(data));
    this.socket.on('gameOver', (data) => this.handleGameOver(data));
    this.socket.on('roomFull', () => this.showMessage('房间已满'));
    this.socket.on('roomNotFound', () => this.showMessage('房间不存在'));
    this.socket.on('invalidRoomId', () => {
      this.showMessage('房间ID必须是4位小写字母');
      try { window.history.pushState({}, '', '/'); } catch(e) {}
    });
    
    // 新增：游戏已开始事件处理
    this.socket.on('gameAlreadyStarted', () => {
      this.showMessage('游戏已开始，无法加入该房间');
      this.hasJoinedRoom = false;
      const joinBtn = document.getElementById('join-create-btn');
      if (joinBtn) joinBtn.disabled = false;
    });

    // --- 修改: setupEventListeners 中的 serverShutdown 处理 ---
    this.socket.on('serverShutdown', (data) => {
      // 移除之前的自动 window.close，因为现代浏览器通常会拦截非脚本打开的窗口关闭请求
      this.showShutdownModal();
    });
    
    // 新增：玩家被击败事件
    this.socket.on('playerDefeated', (data) => this.handlePlayerDefeated(data));

    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    window.addEventListener('resize', () => { if (this.gameStarted) this.renderGrid(); });
  }
  showShutdownModal() {
    const existing = document.getElementById('shutdown-modal');
    if (existing) return;

    const modal = document.createElement('div');
    modal.id = 'shutdown-modal';
    modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:9999;backdrop-filter:blur(5px);';
    
    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:#222;padding:30px;border-radius:12px;min-width:320px;color:#fff;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid #444;';
    
    const icon = document.createElement('div');
    icon.innerHTML = '⚠️';
    icon.style.fontSize = '48px';
    icon.style.marginBottom = '16px';

    const h = document.createElement('h2'); 
    h.textContent = '服务器已断开'; 
    h.style.marginBottom = '12px';
    
    const p = document.createElement('p'); 
    p.textContent = '服务器已停止运行或正在维护。'; 
    p.style.cssText = 'color:#bbb;margin-bottom:24px;line-height:1.5;';

    const btn = document.createElement('button'); 
    btn.textContent = '关闭页面'; 
    btn.style.cssText = 'padding:12px 24px;background:#e74c3c;border:none;color:#fff;cursor:pointer;border-radius:6px;font-size:16px;font-weight:bold;transition:background 0.2s;';
    btn.onmouseover = () => btn.style.background = '#c0392b';
    btn.onmouseout = () => btn.style.background = '#e74c3c';

    
    setTimeout(() => {
      document.body.innerHTML = '';
      document.body.style.background = '#000';
      window.location.href = "about:blank"; 

      window.close();
    }, 200);

    // 尝试关闭页面，如果失败（浏览器限制），则跳转空白页
    btn.addEventListener('click', () => {
      // 1. 尝试标准关闭
      try {
        window.close();
      } catch(e) {}

      // 2. 如果上面没生效（大多数情况），提示用户手动关闭或跳转
      setTimeout(() => {
        document.body.innerHTML = '';
        document.body.style.background = '#000';
        const msg = document.createElement('div');
        msg.textContent = '您可以直接关闭此标签页。';
        msg.style.cssText = 'color:#fff;text-align:center;margin-top:100px;font-family:sans-serif;';
        document.body.appendChild(msg);
        
        // 可选：跳转到空白页
        window.location.href = "about:blank"; 
      }, 300);
    });

    wrap.appendChild(icon);
    wrap.appendChild(h);
    wrap.appendChild(p);
    wrap.appendChild(btn);
    modal.appendChild(wrap);
    document.body.appendChild(modal);
  }

  renderLobbyList(data) {
    const { players, maxPlayers } = data;
    const leaderboardBody = document.getElementById('leaderboard-body');
    if (!leaderboardBody) return;

    leaderboardBody.innerHTML = ''; // 清空现有列表

    for (let i = 1; i <= maxPlayers; i++) {
      const player = players[i];
      const row = document.createElement('tr');

      if (player) {
        // 玩家槽位已占用
        const nameCell = document.createElement('td');
        nameCell.className = 'leaderboard-name';
        nameCell.textContent = player.name;        
        // 修改：直接使用服务器发送的颜色
        nameCell.style.backgroundColor = player.color || '#888'; 

        const armyCell = document.createElement('td');
        armyCell.className = 'in-game-col';

        const tilesCell = document.createElement('td');
        tilesCell.className = 'in-game-col';

        const statusCell = document.createElement('td');
        statusCell.className = 'pre-game-col';
        if (player.isReady) {
          statusCell.textContent = '✔️ 已准备';
          statusCell.classList.add('player-status-ready');
        } else {
          statusCell.textContent = '⌛ 等待中';
          statusCell.classList.add('player-status-waiting');
        }

        row.appendChild(nameCell);
        row.appendChild(armyCell);
        row.appendChild(tilesCell);
        row.appendChild(statusCell);

      } else {
        // 空槽位
        const nameCell = document.createElement('td');
        nameCell.textContent = `[ 空位 ${i} ]`;
        nameCell.style.color = '#999';

        row.appendChild(nameCell);
        row.appendChild(document.createElement('td')); // army
        row.appendChild(document.createElement('td')); // tiles
        row.appendChild(document.createElement('td')); // status
      }
      leaderboardBody.appendChild(row);
    }
  }

  joinOrCreateRoom() {
    if (this.hasJoinedRoom) {
      this.showMessage('您已加入房间，无法重复操作');
      return;
    }

    const input = document.getElementById('room-id-input');
    const roomId = (input.value || '').trim();
    if (!roomId) { this.showMessage('请输入有效的房间ID'); return; }
    if (!/^[a-z]{4}$/.test(roomId)) {
      this.showMessage('房间ID必须是4位小写字母');
      try { window.history.pushState({}, '', '/'); } catch(e) {}
      return;
    }
    try { window.history.pushState({}, '', `/${roomId}`); } catch(e) {}
    if (!this.username || !this.username.trim()) { this.showMessage('请先输入用户名'); this.showUsernameModal(); return; }
    
    this.hasJoinedRoom = true;
    const joinBtn = document.getElementById('join-create-btn');
    if (joinBtn) joinBtn.disabled = true;
    this.socket.emit('joinRoom', { roomId, username: this.username });
  }

  //game.js
  // 修复 playerReady 方法，确保传递正确的参数
  playerReady() {
    if (!this.roomId || !this.playerId) { this.showMessage('请先创建或加入房间'); return; }
    if (!this.username || !this.username.trim()) { this.showMessage('请先设置用户名'); this.showUsernameModal(); return; }
    // 修复：传递正确的参数格式
    this.socket.emit('playerReady', { 
      roomId: this.roomId, 
      playerId: this.playerId, 
      name: this.username 
    });
    this.readyButton.style.display = 'none';
    // this.showMessage('等待其他玩家准备...');
  }

  // 修改 showSettings 方法中的事件监听
  showSettings() {
    const existing = document.getElementById('settings-modal');
    if (existing) return;

    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:2000;background:rgba(0,0,0,0.7);';

    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background:#333;padding:30px;text-align:center;max-width:400px;width:80%;border-radius:10px;';
    
    // 阻止点击内容区域时事件冒泡到modal
    modalContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    const heading = document.createElement('h2'); 
    heading.textContent = '设置'; 
    heading.style.cssText = 'color:#fff;margin-bottom:15px;';
    
    const usernameLabel = document.createElement('label');
    usernameLabel.textContent = '用户名:'; 
    usernameLabel.style.cssText = 'color:#fff;display:block;margin-bottom:5px;text-align:left;';
    
    const usernameInput = document.createElement('input');
    usernameInput.type = 'text'; 
    usernameInput.value = this.username; 
    usernameInput.maxLength = 12; 
    usernameInput.style.cssText = 'width:100%;padding:10px;margin-bottom:15px;font-size:16px;';

    const btnWrap = document.createElement('div'); 
    btnWrap.style.display='flex'; 
    btnWrap.style.gap='10px'; 
    btnWrap.style.justifyContent='center';
    
    const saveButton = document.createElement('button'); 
    saveButton.textContent='保存'; 
    saveButton.style.cssText='padding:10px 20px;background:#4CAF50;color:#fff;border:none;cursor:pointer;font-size:16px;flex:1;';
    
    const cancelButton = document.createElement('button'); 
    cancelButton.textContent='取消'; 
    cancelButton.style.cssText='padding:10px 20px;background:#f44336;color:#fff;border:none;cursor:pointer;font-size:16px;flex:1;';

    btnWrap.appendChild(saveButton); 
    btnWrap.appendChild(cancelButton);
    modalContent.appendChild(heading); 
    modalContent.appendChild(usernameLabel); 
    modalContent.appendChild(usernameInput); 
    modalContent.appendChild(btnWrap);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    saveButton.addEventListener('click', () => {
      const newUsername = usernameInput.value.trim();
      if (newUsername) {
        this.username = newUsername;
        localStorage.setItem('generals_username', newUsername);
        const disp = document.getElementById('username-display'); 
        if (disp) disp.textContent = `用户名: ${newUsername}`;
        document.body.removeChild(modal);
        this.showMessage('用户名已保存');
        const joinBtn = document.getElementById('join-create-btn');
        if (joinBtn) joinBtn.disabled = false;
      } else {
        this.showMessage('用户名不能为空');
      }
    });
    
    cancelButton.addEventListener('click', () => document.body.removeChild(modal));
  }

  handleGridClick(e) {
    // 阻止默认行为，防止某些浏览器触发双击缩放或选中文字
    e.preventDefault(); 

    const tileEl = e.target.closest('.tile');
    if (!tileEl) return;

    // 直接从 dataset 读取显示坐标 (我们在 renderGrid 里存了 dx, dy)
    // 这样不用依赖复杂的 DOM 结构计算
    const dx = parseInt(tileEl.dataset.dx, 10);
    const dy = parseInt(tileEl.dataset.dy, 10);

    if (isNaN(dx) || isNaN(dy)) return;

    this.handleTileClick(dx, dy);
  }

  handleRoomCreated(data) {
    this.playerId = data.playerId;
    this.roomId = data.roomId;
    try { window.history.pushState({}, '', `/${data.roomId}`); } catch(e) {}
    this.showMessage(`房间已创建！房间ID: ${data.roomId}，请等待其他玩家加入。`);
    this.readyButton.style.display = 'block';
    const elLeaderboard = document.getElementById('game-leaderboard');
    if (elLeaderboard) {
      elLeaderboard.style.display = 'block';
    }
    console.log(`房间创建成功，ID: ${data.roomId}, 玩家ID: ${data.playerId}`);
  }

  // 修改handlePlayerDefeated方法
  handlePlayerDefeated(data) {
    // 标记玩家为被击败状态
    this.defeated = true;
    this.selectedTile = null;
    
    // 更新游戏状态，显示完整地图
    if (data.grid) this.tileStatus = data.grid;
    if (data.stats) this.stats = data.stats;

    // 如果没有提供视野，则显示所有格子
    this.vision = new Set();
    for (let i = 0; i < this.GRID_SIZE; i++) {
      for (let j = 0; j < this.GRID_SIZE; j++) {
        this.vision.add(`${i},${j}`);
      }
    }
    
    this.renderGrid();
    this.updateStats();
  }

  handleRoomJoined(data) {
    this.playerId = data.playerId;
    this.roomId = data.roomId;
    // this.showMessage(`已加入房间 ${data.roomId}，请准备游戏`);
    this.readyButton.style.display = 'block';
    const elLeaderboard = document.getElementById('game-leaderboard');
    if (elLeaderboard) {
      elLeaderboard.style.display = 'block';
    }
    console.log(`加入房间成功，ID: ${data.roomId}, 玩家ID: ${data.playerId}`);
  }
  
  transformCoordinate(x, y, reverse = false) {
    const size = this.GRID_SIZE;
    let tx = x, ty = y;
    
    if (reverse) {
      // 反向变换：从显示坐标转回原始坐标
      switch (this.visionTransform) {
        case 1: // 逆时针旋转90（对应正向的顺时针90）
          [tx, ty] = [y, size - 1 - x];
          break;
        case 2: // 旋转180
          [tx, ty] = [size - 1 - x, size - 1 - y];
          break;
        case 3: // 逆时针旋转270（对应正向的顺时针270）
          [tx, ty] = [size - 1 - y, x];
          break;
        case 4: // 上下翻转
          [tx, ty] = [x, size - 1 - y];
          break;
        case 5: // 水平翻转
          [tx, ty] = [size - 1 - x, y];
          break;
        case 6: // 上下水平翻转
          [tx, ty] = [size - 1 - x, size - 1 - y];
          break;
        // case 0 不变，不需要处理
      }
    } else {
      // 正向变换：从原始坐标转到显示坐标
      switch (this.visionTransform) {
        case 1: // 顺时针旋转90
          [tx, ty] = [size - 1 - y, x];
          break;
        case 2: // 旋转180
          [tx, ty] = [size - 1 - x, size - 1 - y];
          break;
        case 3: // 顺时针旋转270
          [tx, ty] = [y, size - 1 - x];
          break;
        case 4: // 上下翻转
          [tx, ty] = [x, size - 1 - y];
          break;
        case 5: // 水平翻转
          [tx, ty] = [size - 1 - x, y];
          break;
        case 6: // 上下水平翻转
          [tx, ty] = [size - 1 - x, size - 1 - y];
          break;
        // case 0 不变，不需要处理
      }
    }
    
    return { x: tx, y: ty };
  }

  // 在Game类中修改splitArmy方法
  splitArmy(x, y) {
    if (this.gameOver || !this.gameStarted) return;
    
    const tile = this.tileStatus[x][y];
    if (!tile || tile.owner !== this.playerId || tile.army <= 1) return;
    
    // 分兵前清空该格子的所有移动计划
    const sourceKey = `${x},${y}`;
    if (this.player.pendingMoves.has(sourceKey)) {
      // 从moveQueue中移除所有相关的移动
      this.player.moveQueue = this.player.moveQueue.filter(m => 
        m.source.x !== x || m.source.y !== y);
      // 从pendingMoves中移除
      this.player.pendingMoves.delete(sourceKey);
    }
    
    // 发送分兵请求到服务器
    this.socket.emit('splitArmy', {
      roomId: this.roomId,
      playerId: this.playerId,
      x, y
    });
  }

  // 添加显示分兵指示器的方法
  showSplitIndicator(x, y, amount) {
    const tileElement = this.gridElement.querySelector(`[data-x="${x}"][data-y="${y}"]`);
    if (!tileElement) return;
    
    const indicator = document.createElement('div');
    indicator.className = 'split-indicator';
    indicator.textContent = `50% (${amount})`;
    indicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 10px;
      z-index: 5;
    `;
    
    tileElement.appendChild(indicator);
    
    // 2秒后移除指示器
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 2000);
  }

  handleTileSelected(data) {
    if (this.tileStatus && this.tileStatus[data.x] && this.tileStatus[data.x][data.y]) {
      this.selectedTile = this.tileStatus[data.x][data.y];
    } else {
      this.selectedTile = { x: data.x, y: data.y };
    }
    this.renderGrid();
  }

  handleArmyMoved(data) {
    if (data.source && data.target) {
      if (this.tileStatus[data.source.x] && this.tileStatus[data.source.x][data.source.y]) {
        this.tileStatus[data.source.x][data.source.y] = data.source;
      }
      if (this.tileStatus[data.target.x] && this.tileStatus[data.target.x][data.target.y]) {
        this.tileStatus[data.target.x][data.target.y] = data.target;
      }
    } else if (data.grid) {
      this.tileStatus = data.grid;
    }
    if (data.stats) this.stats = data.stats;
    if (data.vision) this.vision = new Set(data.vision);

    if (this.selectedTile) {
      const x = this.selectedTile.x;
      const y = this.selectedTile.y;
      if (this.tileStatus[x] && this.tileStatus[x][y]) {
        this.selectedTile = this.tileStatus[x][y];
      }
    }

    this.renderGrid();
    this.updateStats();
  }

  // 添加handleArmySplit方法
  handleArmySplit(data) {
    if (data.grid) this.tileStatus = data.grid;
    if (data.stats) this.stats = data.stats;
    if (data.vision) this.vision = new Set(data.vision);
    
    // 更新选中格子的状态
    if (this.selectedTile && this.selectedTile.x === data.x && this.selectedTile.y === data.y) {
      this.selectedTile.army = data.newArmy;
    }
    
    this.renderGrid();
    this.updateStats();
  }

  handleArmyIncreased(data) {
    if (data.grid) this.tileStatus = data.grid;
    if (data.stats) this.stats = data.stats;
    if (data.vision) this.vision = new Set(data.vision);
    this.renderGrid();
    this.updateStats();
  }

  handleGameStart(data) {
    if (!data || !data.grid || !data.gridSize) {
      console.error('错误: gameStart 数据不完整!', data);
      this.showMessage('游戏数据错误，无法开始');
      return;
    }

    // 确保使用服务器传来的视角变换
    this.visionTransform = data.visionTransform !== undefined ? data.visionTransform : 0;
    
    console.log(`玩家 ${data.playerId} 的视角变换: ${this.visionTransform}`);
    
    document.body.classList.add('game-started');
    
    this.gameStarted = true;
    this.gameOver = false;
    this.defeated = false;
    this.tileStatus = data.grid;
    this.GRID_SIZE = data.gridSize;
    this.vision = new Set(data.vision || []);
    this.stats = data.stats || {};
    
    // 修复：确保初始回合数正确设置
    this.currentTurn = (data.stats && data.stats.turn) ? data.stats.turn : 1;
    
    this.playerId = data.playerId;
    this.player = new Player(this, data.playerId);
    this.allPlayerColors = data.colors || {};
    this.playerColor = this.allPlayerColors[this.playerId] || 'rgb(39,146,255)';
    
    if (this.roomUI) this.roomUI.style.display = 'none';
    if (this.readyButton) this.readyButton.style.display = 'none';
    
    this.showGameElements();
    
    requestAnimationFrame(() => {
      this.renderGrid();
      this.updateStats(); // 确保初始回合数显示
    });
  }

  // 修复 handleTurnEnded 方法，确保正确更新回合数
  handleTurnEnded(data) {
    if (data.grid) this.tileStatus = data.grid;
    if (data.stats) this.stats = data.stats;
    
    // 修复：确保正确更新当前回合数
    if (data.stats && data.stats.turn) {
      this.currentTurn = data.stats.turn;
    }
    
    if (data.vision) this.vision = new Set(data.vision);

    // 更新统计显示，包括回合数
    this.updateStats();
    this.renderGrid();
  }

  handleGameOver(data) {
    console.log("game over!!!");
    
    this.gameOver = true;
    if (this.player) {
      this.player.clearMoves();
      this.player.stopMoveInterval();
    }
    
    // 更新最终的游戏状态
    if (data.grid) this.tileStatus = data.grid;
    if (data.stats) this.stats = data.stats;
    
    // 游戏结束后显示完整地图
    if (data.vision) {
      this.vision = new Set(data.vision);
    } else {
      // 如果没有提供视野，则显示所有格子
      this.vision = new Set();
      for (let i = 0; i < this.GRID_SIZE; i++) {
        for (let j = 0; j < this.GRID_SIZE; j++) {
          this.vision.add(`${i},${j}`);
        }
      }
    }
    
    const winnerName = data.winner === this.playerId ? '你' : '对手';
    this.showGameOver(`${winnerName}赢得了游戏！`);
    
    // 重新渲染棋盘以显示最终状态
    this.renderGrid();
    this.updateStats();
    
    // 新增：移除body的类名以恢复大厅视图
    document.body.classList.remove('game-started');

    // 重置游戏状态，但保持界面显示
    this.gameStarted = false;
    this.hasJoinedRoom = false;
  }

  showMessage(message) {
    this.statusMessage.textContent = message;
    this.statusMessage.style.display = 'block';
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => { this.statusMessage.style.display = 'none'; }, 3000);
  }
  
  renderGrid() {
    if (!this.gridElement) return;
    
    // 1. 基础布局计算 (保持不变)
    const availableWidth = window.innerWidth - 170;
    const availableHeight = window.innerHeight - 120;
    const minDimension = Math.min(availableHeight, availableWidth);
    let tileSize = Math.floor(minDimension / this.GRID_SIZE);
    if (tileSize < 1) tileSize = 1;
    const boardSize = tileSize * this.GRID_SIZE;

    this.gridElement.style.display = 'grid';
    this.gridElement.style.gridTemplateColumns = `repeat(${this.GRID_SIZE}, ${tileSize}px)`;
    this.gridElement.style.width = `${boardSize}px`;
    this.gridElement.style.height = `${boardSize}px`;

    // 2. 初始化 DOM 缓存 (如果尺寸变了或未初始化)
    if (!this.domGrid || this.domGrid.length !== this.GRID_SIZE) {
        this.gridElement.innerHTML = ''; // 仅在初始化时清空一次
        this.domGrid = new Array(this.GRID_SIZE).fill(0).map(() => new Array(this.GRID_SIZE).fill(null));
    }

    // 3. 增量更新循环
    for (let i = 0; i < this.GRID_SIZE; i++) {
        for (let j = 0; j < this.GRID_SIZE; j++) {
            // 获取逻辑坐标
            const { x: origX, y: origY } = this.transformCoordinate(i, j, true);
            const originalTile = this.tileStatus[origX]?.[origY]; // 安全访问

            // 如果数据错乱，跳过以防报错
            if (!originalTile) continue;

            // --- A. 获取或创建 DOM 节点 ---
            let tileEl = this.domGrid[i][j];
            if (!tileEl) {
                tileEl = document.createElement('div');
                tileEl.className = 'tile';
                // 保存显示坐标用于点击事件
                tileEl.dataset.dx = i; 
                tileEl.dataset.dy = j;
                
                // 内部结构：一次性创建，后续只改属性
                // 结构：背景层(owner) -> 内容层(数字) -> 图标层(城市) -> 箭头层
                tileEl.innerHTML = `
                    <div class="owner-overlay" style="pointer-events:none;position:absolute;inset:0;"></div>
                    <div class="city-icon" style="pointer-events:none;position:absolute;inset:0;background-size:contain;background-repeat:no-repeat;background-position:center;"></div>
                    <div class="tile-content" style="pointer-events:none;position:relative;z-index:3;font-weight:bold;"></div>
                    <div class="arrow-layer" style="pointer-events:none;position:absolute;inset:0;z-index:5;"></div>
                `;
                
                this.gridElement.appendChild(tileEl);
                this.domGrid[i][j] = tileEl;
            }

            // --- B. 更新样式 (不销毁节点) ---
            tileEl.style.width = `${tileSize}px`;
            tileEl.style.height = `${tileSize}px`;
            tileEl.style.fontSize = `${Math.max(8, tileSize * 0.5)}px`;

            // 获取子元素引用
            const overlay = tileEl.children[0];
            const cityIcon = tileEl.children[1];
            const content = tileEl.children[2];
            const arrowLayer = tileEl.children[3];

            // 重置基础状态
            tileEl.className = 'tile';
            tileEl.style.backgroundImage = '';
            tileEl.style.backgroundColor = '';
            overlay.style.backgroundColor = 'transparent';
            cityIcon.style.backgroundImage = '';
            content.textContent = '';
            arrowLayer.innerHTML = ''; 

            const key = `${origX},${origY}`;
            const isVisible = this.vision.has(key) || this.defeated || this.gameOver;

            // --- 渲染地形和单位 (受视野限制) ---
            if (isVisible) {
                tileEl.classList.add('in-sight');
                
                if (originalTile.type === 'mountain') {
                    tileEl.classList.add('mountain');
                    tileEl.style.backgroundImage = 'url("/img/mountain.png")';
                    tileEl.style.backgroundColor = '#bbbbbb';
                } else {
                    // 所有者颜色
                    if (originalTile.owner !== 0) {
                        const color = this.allPlayerColors[originalTile.owner] || '#888';
                        overlay.style.backgroundColor = color;
                    } else if (originalTile.isCity) {
                        tileEl.style.backgroundColor = '#808080';
                    } else {
                        tileEl.style.backgroundColor = '#dcdcdc';
                    }

                    // 城市/皇冠图标
                    if (originalTile.isCity) {
                        const iconUrl = originalTile.isCapital ? '/img/crown.png' : '/img/city.png';
                        cityIcon.style.backgroundImage = `url("${iconUrl}")`;
                    }

                    // 数字显示
                    if (originalTile.army > 0) {
                        content.textContent = originalTile.army;
                    } else if (originalTile.owner === 0 && originalTile.isCity) {
                        content.textContent = originalTile.captureCost || '';
                    }
                }
            } else {
                // 迷雾区域
                tileEl.style.backgroundColor = '#606060'; // 灰色迷雾
                // 即使在迷雾中，如果是已知的山脉或障碍，也可以显示特定纹理（可选）
                if (originalTile.type === 'mountain') {
                    // 如果需要让迷雾中的山脉看起来不同，可以在这里处理
                    tileEl.style.backgroundImage = 'url("/img/obstacle.png")';
                } else if (originalTile.isCity && !originalTile.isCapital) {
                     tileEl.style.backgroundImage = 'url("/img/obstacle.png")';
                }
            }

            // --- 修改点 3: 箭头渲染移出 isVisible 判断 (视野外也能看到移动计划) ---
            if (this.player && this.player.pendingMoves) {
                const moves = this.player.pendingMoves.get(key);
                if (moves) {
                    const moveList = Array.isArray(moves) ? moves : [moves];
                    moveList.forEach(m => {
                        const arr = document.createElement('div');
                        arr.className = 'arrow'; // 确保 CSS 中有 .arrow 样式
                        arr.textContent = m.arrow;
                        arr.style.position = 'absolute';
                        arr.style.left = '50%'; arr.style.top = '50%';
                        arr.style.transform = 'translate(-50%, -50%)';
                        arr.style.color = '#fff';
                        arr.style.textShadow = '0 0 2px #000';
                        arr.style.zIndex = '10'; // 确保箭头浮在迷雾上方
                        arrowLayer.appendChild(arr);
                    });
                }
            }

            // 选中高亮 (保持在最后)
            if (this.selectedTile && this.selectedTile.x === origX && this.selectedTile.y === origY) {
                tileEl.classList.add('selected');
            }
        }
    }
  }

  handleTileClick(displayX, displayY) {
    const originalCoord = this.transformCoordinate(displayX, displayY, true);
    const origX = originalCoord.x;
    const origY = originalCoord.y;
    
    const key = `${origX},${origY}`;
    // 判断该格子是否在当前视野内
    const isVisible = this.vision.has(key) || this.defeated || this.gameOver;
    
    const originalTile = this.tileStatus[origX] && this.tileStatus[origX][origY];
    if (!originalTile) return;

    // 逻辑核心：
    // 1. 如果格子可见 且 是山脉 -> 不可选中（就像它是墙一样）
    // 2. 如果格子不可见（迷雾） -> 即使它是山脉，玩家也不知道，所以允许选中/尝试交互
    if (isVisible && originalTile.type === 'mountain') {
      return;
    }
    // --- 修复结束 ---
    
    // 逻辑处理：点击选中或取消选中
    if (this.selectedTile && this.selectedTile.x === origX && this.selectedTile.y === origY) {
      this.selectedTile = null;
    } else {
      this.selectedTile = {
        x: origX, y: origY, // ...
        // 注意：如果是迷雾中的格子，这里获取到的 info 可能是过期的，但这符合游戏逻辑
        // 玩家基于“以为”的信息进行操作
        owner: originalTile.owner,
        army: originalTile.army,
        type: originalTile.type,
        isCity: originalTile.isCity,
        isCapital: originalTile.isCapital
      };
    }

    // --- 修改点 2: 立即更新 DOM 样式，不等待 renderGrid (消除视觉延迟) ---
    // 1. 移除旧的选中高亮
    const prevSelected = this.gridElement.querySelector('.tile.selected');
    if (prevSelected) {
      prevSelected.classList.remove('selected');
    }

    // 2. 如果当前有选中目标，立即添加高亮
    if (this.selectedTile) {
      // 直接使用传入的 displayX/Y 找到对应的 DOM 元素
      if (this.domGrid[displayX] && this.domGrid[displayX][displayY]) {
        this.domGrid[displayX][displayY].classList.add('selected');
      }
    }
    
    // 发送选中事件给服务器（如果需要同步）
    this.socket.emit('selectTile', { roomId: this.roomId, playerId: this.playerId, x: origX, y: origY });

    // 依然调用 renderGrid 以保证数据一致性，但视觉上已经先行一步
    // this.renderGrid(); // 可选：如果觉得闪烁可以注释掉这一行，依靠 socket 回调更新
  }

  updateStats() {
    if (!this.stats) return;
    
    // 修复：确保回合数元素存在并更新显示
    const turnNumberElement = document.getElementById('turn-number');
    if (turnNumberElement) {
      turnNumberElement.textContent = this.currentTurn;
    }
    
    const playersArr = [];
    if (this.stats.players) {
      for (const pid in this.stats.players) {
        const p = this.stats.players[pid];
        playersArr.push({ ...p, id: Number(pid) });
      }
    }
    
    playersArr.sort((a, b) => (b.army !== a.army) ? b.army - a.army : b.tiles - a.tiles);
    
    const leaderboardBody = document.getElementById('leaderboard-body');
    if (leaderboardBody) {
      leaderboardBody.innerHTML = '';
      
      playersArr.forEach((player, index) => {
        const row = document.createElement('tr');
        
        const nameCell = document.createElement('td');
        nameCell.className = 'leaderboard-name';
        nameCell.textContent = player.name; // 这里应该显示实际用户名
        
        const color = this.stats.colors && this.stats.colors[player.id]
          ? this.stats.colors[player.id]
          : '#808080';
        nameCell.style.backgroundColor = color;
        
        const armyCell = document.createElement('td');
        armyCell.textContent = player.army;
        
        const tilesCell = document.createElement('td');
        tilesCell.textContent = player.tiles;
        
        row.appendChild(nameCell);
        row.appendChild(armyCell);
        row.appendChild(tilesCell);
        leaderboardBody.appendChild(row);
      });
    }
  }

  showGameOver(message) {
    const existing = document.getElementById('game-over-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'game-over-modal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center; z-index: 2000;
      background: rgba(0,0,0,0.7);
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `background:#333;padding:30px;text-align:center;max-width:400px;width:80%;border-radius:10px;`;

    const heading = document.createElement('h2');
    heading.textContent = '游戏结束';
    heading.style.cssText = 'color:#fff;margin-bottom:15px;';

    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.style.cssText = 'color:#fff;font-size:18px;margin-bottom:20px;';

    const btnWrap = document.createElement('div');
    btnWrap.style.display = 'flex'; btnWrap.style.gap = '10px'; btnWrap.style.justifyContent = 'center';

    const restartButton = document.createElement('button');
    restartButton.id = 'restart-button';
    restartButton.textContent = '重新开始';
    restartButton.style.cssText = 'padding:10px 20px;background:#4CAF50;color:#fff;border:none;cursor:pointer;font-size:16px;';

    const closeButton = document.createElement('button');
    closeButton.id = 'close-button';
    closeButton.textContent = '关闭';
    closeButton.style.cssText = 'padding:10px 20px;background:#f44336;color:#fff;border:none;cursor:pointer;font-size:16px;';

    btnWrap.appendChild(restartButton); btnWrap.appendChild(closeButton);
    modalContent.appendChild(heading); modalContent.appendChild(messageEl); modalContent.appendChild(btnWrap);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    restartButton.addEventListener('click', () => { document.body.removeChild(modal); location.reload(); });
    closeButton.addEventListener('click', () => document.body.removeChild(modal));
  }

handleKeyDown(e) {
  // 新增：如果玩家被击败，不响应任何键盘操作
  if (this.defeated) return;
  
  if (!this.selectedTile || this.gameOver || !this.gameStarted) return;
  
    const key = e.key.toLowerCase();
  
    if(key === 'q') {
      if(this.player) {
        this.player.clearMoves();
      }
      return;
    }
  
    if(key === 'e') {
      if(this.player && this.player.moveQueue.length > 0) {
        const lastMove = this.player.moveQueue.pop();
        const sourceKey = `${lastMove.source.x},${lastMove.source.y}`;
        this.selectedTile =  this.tileStatus[lastMove.source.x][lastMove.source.y]; 
        this.player.pendingMoves.delete(sourceKey);
        this.renderGrid();
      }
      return;
    }
  
    // 在handleKeyDown方法中添加z键处理
    if (key === 'z') {
      if (this.selectedTile && this.selectedTile.owner === this.playerId && this.selectedTile.army > 1) {
        this.splitArmy(this.selectedTile.x, this.selectedTile.y);
      }
      return;
    }
  
    const DIR = {
      'w': { dx: -1, dy: 0, arrow: '↑' }, 'arrowup':    { dx: -1, dy: 0, arrow: '↑' },
      'a': { dx:  0, dy: -1, arrow: '←' }, 'arrowleft':  { dx:  0, dy: -1, arrow: '←' },
      's': { dx:  1, dy: 0, arrow: '↓' }, 'arrowdown':   { dx:  1, dy: 0, arrow: '↓' },
      'd': { dx:  0, dy: 1, arrow: '→' }, 'arrowright':  { dx:  0, dy: 1, arrow: '→' }
    };
  
    if (DIR[key]) {
      e.preventDefault();
      const dir = DIR[key];
      
      if (!this.selectedTile) return;
      
      // 将选中的原始坐标转换为显示坐标
      const displayCoord = this.transformCoordinate(this.selectedTile.x, this.selectedTile.y);
      const displayX = displayCoord.x;
      const displayY = displayCoord.y;
      
      const targetDisplayX = displayX + dir.dx;
      const targetDisplayY = displayY + dir.dy;
      
      // 将目标显示坐标转换回原始坐标
      const targetOriginalCoord = this.transformCoordinate(targetDisplayX, targetDisplayY, true);
      const targetX = targetOriginalCoord.x;
      const targetY = targetOriginalCoord.y;
      
      if (targetX >= 0 && targetX < this.GRID_SIZE && targetY >= 0 && targetY < this.GRID_SIZE) {
        const targetTile = this.tileStatus[targetX][targetY];
        const targetKey = `${targetX},${targetY}`;
        const isTargetVisible = this.vision.has(targetKey) || this.defeated || this.gameOver;
        
        // 移动逻辑核心：
        // 允许移动的条件：
        // 1. 目标完全未知（在迷雾中） -> 允许尝试移动（如果实际上是山脉，服务器或前端executeMove会拦截并消耗移动机会或弹回）
        // 2. 目标可见 且 不是山脉 -> 允许移动
        
        // 如果目标可见 且 是山脉 -> 禁止移动计划
        if (isTargetVisible && targetTile.type === 'mountain') {
            // 撞墙了，什么都不做
            return;
        }

        // 只要不是“可见的山脉”，都允许加入移动队列
        this.player.addMoveToQueue(
          { x: this.selectedTile.x, y: this.selectedTile.y },
          { x: targetX, y: targetY },
          dir.arrow
        );
        
        // 移动选中框体验优化：
        // 即使目标在迷雾中（可能是山脉），我们也先让光标移过去。
        // 等真正执行移动时，如果发现是山脉，兵力不会动，但光标移动不影响。
        this.selectedTile = this.tileStatus[targetX][targetY];
      }

      // 关键优化：快速连按时，本地立即更新选中框位置
      const oldSelectedX = this.selectedTile?.x;
      const oldSelectedY = this.selectedTile?.y;

      this.player.addMoveToQueue(
        { x: this.selectedTile.x, y: this.selectedTile.y },
        { x: targetX, y: targetY },
        dir.arrow
      );
      
      // 立即更新 selectedTile
      this.selectedTile = this.tileStatus[targetX][targetY];
      
      // 仅对这两个格子进行重绘，而不是全盘重绘 (或者调用节流后的 renderGrid)
      this.renderGrid();
    } else if (key === 'h') {
      let capital = null;
      for (let i = 0; i < this.GRID_SIZE; i++) {
        for (let j = 0; j < this.GRID_SIZE; j++) {
          if (this.tileStatus[i][j].isCapital && this.tileStatus[i][j].owner === this.playerId) { capital = this.tileStatus[i][j]; break; }
        }
        if (capital) break;
      }
      if (capital) { 
        // 将原始坐标转换为显示坐标
        const displayCoord = this.transformCoordinate(capital.x, capital.y);
        this.selectedTile = capital; 
        this.renderGrid(); 
      }
    } 
  }  
}

document.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
