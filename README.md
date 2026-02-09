# Generals

**Generals** 是一款基于 Node.js 的多人将军棋游戏，支持本地或网络联机对战。

## 特性

* 经典将军棋玩法
* 支持本地 `localhost` 联机
* 支持远程服务器 IP 联机
* 游戏参数可在 `server.js` 中自定义
* 简单易用的 Node.js 启动方式

## 安装

1. 克隆仓库：

```bash
git clone https://github.com/2542068503/generals.git
cd generals
```

2. 安装依赖：

```bash
npm install
```

## 配置

打开 `server.js` 文件，你可以自定义以参数：

根据需要修改参数，然后保存即可。

## 启动游戏

在项目根目录执行：

```bash
node server.js
```

* 本地联机：在浏览器访问 `http://localhost:3000`
* 远程联机：在浏览器访问 `http://<服务器IP>:3000`

游戏客户端会自动连接服务器进行对战。

## 使用示例

1. 两台电脑在同一局域网内，分别打开浏览器访问 `http://<服务器IP>:3000`
2. 等待两名玩家都进入后，游戏自动开始
3. 按照界面提示操作，将棋子移动至合适位置，击败对方将军

## 贡献

1. Fork 本仓库
2. 新建分支 (`git checkout -b feature-name`)
3. 修改代码并提交 (`git commit -m 'Add new feature'`)
4. 推送到远程 (`git push origin feature-name`)
5. 提交 Pull Request

## License

[MIT](LICENSE)
