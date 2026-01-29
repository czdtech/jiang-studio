# Nano Banana Studio - 项目概览

## 项目目的
Nano Banana Studio 是一个基于 AI 的图像生成和编辑工具，支持多个 AI 服务提供商：
- Gemini 官方 API
- 第三方 OpenAI 兼容中转服务
- Antigravity Tools
- Kie AI

主要功能：
- AI 图像生成
- 图像编辑和修改
- 作品集管理
- 多供应商配置管理

## 技术栈
- **前端框架**: React 19.2.3 + TypeScript
- **构建工具**: Vite 6.2.0
- **样式**: Tailwind CSS 4.1.18 (自定义主题)
- **图标**: Lucide React
- **AI 服务**: Google Gemini API
- **数据存储**: IndexedDB (通过自定义 db.ts 服务)
- **开发环境**: Node.js + npm

## 项目结构
```
├── components/          # React 组件
│   ├── EditorModal.tsx     # 图像编辑模态框
│   ├── GeminiPage.tsx      # Gemini 页面
│   ├── ImageGrid.tsx       # 图像网格显示
│   ├── ImagePreviewModal.tsx # 图像预览模态框
│   ├── KiePage.tsx         # Kie AI 页面
│   ├── OpenAIPage.tsx      # OpenAI 兼容页面
│   ├── PortfolioGrid.tsx   # 作品集网格
│   └── Toast.tsx           # 提示组件
├── services/            # 业务逻辑服务
│   ├── db.ts              # IndexedDB 数据库操作
│   ├── gemini.ts          # Gemini API 集成
│   ├── openai.ts          # OpenAI 兼容 API
│   ├── kie.ts             # Kie AI 集成
│   ├── kieUpload.ts       # Kie 文件上传
│   └── shared.ts          # 共享工具函数
├── hooks/               # React Hooks
│   └── usePortfolio.ts    # 作品集管理 Hook
├── App.tsx              # 主应用组件
├── types.ts             # TypeScript 类型定义
└── index.tsx            # 应用入口点
```

## 环境要求
- Node.js (版本要求见 package.json)
- GEMINI_API_KEY 环境变量 (在 .env.local 中配置)