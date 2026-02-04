# P2 Regression Checklist (Aurora Layout + Batch Grid)

This checklist focuses on functional regressions and critical UX flows after the Aurora layout refactor and grid auto-fit changes.

## Quick automated checks (optional)
- `npm run test:e2e` (smoke + UI screenshots)
- `npm run test:e2e:update` (if UI changes are expected)

## Global navigation
- [ ] Desktop header nav renders (56px height), active tab highlight works
- [ ] Mobile bottom nav renders, active state correct
- [ ] Switching tabs preserves page state (inputs, selections, scroll positions)

## Shared components
- [ ] Toast shows for success/error/info (color + radius consistent)
- [ ] Tooltip shows on hover/click (top/right) and dismisses on outside click
- [ ] Image preview modal opens and closes correctly
- [ ] Editor modal opens and saves edits correctly

## Gemini page
- [ ] Provider select, favorite, create, delete flows
- [ ] API key/base URL warnings show when missing
- [ ] Prompt input accepts text; sample chips fill prompt
- [ ] Ref images: desktop row (>=1024), mobile popover (bottom-full)
- [ ] Generate disabled without API key
- [ ] Single generate shows results in grid
- [ ] Batch mode toggle works
- [ ] Batch config: concurrency 1–8, count per prompt 1–4
- [ ] Max batch total 32 enforced (prompt list trimmed + info toast)
- [ ] Batch stop works; batch download works
- [ ] Grid auto-fit: no scrollbars in canvas body, all cards visible
- [ ] Iteration assistant visible at >=1200 only

## OpenAI Proxy page
- [ ] Provider list/create/delete/favorite works
- [ ] Base URL required warning; API key requirement respects provider settings
- [ ] Custom model input + datalist works
- [ ] Antigravity is not active here (aspect/size selectable)
- [ ] Ref images desktop row + mobile popover works (limit 8)
- [ ] Single generate + stop
- [ ] Batch mode + config bounds (1–8, 1–4)
- [ ] Max batch total 32 enforced
- [ ] Batch stop + download all
- [ ] Grid auto-fit (no scrollbars; all cards visible)

## Antigravity Tools page
- [ ] Base URL + API key required warnings show
- [ ] Aspect ratio / image size selectors hidden
- [ ] Other params/behavior same as OpenAI Proxy
- [ ] Grid auto-fit (no scrollbars; all cards visible)

## Kie page
- [ ] Provider list/create/delete/favorite works
- [ ] Base URL + API key required warnings show
- [ ] Custom model input works
- [ ] outputFormat remains in config area
- [ ] Ref images desktop row + mobile popover works (limit 8)
- [ ] Single generate + stop
- [ ] Batch mode + config bounds (1–8, 1–4)
- [ ] Max batch total 32 enforced
- [ ] Batch stop + download all
- [ ] Grid auto-fit (no scrollbars; all cards visible)

## Portfolio page
- [ ] Grid renders existing images
- [ ] Image preview and edit work
- [ ] Delete removes item

## Responsive checks
- [ ] 1440x900 (desktop): 3-column layout visible (assistant at >=1200)
- [ ] 1024–1199: ref image row hidden, popover available
- [ ] <=768: mobile nav present, header hidden, padding reduced
- [ ] No horizontal scrollbars; key actions remain accessible
