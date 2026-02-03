<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# nano-bababa-studio

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Mxb1zZ_YaSzpJDMtEjEXYMn9WuIifgpQ

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Dev Proxy (optional)

- Antigravity Tools 默认使用同源路径 `/antigravity`（避免 Mixed Content / CORS）
  - 默认代理目标：`http://127.0.0.1:8045`
  - 可用环境变量覆盖：`ANTIGRAVITY_PROXY_TARGET`
- 可选 OpenAI 同源代理路径 `/openai`（仅 dev 代理）
  - 默认代理目标：`https://api.openai.com`
  - 可用环境变量覆盖：`OPENAI_PROXY_TARGET`

## E2E (Playwright)

- Run smoke + UI screenshot regression:
  `npm run test:e2e`
- Update screenshot baselines:
  `npm run test:e2e:update`
- Open the Playwright UI runner:
  `npm run test:e2e:ui`
