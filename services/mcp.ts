/**
 * MCP 提示词优化器服务
 *
 * 封装与 MCP 服务器的通信，提供两个核心功能：
 * 1. optimizeUserPrompt - 优化用户提示词（生图前使用）
 * 2. iteratePrompt - 迭代优化提示词（迭代助手使用）
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
 * 优化用户提示词（生图前使用）
 *
 * @param prompt 原始用户提示词
 * @param templateId 可选的模板 ID
 * @returns 优化后的提示词
 */
export async function optimizeUserPrompt(prompt: string, templateId?: string): Promise<string> {
  const args: Record<string, unknown> = { prompt };
  if (templateId) {
    args.template = templateId;
  }
  return callTool('optimize-user-prompt', args);
}

/**
 * 迭代优化提示词（迭代助手使用）
 *
 * @param prompt 当前提示词
 * @param requirement 用户的修改需求
 * @returns 优化后的提示词
 */
export async function iteratePrompt(prompt: string, requirement: string, templateId?: string): Promise<string> {
  const args: Record<string, unknown> = { prompt, requirements: requirement };
  if (templateId) {
    args.template = templateId;
  }
  return callTool('iterate-prompt', args);
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
