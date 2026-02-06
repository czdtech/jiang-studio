<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Nano Banana Studio

一个面向创作者的多供应商 AI 生图工作台：浏览器端完成生成、编辑、批量任务与作品集管理。  
部署形态为**纯静态前端**，用户自行配置 API Key，应用不保存到你的服务器。

## 功能概览

- 多供应商页签：**Gemini 官方 / OpenAI 兼容中转 / Antigravity / Kie AI**
- 供应商配置管理：多 Key、Base URL、默认模型、收藏、模型列表刷新（OpenAI 兼容）
- 提示词优化（MCP）：手动/自动模式 + 模板配置 + 迭代助手
- 批量生成与进度管理：并发控制、失败重试提示、批量下载
- 参考图与图像编辑：支持编辑指令、模型选择
- 作品集：IndexedDB 本地保存，支持落盘到本地目录（File System Access API）

## 页面说明

- **Gemini 官方**：直连 Gemini 官方 SDK，支持文生图/编辑与参考图
- **第三方中转**：OpenAI 兼容接口（`/v1/chat/completions` / `/v1/images`）
- **Antigravity**：默认指向本地 `http://127.0.0.1:8045`（可修改）
- **Kie AI**：基于 Kie Jobs API 的 Nano Banana / Imagen 系列
- **作品集**：本地保存与管理生成结果

## 数据与隐私

- 本项目是**静态前端**，你的 Railway 不会接收或存储用户数据。
- **API Key 保存在浏览器本地 IndexedDB**，可通过浏览器清理站点数据移除。
- 生成的图片默认存 IndexedDB，也可选择本地目录落盘（浏览器权限控制）。
- 生成请求**直接从浏览器发送到用户填写的服务商**（Gemini/OpenAI 兼容/Kie 等）。
- 使用 Kie 时，参考图（data URL）会上传到 Kie 官方上传接口以换取 URL。
- 使用 Gemini 编辑时，会使用 Gemini File API 上传图片以优化 token 成本。

## 本地开发

```bash
npm install
npm run dev
```

打开：`http://localhost:3000`

### 可选：本地代理（仅 dev 生效）

用于解决 CORS / Mixed Content / 本地服务访问：

```bash
# .env.local（仅 dev ）
ANTIGRAVITY_PROXY_TARGET=http://127.0.0.1:8045
OPENAI_PROXY_TARGET=https://api.openai.com
PROMPT_OPTIMIZER_TARGET=http://127.0.0.1:28081
```

## 构建与部署

```bash
npm run build
npm run preview
```

- 构建产物：`dist/`
- 任意静态托管可部署（Railway / Vercel / Netlify / Nginx）
- **生产环境不需要任何环境变量**，也不应配置 API Key

## 测试（Playwright）

```bash
npm run test:e2e
npm run test:e2e:update
npm run test:e2e:ui
```

## 目录结构

- `components/`：页面与 UI 组件
- `services/`：Gemini / OpenAI / Kie / MCP / 本地存储实现
- `hooks/`：本地作品集与状态管理
- `tests/`：E2E 测试

---

如果你准备扩展为“带后端”的模式（例如统一代理 API、账号体系等），建议将 API 请求移到服务端并新增隐私条款与日志策略。
