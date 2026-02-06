import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const antigravityTarget = env.ANTIGRAVITY_PROXY_TARGET || 'http://127.0.0.1:8045';
    const openaiTarget = env.OPENAI_PROXY_TARGET || 'https://api.openai.com';
    const promptOptimizerTarget = env.PROMPT_OPTIMIZER_TARGET || 'http://127.0.0.1:28081';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // MCP: keep browser calls same-origin and proxy to prompt-optimizer.
          // This avoids "localhost" pointing to Windows (not the VM) in browser.
          '/mcp': {
            target: promptOptimizerTarget,
            changeOrigin: true,
          },
          // 解决 HTTPS 页面直连 HTTP 本地服务的 Mixed Content + CORS 问题（仅 dev 生效）
          '/antigravity': {
            target: antigravityTarget,
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/antigravity/, ''),
          },
          // 可选：开发环境下用同源代理访问 OpenAI（避免浏览器 CORS）
          '/openai': {
            target: openaiTarget,
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/openai/, ''),
          },
        },
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
