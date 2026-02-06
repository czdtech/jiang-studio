import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// prompt-optimizer 内网地址（Railway Private Networking）
const mcpTarget = process.env.PROMPT_OPTIMIZER_TARGET
  || 'http://prompt-optimizer.railway.internal:80';

// 代理 /mcp 到 prompt-optimizer 内网服务
app.use('/mcp', createProxyMiddleware({
  target: mcpTarget,
  changeOrigin: true,
}));

// 托管 dist/ 静态文件
app.use(express.static(path.join(__dirname, 'dist')));

// SPA 回退：所有未匹配路由返回 index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on :${PORT}`);
  console.log(`MCP proxy → ${mcpTarget}`);
});
