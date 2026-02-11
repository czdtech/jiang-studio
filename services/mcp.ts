/**
 * MCP 提示词优化器服务
 *
 * 封装与 MCP 服务器的通信，提供两个核心功能：
 * 1. optimizeUserPrompt - 优化用户提示词（生图前使用）
 * 2. iteratePrompt - 迭代优化提示词（迭代助手使用）
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parsePromptsToBatch } from './batch';

function getMcpUrl(): URL {
  // In the browser, call same-origin and let Vite proxy `/mcp` to the VM's prompt-optimizer.
  // This avoids `localhost` pointing to the user's own machine (e.g. Windows) instead of the VM.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL('/mcp', window.location.origin);
  }

  // Non-browser fallback (e.g. running this module in Node).
  return new URL('http://127.0.0.1:28081/mcp');
}

let mcpClient: Client | null = null;

/**
 * 获取或创建 MCP 客户端
 */
async function getClient(): Promise<Client> {
  if (mcpClient) {
    return mcpClient;
  }

  const transport = new StreamableHTTPClientTransport(getMcpUrl());
  const client = new Client({
    name: 'nano-banana-studio',
    version: '1.0.0',
  });

  await client.connect(transport);
  mcpClient = client;
  return client;
}

/**
 * 调用 MCP 工具
 */
async function callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  const client = await getClient();

  const result = await client.callTool({
    name: toolName,
    arguments: args,
  });

  // 提取文本内容
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find((c) => c.type === 'text');
    if (textContent && 'text' in textContent) {
      return textContent.text as string;
    }
  }

  throw new Error('MCP 工具返回了意外的格式');
}

/**
 * 优化单条提示词（内部使用）
 */
async function optimizeOne(prompt: string, templateId?: string): Promise<string> {
  const args: Record<string, unknown> = { prompt };
  if (templateId) {
    args.template = templateId;
  }
  return callTool('optimize-user-prompt', args);
}

/**
 * 优化用户提示词（生图前使用）
 *
 * 支持多 prompt 输入：当输入包含 `---` 分隔符时，
 * 会拆分为多条 prompt 分别优化，再用 `\n---\n` 拼接返回。
 *
 * @param prompt 原始用户提示词（可含 `---` 分隔的多条）
 * @param templateId 可选的模板 ID
 * @returns 优化后的提示词
 */
export async function optimizeUserPrompt(prompt: string, templateId?: string): Promise<string> {
  const prompts = parsePromptsToBatch(prompt);
  if (prompts.length === 0) return '';

  const results = await Promise.all(prompts.map((p) => optimizeOne(p, templateId)));
  return results.join('\n---\n');
}

/**
 * 将 base64 图片缩小到指定最大尺寸，返回压缩后的 base64（无 data URI 前缀）
 * 用于视觉迭代时减小 MCP 请求体积
 */
function resizeImageBase64(base64: string, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64); return; }
      ctx.drawImage(img, 0, 0, w, h);
      // 输出 JPEG 质量 0.6，通常 < 30KB
      const result = canvas.toDataURL('image/jpeg', 0.6);
      resolve(result.replace(/^data:image\/\w+;base64,/, ''));
    };
    img.onerror = () => reject(new Error('图片缩放失败'));
    // 确保 src 有 data URI 前缀
    img.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
  });
}

/**
 * 迭代优化提示词（迭代助手使用）
 *
 * @param prompt 当前提示词
 * @param requirement 用户的修改需求
 * @returns 优化后的提示词
 */
export async function iteratePrompt(
  prompt: string,
  requirement: string,
  templateId?: string,
  _context?: {
    targetImageBase64?: string;
    targetImagePrompt?: string;
  },
): Promise<string> {
  const args: Record<string, unknown> = { prompt, requirements: requirement };
  if (templateId) {
    args.template = templateId;
  }

  // 视觉迭代：压缩图片后传递给 MCP 服务（服务端可选支持）
  if (_context?.targetImageBase64) {
    try {
      args.targetImage = await resizeImageBase64(_context.targetImageBase64);
    } catch {
      // 压缩失败则跳过图片，仅用文本迭代
    }
  }
  if (_context?.targetImagePrompt) args.targetImagePrompt = _context.targetImagePrompt;

  try {
    return await callTool('iterate-prompt', args);
  } catch (error) {
    // 413 Payload Too Large：降级为纯文本迭代
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('413') || msg.includes('Payload Too Large')) {
      delete args.targetImage;
      return callTool('iterate-prompt', args);
    }
    throw error;
  }
}

/**
 * 测试 MCP 连接
 *
 * @returns 连接是否成功
 */
export async function testConnection(): Promise<boolean> {
  try {
    await getClient();
    return true;
  } catch {
    return false;
  }
}

/**
 * 断开 MCP 连接
 */
export async function disconnect(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
  }
}
