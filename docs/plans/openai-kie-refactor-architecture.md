# OpenAI/Kie 重构架构方案

## 一、设计原则
- **最小化改动**：复用现有抽象，避免引入新的复杂度
- **零新文件**：不创建新的共享组件/hooks，直接在现有文件中重构
- **保持行为**：功能对等迁移，UI/UX 保持一致

## 二、共享代码分析

### 2.1 已共享抽象（无需改动）
| 抽象 | 位置 | 用途 |
|------|------|------|
| `uiStyles.ts` | `components/uiStyles.ts` | 按钮/输入框样式函数 |
| `ImageGrid` | `components/ImageGrid.tsx` | 图片展示网格 |
| `PromptOptimizerSettings` | `components/PromptOptimizerSettings.tsx` | 提示词优化器配置 |
| `IterationAssistant` | `components/IterationAssistant.tsx` | 迭代助手 |
| `SamplePromptChips` | `components/SamplePromptChips.tsx` | 示例提示词 |
| `Toast` | `components/Toast.tsx` | 通知系统 |
| DB functions | `services/db.ts` | 供应商/草稿持久化 |

### 2.2 需对齐的差异点

#### A. 参考图限制
- **现状**：OpenAI 4 张，Kie 8 张
- **方案**：统一改为 8 张（OpenAI: `1036, 1044` → `slice(0, 8)`）

#### B. 批量下载
- **现状**：OpenAI 有 `handleBatchDownloadAll`（1003-1014），Kie 无
- **方案**：Kie 新增（参考 OpenAI 实现）

#### C. Portfolio prop
- **现状**：OpenAI 有 `portfolio` prop（未使用）
- **方案**：删除（接口定义 46-52 + 解构 138）

#### D. Antigravity Tools 特性
- **现状**：OpenAI 根据 `variant` 隐藏比例/尺寸选择器
- **方案**：保持不变（Kie 无此逻辑）

#### E. 迭代助手响应式
- **现状**：OpenAI 桌面端可见（1233 `hidden md:block`），Kie 始终可见（1021）
- **方案**：Kie 改为 `hidden md:block`

#### F. outputFormat
- **现状**：Kie 有 `outputFormat` 选择器（1125-1138），OpenAI 无
- **方案**：保持不变（Kie 专属）

## 三、文件变更清单

### 3.1 需修改文件（3 个）

#### `components/OpenAIPage.tsx`
**变更点**：
1. **删除 portfolio prop**（2 处）
   - L46-48：删除 `portfolio: GeneratedImage[]` 字段
   - L138：移除 `portfolio` 解构
2. **参考图限制 4→8**（1 处）
   - L1036：`slice(0, 4)` → `slice(0, 8)`
3. **参考图显示 4→8**（2 处）
   - L1420：`{refImages.length}/4` → `{refImages.length}/8`
   - L1426：`参考图 ({refImages.length}/4)` → `参考图 ({refImages.length}/8)`

**风险**：极低（仅数值常量调整）

---

#### `components/KiePage.tsx`
**变更点**：
1. **新增批量下载功能**（3 处）
   - 导入 `downloadImagesSequentially`（新增 import）
   - 新增 `handleBatchDownloadAll` 函数（参考 OpenAI:1003-1014）
   - 批量进度条中新增"下载全部"按钮（参考 OpenAI:1191-1201）
2. **迭代助手响应式优化**（1 处）
   - L1021：外层 div 添加 `className="hidden md:block"`

**风险**：低（纯增量，不影响现有逻辑）

---

#### `components/uiStyles.ts`
**变更点**：无（已统一 Aurora 样式）

**风险**：无

---

### 3.2 不需要修改的文件
- `services/openai.ts`：逻辑独立
- `services/kie.ts`：逻辑独立
- `types.ts`：类型已覆盖所有场景
- 其他共享组件：已对齐

## 四、实施步骤

### Step 1: OpenAIPage 清理（5 分钟）
```bash
# 改动行：46-48, 138, 1036, 1420, 1426（共 5 处）
```
1. 删除 `portfolio` prop 定义和解构
2. 将参考图限制从 4 改为 8

### Step 2: KiePage 增强（10 分钟）
```bash
# 改动行：导入区 + 新增函数 + 进度条按钮 + 1021（共 4 处）
```
1. 导入 `downloadImagesSequentially`
2. 新增 `handleBatchDownloadAll` 函数
3. 批量进度条新增"下载全部"按钮
4. 迭代助手添加响应式隐藏

### Step 3: 验证测试
- [ ] OpenAI 参考图上限 8 张
- [ ] OpenAI 无 portfolio prop 编译错误
- [ ] Kie 批量下载功能正常
- [ ] Kie 移动端迭代助手隐藏

## 五、风险评估

### 5.1 技术风险
| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| OpenAI portfolio 移除导致外部调用失败 | 低 | 检查 App.tsx 调用点，确保未传递 portfolio |
| Kie 批量下载逻辑与 OpenAI 不一致 | 低 | 直接复制 OpenAI 实现，延迟参数保持 140ms |
| 响应式断点不一致 | 极低 | 已统一为 `md:` (768px) |

### 5.2 边缘情况
1. **参考图上传超限**
   - 场景：用户一次上传 10 张图
   - 处理：`slice(0, 8)` 自动截断
2. **批量下载浏览器限制**
   - 场景：浏览器阻止批量下载
   - 处理：已有 140ms 延迟缓解（OpenAI 验证过）
3. **移动端迭代助手空白**
   - 场景：Kie 移动端迭代助手消失后右侧空白
   - 处理：`hidden md:block` 自动收缩布局

## 六、对比验证

### 6.1 功能对齐检查表
| 功能 | OpenAI | Kie | 备注 |
|------|--------|-----|------|
| 供应商管理 | ✅ | ✅ | 已对齐 |
| 草稿持久化 | ✅ | ✅ | 已对齐 |
| 提示词优化 | ✅ | ✅ | 已对齐 |
| 批量生成 | ✅ | ✅ | 已对齐 |
| 批量下载 | ✅ | 🔧 需新增 | **待实施** |
| 参考图限制 | 8 | 8 | **已对齐** |
| 迭代助手响应式 | ✅ | 🔧 需修改 | **待实施** |
| 比例/尺寸选择 | 条件隐藏 | 始终显示 | **保持差异**（Antigravity Tools 特性）|
| outputFormat | ❌ | ✅ | **保持差异**（Kie 专属）|

### 6.2 UI 结构对比
两个组件结构完全一致：
```
┌─ 上区（flex-1）
│  ├─ 左侧：API 配置（280px）
│  ├─ 中间：图片展示（flex-1）
│  └─ 右侧：迭代助手（md:block）
└─ 下区（shrink-0）
   └─ Prompt + 参数 + 生成按钮
```

## 七、总结

### 最小化改动承诺
- **修改文件**：2 个（OpenAIPage.tsx, KiePage.tsx）
- **新增文件**：0 个
- **代码行变更**：~20 行（删除 5 + 新增 15）
- **风险等级**：低
- **回归测试范围**：参考图上传 + 批量下载

### 下一步
1. 用户确认架构方案
2. 执行 Step 1-3 实施
3. 运行 E2E 测试验证
