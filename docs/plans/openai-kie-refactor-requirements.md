# OpenAIPage / KiePage 重构需求清单

## 目标
将 OpenAIPage 和 KiePage 重构为与 GeminiPage 一致的 Aurora 三列布局设计语言，实现视觉和交互的统一体验。

---

## Requirements

### 1. 布局结构迁移
- [ ] **主容器**: 将根容器从 `h-full flex flex-col` 迁移到 `aurora-page`
- [ ] **主行布局**: 将上区（配置+图片）迁移到 `aurora-main-row` 三列结构
  - [ ] 左侧边栏：`aurora-sidebar`（API 配置）
  - [ ] 中间画布：`aurora-canvas`（图片展示）
  - [ ] 右侧助手：`aurora-assistant`（迭代助手，仅在 ≥1200px 显示）
- [ ] **提示词区**: 将下区迁移到 `aurora-prompt-area` 三列结构
  - [ ] 左列：`aurora-prompt-optimizer`（提示词优化器，仅在 ≥768px 显示）
  - [ ] 中列：`aurora-prompt-input`（提示词输入+参考图）
  - [ ] 右列：`aurora-prompt-config`（参数配置，仅在 ≥1200px 显示）

### 2. CSS 类名迁移
- [ ] **侧边栏区域**:
  - [ ] 替换 `border-dark-border rounded-xl bg-dark-surface/80` → `aurora-sidebar`
  - [ ] 替换标题区域为 `aurora-section-header` + `aurora-section-title`
  - [ ] 替换所有输入框为 `inputBaseStyles`（Aurora Slate 背景）
  - [ ] 替换所有选择框为 `selectBaseStyles` 或 `selectSmallStyles`
- [ ] **画布区域**:
  - [ ] 替换容器为 `aurora-canvas`
  - [ ] 添加 `aurora-canvas-header`（标题栏）
  - [ ] 添加 `aurora-canvas-body`（内容区）
  - [ ] 批量进度条使用 `aurora-batch-progress` + `aurora-batch-items` + `aurora-batch-item`
- [ ] **提示词输入区**:
  - [ ] 替换 textarea 容器为 `aurora-prompt-box` + `aurora-prompt-box-textarea`
  - [ ] 添加 Sparkles 图标（`aurora-prompt-box-icon`）
  - [ ] 参考图行：桌面端使用 `aurora-ref-row`（横向显示），移动端保持弹出层
- [ ] **参数配置区**:
  - [ ] 数量按钮使用 `aurora-count-buttons` + `aurora-count-btn`
  - [ ] 生成按钮使用 `aurora-generate-btn`（替换 `getGenerateButtonStyles`）
  - [ ] 批量模式切换使用 Aurora 分段控制器样式（参考 GeminiPage 1105-1136 行）

### 3. 组件功能对齐

#### 3.1 供应商管理
- [ ] **保留现有功能**:
  - [ ] 供应商选择下拉框
  - [ ] 新增/删除/收藏供应商
  - [ ] 供应商名称编辑
  - [ ] API Key / Base URL 配置
- [ ] **样式迁移**:
  - [ ] 按钮使用 Aurora 样式（收藏按钮：`getFavoriteButtonStyles`）
  - [ ] 删除按钮使用错误色（`text-error hover:border-error/50`）

#### 3.2 模型选择
- [ ] **OpenAIPage**: 保留自定义模型输入 + datalist（模型列表下拉）
- [ ] **KiePage**: 保留自定义模型输入 + datalist
- [ ] **样式**: 输入框使用 `inputBaseStyles`，下拉箭头使用 ChevronDown 图标
- [ ] **模型刷新**: 保留刷新按钮功能，样式对齐 Aurora

#### 3.3 参考图管理
- [ ] **桌面端（≥1024px）**: 
  - [ ] 参考图显示在 `aurora-ref-row`（提示词输入框上方）
  - [ ] 使用 `aurora-ref-add`、`aurora-ref-list`、`aurora-ref-thumb`、`aurora-ref-count`
- [ ] **移动端（<1024px）**: 
  - [ ] 保留弹出层（`showRefPopover`）
  - [ ] 弹出层样式使用 Aurora 颜色变量（`bg-graphite border-ash`）
- [ ] **限制**: 
  - [ ] OpenAIPage: 最多 4 张（保持不变）
  - [ ] KiePage: 最多 8 张（保持不变）

#### 3.4 提示词优化器
- [ ] **位置**: 迁移到 `aurora-prompt-optimizer`（左列，与侧边栏对齐）
- [ ] **组件**: 使用现有 `PromptOptimizerSettings` 组件（无需修改）
- [ ] **响应式**: 仅在 ≥768px 显示

#### 3.5 批量模式
- [ ] **切换器**: 使用 Aurora 分段控制器（参考 GeminiPage 1105-1136 行）
  - [ ] 普通生成 / 批量任务 两个选项
  - [ ] 滑动背景块动画（`ease-spring`）
- [ ] **配置**: 批量模式下显示并发数/每提示词配置
- [ ] **进度显示**: 使用 `aurora-batch-progress` 样式
- [ ] **功能**: 保留所有现有批量生成逻辑

#### 3.6 参数配置
- [ ] **模型选择**: 保留自定义输入（OpenAI/Kie 特有）
- [ ] **比例/尺寸**: 
  - [ ] OpenAIPage: 保留比例/尺寸选择（Antigravity Tools 模式下隐藏）
  - [ ] KiePage: 保留比例/尺寸选择，比例选项包含 'auto'
- [ ] **输出格式**: KiePage 保留 outputFormat 选择（png/jpg）
- [ ] **数量选择**: 使用 `aurora-count-buttons` + `aurora-count-btn`（普通模式）
- [ ] **生成按钮**: 使用 `aurora-generate-btn`，保留停止/批量生成状态

#### 3.7 迭代助手
- [ ] **位置**: 迁移到 `aurora-assistant`（右侧，仅在 ≥1200px 显示）
- [ ] **组件**: 使用现有 `IterationAssistant` 组件（无需修改）

### 4. 响应式行为
- [ ] **移动端（<768px）**:
  - [ ] 主行垂直堆叠（`flex-direction: column`）
  - [ ] 侧边栏最大高度 40vh，可滚动
  - [ ] 提示词优化器隐藏
  - [ ] 参考图使用弹出层
- [ ] **平板（768px-1199px）**:
  - [ ] 主行水平布局
  - [ ] 提示词优化器显示（左列）
  - [ ] 参数配置区隐藏（合并到提示词输入区）
- [ ] **桌面（≥1200px）**:
  - [ ] 完整三列布局（侧边栏 + 画布 + 助手）
  - [ ] 提示词区三列布局（优化器 + 输入 + 配置）

### 5. 样式细节
- [ ] **颜色系统**: 所有颜色变量迁移到 Aurora 系统
  - [ ] `dark-bg` → `void`
  - [ ] `dark-surface` → `graphite`
  - [ ] `dark-border` → `ash`
  - [ ] `gray-*` → `text-*`（primary/secondary/muted/disabled）
- [ ] **圆角**: 统一使用 Aurora 圆角变量（`var(--radius-md)` 等）
- [ ] **阴影**: 使用 Aurora 阴影变量（`var(--shadow-lifted)` 等）
- [ ] **图标**: 统一使用 lucide-react 图标，颜色使用 `text-banana-500`

### 6. 功能保留
- [ ] **OpenAIPage 特有**:
  - [ ] Antigravity Tools 模式支持（`variant` prop）
  - [ ] 模型列表刷新功能
  - [ ] 模型 ID 推断配置（aspectRatio/imageSize）
  - [ ] ImageGridSlot 错误状态显示
- [ ] **KiePage 特有**:
  - [ ] outputFormat 选择（png/jpg）
  - [ ] 更多比例选项（包括 'auto'）
  - [ ] 最多 8 张参考图支持

---

## Non-goals

1. **不修改业务逻辑**: 仅重构 UI 布局和样式，不改变生成流程、API 调用、状态管理逻辑
2. **不统一模型选择方式**: OpenAIPage/KiePage 保持自定义模型输入，不强制使用 Gemini 的 MODEL_PRESETS
3. **不修改共享组件**: `PromptOptimizerSettings`、`IterationAssistant`、`ImageGrid` 等组件保持不变
4. **不改变数据持久化**: 供应商、草稿的存储逻辑保持不变
5. **不修改批量生成算法**: 并发控制、任务队列逻辑保持不变

---

## Risks

1. **响应式断点冲突**: Aurora 布局使用 768px/1024px/1200px 断点，需确保与现有响应式逻辑兼容
2. **参考图显示差异**: GeminiPage 桌面端横向显示参考图，OpenAI/Kie 需保持一致但限制数量不同
3. **模型选择 UI 差异**: Gemini 使用预设下拉，OpenAI/Kie 使用自定义输入，需保持功能完整
4. **批量模式切换器**: 新分段控制器样式需确保状态切换流畅，不影响批量任务状态
5. **移动端体验**: 参考图弹出层在移动端需保持可用性，避免与新的布局冲突

---

## Acceptance Criteria

### 视觉一致性
- [ ] OpenAIPage/KiePage 与 GeminiPage 使用相同的 Aurora 设计语言
- [ ] 三列布局在桌面端（≥1200px）完全对齐
- [ ] 颜色、圆角、阴影、间距与 GeminiPage 一致
- [ ] 图标、按钮、输入框样式统一

### 功能完整性
- [ ] 所有现有功能正常工作（供应商管理、模型选择、批量生成等）
- [ ] 响应式布局在所有断点正常工作
- [ ] 参考图上传/删除功能正常
- [ ] 批量模式切换和配置正常
- [ ] 生成流程和错误处理正常

### 代码质量
- [ ] 使用 Aurora CSS 类名，避免硬编码颜色/尺寸
- [ ] 组件结构清晰，与 GeminiPage 保持一致
- [ ] 响应式逻辑使用 CSS media queries，避免 JS 判断
- [ ] 无重复代码，共享样式函数（`uiStyles.ts`）

### 测试验证
- [ ] 桌面端（≥1200px）三列布局正常显示
- [ ] 平板端（768px-1199px）两列布局正常显示
- [ ] 移动端（<768px）垂直堆叠正常显示
- [ ] 参考图在桌面端横向显示，移动端弹出层正常
- [ ] 批量模式切换动画流畅
- [ ] 所有生成流程端到端测试通过

---

## Questions

1. **OpenAIPage portfolio prop**: GeminiPage 没有 `portfolio` prop，OpenAIPage 是否需要保留？如果不需要，如何移除？
2. **模型选择 UI**: OpenAI/Kie 的自定义模型输入是否考虑改为下拉选择（类似 Gemini）？还是保持当前输入框+datalist？
3. **参考图限制**: OpenAIPage 限制 4 张，KiePage 限制 8 张，是否需要统一？还是保持各自限制？
4. **批量下载功能**: OpenAIPage/KiePage 是否有批量下载功能？GeminiPage 有 `handleBatchDownloadAll`，是否需要对齐？
5. **错误状态显示**: OpenAIPage 使用 `ImageGridSlot` 显示错误，GeminiPage 没有，是否需要统一处理方式？
6. **Antigravity Tools 特殊处理**: 在 Antigravity Tools 模式下，比例/尺寸是否应该隐藏（当前已隐藏）？是否需要其他特殊样式？
7. **KiePage outputFormat**: outputFormat 选择是否应该保留在参数配置区？还是移到其他位置？
8. **响应式断点**: Aurora 使用 768px/1024px/1200px，是否与现有断点冲突？需要调整吗？
9. **参考图弹出层位置**: 移动端参考图弹出层应该定位在哪里？当前是 `bottom-full`，是否需要调整？
10. **批量模式默认状态**: 批量模式默认是关闭还是开启？是否需要与 GeminiPage 保持一致？
