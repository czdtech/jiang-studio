# Nano Banana Studio - Design System

> AI 图像生成工作室的全新设计语言

---

## 品牌理念

**Nano Banana Studio** 是一个专业的 AI 图像生成工具，设计语言应体现：
- **创意激发** - 激励用户释放想象力
- **专业可靠** - 工具级的稳定与信任感
- **流畅体验** - 无缝的创作工作流

---

## 色彩系统

### 主色调 - Aurora 系列

| 名称 | 色值 | 用途 |
|------|------|------|
| **Aurora Gold** | `#F7B32B` | 品牌主色、CTA、高亮 |
| **Aurora Amber** | `#E09915` | 主色悬停态 |
| **Aurora Light** | `#FFD975` | 主色浅变体 |

### 深色背景系统

| 名称 | 色值 | 用途 |
|------|------|------|
| **Void** | `#08090A` | 最深背景（画布区） |
| **Obsidian** | `#0D0E10` | 主背景 |
| **Graphite** | `#16181C` | 卡片/面板背景 |
| **Slate** | `#1E2028` | 输入框/次级面板 |
| **Ash** | `#2A2D38` | 边框/分隔线 |
| **Smoke** | `#3D4150` | 悬停边框 |

### 文字层级

| 名称 | 色值 | 用途 |
|------|------|------|
| **Text Primary** | `#F4F5F7` | 标题、重要文字 |
| **Text Secondary** | `#B8BCC8` | 正文、描述 |
| **Text Muted** | `#6B7085` | 次要信息、占位符 |
| **Text Disabled** | `#404559` | 禁用状态 |

### 语义色彩

| 状态 | 色值 | 用途 |
|------|------|------|
| **Success** | `#34D399` | 成功、完成 |
| **Warning** | `#FBBF24` | 警告、注意 |
| **Error** | `#F87171` | 错误、危险 |
| **Info** | `#60A5FA` | 信息、提示 |

---

## 字体系统

### 字体家族

```css
/* 标题字体 */
--font-display: 'Plus Jakarta Sans', system-ui, sans-serif;

/* 正文字体 */
--font-body: 'Inter', system-ui, sans-serif;

/* 代码字体 */
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### 字体大小

| 名称 | 大小 | 行高 | 用途 |
|------|------|------|------|
| **Display** | 48px | 1.1 | 页面大标题 |
| **H1** | 32px | 1.2 | 区块标题 |
| **H2** | 24px | 1.3 | 卡片标题 |
| **H3** | 18px | 1.4 | 小节标题 |
| **Body** | 15px | 1.6 | 正文 |
| **Small** | 13px | 1.5 | 辅助文字 |
| **Tiny** | 11px | 1.4 | 标签、徽章 |

### 字重

| 名称 | 值 | 用途 |
|------|------|------|
| **Regular** | 400 | 正文 |
| **Medium** | 500 | 标签、按钮 |
| **Semibold** | 600 | 小标题 |
| **Bold** | 700 | 大标题 |

---

## 间距系统

基于 4px 网格：

| Token | 值 | 用途 |
|-------|------|------|
| `space-1` | 4px | 紧凑内边距 |
| `space-2` | 8px | 元素内小间距 |
| `space-3` | 12px | 按钮内边距 |
| `space-4` | 16px | 卡片内边距 |
| `space-5` | 20px | 区块间距 |
| `space-6` | 24px | 面板内边距 |
| `space-8` | 32px | 区块大间距 |
| `space-10` | 40px | 页面边距 |
| `space-12` | 48px | 大区块分隔 |

---

## 圆角系统

| Token | 值 | 用途 |
|-------|------|------|
| `radius-sm` | 6px | 小按钮、标签 |
| `radius-md` | 10px | 输入框、按钮 |
| `radius-lg` | 14px | 卡片、面板 |
| `radius-xl` | 20px | 模态框、大卡片 |
| `radius-2xl` | 28px | 特殊装饰元素 |
| `radius-full` | 9999px | 圆形、药丸形 |

---

## 阴影系统

```css
/* 浮起 - 卡片默认 */
--shadow-lifted: 0 2px 8px rgba(0, 0, 0, 0.25);

/* 悬浮 - 悬停态 */
--shadow-floating: 0 8px 24px rgba(0, 0, 0, 0.35);

/* 聚焦 - 品牌色光晕 */
--shadow-glow: 0 0 20px rgba(247, 179, 43, 0.25);

/* 内凹 - 输入框 */
--shadow-inset: inset 0 2px 4px rgba(0, 0, 0, 0.15);
```

---

## 组件规范

### 按钮

#### 主要按钮 (Primary)
```css
.btn-primary {
  background: linear-gradient(135deg, #F7B32B 0%, #E09915 100%);
  color: #0D0E10;
  font-weight: 600;
  padding: 12px 24px;
  border-radius: 10px;
  transition: all 200ms ease;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(247, 179, 43, 0.3);
}
```

#### 次要按钮 (Secondary)
```css
.btn-secondary {
  background: #1E2028;
  border: 1px solid #2A2D38;
  color: #F4F5F7;
  padding: 12px 24px;
  border-radius: 10px;
}
.btn-secondary:hover {
  border-color: #3D4150;
  background: #2A2D38;
}
```

#### 幽灵按钮 (Ghost)
```css
.btn-ghost {
  background: transparent;
  color: #B8BCC8;
  padding: 12px 24px;
}
.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #F4F5F7;
}
```

### 输入框

```css
.input {
  background: #1E2028;
  border: 1px solid #2A2D38;
  border-radius: 10px;
  padding: 12px 16px;
  color: #F4F5F7;
  font-size: 15px;
  transition: all 200ms ease;
}
.input:focus {
  border-color: #F7B32B;
  box-shadow: 0 0 0 3px rgba(247, 179, 43, 0.15);
  outline: none;
}
.input::placeholder {
  color: #6B7085;
}
```

### 卡片

```css
.card {
  background: #16181C;
  border: 1px solid #2A2D38;
  border-radius: 14px;
  padding: 20px;
  transition: all 200ms ease;
}
.card:hover {
  border-color: #3D4150;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
```

### 选中态 (Selection)

```css
::selection {
  background: rgba(247, 179, 43, 0.3);
  color: #F4F5F7;
}
```

---

## 动效规范

### 时间曲线

| 名称 | 值 | 用途 |
|------|------|------|
| **Micro** | 100ms | 按钮状态变化 |
| **Fast** | 150ms | 小元素过渡 |
| **Normal** | 200ms | 标准交互 |
| **Smooth** | 300ms | 卡片、面板 |
| **Slow** | 400ms | 大区域过渡 |

### 缓动函数

```css
--ease-out: cubic-bezier(0.33, 1, 0.68, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

### 减少动效偏好

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 图标规范

- **图标库**: Lucide Icons (与现有项目一致)
- **默认大小**: 20px (w-5 h-5)
- **描边宽度**: 1.5px
- **颜色继承**: `currentColor`

---

## 响应式断点

| 名称 | 值 | 用途 |
|------|------|------|
| **Mobile** | 375px | 手机端 |
| **Tablet** | 768px | 平板端 |
| **Desktop** | 1024px | 桌面端 |
| **Wide** | 1440px | 宽屏 |

---

## Z-Index 层级

| 层级 | 值 | 用途 |
|------|------|------|
| **Base** | 0 | 常规内容 |
| **Raised** | 10 | 浮动元素 |
| **Dropdown** | 20 | 下拉菜单 |
| **Sticky** | 30 | 粘性导航 |
| **Modal** | 40 | 模态框 |
| **Popover** | 50 | 弹出层 |
| **Toast** | 60 | 通知提示 |

---

## 无障碍要求

- 所有文字对比度 ≥ 4.5:1
- 可聚焦元素必须有可见的 focus 态
- 所有图标按钮必须有 `aria-label`
- 图片必须有 `alt` 文本
- 支持键盘完整导航
