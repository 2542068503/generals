//server.js
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);


// 玩家颜色列表（可自由扩展）
const PLAYER_COLORS = [
  'rgb(255, 0, 0)',      // 红色
  'rgb(39, 146, 255)',   // 天蓝色
  'rgb(0, 128, 0)',      // 绿色
  'rgb(0, 128, 128)',    // 青色
  'rgb(250, 140, 1)',    // 橙色
  'rgb(240, 50, 230)',   // 品红色
  'rgb(128, 0, 128)',    // 紫色
  'rgb(155, 1, 1)',      // 暗红色
  'rgb(179, 172, 50)',   // 橄榄绿
  'rgb(154, 94, 36)',    // 棕色
  'rgb(16, 49, 255)',    // 深蓝色
  'rgb(89, 76, 165)',    // 靛蓝
  'rgb(133, 169, 28)',   // 草绿
  'rgb(255, 102, 104)',  // 粉红红
  'rgb(180, 127, 202)',  // 淡紫色
  'rgb(180, 153, 113)'   // 土黄色
];
// 1. `rgb(255, 0, 0)` — 红色
// 2. `rgb(39, 146, 255)` — 天蓝色
// 3. `rgb(0, 128, 0)` — 绿色
// 4. `rgb(0, 128, 128)` — 青色
// 5. `rgb(250, 140, 1)` — 橙色
// 6. `rgb(240, 50, 230)` — 品红色
// 7. `rgb(128, 0, 128)` — 紫色
// 8. `rgb(155, 1, 1)` — 暗红色
// 9. `rgb(179, 172, 50)` — 橄榄绿
// 10. `rgb(154, 94, 36)` — 棕色
// 11. `rgb(16, 49, 255)` — 深蓝色
// 12. `rgb(89, 76, 165)` — 靛蓝
// 13. `rgb(133, 169, 28)` — 草绿
// 14. `rgb(255, 102, 104)` — 粉红红
// 15. `rgb(180, 127, 202)` — 淡紫色
// 16. `rgb(180, 153, 113)` — 土黄色


// 配置设置（直接在代码中配置）
const config = {
  ipBlacklist: [], // 修改为IPv4格式
  ipWhitelist: ["192.168.68.43","192.168.45.95","192.168.45.9","192.168.45.139","192.168.45.104","192.168.45.103","192.168.45.93","192.168.45.108"], // 白名单列表
  whitelistMode: false, // 是否启用白名单模式
  port: 80, // 服务器端口
  forbiddenRedirectUrl: "http://1.1.1.3/disable/disable.htm?url_type=访问网站/未分类&plc_name=机房2仅充许访问特定网站",
  maxPlayers: 8 // <-- 新增：房间最大玩家数（根据需要改成 2/4/6）
};

// 黑名单和白名单管理（使用Set提高查询性能）
const ipBlacklist = new Set(config.ipBlacklist);
const ipWhitelist = new Set(config.ipWhitelist);
const whitelistMode = config.whitelistMode;

function getClientIP(req) {
  let ip = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '';
  if (typeof ip !== 'string') ip = String(ip || '');
  // 处理 ::ffff: 前缀的 IPv4 映射
  if (ip.indexOf('::ffff:') !== -1) {
    ip = ip.split(':').pop();
  }
  // 本地 IPv6 映射为本地 IPv4
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

// 检查IP是否被允许访问
function isIPAllowed(ip) {
  // 如果启用了白名单模式，只允许白名单中的IP
  if (whitelistMode) {
    return ipWhitelist.has(ip);
  }
  
  // 否则，只要不在黑名单中就允许
  return !ipBlacklist.has(ip);
}

// IP检查中间件
function ipCheckMiddleware(req, res, next) {
  const clientIP = getClientIP(req);
  
  if (!isIPAllowed(clientIP)) {
    console.log(`拒绝HTTP请求: IP ${clientIP} 在黑名单中或不在白名单中`);
    return res.status(403).redirect(config.forbiddenRedirectUrl);
  }
  
  next();
}

// 应用IP检查中间件到所有路由
app.use(ipCheckMiddleware);

// 允许跨域
try {
  io.origins('*:*');
} catch (e) {
  console.warn('io.origins set skipped:', e && e.message);
}

// 静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 避免 favicon 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 房间 URL 路由
app.get('/:roomId([a-z]{4})', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 根路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 状态管理
const gameStates = {};
const playerRooms = {};
const playerNames = {};

// 生成 4 位房间号
function generateRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let roomId;
  do {
    roomId = '';
    for (let i = 0; i < 4; i++) roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (gameStates[roomId]);
  return roomId;
}

// Socket连接获取IP的辅助函数
function getSocketIP(socket) {
  let ip = (socket && socket.handshake && socket.handshake.address) || '';
  if (typeof ip !== 'string') ip = String(ip || '');
  if (ip.indexOf('::ffff:') !== -1) {
    ip = ip.split(':').pop();
  }
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

class Game {
  constructor(roomId) {
    this.roomId = roomId;
    this.MAX_PLAYERS = (typeof config.maxPlayers === 'number' ? config.maxPlayers : 2);
    this.numPlayers = 0;  // 新增：实际玩家数，启动时设置
    this.GRID_SIZE = Math.floor(Math.random() * 11) + 20; // 20-30
    this.TILE_TYPES = { PLAIN: 'plain', MOUNTAIN: 'mountain', CITY: 'city' };
    this.PLAYERS = { NONE: 0};  // 动态用 pid
    this.CITY_CAPTURE_RANGE = { min: 46, max: 50 };

    this.tileStatus = [];
    this.gameOver = false;
    this.currentTurn = 1;
    // 移除原 for 循环初始化，只在 initGame 中动态初始化
    this.players = {};
    this.playerNames = {};
    this.playerColors = {};
    this.readyPlayers = {};
    this.moves = {};
    this.selectedTiles = {};

    this.turnTimer = null;
    this.armyIncreaseTimer = null;
    this.capitalIncreaseTimer = null;
    this.lastArmyIncreaseTime = Date.now();
    this.gameStarted = false;
  }

  initGame() {
    if (this.numPlayers < 2) this.numPlayers = 2;
    this.tileStatus = [];
    
    // 确保为每个玩家生成不同的随机视角变换
    this.playerVisionTransforms = {};
    const availableTransforms = [0, 1, 2, 3, 4, 5, 6]; // 所有可能的变换
    const usedTransforms = new Set();
    
    for (let pid = 1; pid <= this.numPlayers; pid++) {
      let transform;
      // 确保每个玩家获得不同的变换
      do {
        transform = Math.floor(Math.random() * 7);
      } while (usedTransforms.has(transform) && usedTransforms.size < Math.min(7, this.numPlayers));
      
      usedTransforms.add(transform);
      this.playerVisionTransforms[pid] = transform;
      console.log(`房间 ${this.roomId} 玩家 ${pid} 的视角变换: ${transform}`);
    }
    
    for (let i = 0; i < this.GRID_SIZE; i++) {
      this.tileStatus[i] = [];
      for (let j = 0; j < this.GRID_SIZE; j++) {
        this.tileStatus[i][j] = {
          type: this.TILE_TYPES.PLAIN,
          army: 0,
          owner: 0,
          isCity: false,
          isCapital: false,
          isSplit: false,
          x: i,
          y: j
        };
      }
    }
  
    // 其他初始化代码保持不变
    for (let pid = 1; pid <= this.numPlayers; pid++) {
      this.playerColors[pid] = PLAYER_COLORS[(pid - 1) % PLAYER_COLORS.length];
      this.readyPlayers[pid] = false;
      this.moves[pid] = [];
      this.selectedTiles[pid] = null;
    }
  
    this.placeCapitals();
    this.ensurePathBetweenCapitals();
    this.addMountains();
    this.placeAdditionalCities(13);
    console.log(`房间 ${this.roomId} 游戏初始化完成，玩家数: ${this.numPlayers}`);
  }

  // 修改 placeCapitals：用 this.numPlayers 代替 this.MAX_PLAYERS
  placeCapitals() {
    const minDistance = Math.floor(this.GRID_SIZE * 0.5);
    const capitals = [];
    let attempts = 0;

    while (capitals.length < this.numPlayers && attempts < 5000) {  // 修改为 this.numPlayers
      attempts++;
      const x = Math.floor(Math.random() * this.GRID_SIZE);
      const y = Math.floor(Math.random() * this.GRID_SIZE);

      let ok = true;
      for (const c of capitals) {
        if (Math.abs(c.x - x) + Math.abs(c.y - y) < minDistance) { ok = false; break; }
      }
      if (!ok) continue;

      capitals.push({ x, y });
    }

    // 简化 fallback，只取前 numPlayers 个
    if (capitals.length < this.numPlayers) {
      const fallback = [
        {x:1, y:1},
        {x:1, y:this.GRID_SIZE-2},
        {x:this.GRID_SIZE-2, y:1},
        {x:this.GRID_SIZE-2, y:this.GRID_SIZE-2},
        {x: Math.floor(this.GRID_SIZE/2), y:1},
        {x: Math.floor(this.GRID_SIZE/2), y:this.GRID_SIZE-2}
      ].slice(0, this.numPlayers);  // 简化

      for (let i = 0; i < this.numPlayers && capitals.length < this.numPlayers; i++) {
        const f = fallback[i];
        if (!capitals.find(c => c.x === f.x && c.y === f.y)) capitals.push(f);
      }
    }

    this.playerCapitals = {};
    for (let pid = 1; pid <= this.numPlayers; pid++) {  // 修改为 this.numPlayers
      const pos = capitals[pid-1];
      if (!pos) continue;
      const { x, y } = pos;
      this.tileStatus[x][y] = {
        type: this.TILE_TYPES.CITY,
        army: 1,
        owner: pid,
        isCity: true,
        isCapital: true,
        x, y,
        captureCost: 0
      };
      this.playerCapitals[pid] = { x, y };
    }
  }

  // 移除 ensurePathBetweenCapitals 中的无用注释，并简化循环（caps.length -1）
  ensurePathBetweenCapitals() {
    const caps = Object.values(this.playerCapitals);  // 简化获取
    for (let k = 0; k < caps.length - 1; k++) {
      const a = caps[k], b = caps[k+1];
      const sx = Math.min(a.x, b.x), ex = Math.max(a.x, b.x);
      const sy = Math.min(a.y, b.y), ey = Math.max(a.y, b.y);

      for (let x = sx; x <= ex; x++) {
        if (this.tileStatus[x][a.y].type === this.TILE_TYPES.MOUNTAIN) this.tileStatus[x][a.y].type = this.TILE_TYPES.PLAIN;
      }
      for (let y = sy; y <= ey; y++) {
        if (this.tileStatus[b.x][y].type === this.TILE_TYPES.MOUNTAIN) this.tileStatus[b.x][y].type = this.TILE_TYPES.PLAIN;
      }
    }
  }

  addMountains() {
    const caps = this.playerCapitals || {};
    for (let i = 0; i < this.GRID_SIZE; i++) {
      for (let j = 0; j < this.GRID_SIZE; j++) {

        // 检查是否靠近任意首都（安全读取）
        let near = false;
        for (let pid = 1; pid <= this.MAX_PLAYERS; pid++) {
          const cap = caps[pid];
          if (cap && Math.abs(i - cap.x) <= 2 && Math.abs(j - cap.y) <= 2) {
            near = true;
            break;
          }
        }
        if (near) continue;

        if (Math.random() <= 0.2) {
          this.tileStatus[i][j].type = this.TILE_TYPES.MOUNTAIN;
        }
      }
    }
  }

  placeAdditionalCities(count) {
    let placed = 0, tries = 0;
    while (placed < count && tries < 2000) {
      tries++;
      const x = Math.floor(Math.random() * this.GRID_SIZE);
      const y = Math.floor(Math.random() * this.GRID_SIZE);

      if (this.tileStatus[x][y].type === this.TILE_TYPES.PLAIN && !this.tileStatus[x][y].isCity) {
        const cost = Math.floor(Math.random() * (this.CITY_CAPTURE_RANGE.max - this.CITY_CAPTURE_RANGE.min + 1)) + this.CITY_CAPTURE_RANGE.min;
        this.tileStatus[x][y] = {
          type: this.TILE_TYPES.CITY,
          army: 0,
          owner: this.PLAYERS.NONE,
          isCity: true,
          isCapital: false,
          x, y,
          captureCost: cost
        };
        placed++;
      }
    }
  }

  checkWinCondition() {
    if (this.gameOver) return null;
  
    const playersAlive = new Set();
    const playersWithCapital = new Set();
  
    for (let pid = 1; pid <= this.numPlayers; pid++) {
      let hasTiles = false;
      for (let i = 0; i < this.GRID_SIZE; i++) {
        for (let j = 0; j < this.GRID_SIZE; j++) {
          const t = this.tileStatus[i][j];
          if (t.owner === pid) {
            hasTiles = true;
            if (t.isCapital) {
              playersWithCapital.add(pid);
            }
          }
        }
      }
      
      // 如果玩家没有领地了，发送完整视野
      if (!hasTiles && this.players[pid]) {
        const socketId = this.players[pid];
        if (socketId) {
          const fullVision = new Set();
          for (let i = 0; i < this.GRID_SIZE; i++) {
            for (let j = 0; j < this.GRID_SIZE; j++) {
              fullVision.add(`${i},${j}`);
            }
          }
          
          io.to(socketId).emit('playerDefeated', {
            winner: null, // 游戏还未完全结束
            stats: this.getStats(),
            grid: this.tileStatus,
            vision: Array.from(fullVision)
          });
          
          // console.log(`玩家 ${pid} 失去所有领地，已发送完整视野`);
        }
      }
      
      if (hasTiles) {
        playersAlive.add(pid);
      }
    }

    // 胜利条件1：只剩一个玩家有领地
    if (playersAlive.size <= 1) {
      this.gameOver = true;
      const winner = playersAlive.values().next().value || null;
      return { winner };
    }

    // 胜利条件2：只剩一个玩家拥有首都
    if (playersWithCapital.size === 1) {
      this.gameOver = true;
      const winner = playersWithCapital.values().next().value;
      return { winner: Number(winner) };
    }

    return null; // 还没有赢家
  }

  moveArmy(source, target, playerId) {
    let movingArmy;
    if (source.isSplit) {
      // 分兵移动：移动一半兵力，向下取整
      movingArmy = Math.floor((source.army - 1) / 2);
      source.isSplit = false; // 重置分兵标志
    } else {
      // 正常移动：移动全部兵力减1
      movingArmy = source.army - 1;
    }
    
    if (movingArmy < 1) return false;
    
    source.army -= movingArmy;
    if (source.army < 1) source.army = 1;

    if (target.owner === this.PLAYERS.NONE && target.isCity) {
      if (movingArmy >= target.captureCost) {
        target.owner = playerId;
        target.army = movingArmy - target.captureCost;
        target.captureCost = 0;
        target.isCity = true;
        if (target.isCapital) {
          target.isCapital = false;
        }
      } else {
        target.captureCost -= movingArmy;
        if (target.captureCost < 1) target.captureCost = 1;
        return true;
      }
    } else if (target.owner === this.PLAYERS.NONE) {
      target.owner = playerId;
      target.army = movingArmy;
    } else if (target.owner === playerId) {
      target.army += movingArmy;
    } else {
      const defender = target.army;
      const defenderOwner = target.owner;
    
      if (movingArmy > defender) {
        target.owner = playerId;
        target.army = movingArmy - defender;
    
        // 在 Game 类的 moveArmy 方法中，找到处理玩家被击败的部分，修改为：
        if (target.isCapital) {
          const defeated = defenderOwner; // 被攻占者
          // 将 defeated 的所有领地转移给 playerId
          for (let i = 0; i < this.GRID_SIZE; i++) {
            for (let j = 0; j < this.GRID_SIZE; j++) {
              const t = this.tileStatus[i][j];
              if (t.owner === defeated) {
                t.owner = playerId;
                if (t.isCapital) {
                  t.isCapital = false;
                  t.type = this.TILE_TYPES.CITY;
                }
              }
            }
          }
          target.isCapital = false;
          target.type = this.TILE_TYPES.CITY;

          // 修复：向被击败的玩家发送完整视野
          const defeatedSocketId = this.players[defeated];
          if (defeatedSocketId) {
            const fullVision = new Set();
            for (let i = 0; i < this.GRID_SIZE; i++) {
              for (let j = 0; j < this.GRID_SIZE; j++) {
                fullVision.add(`${i},${j}`);
              }
            }
            
            io.to(defeatedSocketId).emit('playerDefeated', {
              winner: playerId,
              stats: this.getStats(),
              grid: this.tileStatus,
              vision: Array.from(fullVision)
            });
            
            console.log(`玩家 ${defeated} 被击败，已发送完整视野`);
          }
        }
      } else if (movingArmy < defender) {
        target.army = defender - movingArmy;
      } else {
        target.army = 0;
      }
    }

    const winResult = this.checkWinCondition();
    if (winResult) {
      return { winner: winResult.winner, gameOver: true };
    }
    
    return { winner: null, gameOver: false };
  }

  //server.js
  // 在 Game 类的 getStats 方法中修改玩家名称显示
  getStats() {
    const playerStats = {};
    
    for (let pid = 1; pid <= this.numPlayers; pid++) {
      let army = 0;
      let tiles = 0;
      
      for (let i = 0; i < this.GRID_SIZE; i++) {
        for (let j = 0; j < this.GRID_SIZE; j++) {
          const tile = this.tileStatus[i][j];
          if (tile.owner === pid) {
            tiles++;
            army += tile.army || 0;
          }
        }
      }
      
      // 修复：使用实际玩家名称而不是默认名称
      playerStats[pid] = {
        name: this.playerNames[pid] || `玩家${pid}`, // 确保使用实际设置的用户名
        army,
        tiles
      };
    }
    
    return {
      turn: this.currentTurn,
      players: playerStats,
      colors: this.playerColors
    };
  }

  increaseArmies() {
    for (let i = 0; i < this.GRID_SIZE; i++) {
      for (let j = 0; j < this.GRID_SIZE; j++) {
        const t = this.tileStatus[i][j];
        if (t.owner !== this.PLAYERS.NONE && t.type !== this.TILE_TYPES.MOUNTAIN) {
          t.army += 1;
        }
      }
    }
    this.lastArmyIncreaseTime = Date.now();

    Object.keys(this.players).forEach(pid => {
      const sid = this.players[pid];
      if (sid) {
        const vision = Array.from(this.getPlayerVision(parseInt(pid)));
        io.to(sid).emit('armyIncreased', { stats: this.getStats(), grid: this.tileStatus, vision });
      }
    });
  }

  startCapitalIncreaseTimer() {
    if (this.capitalIncreaseTimer) clearInterval(this.capitalIncreaseTimer);
    this.capitalIncreaseTimer = setInterval(() => {
      if (this.gameOver || !this.gameStarted) { clearInterval(this.capitalIncreaseTimer); return; }

      let changed = false;
      for (let i = 0; i < this.GRID_SIZE; i++) {
        for (let j = 0; j < this.GRID_SIZE; j++) {
          const t = this.tileStatus[i][j];
          if ((t.isCapital || t.isCity) && t.owner !== this.PLAYERS.NONE) { t.army += 1; changed = true; }
        }
      }
      if (changed) {
        Object.keys(this.players).forEach(pid => {
          const sid = this.players[pid];
          if (sid) {
            const vision = Array.from(this.getPlayerVision(parseInt(pid)));
            io.to(sid).emit('armyIncreased', { stats: this.getStats(), grid: this.tileStatus, vision });
          }
        });
      }
    }, 1000);
  }

  // 修改 startNewTurn 方法中的游戏结束判断逻辑
  startNewTurn() {
    this.currentTurn++;
    this.bonusArmyApplied = false;
    
    // 重置所有玩家的移动和选中状态
    for (let pid = 1; pid <= this.numPlayers; pid++) {
      this.moves[pid] = [];
      this.selectedTiles[pid] = null;
    }

    const winResult = this.checkWinCondition();
    if (winResult) {
      return winResult;
    }

    // console.log(`房间 ${this.roomId} 回合 ${this.currentTurn} 开始，存活玩家: ${playersAlive.length}`);
    return false;
  }
  
  // 修改 startTurnTimer 方法
  startTurnTimer() {
    if (this.turnTimer) clearInterval(this.turnTimer);
    this.turnTimer = setInterval(() => {
      if (this.gameOver || !this.gameStarted) { 
        clearInterval(this.turnTimer); 
        return; 
      }
  
      const over = this.startNewTurn();
      if (over) {
        // 游戏结束，通知所有玩家
        Object.keys(this.players).forEach(pid => {
          const sId = this.players[pid];
          if (sId) {
            // 创建完整视野
            const fullVision = new Set();
            for (let i = 0; i < this.GRID_SIZE; i++) {
              for (let j = 0; j < this.GRID_SIZE; j++) {
                fullVision.add(`${i},${j}`);
              }
            }
            
            io.to(sId).emit('gameOver', {
              winner: over.winner,
              stats: this.getStats(),
              grid: this.tileStatus,
              vision: Array.from(fullVision)
            });
          }
        });
        
        // 清理游戏状态
        this.cleanup();
        delete gameStates[this.roomId];
        console.log(`房间 ${this.roomId} 游戏结束，胜利者: ${over.winner}`);
      } else {
        // 回合继续，更新所有玩家状态
        const stats = this.getStats();
        Object.keys(this.players).forEach(pid => {
          const sId = this.players[pid];
          if (sId) {
            const vision = Array.from(this.getPlayerVision(parseInt(pid)));
            io.to(sId).emit('turnEnded', { 
              stats, 
              grid: this.tileStatus, 
              vision 
            });
          }
        });
      }
    }, 1000);
  }

  startArmyIncreaseTimer() {
    if (this.armyIncreaseTimer) clearInterval(this.armyIncreaseTimer);
    this.armyIncreaseTimer = setInterval(() => {
      if (this.gameOver || !this.gameStarted) { clearInterval(this.armyIncreaseTimer); return; }
      this.increaseArmies();
    }, 25000);
  }

  getPlayerVision(playerId) {
    const vision = new Set();
    for (let i = 0; i < this.GRID_SIZE; i++) {
      for (let j = 0; j < this.GRID_SIZE; j++) {
        const t = this.tileStatus[i][j];
        if (t.owner === playerId) {
          vision.add(`${i},${j}`);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const nx = i + dx, ny = j + dy;
              if (nx >= 0 && nx < this.GRID_SIZE && ny >= 0 && ny < this.GRID_SIZE) vision.add(`${nx},${ny}`);
            }
          }
        }
      }
    }
    return vision;
  }

  cleanup() {
    if (this.turnTimer) { clearInterval(this.turnTimer); this.turnTimer = null; }
    if (this.armyIncreaseTimer) { clearInterval(this.armyIncreaseTimer); this.armyIncreaseTimer = null; }
    if (this.capitalIncreaseTimer) { clearInterval(this.capitalIncreaseTimer); this.capitalIncreaseTimer = null; }
  }
}

// --- 修改 1: 在 getRoomLobbyData 中添加颜色信息 ---
function getRoomLobbyData(game) {
  const lobbyPlayers = {};
  if (!game || !game.players) return { players: lobbyPlayers };

  for (let pid = 1; pid <= game.MAX_PLAYERS; pid++) {
    const socketId = game.players[pid];
    if (socketId) { // 如果这个玩家槽位有人
      lobbyPlayers[pid] = {
        name: game.playerNames[pid] || `玩家${pid}`,
        isReady: !!game.readyPlayers[pid], // 转换为布尔值
        // 新增：根据 PID 确定颜色，与游戏开始后的逻辑保持一致
        color: PLAYER_COLORS[(pid - 1) % PLAYER_COLORS.length] 
      };
    }
  }
  return { players: lobbyPlayers, maxPlayers: game.MAX_PLAYERS };
}

function broadcastRoomLobbyUpdate(roomId) {
  const game = gameStates[roomId];
  if (game) {
    const lobbyData = getRoomLobbyData(game);
    io.to(roomId).emit('roomLobbyUpdate', lobbyData);
  }
}

io.on('connection', (socket) => {
  const clientIP = getSocketIP(socket); // 使用新的IP获取方法
  console.log(`用户连接尝试: ${socket.id} (IP: ${clientIP})`);
  
  // 检查IP是否被允许连接
  if (!isIPAllowed(clientIP)) {
    console.log(`拒绝连接: IP ${clientIP} 在黑名单中或不在白名单中`);
    socket.disconnect(true);
    return;
  }
  
  console.log(`用户连接已接受: ${socket.id} (IP: ${clientIP})`);
  playerNames[socket.id] = `玩家${Object.keys(playerNames).length + 1}`;

  socket.on('createRoom', (data) => {
    if (playerRooms[socket.id]) {
      console.log(`用户 ${socket.id} 已加入房间 ${playerRooms[socket.id]}，禁止重复创建`);
      socket.emit('alreadyInRoom', { roomId: playerRooms[socket.id] });
      return;
    }

    const username = (data && data.username) ? String(data.username).trim() : '';
    if (!username) {
      socket.emit('invalidUsername', { reason: '用户名不能为空' });
      return;
    }

    // createRoom: 创建后把创建者分配到第一个空位
    const roomId = generateRoomId();
    gameStates[roomId] = new Game(roomId);
    playerRooms[socket.id] = roomId;
    const game = gameStates[roomId];

    // 分配第一个空位
    let assigned = null;
    for (let pid = 1; pid <= game.MAX_PLAYERS; pid++) {
      if (!game.players[pid]) { game.players[pid] = socket.id; assigned = pid; break; }
    }
    if (assigned === null) {
      // 极不可能：刚创建的房间应该有空位
      socket.emit('roomFull');
      return;
    }
    game.playerNames[assigned] = username || playerNames[socket.id];
    game.playerColors = game.playerColors || {};
    game.playerColors[assigned] = PLAYER_COLORS[(assigned - 1) % PLAYER_COLORS.length]; socket.join(roomId);
    // 增量：立即打印该 socket 在 adapter 中的房间列表（即时验证 join 是否成功）
    try {
      const adapter = io.sockets.adapter;
      const sids = adapter.sids;
      if (sids && typeof sids.get === 'function') {
        const roomsForThisSocket = sids.get(socket.id) ? Array.from(sids.get(socket.id)) : [];
        // console.log(`(join) socket ${socket.id} roomsAfterJoin:`, roomsForThisSocket);
      } else {
        // 兼容：有的版本用普通对象
        // console.log(`(join) socket ${socket.id} roomsAfterJoin (raw adapter):`, adapter.rooms && adapter.rooms[socket.id]);
      }
    } catch (e) {
      // console.error('join 后查询 rooms 出错:', e);
    }
    
    socket.emit('roomCreated', { roomId, playerId: assigned, roomUrl });
    console.log(`房间 ${roomId} 已创建，玩家${assigned}加入，用户名: ${username}`);
  });

  // 修改 joinRoom 事件处理，允许用户名重复
  socket.on('joinRoom', (data) => {
    if (playerRooms[socket.id]) {
      console.log(`用户 ${socket.id} 已加入房间 ${playerRooms[socket.id]}，禁止重复加入`);
      socket.emit('alreadyInRoom', { roomId: playerRooms[socket.id] });
      return;
    }

    const roomId = data && data.roomId ? String(data.roomId) : '';
    const username = data && data.username ? String(data.username).trim() : '';

    if (!username) {
      socket.emit('invalidUsername', { reason: '用户名不能为空' });
      return;
    }

    if (!/^[a-z]{4}$/.test(roomId)) {
      socket.emit('invalidRoomId');
      return;
    }

    // 新增：检查游戏是否已经开始
    if (gameStates[roomId] && gameStates[roomId].gameStarted) {
      socket.emit('gameAlreadyStarted');
      console.log(`房间 ${roomId} 游戏已开始，玩家 ${username} 无法加入`);
      return;
    }

    // joinRoom 核心分配：找第一个空位
    if (!gameStates[roomId]) gameStates[roomId] = new Game(roomId);
    const game = gameStates[roomId];

    let assigned = null;
    for (let pid = 1; pid <= game.MAX_PLAYERS; pid++) {
      if (!game.players[pid]) { assigned = pid; break; }
    }
    if (!assigned) {
      socket.emit('roomFull');
      console.log(`房间 ${roomId} 已满，玩家 ${username} 无法加入`);
      return;
    }

    game.players[assigned] = socket.id;
    playerRooms[socket.id] = roomId;
    game.playerNames[assigned] = username || playerNames[socket.id];

    socket.join(roomId);

    // --- 增量更新：向加入的客户端发送确认事件 ---
    socket.emit('roomJoined', { roomId, playerId: assigned });

    broadcastRoomLobbyUpdate(roomId);

    console.log(`玩家 ${username} 加入房间 ${roomId} 作为玩家${assigned}`);
  });

  socket.on('playerReady', ({ roomId, playerId, name }) => {
    console.log(`房间 ${roomId} 玩家 ${playerId} 就绪`);
    if (gameStates[roomId]) {
        const game = gameStates[roomId];
        game.readyPlayers[playerId] = true;
        game.playerNames[playerId] = name || `玩家${playerId}`;
        broadcastRoomLobbyUpdate(roomId);
        const totalPlayers = Object.values(game.players).filter(p => p).length;
        const readyCount = Object.values(game.readyPlayers).filter(r => r).length;
        const allReady = readyCount === totalPlayers && totalPlayers >= 2;
        if (allReady) {
            // console.log(`房间 ${roomId} 游戏开始，所有玩家已就绪`);
            game.numPlayers = totalPlayers;
            game.initGame();
            game.currentTurn = 1;
            
            Object.keys(game.players).forEach(pid => {
                const sId = game.players[pid];
                if (sId) {
                    const vision = Array.from(game.getPlayerVision(parseInt(pid)));
                    // 确保发送正确的视角变换
                    const visionTransform = game.playerVisionTransforms[pid] || 0;
                    io.to(sId).emit('gameStart', {
                        gridSize: game.GRID_SIZE,
                        grid: game.tileStatus,
                        playerId: parseInt(pid),
                        roomId: roomId,
                        colors: game.playerColors,
                        names: game.playerNames,
                        stats: game.getStats(),
                        capitals: game.playerCapitals,
                        vision: vision,
                        visionTransform: visionTransform  // 发送该玩家的视角变换
                    });
                    // console.log(`向玩家 ${pid} 发送视角变换: ${visionTransform}`);
                }
            });
            game.gameStarted = true;
            game.startTurnTimer();
            game.startArmyIncreaseTimer();
            game.startCapitalIncreaseTimer();
        }
    }
  });

  socket.on('selectTile', ({ roomId, playerId, x, y }) => {
    if (gameStates[roomId] && gameStates[roomId].gameStarted) {
      const tile = gameStates[roomId].tileStatus[x][y];
      if (tile && tile.owner === playerId) {
        gameStates[roomId].selectedTiles[playerId] = tile;
        socket.emit('tileSelected', { x, y });
      }
    }
  });

  socket.on('playerDefeated', (data) => {
    // 更新游戏状态，显示完整地图
    if (data.grid) this.tileStatus = data.grid;
    if (data.stats) this.stats = data.stats;
    if (data.vision) this.vision = new Set(data.vision);
    
    // 游戏结束状态
    this.gameOver = true;
    this.gameStarted = false;
    
    const message = data.winner === this.playerId ? 
      '你赢得了游戏！' : '你被击败了！游戏继续观看中...';
    
    this.showGameOver(message);
    this.renderGrid();
    this.updateStats();
  });

  socket.on('moveArmy', ({ roomId, playerId, source, target, arrow }) => {
    if (gameStates[roomId] && gameStates[roomId].gameStarted) {
      const game = gameStates[roomId];
      const sourceTile = game.tileStatus[source.x][source.y];
      const targetTile = game.tileStatus[target.x][target.y];
      if (!sourceTile || !targetTile) return;
      if (sourceTile.owner !== playerId) return;
      if (targetTile.type === game.TILE_TYPES.MOUNTAIN) return;
      if (Math.abs(source.x - target.x) + Math.abs(source.y - target.y) !== 1) return;
      if (sourceTile.army <= 1) return;
  
      const result = game.moveArmy(sourceTile, targetTile, playerId);
  
      Object.keys(game.players).forEach(pId => {
        const sId = game.players[pId];
        if (sId) {
          const vision = Array.from(game.getPlayerVision(parseInt(pId)));
          io.to(sId).emit('armyMoved', {
            source: sourceTile,
            target: targetTile,
            playerId,
            stats: game.getStats(),
            grid: game.tileStatus,
            vision
          });
        }
      });
  
      // 修改：只有当游戏完全结束时才向所有玩家发送gameOver
      // 玩家中途死亡已经在moveArmy中单独处理了
      if (result && result.winner && result.gameOver) {
        console.log(`房间 ${roomId} 游戏完全结束，胜利者: ${result.winner}`);
        game.gameOver = true;
        
        // 游戏完全结束时，为所有玩家显示完整地图
        Object.keys(game.players).forEach(pid => {
          const sId = game.players[pid];
          if (sId) {
            const fullVision = new Set();
            for (let i = 0; i < game.GRID_SIZE; i++) {
              for (let j = 0; j < game.GRID_SIZE; j++) {
                fullVision.add(`${i},${j}`);
              }
            }
            
            io.to(sId).emit('gameOver', {
              winner: result.winner,
              stats: game.getStats(),
              grid: game.tileStatus,
              vision: Array.from(fullVision)
            });
          }
        });
        
        // 延迟清理游戏状态
        setTimeout(() => {
          game.cleanup();
          delete gameStates[roomId];
          
          Object.keys(playerRooms).forEach(socketId => {
            if (playerRooms[socketId] === roomId) {
              delete playerRooms[socketId];
            }
          });
        }, 1000);
      }
    }
  });

  //server.js
  // 在socket.io连接处理中添加splitArmy事件监听
  socket.on('splitArmy', (data) => {
    if (gameStates[data.roomId] && gameStates[data.roomId].gameStarted) {
      const game = gameStates[data.roomId];
      const tile = game.tileStatus[data.x][data.y];
      
      if (tile && tile.owner === data.playerId && tile.army > 1) {
        // 设置分兵标志，不立即减少兵力
        tile.isSplit = true;
        
        // 广播分兵事件给所有玩家
        Object.keys(game.players).forEach(pid => {
          const sId = game.players[pid];
          if (sId) {
            const vision = Array.from(game.getPlayerVision(parseInt(pid)));
            io.to(sId).emit('armySplit', {
              x: data.x,
              y: data.y,
              isSplit: true,
              newArmy: tile.army,
              stats: game.getStats(),
              grid: game.tileStatus,
              vision
            });
          }
        });
      }
    }
  });

  socket.on('endTurn', ({ roomId, playerId }) => {
    console.log(`房间 ${roomId} 玩家 ${playerId} 结束回合`);
    if (gameStates[roomId] && gameStates[roomId].gameStarted) {
      const game = gameStates[roomId];
      const over = game.startNewTurn();
      if (over) {
        console.log(`房间 ${roomId} 游戏结束，胜利者: ${over.winner}`);
        io.to(roomId).emit('gameOver', over);
        gameStates[roomId].cleanup();
        delete gameStates[roomId];
      } else {
        const stats = game.getStats();
        Object.keys(game.players).forEach(pId => {
          const sId = game.players[pId];
          if (sId) {
            const vision = Array.from(game.getPlayerVision(parseInt(pId)));
            io.to(sId).emit('turnEnded', { stats, grid: game.tileStatus, vision });
          }
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`用户断开连接: ${socket.id}`);
    const roomId = playerRooms[socket.id];
    if (roomId && gameStates[roomId]) {
      const game = gameStates[roomId];

      // 从 game.players 中清空断开玩家的位置
      let disconnectedPlayerId = null;
      for (const pid of Object.keys(game.players)) {
        if (game.players[pid] === socket.id) {
          game.players[pid] = null;
          disconnectedPlayerId = pid;
          break;
        }
      }

      if (game.gameStarted && !game.gameOver && disconnectedPlayerId) {
        console.log(`玩家 ${disconnectedPlayerId} 在游戏中断开连接，将其领地设为中立`);
        
        // 将断开连接玩家的所有领地设为中立，皇城变成城市
        let hasChanged = false;
        for (let i = 0; i < game.GRID_SIZE; i++) {
          for (let j = 0; j < game.GRID_SIZE; j++) {
            const tile = game.tileStatus[i][j];
            if (tile.owner == disconnectedPlayerId) {
              if (tile.isCapital) {
                tile.isCapital = false;
                tile.type = game.TILE_TYPES.CITY;
              }
              hasChanged = true;
            }
          }
        }
        
        if (hasChanged) {
          // 更新所有客户端的棋盘状态
          Object.keys(game.players).forEach(pid => {
            const sId = game.players[pid];
            if (sId) {
              const vision = Array.from(game.getPlayerVision(parseInt(pid)));
              io.to(sId).emit('armyIncreased', {
                stats: game.getStats(),
                grid: game.tileStatus,
                vision
              });
            }
          });
          
          // 检查游戏是否应该继续
          const playersAlive = [];
          for (let pid = 1; pid <= game.numPlayers; pid++) {
            let hasTiles = false;
            for (let i = 0; i < game.GRID_SIZE; i++) {
              for (let j = 0; j < game.GRID_SIZE; j++) {
                const t = game.tileStatus[i][j];
                if (t.owner == pid) {
                  hasTiles = true;
                  break;
                }
              }
              if (hasTiles) break;
            }
            if (hasTiles) playersAlive.push(pid);
          }
          
          // 只有当存活玩家数量 <= 1 时才结束游戏
          if (playersAlive.length <= 1) {
            game.gameOver = true;
            const winner = playersAlive[0] || null;
            
            Object.keys(game.players).forEach(pid => {
              const sId = game.players[pid];
              if (sId) {
                const fullVision = new Set();
                for (let i = 0; i < game.GRID_SIZE; i++) {
                  for (let j = 0; j < game.GRID_SIZE; j++) {
                    fullVision.add(`${i},${j}`);
                  }
                }
                
                io.to(sId).emit('gameOver', {
                  winner: winner,
                  stats: game.getStats(),
                  grid: game.tileStatus,
                  vision: Array.from(fullVision)
                });
              }
            });
            
            setTimeout(() => {
              game.cleanup();
              delete gameStates[roomId];
            }, 1000);
          }
        }
      } else if (!game.gameStarted && disconnectedPlayerId) {
        // 修复：游戏未开始时，仅当最后一名玩家离开时才清理房间
        console.log(`玩家 ${disconnectedPlayerId} 在游戏开始前离开房间 ${roomId}`);
        
        // 从其他状态中也移除玩家信息
        delete game.playerNames[disconnectedPlayerId];
        delete game.readyPlayers[disconnectedPlayerId];

        // 检查房间是否还有其他玩家 (通过过滤 null 值来准确计数)
        const remainingPlayersCount = Object.values(game.players).filter(p => p).length;

        if (remainingPlayersCount === 0) {
            console.log(`房间 ${roomId} 已空，正在清理...`);
            game.cleanup();
            delete gameStates[roomId];
        } else {
            // 用新的广播函数替换旧的 'playerLeft' 事件
            broadcastRoomLobbyUpdate(roomId);
            console.log(`房间 ${roomId} 仍有 ${remainingPlayersCount} 名玩家。`);
        }
      }
    }

    // 全局映射清理（保底）
    delete playerRooms[socket.id];
    delete playerNames[socket.id];
  });
});

// 启动服务器
const PORT = config.port || 80;

function startServer(port) {
  const serverInstance = server.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
    console.log(`当前配置:`);
    console.log(`- 白名单模式: ${whitelistMode ? '启用' : '禁用'}`);
    console.log(`- 白名单IP: ${Array.from(ipWhitelist).join(', ')}`);
    console.log(`- 黑名单IP: ${Array.from(ipBlacklist).join(', ')}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 被占用，尝试端口 ${port + 1}`);
      startServer(port + 1);
    } else {
      console.error('服务器启动错误:', err);
    }
  });

  // 修改服务器关闭处理逻辑
  process.on('SIGINT', () => {
    console.log('服务器正在关闭...');
    
    // 通知所有客户端服务器即将关闭
    io.emit('serverShutdown', { message: '服务器即将关闭', timestamp: Date.now() });

    // --- 修复：添加实际的退出逻辑 ---
    setTimeout(() => {
      // 强制断开所有客户端连接
      Object.keys(io.sockets.sockets).forEach(socketId => {
        io.sockets.sockets[socketId].disconnect(true);
      });

      // 关闭服务器并退出进程
      serverInstance.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
      });
      
      // 如果 server.close 卡住（例如有未释放的资源），强制退出
      setTimeout(() => {
          console.log('强制关闭...');
          process.exit(0);
      }, 2000);
    }, 1000); // 等待1秒让客户端接收到关闭消息
  });

  process.on('SIGTERM', () => {
    console.log('收到终止信号，正在关闭服务器...');
    io.emit('serverShutdown', { message: '服务器维护中', timestamp: Date.now() });
    
    setTimeout(() => {
      Object.keys(io.sockets.sockets).forEach(socketId => {
        io.sockets.sockets[socketId].disconnect(true);
      });

      serverInstance.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
      });
    }, 1000);
  });

  return serverInstance;
}

startServer(PORT);
