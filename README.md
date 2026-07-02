# Nanjing Mahjong

四人联机南京麻将网页游戏项目骨架。

当前版本只包含可运行、可测试的项目基础设施：前端首页、后端健康检查、最小 Socket.IO 连接、共享包和文档占位。不包含麻将业务规则。

## 项目结构

```text
apps/
  web/              React + Vite 前端
  server/           Express + Socket.IO 后端
packages/
  game-core/        纯 TypeScript 游戏核心模块骨架
  shared-types/     共享类型模块骨架
docs/               产品、规则、状态机和协议文档
AGENTS.md           协作与代码约束
package.json        npm workspaces 根配置
```

## 安装

```bash
npm install
```

## 开发启动

同时启动前端和后端：

```bash
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3000
- 健康检查：http://localhost:3000/health

## 测试和检查

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
```
