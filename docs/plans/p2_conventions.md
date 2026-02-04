# Testing Patterns & UI Conventions for Page Refactors

## Overview
This document identifies testing patterns, UI conventions, and refactoring guidelines for migrating OpenAIPage/KiePage to Aurora layout.

---

## Testing Patterns

### Test Commands

**E2E Tests** (Playwright):
```bash
npm run test:e2e              # Run all tests headless
npm run test:e2e:ui          # Run with Playwright UI
npm run test:e2e:update      # Update screenshot snapshots
npm run test:e2e:report      # Show test report
```

**Test Files**:
- `tests/smoke.spec.ts` - Basic navigation and rendering
- `tests/ui.screenshots.spec.ts` - Visual regression (screenshots)

### Test Structure

#### smoke.spec.ts
- **Purpose**: Basic functionality verification
- **Coverage**:
  - Navigation between tabs
  - Page heading visibility
  - Disabled state logic (API Key required)

#### ui.screenshots.spec.ts
- **Purpose**: Visual regression testing
- **Coverage**:
  - Desktop screenshots (1440x900):
    - `desktop-gemini-linux.png`
    - `desktop-openai-proxy-linux.png`
    - `desktop-antigravity-linux.png`
    - `desktop-kie-linux.png`
    - `desktop-portfolio-linux.png`
  - Mobile screenshots (390x844):
    - `mobile-gemini-linux.png`
    - `mobile-openai-proxy-linux.png`
    - `mobile-antigravity-linux.png`
    - `mobile-kie-linux.png`
    - `mobile-portfolio-linux.png`

**Test Configuration**:
- Viewport sizes: Desktop (1440x900), Mobile (390x844)
- Screenshot options:
  - `fullPage: false`
  - `animations: 'disabled'`
  - `caret: 'hide'`
  - `maxDiffPixels: 10000` (allows small rendering diffs)

### Testing Conventions

1. **Screenshot Updates**: After UI refactor, run `test:e2e:update` to update snapshots
2. **Visual Regression**: Screenshots are stored in `tests/ui.screenshots.spec.ts-snapshots/`
3. **Test Isolation**: Each test navigates to page and waits for heading visibility
4. **Responsive Testing**: Both desktop and mobile viewports tested

---

## UI Conventions

### Aurora Design System

#### Color System
```css
/* Backgrounds */
--color-void: #08090A          /* Deepest background (canvas) */
--color-obsidian: #0D0E10       /* Slightly lighter */
--color-graphite: #16181C       /* Card/panel background */
--color-slate: #1E2028          /* Input/secondary panel */
--color-ash: #2A2D38           /* Border/divider */
--color-smoke: #3D4150         /* Hover border */

/* Text */
--color-text-primary: #F4F5F7   /* Main text */
--color-text-secondary: #B8BCC8 /* Secondary text */
--color-text-muted: #6B7085     /* Muted text */
--color-text-disabled: #404559  /* Disabled text */

/* Accent */
--color-banana-500: #F7B32B     /* Brand gold */
--color-banana-600: #E09915     /* Hover state */

/* Semantic */
--color-success: #34D399
--color-warning: #FBBF24
--color-error: #F87171
--color-info: #60A5FA
```

#### Spacing & Layout
- **Gap**: 16px between major sections
- **Padding**: 16px for containers
- **Border Radius**: `var(--radius-md)` (10px) for inputs, `var(--radius-lg)` (14px) for containers
- **Shadows**: `var(--shadow-lifted)` for buttons, `var(--shadow-floating)` for popovers

#### Typography
- **Headings**: 'Plus Jakarta Sans' (font-family)
- **Body**: 'Inter' (font-family)
- **Code**: 'JetBrains Mono' (font-family)

### CSS Class Naming

#### Aurora Layout Classes
- `aurora-page` - Root page container
- `aurora-main-row` - Top section (sidebar + canvas + assistant)
- `aurora-sidebar` - Left column (API config)
- `aurora-canvas` - Center column (image grid)
- `aurora-assistant` - Right column (iteration assistant)
- `aurora-prompt-area` - Bottom section (optimizer + input + config)
- `aurora-prompt-optimizer` - Left column (prompt optimizer)
- `aurora-prompt-input` - Center column (prompt + ref images)
- `aurora-prompt-config` - Right column (params + generate)

#### Aurora Component Classes
- `aurora-section-header` - Section title container
- `aurora-section-title` - Section title text
- `aurora-canvas-header` - Canvas header bar
- `aurora-canvas-body` - Canvas content area
- `aurora-prompt-box` - Prompt input container
- `aurora-prompt-box-icon` - Sparkles icon in prompt box
- `aurora-prompt-box-textarea` - Prompt textarea
- `aurora-ref-row` - Reference images row (desktop)
- `aurora-ref-add` - Add reference image button
- `aurora-ref-list` - Reference images list
- `aurora-ref-thumb` - Reference image thumbnail
- `aurora-ref-count` - Reference image count display
- `aurora-count-buttons` - Count selection button group
- `aurora-count-btn` - Individual count button
- `aurora-generate-btn` - Generate button
- `aurora-batch-progress` - Batch progress container
- `aurora-batch-items` - Batch items container
- `aurora-batch-item` - Individual batch item (with status classes)

#### Status Classes
- `aurora-batch-item.success` - Success state
- `aurora-batch-item.error` - Error state
- `aurora-batch-item.running` - Running state (with pulse animation)
- `aurora-batch-item.pending` - Pending state
- `aurora-count-btn.active` - Active count button
- `aurora-generate-btn.stopping` - Stopping state

### Style Functions (uiStyles.ts)

#### Input Styles
- `inputBaseStyles` - Standard input (slate bg, ash border)
- `textareaBaseStyles` - Textarea (legacy, use `aurora-prompt-box-textarea` instead)
- `selectBaseStyles` - Standard select dropdown
- `selectSmallStyles` - Small select (for params)

#### Button Styles
- `getGenerateButtonStyles(canGenerate, isGenerating)` - Generate button (legacy, use `aurora-generate-btn` instead)
- `getCountButtonStyles(isActive)` - Count button (legacy, use `aurora-count-btn` instead)
- `getFavoriteButtonStyles(isFavorite)` - Favorite toggle button
- `getRefImageButtonStyles(hasImages)` - Reference image button

### Responsive Breakpoints

#### Aurora Layout Breakpoints
- **<768px**: Mobile (vertical stack)
  - Sidebar: full width, max-height 40vh
  - Optimizer: hidden
  - Config: hidden (merged into input area)
- **768px-1199px**: Tablet (horizontal layout)
  - Sidebar: 280px fixed width
  - Optimizer: visible (left column)
  - Config: hidden (merged into input area)
  - Assistant: hidden
- **≥1200px**: Desktop (full three-column)
  - Sidebar: 280px fixed width
  - Canvas: flex-1
  - Assistant: 320px fixed width
  - Optimizer: 280px fixed width
  - Input: flex-1
  - Config: 320px fixed width

#### Reference Images Breakpoint
- **<1024px**: Mobile/Tablet (popover)
- **≥1024px**: Desktop (horizontal row in prompt input)

---

## Refactoring Guidelines

### 1. Color Migration

**Replace**:
```tsx
// Old
className="bg-dark-bg border-dark-border text-gray-500"

// New
className="bg-slate border-ash text-text-muted"
```

**Mapping**:
- `dark-bg` → `slate`
- `dark-surface` → `graphite`
- `dark-border` → `ash`
- `gray-*` → `text-*` (primary/secondary/muted/disabled)

### 2. Layout Migration

**Replace**:
```tsx
// Old
<div className="h-full flex flex-col">
  <div className="flex-1 min-h-0 p-4 flex flex-col md:flex-row gap-4">
    <div className="w-full md:w-[280px] border border-dark-border rounded-xl bg-dark-surface/80">
      {/* Sidebar */}
    </div>
    <div className="flex-1 min-w-0">
      {/* Canvas */}
    </div>
  </div>
</div>

// New
<div className="aurora-page">
  <div className="aurora-main-row">
    <aside className="aurora-sidebar">
      {/* Sidebar */}
    </aside>
    <div className="aurora-canvas">
      <div className="aurora-canvas-header">
        {/* Header */}
      </div>
      <div className="aurora-canvas-body">
        {/* Content */}
      </div>
    </div>
  </div>
</div>
```

### 3. Component Migration

**Prompt Input**:
```tsx
// Old
<textarea className={textareaBaseStyles} />

// New
<div className="aurora-prompt-box">
  <Sparkles className="aurora-prompt-box-icon" />
  <textarea className="aurora-prompt-box-textarea" />
</div>
```

**Count Buttons**:
```tsx
// Old
{[1,2,3,4].map(n => (
  <button className={getCountButtonStyles(params.count === n)}>
    {n}
  </button>
))}

// New
<div className="aurora-count-buttons">
  {[1,2,3,4].map(n => (
    <button className={`aurora-count-btn ${params.count === n ? 'active' : ''}`}>
      {n}
    </button>
  ))}
</div>
```

**Generate Button**:
```tsx
// Old
<button className={getGenerateButtonStyles(canGenerate, isGenerating)}>
  Generate
</button>

// New
<button className={`aurora-generate-btn ${isGenerating ? 'stopping' : ''}`} disabled={!canGenerate}>
  Generate
</button>
```

### 4. Reference Images Migration

**Desktop (≥1024px)**:
```tsx
<div className="aurora-ref-row">
  <label className="aurora-ref-add">
    <ImagePlus className="w-4 h-4" />
    <span>添加</span>
    <input type="file" className="hidden" accept="image/*" multiple />
  </label>
  <div className="aurora-ref-count">{refImages.length}/{maxRefImages}</div>
  <div className="aurora-ref-list">
    {refImages.map((img, idx) => (
      <div key={idx} className="aurora-ref-thumb">
        <img src={img} alt={`Ref ${idx + 1}`} />
        <button className="aurora-ref-remove" onClick={() => removeRefImage(idx)}>
          <X className="w-2.5 h-2.5" />
        </button>
      </div>
    ))}
  </div>
</div>
```

**Mobile (<1024px)**: Keep existing popover pattern

### 5. Batch Mode Toggle Migration

**Replace simple toggle with segmented control**:
```tsx
// Old
<button onClick={() => setBatchModeEnabled(!batchModeEnabled)}>
  {batchModeEnabled ? '开' : '关'}
</button>

// New (from GeminiPage lines 1105-1136)
<div className="bg-slate border border-ash rounded-[var(--radius-md)] p-1 flex relative">
  <button onClick={() => setBatchModeEnabled(false)} className={...}>
    普通生成
  </button>
  <button onClick={() => setBatchModeEnabled(true)} className={...}>
    批量任务
  </button>
  <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-banana-500 rounded-[var(--radius-sm)] transition-all duration-300 ease-spring ${
    batchModeEnabled ? 'left-[calc(50%+2px)]' : 'left-1'
  }`} />
</div>
```

---

## Testing Checklist

### Visual Regression
- [ ] Run `npm run test:e2e:update` after refactor
- [ ] Verify desktop screenshots match Aurora design
- [ ] Verify mobile screenshots match Aurora design
- [ ] Check all breakpoints (768px, 1024px, 1200px)

### Functional Testing
- [ ] Navigation between tabs works
- [ ] Provider selection works
- [ ] API Key input works
- [ ] Prompt input works
- [ ] Reference image upload works (desktop + mobile)
- [ ] Batch mode toggle works
- [ ] Generate button works
- [ ] Image grid displays correctly
- [ ] Error states display correctly (OpenAI/Kie slots)

### Responsive Testing
- [ ] Mobile (<768px): Vertical stack, optimizer hidden
- [ ] Tablet (768px-1199px): Horizontal layout, optimizer visible, config hidden
- [ ] Desktop (≥1200px): Full three-column layout
- [ ] Reference images: Desktop row (≥1024px), mobile popover (<1024px)

---

## Acceptance Criteria

- [ ] All CSS classes migrated to Aurora system
- [ ] All color variables migrated to Aurora system
- [ ] All layout structures match GeminiPage
- [ ] All responsive breakpoints match GeminiPage
- [ ] All tests pass (smoke + screenshots)
- [ ] Visual regression tests updated
- [ ] No functionality regressions
- [ ] Code follows Aurora conventions
