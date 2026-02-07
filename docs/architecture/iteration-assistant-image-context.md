# IterationAssistant 图片上下文迭代架构设计

## 1. 类型定义变更

### 1.1 新增类型（types.ts）

```typescript
/** 迭代上下文：包含图片和提示词信息 */
export interface IterationContext {
  /** 目标图片（用于精准迭代） */
  targetImage?: GeneratedImage;
  /** 目标图片的提示词（如果图片有独立 prompt） */
  targetPrompt?: string;
  /** 当前所有图片列表（用于显示缩略图） */
  allImages?: GeneratedImage[];
  /** 当前选中的图片索引（用于高亮） */
  selectedImageIndex?: number;
}

/** 迭代模式 */
export type IterationMode = 'prompt-only' | 'image-context';

/** 迭代助手配置 */
export interface IterationAssistantConfig {
  /** 当前迭代模式 */
  mode: IterationMode;
  /** 迭代上下文 */
  context?: IterationContext;
}
```

### 1.2 修改类型

#### IterationAssistantProps（components/IterationAssistant.tsx）

```typescript
interface IterationAssistantProps {
  /** 当前主提示词 */
  currentPrompt: string;
  /** 用户选择使用某个版本时的回调 */
  onUseVersion: (prompt: string) => void;
  /** 迭代模板 ID */
  iterateTemplateId?: string;
  /** 模板变更回调 */
  onTemplateChange?: (templateId: string) => void;
  
  // ========== 新增属性 ==========
  /** 迭代配置（包含图片上下文） */
  iterationConfig?: IterationAssistantConfig;
  /** 生成图片的回调（用于"使用此版本"后自动生成） */
  onGenerate?: (prompt: string, context?: IterationContext) => Promise<void>;
  /** 当前所有图片列表（用于显示缩略图） */
  allImages?: GeneratedImage[];
}
```

#### ImageGridProps（components/ImageGrid.tsx）

```typescript
interface ImageGridProps {
  // ... 现有属性 ...
  
  // ========== 新增属性 ==========
  /** 迭代回调（点击图片时触发） */
  onIterate?: (image: GeneratedImage, index: number, allImages: GeneratedImage[]) => void;
}
```

#### BatchImageGridProps（components/BatchImageGrid.tsx）

```typescript
interface BatchImageGridProps {
  // ... 现有属性 ...
  
  // ========== 新增属性 ==========
  /** 迭代回调（点击图片时触发） */
  onIterate?: (image: GeneratedImage, index: number, allImages: GeneratedImage[]) => void;
}
```

### 1.3 MCP 服务接口预留（services/mcp.ts）

```typescript
/**
 * 迭代优化提示词（迭代助手使用）
 * 
 * @param prompt 当前提示词
 * @param requirement 用户的修改需求
 * @param templateId 可选的模板 ID
 * @param context 可选的图片上下文（阶段1不实现，仅预留接口）
 * @returns 优化后的提示词
 */
export async function iteratePrompt(
  prompt: string,
  requirement: string,
  templateId?: string,
  context?: {
    targetImageBase64?: string;  // 目标图片的 base64（阶段2实现）
    targetImagePrompt?: string;   // 目标图片的 prompt（阶段2实现）
  }
): Promise<string> {
  const args: Record<string, unknown> = { prompt, requirements: requirement };
  if (templateId) {
    args.template = templateId;
  }
  // 阶段1：context 参数预留但不传递
  // 阶段2：if (context?.targetImageBase64) { args.targetImage = context.targetImageBase64; }
  // 阶段2：if (context?.targetImagePrompt) { args.targetImagePrompt = context.targetImagePrompt; }
  return callTool('iterate-prompt', args);
}
```

---

## 2. 组件改动清单

### 2.1 IterationAssistant.tsx

**改动范围：**
- 新增 props：`iterationConfig`, `onGenerate`, `allImages`
- 新增状态：`mode`（从 `iterationConfig.mode` 派生）
- 新增 UI：顶部图片缩略图区域（仅在 `mode === 'image-context'` 时显示）
- 修改逻辑：`onUseVersion` 回调改为调用 `onGenerate`（如果存在）

**关键改动点：**

1. **顶部缩略图区域**（新增）
   ```tsx
   {mode === 'image-context' && iterationConfig?.context && (
     <div className="aurora-assistant-image-context">
       {/* 显示目标图片缩略图 + 所有图片缩略图（可选） */}
     </div>
   )}
   ```

2. **"使用此版本"按钮逻辑**（修改）
   ```tsx
   <button
     onClick={() => {
       if (onGenerate && iterationConfig?.context) {
         // 有图片上下文：生成新图并追加
         void onGenerate(msg.content, iterationConfig.context);
       } else {
         // 无图片上下文：仅更新 prompt（向后兼容）
         onUseVersion(msg.content);
       }
     }}
   >
     使用此版本
   </button>
   ```

### 2.2 ImageGrid.tsx

**改动范围：**
- 新增 prop：`onIterate`
- 修改：图片卡片 hover 时显示"迭代"按钮（仅在 `onIterate` 存在时）

**关键改动点：**

```tsx
{onIterate && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onIterate(img, idx, images);
    }}
    aria-label="迭代此图片"
    className="h-8 w-8 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-banana-500 transition-colors flex items-center justify-center"
  >
    <Sparkles className="w-4 h-4" />
  </button>
)}
```

### 2.3 BatchImageGrid.tsx

**改动范围：**
- 新增 prop：`onIterate`
- 修改：图片卡片 hover 时显示"迭代"按钮（仅在 `onIterate` 存在时）

**关键改动点：**（同 ImageGrid.tsx）

### 2.4 GeminiPage.tsx / OpenAIPage.tsx / KiePage.tsx

**改动范围：**
- 新增状态：`iterationConfig`（`IterationAssistantConfig`）
- 新增函数：`handleIterate`（处理图片迭代点击）
- 新增函数：`handleIterationGenerate`（处理迭代后的图片生成）
- 修改：`IterationAssistant` 组件传入新 props

**关键改动点：**

1. **新增状态**
   ```tsx
   const [iterationConfig, setIterationConfig] = useState<IterationAssistantConfig | undefined>();
   ```

2. **新增迭代点击处理**
   ```tsx
   const handleIterate = useCallback((image: GeneratedImage, index: number, allImages: GeneratedImage[]) => {
     setIterationConfig({
       mode: 'image-context',
       context: {
         targetImage: image,
         targetPrompt: image.prompt,
         allImages: allImages,
         selectedImageIndex: index,
       },
     });
     // 可选：滚动到迭代助手区域
   }, []);
   ```

3. **新增迭代生成处理**
   ```tsx
   const handleIterationGenerate = useCallback(async (prompt: string, context?: IterationContext) => {
     // 1. 更新 prompt
     setPrompt(prompt);
     
     // 2. 使用目标图片的生成参数（如果有）
     const baseParams: GenerationParams = {
       ...params,
       prompt,
       // 可选：从 context.targetImage.params 继承部分参数
     };
     
     // 3. 调用生成（复用现有 handleGenerate 逻辑）
     // 注意：生成后会自动追加到 currentImages（保留原图）
     
     // 4. 可选：清除迭代上下文（或保留以便继续迭代）
     // setIterationConfig(undefined);
   }, [params, /* ... */]);
   ```

4. **修改 IterationAssistant 调用**
   ```tsx
   <IterationAssistant
     currentPrompt={prompt}
     onUseVersion={setPrompt}
     iterateTemplateId={optimizerConfig?.iterateTemplateId}
     onTemplateChange={handleIterateTemplateChange}
     iterationConfig={iterationConfig}
     onGenerate={handleIterationGenerate}
     allImages={currentImages}
   />
   ```

5. **修改 ImageGrid / BatchImageGrid 调用**
   ```tsx
   <ImageGrid
     images={currentImages}
     // ... 现有 props ...
     onIterate={handleIterate}
   />
   
   <BatchImageGrid
     // ... 现有 props ...
     onIterate={handleIterate}
   />
   ```

---

## 3. 数据流图

### 3.1 用户点击图片"迭代"按钮

```
用户点击图片"迭代"按钮
  ↓
ImageGrid.onIterate(image, index, allImages)
  ↓
GeminiPage.handleIterate(image, index, allImages)
  ↓
setIterationConfig({
  mode: 'image-context',
  context: {
    targetImage: image,
    targetPrompt: image.prompt,
    allImages: allImages,
    selectedImageIndex: index,
  }
})
  ↓
IterationAssistant 接收 iterationConfig prop
  ↓
UI 更新：显示顶部图片缩略图 + 高亮选中图片
```

### 3.2 用户在迭代助手中输入需求并发送

```
用户在迭代助手输入框输入需求
  ↓
IterationAssistant.sendMessage(requirement)
  ↓
const basePrompt = iterationConfig?.context?.targetPrompt || currentPrompt
  ↓
iteratePrompt(basePrompt, requirement, templateId, {
  // 阶段1：context 参数预留但不传递
  // 阶段2：targetImageBase64: context.targetImage.base64,
  // 阶段2：targetImagePrompt: context.targetImage.prompt,
})
  ↓
返回优化后的 prompt
  ↓
显示在消息列表中（AI 回复）
```

### 3.3 用户点击"使用此版本"

```
用户点击"使用此版本"按钮
  ↓
判断：是否有 onGenerate 和 iterationConfig.context？
  ├─ 是（有图片上下文）
  │   ↓
  │   IterationAssistant 调用 onGenerate(optimizedPrompt, iterationConfig.context)
  │   ↓
  │   GeminiPage.handleIterationGenerate(optimizedPrompt, context)
  │   ↓
  │   1. setPrompt(optimizedPrompt)  // 更新 prompt
  │   2. 构建 GenerationParams（可选：继承 context.targetImage.params）
  │   3. 调用 generateImages(...)
  │   ↓
  │   生成成功
  │   ↓
  │   setCurrentImages(prev => [...newImages, ...prev])  // 追加新图（保留原图）
  │   ↓
  │   saveImage(...)  // 保存到数据库
  │   ↓
  │   完成：新图追加到列表顶部
  │
  └─ 否（无图片上下文，向后兼容）
      ↓
      onUseVersion(optimizedPrompt)
      ↓
      setPrompt(optimizedPrompt)  // 仅更新 prompt，不生成图片
```

### 3.4 切换迭代模式（可选功能）

```
用户点击"切换模式"按钮（或自动切换）
  ↓
setIterationConfig({
  mode: 'prompt-only',  // 或 'image-context'
  context: undefined,   // 清除上下文
})
  ↓
IterationAssistant UI 更新：隐藏图片缩略图区域
```

---

## 4. 实现分阶段

### 阶段1：基础图片上下文支持（可独立发布）

**目标：**
- 支持从图片点击进入迭代模式
- 迭代助手显示图片缩略图
- "使用此版本"后自动生成新图并追加到列表
- 向后兼容：无图片上下文时退化为当前行为

**包含内容：**
1. ✅ 类型定义（`IterationContext`, `IterationMode`, `IterationAssistantConfig`）
2. ✅ `IterationAssistant` 组件 UI 改造（顶部缩略图区域）
3. ✅ `ImageGrid` / `BatchImageGrid` 新增 `onIterate` 回调
4. ✅ 三个页面集成 `handleIterate` 和 `handleIterationGenerate`
5. ✅ MCP 接口预留图片参数（但不传递）

**验收标准：**
- [ ] 点击图片"迭代"按钮，迭代助手切换到图片上下文模式
- [ ] 迭代助手顶部显示目标图片缩略图
- [ ] 输入迭代需求，AI 返回优化后的 prompt
- [ ] 点击"使用此版本"，自动生成新图并追加到列表（保留原图）
- [ ] 无图片上下文时，行为与当前一致（仅更新 prompt）

### 阶段2：视觉迭代（预留，不立即实现）

**目标：**
- MCP 服务支持图片参数
- 迭代时传递目标图片的 base64 和 prompt
- AI 可以基于图片内容进行视觉迭代

**包含内容：**
1. MCP 服务实现图片参数传递
2. `iteratePrompt` 函数实际传递 `context.targetImageBase64`
3. 可选：支持多图片上下文（参考图）

**验收标准：**
- [ ] MCP 服务接收图片参数
- [ ] 迭代结果考虑图片视觉内容
- [ ] 生成的图片更贴合目标图片的风格/内容

---

## 5. 代码骨架

### 5.1 IterationAssistant.tsx（关键部分）

```tsx
export const IterationAssistant = ({
  currentPrompt,
  onUseVersion,
  iterateTemplateId = 'image-iterate-general',
  onTemplateChange: _onTemplateChange,
  iterationConfig,
  onGenerate,
  allImages = [],
}: IterationAssistantProps) => {
  const mode = iterationConfig?.mode || 'prompt-only';
  const context = iterationConfig?.context;
  const hasImageContext = mode === 'image-context' && !!context;

  // ... 现有状态和逻辑 ...

  // 发送消息（修改）
  const sendMessage = async (text: string) => {
    // ... 现有逻辑 ...
    
    try {
      // 确定基础 prompt：优先使用目标图片的 prompt
      const basePrompt = hasImageContext && context?.targetPrompt
        ? context.targetPrompt
        : (messages.length > 0
            ? messages.filter((m) => m.role === 'assistant').pop()?.content || currentPrompt
            : currentPrompt);

      // 调用迭代（阶段1：context 参数预留但不传递）
      const result = await iteratePrompt(
        basePrompt,
        userMessage.content,
        iterateTemplateId,
        // 阶段2：传递图片上下文
        // hasImageContext && context?.targetImage ? {
        //   targetImageBase64: context.targetImage.base64,
        //   targetImagePrompt: context.targetImage.prompt,
        // } : undefined
      );

      // ... 现有逻辑 ...
    } catch (error) {
      // ... 现有错误处理 ...
    }
  };

  // "使用此版本"处理（修改）
  const handleUseVersion = (prompt: string) => {
    if (onGenerate && hasImageContext && context) {
      // 有图片上下文：生成新图
      void onGenerate(prompt, context);
    } else {
      // 无图片上下文：仅更新 prompt（向后兼容）
      onUseVersion(prompt);
    }
  };

  return (
    <div ref={containerRef} className="aurora-assistant-root">
      {/* ... 现有拖拽手柄和标题栏 ... */}

      {/* 新增：图片上下文区域 */}
      {hasImageContext && context?.targetImage && (
        <div className="aurora-assistant-image-context">
          <div className="aurora-assistant-image-context-header">
            <span className="text-xs text-text-muted">迭代目标</span>
          </div>
          <div className="aurora-assistant-image-context-thumbnails">
            {/* 目标图片（高亮） */}
            <div className="aurora-assistant-image-context-target">
              <img
                src={context.targetImage.base64}
                alt="迭代目标"
                className="aurora-assistant-image-context-thumb"
              />
              <div className="aurora-assistant-image-context-badge">目标</div>
            </div>
            
            {/* 可选：显示所有图片缩略图（用于切换目标） */}
            {context.allImages && context.allImages.length > 1 && (
              <div className="aurora-assistant-image-context-all">
                {context.allImages.map((img, idx) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => {
                      // 可选：切换目标图片
                      // onGenerate?.(currentPrompt, { ...context, targetImage: img, selectedImageIndex: idx });
                    }}
                    className={`aurora-assistant-image-context-thumb ${
                      idx === context.selectedImageIndex ? 'selected' : ''
                    }`}
                  >
                    <img src={img.base64} alt={`图片 ${idx + 1}`} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 消息区域 */}
      <div className="aurora-assistant-messages">
        {/* ... 现有消息列表 ... */}
        
        {/* "使用此版本"按钮（修改） */}
        {!msg.content.startsWith('优化失败') && (
          <button
            type="button"
            onClick={() => handleUseVersion(msg.content)}
            className="aurora-assistant-msg-use"
          >
            <Check className="w-3 h-3" />
            {hasImageContext ? '使用此版本并生成' : '使用此版本'}
          </button>
        )}
      </div>

      {/* ... 现有输入区域 ... */}
    </div>
  );
};
```

### 5.2 GeminiPage.tsx（关键部分）

```tsx
export const GeminiPage = ({ saveImage, onImageClick, onEdit }: GeminiPageProps) => {
  // ... 现有状态 ...

  // 新增：迭代配置状态
  const [iterationConfig, setIterationConfig] = useState<IterationAssistantConfig | undefined>();

  // 新增：处理图片迭代点击
  const handleIterate = useCallback((image: GeneratedImage, index: number, allImages: GeneratedImage[]) => {
    setIterationConfig({
      mode: 'image-context',
      context: {
        targetImage: image,
        targetPrompt: image.prompt,
        allImages: allImages,
        selectedImageIndex: index,
      },
    });
    // 可选：滚动到迭代助手区域
    // iterationAssistantRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // 新增：处理迭代后的图片生成
  const handleIterationGenerate = useCallback(async (
    optimizedPrompt: string,
    context?: IterationContext
  ) => {
    if (generateLockRef.current || isGenerating) return;

    const apiKey = settingsApiKey?.trim();
    if (!apiKey) {
      showToast('请先填写 Gemini API Key', 'error');
      return;
    }

    // 1. 更新 prompt
    setPrompt(optimizedPrompt);

    // 2. 构建生成参数（可选：继承目标图片的部分参数）
    const currentParams: GenerationParams = {
      ...params,
      prompt: optimizedPrompt,
      referenceImages: refImages,
      model: normalizeGeminiModel(params.model),
      // 可选：从 context.targetImage.params 继承 aspectRatio, imageSize 等
      // aspectRatio: context?.targetImage?.params?.aspectRatio || params.aspectRatio,
      // imageSize: context?.targetImage?.params?.imageSize || params.imageSize,
    };

    const controller = new AbortController();
    abortControllerRef.current = controller;
    generateLockRef.current = true;
    setIsGenerating(true);

    try {
      const outcomes = await generateImages(
        currentParams,
        {
          apiKey,
          baseUrl: settingsBaseUrl || DEFAULT_GEMINI_BASE_URL,
        },
        { signal: controller.signal }
      );

      if (!isMountedRef.current) return;

      const successImages = outcomes
        .filter(o => o.ok)
        .map(o => (o as any).image as GeneratedImage)
        .map(img => ({
          ...img,
          sourceScope: scope,
          sourceProviderId: activeProviderId,
        }));

      // 3. 追加新图到列表（保留原图）
      setCurrentImages(prev => [...successImages, ...prev]);

      // 4. 保存到数据库
      for (const img of successImages) {
        await saveImage(img);
      }

      showToast(`已生成 ${successImages.length} 张新图`, 'success');
      
      // 可选：清除迭代上下文（或保留以便继续迭代）
      // setIterationConfig(undefined);
    } catch (error) {
      if (!isMountedRef.current) return;
      const aborted = (error as any)?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        showToast('已停止生成', 'info');
        return;
      }
      showToast('生成错误：' + (error instanceof Error ? error.message : '未知错误'), 'error');
    } finally {
      generateLockRef.current = false;
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [params, refImages, settingsApiKey, settingsBaseUrl, scope, activeProviderId, saveImage, showToast, isGenerating]);

  return (
    <div className="aurora-page">
      {/* ... 现有布局 ... */}
      
      {/* ImageGrid（修改） */}
      <ImageGrid
        images={currentImages}
        isGenerating={isGenerating}
        params={params}
        onImageClick={onImageClick}
        onEdit={onEdit}
        onIterate={handleIterate}  // 新增
      />

      {/* IterationAssistant（修改） */}
      <aside className="aurora-assistant">
        <IterationAssistant
          currentPrompt={prompt}
          onUseVersion={setPrompt}
          iterateTemplateId={optimizerConfig?.iterateTemplateId}
          onTemplateChange={handleIterateTemplateChange}
          iterationConfig={iterationConfig}  // 新增
          onGenerate={handleIterationGenerate}  // 新增
          allImages={currentImages}  // 新增
        />
      </aside>
    </div>
  );
};
```

### 5.3 ImageGrid.tsx（关键部分）

```tsx
export const ImageGrid = ({
  images,
  slots,
  isGenerating,
  params,
  expectedCount,
  maxColumns = MAX_COLUMNS,
  minColumns = 2,
  gap = GRID_GAP,
  onImageClick,
  onEdit,
  onIterate,  // 新增
}: ImageGridProps) => {
  // ... 现有逻辑 ...

  return renderGrid(
    <>
      {images.map((img, idx) => (
        <div key={img.id} className="relative w-full h-full group">
          {/* ... 现有图片显示 ... */}
          
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* 现有：编辑按钮 */}
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(img); }}
              // ... 现有样式 ...
            >
              <Edit className="w-4 h-4" />
            </button>
            
            {/* 新增：迭代按钮 */}
            {onIterate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onIterate(img, idx, images);
                }}
                aria-label="迭代此图片"
                className="h-8 w-8 rounded-[var(--radius-md)] border border-ash bg-graphite/90 text-text-secondary hover:text-banana-500 transition-colors flex items-center justify-center"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            )}
            
            {/* 现有：下载按钮 */}
            <a
              href={img.base64}
              download={`nano-banana-${img.id}.png`}
              // ... 现有样式 ...
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        </div>
      ))}
    </>
  );
};
```

### 5.4 services/mcp.ts（关键部分）

```tsx
/**
 * 迭代优化提示词（迭代助手使用）
 * 
 * @param prompt 当前提示词
 * @param requirement 用户的修改需求
 * @param templateId 可选的模板 ID
 * @param context 可选的图片上下文（阶段1不实现，仅预留接口）
 * @returns 优化后的提示词
 */
export async function iteratePrompt(
  prompt: string,
  requirement: string,
  templateId?: string,
  context?: {
    targetImageBase64?: string;  // 目标图片的 base64（阶段2实现）
    targetImagePrompt?: string;   // 目标图片的 prompt（阶段2实现）
  }
): Promise<string> {
  const args: Record<string, unknown> = { prompt, requirements: requirement };
  
  if (templateId) {
    args.template = templateId;
  }
  
  // 阶段1：context 参数预留但不传递
  // 阶段2：实现图片上下文传递
  // if (context?.targetImageBase64) {
  //   args.targetImage = context.targetImageBase64;
  // }
  // if (context?.targetImagePrompt) {
  //   args.targetImagePrompt = context.targetImagePrompt;
  // }
  
  return callTool('iterate-prompt', args);
}
```

---

## 6. CSS 样式（新增）

需要在 `index.css` 或相关样式文件中添加：

```css
/* 迭代助手图片上下文区域 */
.aurora-assistant-image-context {
  padding: 12px;
  border-bottom: 1px solid var(--color-dark-border);
  background: var(--color-dark-surface);
}

.aurora-assistant-image-context-header {
  margin-bottom: 8px;
}

.aurora-assistant-image-context-thumbnails {
  display: flex;
  gap: 8px;
  align-items: center;
}

.aurora-assistant-image-context-target {
  position: relative;
  flex-shrink: 0;
}

.aurora-assistant-image-context-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: var(--radius-md);
  border: 2px solid var(--color-banana-500);
  cursor: pointer;
  transition: opacity 0.2s;
}

.aurora-assistant-image-context-thumb:hover {
  opacity: 0.8;
}

.aurora-assistant-image-context-thumb.selected {
  border-color: var(--color-banana-500);
  box-shadow: 0 0 0 2px var(--color-banana-500/20);
}

.aurora-assistant-image-context-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  padding: 2px 6px;
  font-size: 10px;
  background: var(--color-banana-500);
  color: var(--color-void);
  border-radius: var(--radius-sm);
  font-weight: 600;
}

.aurora-assistant-image-context-all {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.aurora-assistant-image-context-all .aurora-assistant-image-context-thumb {
  width: 32px;
  height: 32px;
  border-width: 1px;
  border-color: var(--color-ash);
}

.aurora-assistant-image-context-all .aurora-assistant-image-context-thumb.selected {
  border-color: var(--color-banana-500);
}
```

---

## 7. 关键设计决策

### 7.1 为什么"使用此版本"后追加而不是替换？

**决策：** 追加新图到列表（保留原图）

**理由：**
- 用户可能需要对比原图和新图
- 保留迭代历史，方便回溯
- 符合"迭代"的语义：在原有基础上改进，而非替换

### 7.2 为什么使用右侧边栏切换模式而不是模态框？

**决策：** 方案A — 右侧边栏切换模式

**理由：**
- 不打断用户工作流
- 可以同时查看图片和迭代助手
- 符合现有 UI 布局（右侧已有迭代助手）

### 7.3 为什么阶段1不实现视觉迭代？

**决策：** MCP 接口预留图片参数但不实现

**理由：**
- 分阶段实现，降低风险
- 阶段1先验证基础流程和 UI
- 阶段2再实现视觉迭代，需要 MCP 服务端支持

### 7.4 向后兼容策略

**策略：**
- `iterationConfig` 为 `undefined` 时，行为与当前一致
- `onGenerate` 不存在时，退化为 `onUseVersion`（仅更新 prompt）
- 三个页面都需要适配，但改动最小化

---

## 8. 测试要点

### 8.1 功能测试

- [ ] 点击图片"迭代"按钮，迭代助手切换到图片上下文模式
- [ ] 迭代助手顶部显示目标图片缩略图
- [ ] 输入迭代需求，AI 返回优化后的 prompt
- [ ] 点击"使用此版本"，自动生成新图并追加到列表
- [ ] 新图保留原图，列表顺序正确（新图在前）
- [ ] 无图片上下文时，行为与当前一致

### 8.2 边界情况

- [ ] 图片列表为空时，不显示"迭代"按钮
- [ ] 批量模式下，点击图片"迭代"按钮正常工作
- [ ] 迭代过程中切换页面，状态正确清理
- [ ] 生成失败时，错误提示正确显示

### 8.3 性能测试

- [ ] 大量图片时，缩略图渲染性能
- [ ] 迭代生成过程中，UI 响应正常

---

## 9. 后续优化（可选）

1. **切换目标图片**：在缩略图区域点击其他图片，切换迭代目标
2. **清除迭代上下文**：添加按钮清除图片上下文，回到 prompt-only 模式
3. **迭代历史**：记录每次迭代的 prompt 和生成的图片
4. **批量迭代**：支持同时迭代多张图片
5. **视觉迭代**：阶段2实现基于图片内容的视觉迭代

---

## 10. 文件清单

### 需要修改的文件

1. `types.ts` - 新增类型定义
2. `components/IterationAssistant.tsx` - 核心组件改造
3. `components/ImageGrid.tsx` - 新增迭代按钮
4. `components/BatchImageGrid.tsx` - 新增迭代按钮
5. `components/GeminiPage.tsx` - 集成迭代功能
6. `components/OpenAIPage.tsx` - 集成迭代功能
7. `components/KiePage.tsx` - 集成迭代功能
8. `services/mcp.ts` - 预留图片参数接口
9. `index.css` - 新增样式（或相关样式文件）

### 不需要修改的文件

- `services/gemini.ts` - 无需修改
- `services/openai.ts` - 无需修改
- `services/kie.ts` - 无需修改
- `services/db.ts` - 无需修改
- `hooks/useBatchGenerator.ts` - 无需修改

---

**文档版本：** v1.0  
**创建日期：** 2026-02-07  
**最后更新：** 2026-02-07
