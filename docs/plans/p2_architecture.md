# Architecture Mapping: OpenAIPage / KiePage Differences from GeminiPage

## Overview
This document maps architectural differences, data flows, and state management patterns between GeminiPage (reference) and OpenAIPage/KiePage (refactor targets).

---

## Module Map

### Core Page Components
```
components/
├── GeminiPage.tsx          (Reference - Aurora layout)
├── OpenAIPage.tsx          (Target - Legacy layout)
└── KiePage.tsx             (Target - Legacy layout)
```

### Shared Components
```
components/
├── ImageGrid.tsx           (Used by all pages)
├── PromptOptimizerSettings.tsx  (Used by all pages)
├── IterationAssistant.tsx  (Used by all pages)
├── SamplePromptChips.tsx   (Used by all pages)
└── uiStyles.ts             (Shared Aurora styles)
```

### Service Layer
```
services/
├── gemini.ts               (GeminiPage → Gemini API)
├── openai.ts               (OpenAIPage → OpenAI-compatible API)
├── kie.ts                  (KiePage → Kie AI Jobs API)
├── mcp.ts                  (All pages → Prompt optimization)
├── db.ts                   (All pages → Provider/draft persistence)
└── download.ts             (All pages → Image downloads)
```

---

## Key Files Analysis

### 1. State Management Patterns

#### GeminiPage (Reference)
- **Provider State**: `providers[]`, `activeProviderId`, `activeProvider` (computed)
- **Settings State**: `settings: GeminiSettings` (apiKey, baseUrl)
- **Generator State**: `prompt`, `isGenerating`, `isOptimizing`, `refImages[]`
- **Params State**: `params: GenerationParams` (with `model: ModelType` enum)
- **Results State**: `generatedImages[]`, `batchTasks[]`
- **Optimizer Config**: `optimizerConfig: PromptOptimizerConfig | null`

**Key Refs**:
- `isHydratingRef` - Prevents save loops during hydration
- `hydratedProviderIdRef` - Tracks which provider was hydrated
- `abortControllerRef` - Single generation abort
- `batchAbortControllerRef` - Batch generation abort
- `generationRunIdRef` - Prevents race conditions
- `generateLockRef` - Prevents concurrent generation
- `deletingProviderIdRef` - Prevents save during deletion

#### OpenAIPage (Current)
- **Provider State**: Same pattern as GeminiPage
- **Settings State**: `settings: OpenAISettings` (apiKey, baseUrl)
- **Generator State**: Same as GeminiPage
- **Params State**: `params: GenerationParams` (with `model: ModelType.CUSTOM`)
- **Custom Model**: `customModel: string` (separate from params.model)
- **Results State**: `generatedImages[]`, `generatedSlots[]`, `batchTasks[]`
- **Model List State**: `availableModels[]`, `availableImageModels[]`, `availableTextModels[]`, `modelsHint`
- **Optimizer Config**: Same as GeminiPage

**Key Differences**:
- Uses `customModel` string instead of `ModelType` enum
- Has `generatedSlots[]` for error state display
- Has model list fetching (`handleRefreshModels`)
- Has Antigravity Tools mode (`variant` prop, `isAntigravityTools`)

#### KiePage (Current)
- **Provider State**: Same pattern as GeminiPage
- **Settings State**: `settings: KieSettings` (apiKey, baseUrl)
- **Generator State**: Same as GeminiPage
- **Params State**: `params: GenerationParams` (with `model: ModelType.CUSTOM`, `outputFormat: 'png' | 'jpg'`)
- **Custom Model**: `customModel: string` (separate from params.model)
- **Results State**: `generatedImages[]`, `generatedSlots[]`, `batchTasks[]`
- **Model List State**: `availableModels[]`, `modelsHint` (simpler than OpenAI)
- **Optimizer Config**: Same as GeminiPage

**Key Differences**:
- Uses `customModel` string instead of `ModelType` enum
- Has `generatedSlots[]` for error state display
- Has `outputFormat` in params (unique to Kie)
- Simpler model list (no image/text separation)

---

## Data Flow Comparison

### Generation Flow

#### GeminiPage
```
User Input → handleGenerate()
  → optimizeUserPrompt() (if auto mode)
  → generateImages(gemini.ts)
    → Gemini API call
    → GeneratedImage[]
  → saveImage() (auto-save to portfolio)
  → setGeneratedImages()
```

#### OpenAIPage
```
User Input → handleGenerate()
  → optimizeUserPrompt() (if auto mode)
  → generateImages(openai.ts)
    → OpenAI-compatible API call
    → ImageGenerationOutcome[] (ok/error)
  → Convert to ImageGridSlot[]
  → saveImage() (auto-save to portfolio)
  → setGeneratedImages() + setGeneratedSlots()
```

#### KiePage
```
User Input → handleGenerate()
  → optimizeUserPrompt() (if auto mode)
  → generateImages(kie.ts)
    → Kie Jobs API (createTask → poll → getResult)
    → ImageGenerationOutcome[] (ok/error)
  → Convert to ImageGridSlot[]
  → saveImage() (auto-save to portfolio)
  → setGeneratedImages() + setGeneratedSlots()
```

**Key Difference**: OpenAI/Kie return `ImageGenerationOutcome[]` with error states, while Gemini returns `GeneratedImage[]` directly (errors throw).

---

## Provider Management Flow

### All Pages (Shared Pattern)
```
Component Mount
  → useEffect: Load providers from DB
  → useEffect: Load active provider config
  → useEffect: Load draft for active provider
  → useEffect: Hydrate settings/params from provider

User Changes Provider
  → handleSelectProvider()
    → setActiveProviderIdState()
    → setActiveProviderIdInDb()
  → useEffect: Load new provider config
  → useEffect: Load draft for new provider

User Edits Settings
  → setSettings() / setProviderName() / etc.
  → useEffect: Debounced save to DB (300ms)
    → upsertProviderInDb()
    → setProviders() (update local state)

User Edits Prompt/Params
  → setPrompt() / setParams() / etc.
  → useEffect: Debounced save draft (350ms)
    → upsertDraftInDb()
```

**Shared Logic**: All pages use identical provider/draft persistence patterns via `services/db.ts`.

---

## Batch Generation Flow

### All Pages (Shared Pattern)
```
User Enables Batch Mode
  → setBatchModeEnabled(true)

User Enters Multi-line Prompt
  → parsePromptsToBatch(prompt)
    → Split by '\n', trim, filter empty

User Clicks Batch Generate
  → handleBatchGenerate()
    → Create BatchTask[] (one per prompt line)
    → setBatchTasks()
    → setIsBatchMode(true)
    → Execute with concurrency control
      → runTask() for each prompt
        → optimizeUserPrompt() (if auto mode)
        → generateImages() (with countPerPrompt)
        → Update task status (pending → running → success/error)
    → Update batchTasks state
    → Aggregate generatedImages
```

**Shared Logic**: All pages use identical batch generation patterns.

---

## Service Layer Differences

### gemini.ts (GeminiPage)
- **API**: Google Generative AI SDK (`@google/genai`)
- **Endpoint**: `models.generateContent()` (streaming)
- **Response**: Direct `GeneratedImage[]`
- **Error Handling**: Throws errors (no outcome wrapper)

### openai.ts (OpenAIPage)
- **API**: OpenAI-compatible HTTP API
- **Endpoint**: `POST /v1/chat/completions` (streaming)
- **Response**: `ImageGenerationOutcome[]` (ok/error discriminated union)
- **Error Handling**: Returns error outcomes (doesn't throw)
- **Special Features**:
  - Model list fetching (`/v1/models`)
  - Antigravity Tools config inference
  - Image config override support

### kie.ts (KiePage)
- **API**: Kie AI Jobs API (async job-based)
- **Endpoint**: `POST /v1/jobs` → `GET /v1/jobs/{id}` (polling)
- **Response**: `ImageGenerationOutcome[]` (ok/error discriminated union)
- **Error Handling**: Returns error outcomes (doesn't throw)
- **Special Features**:
  - Reference image upload (`kieUpload.ts`)
  - Job polling with exponential backoff
  - Image URL resolution

---

## State Sections Mapping

### Provider Configuration State
**All Pages**:
- `providers: ProviderProfile[]`
- `activeProviderId: string`
- `activeProvider: ProviderProfile | null` (computed)
- `providerName: string`
- `providerFavorite: boolean`
- `settings: { apiKey, baseUrl }`

**OpenAIPage Additional**:
- `availableModels: string[]`
- `availableImageModels: string[]`
- `availableTextModels: string[]`
- `modelsHint: string`
- `isLoadingModels: boolean`

**KiePage Additional**:
- `availableModels: string[]`
- `modelsHint: string`
- `isLoadingModels: boolean`

### Generation Parameters State
**GeminiPage**:
- `params: GenerationParams` (includes `model: ModelType` enum)

**OpenAIPage**:
- `params: GenerationParams` (includes `model: ModelType.CUSTOM`)
- `customModel: string` (actual model ID)

**KiePage**:
- `params: GenerationParams` (includes `model: ModelType.CUSTOM`, `outputFormat: 'png' | 'jpg'`)
- `customModel: string` (actual model ID)

### Results State
**GeminiPage**:
- `generatedImages: GeneratedImage[]`
- `batchTasks: BatchTask[]`

**OpenAIPage**:
- `generatedImages: GeneratedImage[]`
- `generatedSlots: ImageGridSlot[]` (for error display)
- `batchTasks: BatchTask[]`

**KiePage**:
- `generatedImages: GeneratedImage[]`
- `generatedSlots: ImageGridSlot[]` (for error display)
- `batchTasks: BatchTask[]`

---

## Shared Components Usage

### ImageGrid
**Props**:
- `images: GeneratedImage[]` (all pages)
- `slots?: ImageGridSlot[]` (OpenAI/Kie only - for error states)
- `isGenerating: boolean` (all pages)
- `params: GenerationParams` (all pages)
- `onImageClick` / `onEdit` (all pages)

**Usage**:
- GeminiPage: Only `images` prop
- OpenAIPage: `images` + `slots` (when not batch mode)
- KiePage: `images` + `slots` (when not batch mode)

### PromptOptimizerSettings
**Props**:
- `onConfigChange` (all pages)
- `currentPrompt` (all pages)
- `onOptimize` (all pages)
- `isOptimizing` (all pages)

**Usage**:
- GeminiPage: In `aurora-prompt-optimizer` column
- OpenAIPage: Currently inline in sidebar (should move)
- KiePage: Currently inline in sidebar (should move)

### IterationAssistant
**Props**:
- `currentPrompt` (all pages)
- `onUseVersion` (all pages)
- `iterateTemplateId` (all pages)
- `onTemplateChange` (all pages)

**Usage**:
- GeminiPage: In `aurora-assistant` column (≥1200px)
- OpenAIPage: In right column (`hidden md:block`)
- KiePage: Always visible (should add responsive hiding)

---

## Architecture Decisions

### Why OpenAI/Kie Use ImageGridSlot?
- **Error Handling**: OpenAI/Kie APIs can return partial failures (some images succeed, some fail)
- **User Feedback**: Users see which specific images failed and why
- **Gemini**: Gemini API either succeeds or throws (no partial failures)

### Why Custom Model Input?
- **Flexibility**: OpenAI/Kie support many models (not just preset list)
- **Model Discovery**: Users can fetch model lists from API
- **Gemini**: Uses fixed MODEL_PRESETS (NANO_BANANA, NANO_BANANA_PRO)

### Why Separate customModel State?
- **Separation of Concerns**: `params.model` is `ModelType.CUSTOM` enum, `customModel` is actual string
- **Type Safety**: Prevents mixing enum values with string IDs
- **Gemini**: Uses `ModelType` enum directly (no custom string needed)

---

## Refactor Impact Analysis

### Low Risk (UI Only)
- Layout structure migration (CSS classes)
- Color variable migration
- Component positioning

### Medium Risk (State Management)
- Moving PromptOptimizerSettings to new column (state unchanged)
- Moving IterationAssistant to aurora-assistant (state unchanged)
- Reference image display migration (state unchanged)

### High Risk (Functionality)
- None identified - all refactors are UI-only

---

## Acceptance Criteria

- [ ] All state management patterns preserved
- [ ] All data flows unchanged
- [ ] All service calls unchanged
- [ ] Error handling unchanged
- [ ] Provider/draft persistence unchanged
- [ ] Batch generation logic unchanged
- [ ] Only UI layout/styling changed
