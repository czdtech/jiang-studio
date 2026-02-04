# OpenAI/Kie Refactor Architecture Proposal

## Executive Summary

**Goal**: Migrate OpenAIPage and KiePage to Aurora three-column layout with minimal new abstractions.

**Approach**: Direct CSS class replacement + component repositioning. No new helper files needed.

**Scope**: UI-only refactor. Zero business logic changes.

---

## Architecture Decision: Zero New Abstractions

### Rationale
- **Existing patterns work**: GeminiPage already demonstrates the Aurora layout successfully
- **Duplication is acceptable**: OpenAI/Kie have unique features (model refresh, outputFormat, Antigravity mode) that don't warrant abstraction
- **Maintenance clarity**: Keeping pages independent makes debugging and feature additions easier
- **Risk minimization**: No new modules = no new failure points

### What We're NOT Creating
- ❌ Shared layout wrapper component
- ❌ Common provider management hook
- ❌ Unified generation handler
- ❌ Abstract parameter configuration component

### What We're Using
- ✅ Existing Aurora CSS classes (already in `index.css`)
- ✅ Existing `uiStyles.ts` functions (already shared)
- ✅ Existing shared components (ImageGrid, PromptOptimizerSettings, IterationAssistant)

---

## Migration Blueprint

### Phase 1: Layout Structure (OpenAIPage)

#### 1.1 Root Container
```tsx
// BEFORE
<div className="h-full flex flex-col">

// AFTER
<div className="aurora-page">
```

#### 1.2 Main Row (Top Section)
```tsx
// BEFORE
<div className="flex-1 min-h-0 p-4 flex flex-col md:flex-row gap-4">
  <div className="w-full md:w-[280px] ...">API Config</div>
  <div className="flex-1 ...">Images</div>
  <div className="hidden md:block">Assistant</div>
</div>

// AFTER
<div className="aurora-main-row">
  <aside className="aurora-sidebar space-y-4">API Config</aside>
  <div className="aurora-canvas">
    <div className="aurora-canvas-header">Header</div>
    <div className="aurora-canvas-body">Images</div>
  </div>
  <aside className="aurora-assistant">Assistant</aside>
</div>
```

#### 1.3 Prompt Area (Bottom Section)
```tsx
// BEFORE
<div className="shrink-0 px-4 pb-4">
  <div className="border border-dark-border rounded-xl ...">
    <div className="flex flex-col lg:flex-row ...">
      <div className="flex-1">Prompt</div>
      <div className="w-full lg:w-[320px]">Params</div>
      <div className="w-full lg:w-[140px]">Generate</div>
    </div>
  </div>
</div>

// AFTER
<div className="aurora-prompt-area">
  <div className="aurora-prompt-optimizer">
    <PromptOptimizerSettings ... />
  </div>
  <div className="aurora-prompt-input">
    <div className="aurora-prompt-box">
      <Sparkles className="aurora-prompt-box-icon" />
      <textarea className="aurora-prompt-box-textarea" />
    </div>
    <div className="aurora-ref-row">Reference images</div>
  </div>
  <div className="aurora-prompt-config">
    <div>Params</div>
    <button className="aurora-generate-btn">Generate</button>
  </div>
</div>
```

### Phase 2: Component Repositioning

#### 2.1 PromptOptimizerSettings
**Current**: Inline in sidebar (lines 1158-1164)
**Target**: Move to `aurora-prompt-optimizer` column

```tsx
// Move from sidebar to prompt area
<div className="aurora-prompt-optimizer">
  <div className="aurora-section-header">
    <Wand2 className="w-4 h-4 text-banana-500" />
    <span className="aurora-section-title">提示词优化</span>
  </div>
  <PromptOptimizerSettings
    onConfigChange={handleOptimizerConfigChange}
    currentPrompt={prompt}
    onOptimize={handleOptimizePrompt}
    isOptimizing={isOptimizing}
  />
</div>
```

#### 2.2 IterationAssistant
**Current**: Right column with `hidden md:block` (lines 1233-1240)
**Target**: `aurora-assistant` (auto-hides at <1200px)

```tsx
// No conditional hiding needed - Aurora CSS handles it
<aside className="aurora-assistant">
  <IterationAssistant
    currentPrompt={prompt}
    onUseVersion={setPrompt}
    iterateTemplateId={optimizerConfig?.iterateTemplateId}
    onTemplateChange={handleIterateTemplateChange}
  />
</aside>
```

#### 2.3 Reference Images
**Desktop (≥1024px)**: Horizontal row above prompt
**Mobile (<1024px)**: Keep existing popover

```tsx
// Desktop: aurora-ref-row (visible ≥1024px)
<div className="aurora-ref-row">
  <button className="aurora-ref-add">
    <ImagePlus className="w-4 h-4" />
    <span>添加参考图</span>
    <input type="file" className="hidden" ... />
  </button>
  {refImages.length > 0 && (
    <div className="aurora-ref-list">
      {refImages.map((img, idx) => (
        <div key={idx} className="aurora-ref-thumb group">
          <img src={img} alt={`Ref ${idx}`} />
          <button onClick={() => removeRefImage(idx)} className="aurora-ref-remove">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="aurora-ref-count">{refImages.length}/4</div>
    </div>
  )}
</div>

// Mobile: Keep existing popover (lines 1423-1458)
// No changes needed - Aurora CSS hides aurora-ref-row on mobile
```

### Phase 3: Batch Mode UI

#### 3.1 Segmented Control (Replace Toggle Button)
```tsx
// BEFORE (lines 1332-1346)
<button onClick={() => setBatchModeEnabled((v) => !v)}>
  {batchModeEnabled ? '开' : '关'}
</button>

// AFTER (Reference: GeminiPage lines 1105-1136)
<div className="aurora-segment-control">
  <button
    onClick={() => setBatchModeEnabled(false)}
    className={`aurora-segment-btn ${!batchModeEnabled ? 'aurora-segment-btn-active' : ''}`}
  >
    普通生成
  </button>
  <button
    onClick={() => setBatchModeEnabled(true)}
    className={`aurora-segment-btn ${batchModeEnabled ? 'aurora-segment-btn-active' : ''}`}
  >
    批量任务
  </button>
  <div
    className="aurora-segment-slider"
    style={{ transform: batchModeEnabled ? 'translateX(100%)' : 'translateX(0)' }}
  />
</div>
```

#### 3.2 Batch Progress Bar
```tsx
// BEFORE (lines 1170-1221)
<div className="mb-4 p-3 bg-dark-surface border border-dark-border rounded-lg">
  ...
</div>

// AFTER
<div className="aurora-batch-progress">
  <div className="aurora-batch-header">
    <span className="aurora-batch-title">
      批量任务进度：{completed}/{total}
    </span>
    <div className="aurora-batch-stats">
      <span className="aurora-batch-stat-success">{success} 成功</span>
      <span className="aurora-batch-stat-error">{error} 失败</span>
      <span className="aurora-batch-stat-pending">{pending} 进行中</span>
    </div>
    {isGenerating && (
      <button onClick={handleBatchStop} className="aurora-batch-cancel">
        取消
      </button>
    )}
  </div>
  <div className="aurora-batch-items">
    {batchTasks.map((task, idx) => (
      <div key={task.id} className={`aurora-batch-item aurora-batch-item-${task.status}`}>
        {idx + 1}
      </div>
    ))}
  </div>
</div>
```

### Phase 4: KiePage Specific Changes

#### 4.1 Output Format Control
**Current**: In params row (lines 1125-1138)
**Target**: Keep in `aurora-prompt-config` column

```tsx
<div className="aurora-prompt-config">
  {/* Model */}
  <div>
    <label className="aurora-label">模型</label>
    <input type="text" list="kie-models-list" ... />
  </div>

  {/* Ratio + Size */}
  <div className="grid grid-cols-2 gap-2">
    <div>
      <label className="aurora-label">比例</label>
      <select ...>{aspectRatioOptions.map(...)}</select>
    </div>
    <div>
      <label className="aurora-label">尺寸</label>
      <select ...>...</select>
    </div>
  </div>

  {/* Output Format + Count/Batch */}
  <div className="grid grid-cols-2 gap-2">
    <div>
      <label className="aurora-label">格式</label>
      <select value={params.outputFormat} ...>
        <option value="png">png</option>
        <option value="jpg">jpg</option>
      </select>
    </div>
    <div>
      {batchModeEnabled ? (
        <div>Batch config</div>
      ) : (
        <div>
          <label className="aurora-label">数量</label>
          <div className="aurora-count-buttons">
            {[1,2,3,4].map(n => (
              <button className={`aurora-count-btn ${params.count === n ? 'aurora-count-btn-active' : ''}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>

  {/* Generate Button */}
  <button className="aurora-generate-btn">...</button>
</div>
```

#### 4.2 Reference Image Limit
**OpenAI**: 4 images (line 1036: `.slice(0, 4)`)
**Kie**: 8 images (line 827: `.slice(0, 8)`)

Keep existing limits - no changes needed.

---

## File Touch List

### Files to Modify
1. **components/OpenAIPage.tsx** (~1508 lines)
   - Lines 1054-1506: Full layout restructure
   - Lines 46-52: Remove `portfolio` prop (unused)
   - Lines 1158-1164: Move PromptOptimizerSettings
   - Lines 1233-1240: Update IterationAssistant wrapper

2. **components/KiePage.tsx** (~1300 lines)
   - Lines 856-1297: Full layout restructure
   - Lines 957-963: Move PromptOptimizerSettings
   - Lines 1020-1026: Update IterationAssistant wrapper
   - Lines 1125-1138: Reposition outputFormat control

### Files NOT Modified
- ❌ `components/GeminiPage.tsx` (reference only)
- ❌ `components/ImageGrid.tsx` (no changes)
- ❌ `components/PromptOptimizerSettings.tsx` (no changes)
- ❌ `components/IterationAssistant.tsx` (no changes)
- ❌ `components/uiStyles.ts` (already has Aurora styles)
- ❌ `index.css` (Aurora classes already defined)
- ❌ `services/*.ts` (no business logic changes)

---

## Implementation Sequence

### Step 1: OpenAIPage Layout Migration (2-3 hours)
1. Replace root container with `aurora-page`
2. Restructure main row to `aurora-main-row` + three columns
3. Add canvas header/body structure
4. Migrate prompt area to three-column layout
5. Move PromptOptimizerSettings to left column
6. Update IterationAssistant wrapper
7. Add desktop reference image row
8. Replace batch toggle with segmented control
9. Update batch progress bar styles

### Step 2: OpenAIPage Testing (1 hour)
1. Test desktop layout (≥1200px)
2. Test tablet layout (768px-1199px)
3. Test mobile layout (<768px)
4. Test batch mode switching
5. Test reference image upload/delete
6. Test generation flow (single + batch)
7. Test Antigravity Tools mode

### Step 3: KiePage Layout Migration (2-3 hours)
1. Repeat Step 1 for KiePage
2. Add outputFormat control to config column
3. Update reference image limit (8 instead of 4)
4. Update aspect ratio options (include 'auto')

### Step 4: KiePage Testing (1 hour)
1. Repeat Step 2 for KiePage
2. Test outputFormat selection
3. Test 8-image reference limit

### Step 5: Cross-Page Consistency Check (30 min)
1. Compare OpenAI/Kie/Gemini side-by-side
2. Verify color/spacing/typography consistency
3. Verify responsive breakpoints align
4. Verify icon/button styles match

---

## Testing Plan

### Visual Regression Tests
```bash
# Desktop (1920x1080)
- [ ] OpenAIPage: Three-column layout renders correctly
- [ ] KiePage: Three-column layout renders correctly
- [ ] Sidebar width matches GeminiPage (280px)
- [ ] Canvas header/body structure matches GeminiPage
- [ ] Prompt area three columns align with sidebar/canvas/assistant

# Tablet (1024x768)
- [ ] OpenAIPage: Two-column layout (sidebar + canvas)
- [ ] KiePage: Two-column layout (sidebar + canvas)
- [ ] Assistant column hidden
- [ ] Prompt optimizer visible (left column)
- [ ] Prompt config merged into input area

# Mobile (375x667)
- [ ] OpenAIPage: Vertical stack layout
- [ ] KiePage: Vertical stack layout
- [ ] Sidebar max-height 40vh, scrollable
- [ ] Prompt optimizer hidden
- [ ] Reference images use popover
```

### Functional Tests
```bash
# Provider Management
- [ ] Create/delete/favorite provider works
- [ ] Provider switching loads correct draft
- [ ] Settings persist after 300ms debounce
- [ ] Draft persists after 350ms debounce

# Model Selection
- [ ] OpenAI: Model refresh fetches list
- [ ] OpenAI: Datalist shows available models
- [ ] Kie: Model refresh fetches list
- [ ] Kie: Datalist shows available models

# Reference Images
- [ ] Desktop: Images display in horizontal row
- [ ] Mobile: Images display in popover
- [ ] Upload adds images (max 4 for OpenAI, 8 for Kie)
- [ ] Delete removes images
- [ ] Images persist in draft

# Batch Mode
- [ ] Segmented control switches modes
- [ ] Batch config shows when enabled
- [ ] Multi-line prompt parses correctly
- [ ] Batch progress updates in real-time
- [ ] Cancel stops batch generation
- [ ] Download all works after completion

# Generation Flow
- [ ] Single generation works
- [ ] Batch generation works
- [ ] Prompt optimization (manual + auto) works
- [ ] Error states display correctly (ImageGridSlot)
- [ ] Abort/stop works
- [ ] Images auto-save to portfolio

# OpenAI Specific
- [ ] Antigravity Tools mode hides ratio/size
- [ ] Model ID inference works (aspectRatio/imageSize)
- [ ] Model list filters image/text models

# Kie Specific
- [ ] Output format selection works
- [ ] Aspect ratio includes 'auto' option
- [ ] 8-image reference limit enforced
```

### E2E Tests (Playwright)
```typescript
// tests/openai-kie-refactor.spec.ts
test('OpenAIPage Aurora layout', async ({ page }) => {
  await page.goto('/');
  await page.click('text=OpenAI');

  // Desktop layout
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('.aurora-sidebar')).toBeVisible();
  await expect(page.locator('.aurora-canvas')).toBeVisible();
  await expect(page.locator('.aurora-assistant')).toBeVisible();

  // Tablet layout
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.aurora-assistant')).not.toBeVisible();

  // Mobile layout
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.locator('.aurora-prompt-optimizer')).not.toBeVisible();
});

test('KiePage Aurora layout', async ({ page }) => {
  // Similar to OpenAIPage test
});

test('Batch mode segmented control', async ({ page }) => {
  await page.goto('/');
  await page.click('text=OpenAI');

  // Switch to batch mode
  await page.click('.aurora-segment-btn:has-text("批量任务")');
  await expect(page.locator('.aurora-segment-slider')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 100, 0)');

  // Enter multi-line prompt
  await page.fill('textarea', 'prompt 1\nprompt 2\nprompt 3');
  await expect(page.locator('text=批量模式：3 个任务')).toBeVisible();
});
```

---

## Risk Assessment

### Low Risk (UI-only changes)
- ✅ CSS class replacement
- ✅ Component repositioning
- ✅ Responsive breakpoint alignment

### Medium Risk (State-dependent UI)
- ⚠️ **Batch mode segmented control**: Ensure `batchModeEnabled` state syncs correctly
  - **Mitigation**: Test state transitions thoroughly
- ⚠️ **Reference image row vs popover**: Ensure responsive switching works
  - **Mitigation**: Test at all breakpoints
- ⚠️ **PromptOptimizerSettings move**: Ensure state callbacks still work
  - **Mitigation**: No prop changes, just position change

### High Risk (None identified)
- ✅ No business logic changes
- ✅ No service layer changes
- ✅ No data persistence changes

### Edge Cases
1. **Antigravity Tools mode**: Ensure ratio/size hiding still works
   - **Test**: Verify `isAntigravityTools` conditional rendering
2. **Model list caching**: Ensure cache survives layout change
   - **Test**: Refresh models, switch layout, verify cache persists
3. **Draft hydration**: Ensure layout change doesn't trigger re-hydration
   - **Test**: Switch providers, verify no duplicate hydration
4. **Batch task state**: Ensure layout change doesn't reset batch tasks
   - **Test**: Start batch, resize window, verify tasks continue

---

## Rollback Plan

### If Critical Issues Found
1. **Revert commits**: Git revert to pre-refactor state
2. **Feature flag**: Add `useAuroraLayout` flag to toggle old/new layout
3. **Gradual rollout**: Enable Aurora layout for Gemini only, keep OpenAI/Kie on old layout

### Rollback Triggers
- Generation flow broken (images not saving)
- Provider switching broken (drafts not loading)
- Batch mode broken (tasks not executing)
- Mobile layout unusable (UI elements overlapping)

---

## Success Criteria

### Visual Consistency
- [ ] OpenAI/Kie/Gemini use identical Aurora layout structure
- [ ] Three-column alignment perfect at ≥1200px
- [ ] Colors/spacing/typography match GeminiPage
- [ ] Icons/buttons/inputs styled identically

### Functional Completeness
- [ ] All existing features work (provider management, generation, batch mode)
- [ ] Responsive layout works at all breakpoints
- [ ] Reference images work (desktop row + mobile popover)
- [ ] Batch mode segmented control works
- [ ] No regressions in generation flow

### Code Quality
- [ ] Zero new helper files created
- [ ] Aurora CSS classes used consistently
- [ ] No hardcoded colors/sizes
- [ ] Component structure matches GeminiPage

### Performance
- [ ] No layout shifts during hydration
- [ ] Smooth responsive transitions
- [ ] Batch mode switching instant (<100ms)

---

## Timeline Estimate

| Phase | Duration | Cumulative |
|-------|----------|------------|
| OpenAIPage Layout | 2-3h | 3h |
| OpenAIPage Testing | 1h | 4h |
| KiePage Layout | 2-3h | 7h |
| KiePage Testing | 1h | 8h |
| Cross-Page Check | 0.5h | 8.5h |
| **Total** | **8-9 hours** | |

**Note**: Timeline assumes no major blockers. Add 2-3h buffer for edge cases.

---

## Next Steps

1. **User approval**: Review this architecture proposal
2. **Create feature branch**: `git checkout -b refactor/openai-kie-aurora-layout`
3. **Start with OpenAIPage**: Implement layout migration
4. **Test thoroughly**: Run all functional + visual tests
5. **Repeat for KiePage**: Apply same patterns
6. **Final review**: Cross-page consistency check
7. **Merge to main**: After all tests pass

---

## Questions for User

1. **Timeline**: Is 8-9 hour estimate acceptable? Or should we split into smaller PRs?
2. **Testing**: Should we add Playwright E2E tests, or manual testing sufficient?
3. **Rollback**: Do you want a feature flag for gradual rollout, or direct merge?
4. **Priority**: Should we do OpenAIPage first, or both pages in parallel?
