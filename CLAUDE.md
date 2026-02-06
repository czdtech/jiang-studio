# Nano Banana Studio

多供应商 AI 生图工作台，纯静态前端，用户自配 API Key，数据存浏览器本地。

## 命令

```bash
npm run dev          # 开发服务器 http://localhost:3000
npm run build        # 构建 -> dist/
npm run test:e2e     # Playwright E2E 测试
npm run test:e2e:ui  # 可视化测试调试
```

## 架构

```
components/   # UI 组件 (*Page.tsx, *Modal.tsx, *Grid.tsx)
services/     # API 服务 (gemini.ts, openai.ts, kie.ts, db.ts)
hooks/        # React Hooks (usePortfolio.ts)
tests/        # E2E 测试
types.ts      # 全局类型定义
```

## 技术栈

- React 19 + TypeScript 5.8 + Vite 6
- Tailwind CSS 4 (暗色主题)
- IndexedDB 本地存储
- Playwright E2E 测试

## 供应商

| 页面 | 服务文件 | 说明 |
|------|----------|------|
| GeminiPage | gemini.ts | Gemini 官方 SDK |
| OpenAIPage | openai.ts | OpenAI 兼容中转 |
| KiePage | kie.ts | Kie Jobs API |

## 代码风格

- 组件: PascalCase (`GeminiPage.tsx`)
- 服务: camelCase (`gemini.ts`)
- 类型: PascalCase interface (`GeneratedImage`)
- 样式: Tailwind 原子类，共享样式在 `uiStyles.ts`

## Gotchas

- **隐私优先**: 永远不要硬编码 API Key，所有密钥存 IndexedDB
- **纯静态**: 生产环境无后端，无服务器，无环境变量
- **代理仅开发**: `/mcp`, `/antigravity`, `/openai` 代理只在 dev 生效
- **测试端口**: E2E 测试用 3004 端口，与开发 3000 分开
- **路径别名**: 使用 `@/*` 指向项目根目录
