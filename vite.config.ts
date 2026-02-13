import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * 开发模式通用 CORS 代理插件。
 * 前端将外部 URL 编码为 /cors-proxy/{encodeURIComponent(url)}，
 * 由 Vite dev server 代为转发，绕过浏览器 CORS 限制。
 * 生产构建无影响（前端不会走此路径）。
 */
function corsProxyPlugin(): Plugin {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const prefix = '/cors-proxy/';
        if (!req.url?.startsWith(prefix)) return next();

        const targetUrl = decodeURIComponent(req.url.slice(prefix.length));
        if (!targetUrl.startsWith('http')) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid target URL');
          return;
        }

        // CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400',
          });
          res.end();
          return;
        }

        // 转发请求
        const parsed = new URL(targetUrl);
        const doRequest = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

        // 清理不应转发的浏览器头
        const headers: Record<string, string | string[] | undefined> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (['host', 'origin', 'referer'].includes(key)) continue;
          headers[key] = value;
        }
        headers['host'] = parsed.host;

        const proxyReq = doRequest(
          parsed,
          { method: req.method, headers },
          (proxyRes) => {
            // 复制响应头并注入 CORS
            const resHeaders: Record<string, string | string[] | undefined> = { ...proxyRes.headers };
            resHeaders['access-control-allow-origin'] = '*';
            resHeaders['access-control-allow-methods'] = '*';
            resHeaders['access-control-allow-headers'] = '*';
            // 移除可能阻碍浏览器读取响应的头
            delete resHeaders['content-security-policy'];
            delete resHeaders['x-frame-options'];
            res.writeHead(proxyRes.statusCode || 200, resHeaders);
            proxyRes.pipe(res);
          }
        );

        proxyReq.on('error', (err) => {
          console.error('[cors-proxy] Error:', err.message);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
          }
          res.end(`Proxy error: ${err.message}`);
        });

        // 将请求体（POST 数据等）转发到目标
        req.pipe(proxyReq);
      });
    },
  };
}

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
      plugins: [corsProxyPlugin(), react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
