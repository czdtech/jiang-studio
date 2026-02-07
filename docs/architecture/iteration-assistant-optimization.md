# IterationAssistant 优化方案架构设计

## 1. 场景拆解

### 场景1：单提示词 + 1张图 ✅
**当前状态**：工作正常
- 用户输入一个提示词，生成1张图
- 迭代助手基于主输入框的提示词进行迭代
- `onUseVersion` 直接替换主输入框，符合预期

**用户期望**：保持现状即可

---

### 场景2：单提示词 + 4张图 ❌
**当前问题**：
- 用户输入一个提示词，生成4张图（`count: 4`）
- 4张图都使用相同的提示词生成
- 用户想针对**其中某张图**进行优化（比如第2张）
- 但迭代助手只知道主输入框的全局提示词，无法知道用户想优化哪张图
- 迭代结果会替换整个主输入框，影响其他图片的上下文

**用户期望**：
- 能够选择某张图片，针对该图片的提示词进行迭代
- 迭代结果应该只影响该图片的重新生成，不影响其他图片
- 或者能够基于图片本身（视觉内容）进行迭代，而不仅仅是提示词

**示例流程**：
```
1. 用户输入 "a cat"，生成4张图
2. 用户看到第2张图，觉得"这只猫的表情不够生动"
3. 用户点击第2张图的"迭代"按钮（或右键菜单）
4. 迭代助手打开，显示该图片和它的提示词 "a cat"
5. 用户输入"让表情更生动"
6. 迭代助手返回优化后的提示词 "a cat with expressive and lively facial features"
7. 用户点击"使用此版本"，只重新生成第2张图
```

---

### 场景3：多提示词 × 多图 ❌
**当前问题**：
- 用户输入多个提示词（用换行分隔），每个提示词生成多张图
- 例如：4个提示词，每个生成4张图，共16张图
- 用户想针对**某个特定提示词的某张图**进行优化
- 迭代助手完全无法处理这种场景

**用户期望**：
- 能够精确定位到某个提示词下的某张图
- 迭代时能够看到该图片和它的提示词
- 迭代结果只影响该图片的重新生成
- 在批量模式下，能够看到提示词分组，方便定位

**示例流程**：
```
批量任务：
- 提示词1: "a cat" → 4张图
- 提示词2: "a dog" → 4张图  
- 提示词3: "a bird" → 4张图
- 提示词4: "a fish" → 4张图

用户操作：
1. 用户看到"提示词2"的第3张图，觉得"这只狗的颜色不够鲜艳"
2. 用户点击该图片的"迭代"按钮
3. 迭代助手打开，显示：
   - 当前图片（视觉预览）
   - 当前提示词："a dog"
   - 上下文信息："提示词2/4，第3张/4张"
4. 用户输入"让颜色更鲜艳"
5. 迭代助手返回："a dog with vibrant and vivid colors"
6. 用户点击"使用此版本"，只重新生成该图片
```

---

## 2. 核心矛盾

### 矛盾1：单一提示词 vs 多图上下文
- **当前**：`IterationAssistant` 只接收 `currentPrompt: string`
- **问题**：无法知道用户想迭代哪张图，无法提供图片视觉上下文
- **影响**：迭代结果可能不符合用户期望

### 矛盾2：全局替换 vs 精准更新
- **当前**：`onUseVersion` 直接 `setPrompt`，替换整个主输入框
- **问题**：在多提示词场景下，替换会破坏其他提示词
- **影响**：用户无法精准迭代单张图片

### 矛盾3：文本迭代 vs 视觉迭代
- **当前**：迭代基于提示词文本，MCP 服务不支持图片输入
- **问题**：用户可能想基于图片视觉内容进行迭代（"让这只猫的表情更生动"）
- **影响**：迭代质量受限，无法利用视觉信息

### 矛盾4：组件职责不清
- **当前**：`IterationAssistant` 是全局组件，不知道图片上下文
- **问题**：图片展示组件（`ImageGrid`/`BatchImageGrid`）有 Edit 按钮，但没有迭代入口
- **影响**：用户不知道如何触发单图迭代

---

## 3. 设计方案

### 方案A：最小变更（复用现有抽象）

#### 设计思路
- 在图片卡片上添加"迭代"按钮（类似 Edit 按钮）
- 点击后打开 `IterationAssistant`，传入该图片的 `prompt`
- `onUseVersion` 回调改为接收图片ID，父组件负责重新生成该图片
- MCP 服务保持不变（纯文本迭代）

#### 架构改动

**1. IterationAssistant 组件扩展**
```typescript
// components/IterationAssistant.tsx
interface IterationAssistantProps {
  // 新增：当前迭代的图片上下文
  targetImage?: GeneratedImage;  // 可选，如果有则显示图片预览
  currentPrompt: string;         // 该图片的提示词（targetImage.prompt）
  onUseVersion: (prompt: string) => void;
  // 新增：迭代完成后是否自动重新生成
  onRegenerate?: (imageId: string, newPrompt: string) => void;
  iterateTemplateId?: string;
  onTemplateChange?: (templateId: string) => void;
}
```

**2. 图片展示组件添加迭代入口**
```typescript
// components/ImageGrid.tsx
interface ImageGridProps {
  // ... existing props
  onIterate?: (image: GeneratedImage) => void;  // 新增
}

// 在图片卡片上添加迭代按钮（Edit 按钮旁边）
<button onClick={() => onIterate?.(img)}>
  <Sparkles /> 迭代
</button>
```

**3. 父组件集成**
```typescript
// components/GeminiPage.tsx
const [iteratingImage, setIteratingImage] = useState<GeneratedImage | null>(null);

// 在 IterationAssistant 中
<IterationAssistant
  targetImage={iteratingImage}
  currentPrompt={iteratingImage?.prompt || prompt}
  onUseVersion={(newPrompt) => {
    if (iteratingImage) {
      // 重新生成该图片
      handleRegenerateImage(iteratingImage.id, newPrompt);
      setIteratingImage(null);
    } else {
      // 传统行为：替换主输入框
      setPrompt(newPrompt);
    }
  }}
/>
```

**4. 重新生成单图逻辑**
```typescript
// components/GeminiPage.tsx
const handleRegenerateImage = async (imageId: string, newPrompt: string) => {
  const image = currentImages.find(img => img.id === imageId);
  if (!image) return;
  
  // 使用新提示词重新生成，保持其他参数不变
  const newImage = await generateImages({
    ...image.params,
    prompt: newPrompt,
    count: 1,
  });
  
  // 替换原图片
  setCurrentImages(prev => prev.map(img => 
    img.id === imageId ? newImage[0] : img
  ));
};
```

#### 优点
- ✅ 改动最小，复用现有组件
- ✅ 向后兼容，不影响现有功能
- ✅ 实现简单，风险低
- ✅ 支持场景1和场景2

#### 缺点
- ❌ 不支持场景3（多提示词批量模式）
- ❌ 不支持视觉迭代（MCP 服务不支持图片输入）
- ❌ 批量模式下无法精确定位提示词
- ❌ 用户体验不够直观（需要点击按钮打开助手）

#### 文件改动清单
1. `components/IterationAssistant.tsx`
   - 添加 `targetImage?: GeneratedImage` prop
   - 添加图片预览区域（如果有 targetImage）
   - 调整空状态提示

2. `components/ImageGrid.tsx`
   - 添加 `onIterate?: (image: GeneratedImage) => void` prop
   - 在图片卡片 hover 区域添加迭代按钮

3. `components/BatchImageGrid.tsx`
   - 添加 `onIterate?: (image: GeneratedImage) => void` prop
   - 在图片卡片 hover 区域添加迭代按钮

4. `components/GeminiPage.tsx`
   - 添加 `iteratingImage` state
   - 添加 `handleRegenerateImage` 函数
   - 修改 `IterationAssistant` 集成
   - 在 `ImageGrid`/`BatchImageGrid` 传入 `onIterate`

5. `components/OpenAIPage.tsx`（同 GeminiPage）
6. `components/KiePage.tsx`（同 GeminiPage）

---

### 方案B：中等改造（平衡体验和复杂度）

#### 设计思路
- 扩展 `IterationAssistant` 支持图片上下文
- 添加图片预览区域，显示当前迭代的图片
- `onUseVersion` 支持两种模式：全局替换 vs 单图重新生成
- MCP 服务扩展支持图片输入（可选，如果 MCP 支持）
- 批量模式下，显示提示词分组信息

#### 架构改动

**1. IterationAssistant 组件重构**
```typescript
// components/IterationAssistant.tsx
interface IterationContext {
  image?: GeneratedImage;
  prompt: string;
  // 批量模式上下文
  batchInfo?: {
    taskId: string;
    taskPrompt: string;
    taskIndex: number;
    totalTasks: number;
    imageIndex: number;
    totalImages: number;
  };
}

interface IterationAssistantProps {
  context?: IterationContext;  // 替换 currentPrompt
  mode: 'global' | 'image';    // 全局模式 vs 单图模式
  onUseVersion: (prompt: string, context?: IterationContext) => void;
  iterateTemplateId?: string;
  onTemplateChange?: (templateId: string) => void;
}
```

**2. MCP 服务扩展（如果支持）**
```typescript
// services/mcp.ts
export async function iteratePrompt(
  prompt: string,
  requirement: string,
  templateId?: string,
  imageBase64?: string  // 新增：图片上下文
): Promise<string> {
  const args: Record<string, unknown> = { prompt, requirements: requirement };
  if (templateId) args.template = templateId;
  if (imageBase64) args.image = imageBase64;  // MCP 工具需要支持
  return callTool('iterate-prompt', args);
}
```

**3. 图片展示组件**
```typescript
// components/ImageGrid.tsx
// 添加迭代按钮，点击后设置 context
onIterate={(img) => {
  setIterationContext({
    image: img,
    prompt: img.prompt,
  });
  setIterationMode('image');
}}
```

**4. 批量模式支持**
```typescript
// components/BatchImageGrid.tsx
onIterate={(img, task, taskIndex, imageIndex) => {
  setIterationContext({
    image: img,
    prompt: img.prompt,
    batchInfo: {
      taskId: task.id,
      taskPrompt: task.prompt,
      taskIndex,
      totalTasks: tasks.length,
      imageIndex,
      totalImages: task.images?.length || 0,
    },
  });
  setIterationMode('image');
}}
```

**5. 父组件集成**
```typescript
// components/GeminiPage.tsx
const [iterationContext, setIterationContext] = useState<IterationContext | undefined>();
const [iterationMode, setIterationMode] = useState<'global' | 'image'>('global');

<IterationAssistant
  context={iterationContext || { prompt }}
  mode={iterationMode}
  onUseVersion={(newPrompt, ctx) => {
    if (ctx?.image && iterationMode === 'image') {
      // 单图重新生成
      handleRegenerateImage(ctx.image.id, newPrompt, ctx.batchInfo);
    } else {
      // 全局替换
      setPrompt(newPrompt);
    }
    setIterationContext(undefined);
    setIterationMode('global');
  }}
/>
```

#### 优点
- ✅ 支持所有3种场景
- ✅ 用户体验更好（图片预览 + 上下文信息）
- ✅ 支持批量模式的精确定位
- ✅ 向后兼容（mode='global' 时行为不变）
- ✅ 为未来视觉迭代预留接口

#### 缺点
- ❌ 实现复杂度中等
- ❌ 需要 MCP 服务支持图片输入（可选）
- ❌ 批量模式上下文信息需要额外传递

#### 文件改动清单
1. `components/IterationAssistant.tsx`
   - 重构 props，使用 `IterationContext`
   - 添加图片预览区域
   - 添加批量模式上下文显示
   - 根据 mode 调整 UI

2. `types.ts`
   - 添加 `IterationContext` 接口

3. `components/ImageGrid.tsx`
   - 添加 `onIterate` prop
   - 添加迭代按钮

4. `components/BatchImageGrid.tsx`
   - 添加 `onIterate` prop（支持传递 batchInfo）
   - 添加迭代按钮

5. `components/GeminiPage.tsx`
   - 添加 `iterationContext` 和 `iterationMode` state
   - 添加 `handleRegenerateImage`（支持批量模式）
   - 重构 `IterationAssistant` 集成

6. `components/OpenAIPage.tsx`（同 GeminiPage）
7. `components/KiePage.tsx`（同 GeminiPage）

8. `services/mcp.ts`（可选）
   - 扩展 `iteratePrompt` 支持图片输入

---

### 方案C：理想方案（最佳用户体验）

#### 设计思路
- `IterationAssistant` 改为模态框或侧边栏，支持多实例
- 每个图片可以独立打开迭代助手
- 支持视觉迭代（MCP 服务支持图片输入）
- 批量模式下，每个提示词行可以独立迭代
- 迭代结果可以预览，支持多版本对比
- 支持批量迭代（一次迭代多个图片）

#### 架构改动

**1. IterationAssistant 改为独立模态框**
```typescript
// components/IterationAssistantModal.tsx（新文件）
interface IterationAssistantModalProps {
  isOpen: boolean;
  context: IterationContext;
  onClose: () => void;
  onUseVersion: (prompt: string) => void;
  onRegenerate: (imageId: string, newPrompt: string) => Promise<void>;
  iterateTemplateId?: string;
}

// 模态框布局：
// - 左侧：图片预览 + 当前提示词
// - 右侧：迭代对话界面
// - 底部：操作按钮（使用此版本、重新生成、取消）
```

**2. 图片展示组件集成**
```typescript
// components/ImageGrid.tsx
// 每个图片卡片都有迭代入口
<button onClick={() => openIterationModal(img)}>
  <Sparkles /> 迭代
</button>
```

**3. 批量模式增强**
```typescript
// components/BatchImageGrid.tsx
// 每个提示词行可以整体迭代
<div className="aurora-batch-row-header">
  <span>{task.prompt}</span>
  <button onClick={() => openIterationModalForTask(task)}>
    迭代整行
  </button>
</div>

// 每个图片也可以单独迭代
<button onClick={() => openIterationModal(img, task)}>
  迭代
</button>
```

**4. MCP 服务完整支持视觉迭代**
```typescript
// services/mcp.ts
export async function iteratePromptWithImage(
  prompt: string,
  requirement: string,
  imageBase64: string,
  templateId?: string
): Promise<string> {
  // MCP 工具接收图片，进行视觉分析
  return callTool('iterate-prompt-with-image', {
    prompt,
    requirements: requirement,
    image: imageBase64,
    template: templateId,
  });
}
```

**5. 迭代结果预览**
```typescript
// components/IterationPreview.tsx（新文件）
// 显示迭代前后的提示词对比
// 支持多版本选择
```

#### 优点
- ✅ 最佳用户体验（模态框聚焦、图片预览、上下文清晰）
- ✅ 支持所有场景，包括批量迭代
- ✅ 支持视觉迭代（如果 MCP 支持）
- ✅ 支持多版本对比
- ✅ 不影响主界面布局

#### 缺点
- ❌ 实现复杂度高
- ❌ 需要 MCP 服务支持图片输入
- ❌ 需要大量 UI 重构
- ❌ 开发周期长

#### 文件改动清单
1. `components/IterationAssistantModal.tsx`（新文件）
   - 完整的模态框实现
   - 图片预览区域
   - 迭代对话界面
   - 操作按钮

2. `components/IterationPreview.tsx`（新文件）
   - 迭代结果预览
   - 多版本对比

3. `types.ts`
   - 添加 `IterationContext` 接口
   - 添加迭代相关类型

4. `components/ImageGrid.tsx`
   - 添加迭代按钮
   - 集成模态框打开逻辑

5. `components/BatchImageGrid.tsx`
   - 添加行级迭代按钮
   - 添加图片级迭代按钮
   - 集成模态框打开逻辑

6. `components/GeminiPage.tsx`
   - 添加模态框状态管理
   - 添加重新生成逻辑
   - 集成 `IterationAssistantModal`

7. `components/OpenAIPage.tsx`（同 GeminiPage）
8. `components/KiePage.tsx`（同 GeminiPage）

9. `services/mcp.ts`
   - 添加 `iteratePromptWithImage` 函数

10. `index.css`
    - 添加模态框样式

---

## 4. 推荐方案

### 推荐：方案B（中等改造）

#### 推荐理由
1. **平衡性**：在用户体验和实现复杂度之间取得良好平衡
2. **覆盖性**：支持所有3种场景，满足用户需求
3. **渐进性**：可以分阶段实现，先实现基础功能，再扩展高级特性
4. **兼容性**：向后兼容，不影响现有功能
5. **扩展性**：为未来视觉迭代预留接口

#### 渐进式实现路径

**阶段1：基础单图迭代（1-2天）**
- 实现方案A的核心功能
- 图片卡片添加迭代按钮
- `IterationAssistant` 支持图片上下文
- 单图重新生成逻辑

**阶段2：批量模式支持（1-2天）**
- 扩展 `IterationContext` 支持批量信息
- `BatchImageGrid` 集成迭代功能
- 批量模式下的重新生成逻辑

**阶段3：视觉迭代（可选，依赖 MCP）**
- MCP 服务扩展支持图片输入
- `IterationAssistant` 传递图片到 MCP
- 优化迭代质量

**阶段4：体验优化（可选）**
- 添加图片预览区域
- 优化 UI/UX
- 添加加载状态和错误处理

---

## 5. UX 交互流程描述

### 场景1：单提示词 + 1张图（保持不变）
```
1. 用户输入提示词，生成1张图
2. 用户点击右侧迭代助手
3. 输入修改需求
4. 点击"使用此版本"
5. 主输入框更新为新提示词
```

### 场景2：单提示词 + 4张图（新流程）
```
1. 用户输入提示词，生成4张图
2. 用户 hover 第2张图，看到"迭代"按钮
3. 用户点击"迭代"按钮
4. 迭代助手自动切换到"单图模式"：
   - 显示第2张图的预览（小缩略图）
   - 显示该图的提示词："a cat"
   - 显示上下文："第2张/4张"
5. 用户输入修改需求："让表情更生动"
6. 迭代助手返回优化后的提示词
7. 用户点击"使用此版本"
8. 系统只重新生成第2张图，其他3张图不变
9. 迭代助手自动切换回"全局模式"
```

### 场景3：多提示词 × 多图（新流程）
```
1. 用户输入4个提示词，批量生成16张图
2. 用户看到"提示词2"的第3张图，想迭代
3. 用户 hover 该图片，点击"迭代"按钮
4. 迭代助手切换到"单图模式"：
   - 显示图片预览
   - 显示提示词："a dog"
   - 显示上下文："提示词2/4，第3张/4张"
5. 用户输入修改需求："让颜色更鲜艳"
6. 迭代助手返回优化后的提示词
7. 用户点击"使用此版本"
8. 系统只重新生成该图片，其他15张图不变
9. 迭代助手切换回"全局模式"

可选：用户也可以点击提示词行的"迭代整行"按钮
- 迭代该提示词下的所有图片
- 迭代结果应用到该提示词的所有图片
```

### 交互细节

**迭代按钮位置**：
- 单图模式：图片卡片 hover 时，在 Edit/Download 按钮旁边显示"迭代"按钮
- 批量模式：每个图片卡片都有迭代按钮；提示词行也有"迭代整行"按钮

**迭代助手状态切换**：
- 全局模式：显示主输入框的提示词，`onUseVersion` 替换主输入框
- 单图模式：显示图片预览和该图的提示词，`onUseVersion` 重新生成该图片

**视觉反馈**：
- 点击迭代按钮时，迭代助手高亮显示
- 单图模式下，图片预览区域有边框高亮
- 重新生成时，原图片位置显示加载状态

**错误处理**：
- 如果重新生成失败，显示错误提示
- 如果 MCP 服务不可用，降级到纯文本迭代

---

## 6. 技术细节

### 重新生成单图逻辑

```typescript
// components/GeminiPage.tsx
const handleRegenerateImage = async (
  imageId: string,
  newPrompt: string,
  batchInfo?: IterationContext['batchInfo']
) => {
  const image = batchInfo
    ? batchTasks
        .find(t => t.id === batchInfo.taskId)
        ?.images?.find(img => img.id === imageId)
    : currentImages.find(img => img.id === imageId);
  
  if (!image) return;
  
  try {
    setIsGenerating(true);
    const outcomes = await generateImages(
      {
        ...image.params,
        prompt: newPrompt,
        count: 1,
      },
      settings,
      { signal: abortControllerRef.current?.signal }
    );
    
    const newImage = outcomes[0]?.ok ? outcomes[0].image : null;
    if (!newImage) throw new Error('生成失败');
    
    // 更新图片
    if (batchInfo) {
      // 批量模式：更新对应 task 的图片
      setBatchTasks(prev => prev.map(task => 
        task.id === batchInfo.taskId
          ? {
              ...task,
              images: task.images?.map(img => 
                img.id === imageId ? { ...newImage, sourceScope: scope, sourceProviderId: activeProviderId } : img
              ) || [],
            }
          : task
      ));
    } else {
      // 单图模式：更新 currentImages
      setCurrentImages(prev => prev.map(img => 
        img.id === imageId ? { ...newImage, sourceScope: scope, sourceProviderId: activeProviderId } : img
      ));
    }
    
    await saveImage(newImage);
    showToast('图片已重新生成', 'success');
  } catch (error) {
    showToast('重新生成失败：' + (error instanceof Error ? error.message : '未知错误'), 'error');
  } finally {
    setIsGenerating(false);
  }
};
```

### 批量模式上下文传递

```typescript
// components/BatchImageGrid.tsx
const handleIterate = (img: GeneratedImage, task: BatchTask, taskIndex: number) => {
  const imageIndex = task.images?.findIndex(i => i.id === img.id) ?? 0;
  onIterate?.(img, {
    taskId: task.id,
    taskPrompt: task.prompt,
    taskIndex,
    totalTasks: tasks.length,
    imageIndex,
    totalImages: task.images?.length || 0,
  });
};
```

---

## 7. 测试考虑

### 单元测试
- `IterationAssistant` 组件在不同 mode 下的行为
- `handleRegenerateImage` 函数的正确性
- 批量模式上下文传递的正确性

### 集成测试
- 场景1：单提示词 + 1张图的迭代流程
- 场景2：单提示词 + 4张图的单图迭代
- 场景3：多提示词 × 多图的精准迭代
- 错误处理：MCP 服务不可用时的降级

### E2E 测试
- 完整的用户交互流程
- 图片重新生成的正确性
- 批量模式下的迭代流程

---

## 8. 后续优化方向

1. **视觉迭代**：如果 MCP 服务支持图片输入，实现基于视觉内容的迭代
2. **批量迭代**：支持一次迭代多个图片
3. **迭代历史**：保存迭代历史，支持回退
4. **A/B 对比**：支持对比不同迭代版本的效果
5. **智能建议**：基于图片内容自动生成迭代建议

---

## 总结

推荐采用**方案B（中等改造）**，分阶段实现：

1. **阶段1**：基础单图迭代（场景1、2）
2. **阶段2**：批量模式支持（场景3）
3. **阶段3**：视觉迭代（可选）
4. **阶段4**：体验优化（可选）

该方案在用户体验和实现复杂度之间取得良好平衡，支持所有场景，向后兼容，且为未来扩展预留接口。
