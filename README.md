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

## E2E (Playwright)

- Run smoke + UI screenshot regression:
  `npm run test:e2e`
- Update screenshot baselines:
  `npm run test:e2e:update`
- Open the Playwright UI runner:
  `npm run test:e2e:ui`
