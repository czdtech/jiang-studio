# Similar Features Mapping: OpenAIPage / KiePage → GeminiPage

## Overview
This document maps similar features and layout patterns between GeminiPage (reference implementation) and OpenAIPage/KiePage (refactor targets).

---

## File Structure Mapping

### Core Page Components
- **Reference**: `components/GeminiPage.tsx` (1243 lines)
- **Targets**: 
  - `components/OpenAIPage.tsx` (1507 lines)
  - `components/KiePage.tsx` (1299 lines)

### Shared Components (Used by All Pages)
- `components/ImageGrid.tsx` - Image display grid with slots support
- `components/PromptOptimizerSettings.tsx` - MCP prompt optimizer UI
- `components/IterationAssistant.tsx` - Iterative prompt refinement
- `components/SamplePromptChips.tsx` - Sample prompt suggestions
- `components/uiStyles.ts` - Shared Aurora style functions

### Shared Services
- `services/db.ts` - Provider/draft persistence
- `services/mcp.ts` - Prompt optimization via MCP
- `services/download.ts` - Image download utilities

---

## Layout Structure Comparison

### GeminiPage (Reference - Aurora Layout)
```
<div className="aurora-page">
  <div className="aurora-main-row">
    <aside className="aurora-sidebar">          {/* Left: API Config */}
    <div className="aurora-canvas">             {/* Center: Image Grid */}
    <aside className="aurora-assistant">        {/* Right: Iteration Assistant */}
  </div>
  <div className="aurora-prompt-area">
    <div className="aurora-prompt-optimizer">  {/* Left: Optimizer */}
    <div className="aurora-prompt-input">       {/* Center: Prompt + Ref Images */}
    <div className="aurora-prompt-config">      {/* Right: Params + Generate */}
  </div>
</div>
```

### OpenAIPage (Current - Legacy Layout)
```
<div className="h-full flex flex-col">
  <div className="flex-1 min-h-0 p-4 flex flex-col md:flex-row gap-4">
    <div className="w-full md:w-[280px]">       {/* Left: API Config */}
    <div className="flex-1 min-w-0">             {/* Center: Image Grid */}
    <div className="hidden md:block">             {/* Right: Iteration Assistant */}
  </div>
  <div className="shrink-0 px-4 pb-4">
    <div className="border border-dark-border rounded-xl bg-dark-surface/80">
      {/* Prompt + Params + Generate (all in one row) */}
    </div>
  </div>
</div>
```

### KiePage (Current - Legacy Layout)
```
<div className="h-full flex flex-col">
  <div className="flex-1 min-h-0 p-4 flex flex-col md:flex-row gap-4">
    <div className="w-full md:w-[280px]">       {/* Left: API Config */}
    <div className="flex-1 min-w-0">             {/* Center: Image Grid */}
    <IterationAssistant />                      {/* Right: Iteration Assistant */}
  </div>
  <div className="shrink-0 px-4 pb-4">
    <div className="border border-dark-border rounded-xl bg-dark-surface/80">
      {/* Prompt + Params + Generate (all in one row) */}
    </div>
  </div>
</div>
```

---

## Key Sections Mapping

### 1. Sidebar (API Configuration)

**GeminiPage** (`aurora-sidebar`):
- Section header: `aurora-section-header` + `aurora-section-title`
- Provider selection dropdown
- Provider management buttons (Add/Favorite/Delete)
- Provider name input
- API Key input (`inputBaseStyles`)
- Base URL input (`inputBaseStyles`)

**OpenAIPage** (Current):
- Similar structure but uses `border-dark-border rounded-xl bg-dark-surface/80`
- Additional: Model refresh button next to Base URL
- Additional: PromptOptimizerSettings inline (should move to prompt area)

**KiePage** (Current):
- Similar structure to OpenAIPage
- Additional: PromptOptimizerSettings inline (should move to prompt area)

**Refactor Target**:
- Migrate to `aurora-sidebar` class
- Use `aurora-section-header` + `aurora-section-title`
- Replace all inputs with `inputBaseStyles`
- Replace all selects with `selectBaseStyles`
- Move PromptOptimizerSettings to `aurora-prompt-optimizer` column

---

### 2. Canvas (Image Display)

**GeminiPage** (`aurora-canvas`):
- Header: `aurora-canvas-header` with title + badge
- Body: `aurora-canvas-body` with ImageGrid
- Batch progress: `aurora-batch-progress` + `aurora-batch-items` + `aurora-batch-item`

**OpenAIPage** (Current):
- Simple container: `flex-1 min-w-0 overflow-auto`
- Batch progress uses custom dark theme classes
- ImageGrid with `slots` prop support (for error states)

**KiePage** (Current):
- Same as OpenAIPage

**Refactor Target**:
- Wrap in `aurora-canvas` container
- Add `aurora-canvas-header` with provider name badge
- Add `aurora-canvas-body` wrapper
- Migrate batch progress to Aurora classes

---

### 3. Prompt Input Area

**GeminiPage** (`aurora-prompt-input`):
- Reference images row: `aurora-ref-row` (desktop, ≥1024px)
  - `aurora-ref-add` button
  - `aurora-ref-count` display
  - `aurora-ref-list` with `aurora-ref-thumb` items
- Prompt box: `aurora-prompt-box` with `aurora-prompt-box-icon` (Sparkles)
- Textarea: `aurora-prompt-box-textarea`
- Mobile ref popover: Hidden on desktop, shown on <1024px

**OpenAIPage** (Current):
- Textarea: `textareaBaseStyles` (legacy)
- Reference images: Always popover (`showRefPopover`)
- No desktop horizontal ref row

**KiePage** (Current):
- Same as OpenAIPage

**Refactor Target**:
- Create `aurora-prompt-input` column
- Add `aurora-ref-row` for desktop (≥1024px)
- Replace textarea with `aurora-prompt-box` structure
- Keep mobile popover for <1024px

---

### 4. Prompt Optimizer

**GeminiPage** (`aurora-prompt-optimizer`):
- Standalone column (left, aligned with sidebar)
- Uses `PromptOptimizerSettings` component
- Hidden on <768px

**OpenAIPage** (Current):
- Inline in sidebar (should move out)

**KiePage** (Current):
- Inline in sidebar (should move out)

**Refactor Target**:
- Extract to `aurora-prompt-optimizer` column
- Use same `PromptOptimizerSettings` component
- Hide on <768px

---

### 5. Parameters Configuration

**GeminiPage** (`aurora-prompt-config`):
- Model selector: `selectSmallStyles` with MODEL_PRESETS
- Aspect ratio + Image size: Grid 2 columns
- Batch mode toggle: Aurora segmented control (lines 1105-1136)
- Count buttons: `aurora-count-buttons` + `aurora-count-btn`
- Generate button: `aurora-generate-btn`

**OpenAIPage** (Current):
- Custom model input (text + datalist)
- Aspect ratio + Image size (hidden for Antigravity Tools)
- Batch mode toggle: Simple button
- Count buttons: `getCountButtonStyles` (legacy)
- Generate button: `getGenerateButtonStyles` (legacy)

**KiePage** (Current):
- Custom model input (text + datalist)
- Aspect ratio + Image size (includes 'auto' option)
- Output format selector (png/jpg) - unique to Kie
- Batch mode toggle: Simple button
- Count buttons: `getCountButtonStyles` (legacy)
- Generate button: `getGenerateButtonStyles` (legacy)

**Refactor Target**:
- Create `aurora-prompt-config` column
- Keep custom model input (OpenAI/Kie specific)
- Migrate batch toggle to Aurora segmented control
- Migrate count buttons to `aurora-count-buttons`
- Migrate generate button to `aurora-generate-btn`
- Keep Kie's output format selector

---

### 6. Iteration Assistant

**GeminiPage** (`aurora-assistant`):
- Standalone column (right, ≥1200px)
- Uses `IterationAssistant` component

**OpenAIPage** (Current):
- Hidden on mobile (`hidden md:block`)
- Uses `IterationAssistant` component

**KiePage** (Current):
- Always visible (no responsive hiding)
- Uses `IterationAssistant` component

**Refactor Target**:
- Wrap in `aurora-assistant` column
- Hide on <1200px (CSS media query)

---

## Feature Differences

### Unique to GeminiPage
- MODEL_PRESETS dropdown (vs custom input)
- Reference image limit: 14 (Pro) / 4 (Standard)
- Desktop ref row always visible (≥1024px)

### Unique to OpenAIPage
- `variant` prop: `'third_party' | 'antigravity_tools'`
- Model refresh button (`handleRefreshModels`)
- Model ID inference (`inferAntigravityImageConfigFromModelId`)
- ImageGridSlot error states
- Reference image limit: 4

### Unique to KiePage
- Output format selector (png/jpg)
- Aspect ratio includes 'auto' option
- Reference image limit: 8

### Shared Features (All Pages)
- Provider management (CRUD)
- Draft persistence per provider
- Batch generation mode
- Prompt optimization (MCP)
- Iteration assistant
- Reference image upload
- Image grid display

---

## CSS Class Migration Map

| Current (OpenAI/Kie) | Target (Aurora) |
|---------------------|-----------------|
| `border-dark-border rounded-xl bg-dark-surface/80` | `aurora-sidebar` |
| `text-gray-*` | `text-text-*` (primary/secondary/muted/disabled) |
| `bg-dark-bg` | `bg-slate` |
| `bg-dark-surface` | `bg-graphite` |
| `border-dark-border` | `border-ash` |
| `getGenerateButtonStyles()` | `aurora-generate-btn` |
| `getCountButtonStyles()` | `aurora-count-btn` |
| `textareaBaseStyles` | `aurora-prompt-box-textarea` |
| Custom batch toggle | Aurora segmented control |

---

## Responsive Breakpoints

### GeminiPage (Aurora)
- **<768px**: Vertical stack, optimizer hidden
- **768px-1199px**: Horizontal layout, optimizer visible, config hidden
- **≥1200px**: Full three-column layout

### OpenAIPage/KiePage (Current)
- **<768px**: Vertical stack
- **≥768px**: Horizontal layout (no optimizer/config separation)

### Refactor Target
- Match GeminiPage breakpoints exactly

---

## Acceptance Criteria Checklist

- [ ] OpenAIPage uses `aurora-page` root container
- [ ] OpenAIPage uses `aurora-main-row` for top section
- [ ] OpenAIPage uses `aurora-prompt-area` for bottom section
- [ ] KiePage uses `aurora-page` root container
- [ ] KiePage uses `aurora-main-row` for top section
- [ ] KiePage uses `aurora-prompt-area` for bottom section
- [ ] All sidebar sections use `aurora-sidebar` + `aurora-section-header`
- [ ] All canvas sections use `aurora-canvas` + `aurora-canvas-header` + `aurora-canvas-body`
- [ ] All prompt inputs use `aurora-prompt-box` structure
- [ ] All config sections use `aurora-prompt-config` with Aurora components
- [ ] Batch progress uses `aurora-batch-progress` classes
- [ ] Reference images use `aurora-ref-row` on desktop (≥1024px)
- [ ] All color variables migrated to Aurora system
- [ ] Responsive breakpoints match GeminiPage (768px/1024px/1200px)
