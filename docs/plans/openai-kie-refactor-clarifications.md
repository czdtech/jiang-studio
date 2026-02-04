# OpenAIPage / KiePage 重构澄清问题

## 优先级问题（≤8）

### 1. OpenAIPage portfolio prop
**问题**: GeminiPage 没有 `portfolio` prop，OpenAIPage 是否需要保留？  
**默认**: **移除** - 代码显示 `portfolio` prop 未使用，移除以保持接口一致性  
**影响**: 组件接口简化

---

### 2. 模型选择 UI 方式
**问题**: OpenAI/Kie 的自定义模型输入是否改为下拉选择（类似 Gemini）？  
**默认**: **保持输入框+datalist** - OpenAI/Kie 支持任意模型名，下拉选择限制灵活性  
**影响**: 保持功能灵活性，仅样式迁移到 Aurora

---

### 3. 参考图数量限制
**问题**: OpenAIPage 限制 4 张，KiePage 限制 8 张，是否需要统一？  
**默认**: **保持各自限制** - 不同 API 支持不同，保持现状  
**影响**: 功能不变，仅 UI 迁移

---

### 4. 批量下载功能对齐
**问题**: OpenAIPage/KiePage 是否需要添加批量下载功能（GeminiPage 有）？  
**默认**: **对齐添加** - OpenAIPage 已有 `handleBatchDownloadAll`，KiePage 需添加  
**影响**: 功能对齐，提升一致性

---

### 5. 错误状态显示方式
**问题**: OpenAIPage/KiePage 使用 `ImageGridSlot` 显示错误，是否需要统一？  
**默认**: **保持现状** - OpenAI/Kie API 返回部分失败，需要 slots 显示；Gemini 全成功或全失败  
**影响**: 功能需求不同，保持各自实现

---

### 6. Antigravity Tools 特殊处理
**问题**: Antigravity Tools 模式下比例/尺寸隐藏，是否需要其他特殊样式？  
**默认**: **仅隐藏比例/尺寸** - 保持当前逻辑，样式迁移到 Aurora  
**影响**: 条件渲染逻辑不变

---

### 7. KiePage outputFormat 位置
**问题**: outputFormat 选择是否保留在参数配置区？  
**默认**: **保留在 `aurora-prompt-config`** - 与其他参数（比例/尺寸）保持一致  
**影响**: 布局位置确定

---

### 8. 响应式断点兼容性
**问题**: Aurora 使用 768px/1024px/1200px，是否与现有断点冲突？  
**默认**: **使用 Aurora 断点** - 替换现有 `md:` (768px) 和 `lg:` (1024px)，新增 1200px  
**影响**: 响应式行为统一

---

## 已确认（无需澄清）

- ✅ 批量模式默认关闭（与 GeminiPage 一致）
- ✅ 参考图弹出层移动端使用 `bottom-full`（保持现状）
- ✅ 提示词优化器迁移到 `aurora-prompt-optimizer` 列
- ✅ 迭代助手迁移到 `aurora-assistant` 列（≥1200px 显示）

---

## 实施建议

基于以上默认值，可直接开始重构：
1. 移除 OpenAIPage `portfolio` prop（如未使用）
2. 保持模型输入框+datalist，仅迁移样式
3. 保持参考图限制（OpenAI: 4, Kie: 8）
4. 为 KiePage 添加批量下载功能
5. 保持错误状态显示方式不变
6. 保持 Antigravity Tools 条件渲染
7. outputFormat 保留在参数配置区
8. 统一使用 Aurora 响应式断点
