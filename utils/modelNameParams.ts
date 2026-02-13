/**
 * 从模型名解析方向/分辨率信息。
 *
 * 第三方中转常提供带方向与分辨率后缀的模型变体，如：
 *   gemini-3.0-pro-image-landscape-4k
 *   gemini-2.5-flash-image-portrait
 *   gemini-3.0-pro-image-square-2k
 *
 * 用途：
 *   1) UI 层：自动同步 params 并禁用冲突的选择器
 *   2) API 层：决定是否发送 aspect_ratio / size（避免与模型名冲突）
 */
import type { GenerationParams } from '../types';

export interface ParsedModelNameParams {
  /** 解析出的比例（存在即表示由模型名决定）：landscape→16:9, portrait→9:16, square→1:1, NxN→对应比例 */
  detectedRatio?: GenerationParams['aspectRatio'];
  /** 解析出的尺寸（存在即表示由模型名决定）：2k→2K, 4k→4K */
  detectedSize?: GenerationParams['imageSize'];
}

const ALLOWED_RATIOS = new Set([
  '1:1', '2:3', '3:2', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9',
]);

export function parseModelNameForImageParams(modelName: string): ParsedModelNameParams {
  const s = (modelName || '').toLowerCase();
  const result: ParsedModelNameParams = {};

  // 1. 方向：landscape / portrait / square 优先
  if (/(?:^|[-_])landscape(?:$|[-_])/.test(s)) {
    result.detectedRatio = '16:9';
  } else if (/(?:^|[-_])portrait(?:$|[-_])/.test(s)) {
    result.detectedRatio = '9:16';
  } else if (/(?:^|[-_])square(?:$|[-_])/.test(s)) {
    result.detectedRatio = '1:1';
  } else {
    // NxN 格式（如 16x9, 3-4）
    const ratioMatch = s.match(/(?:^|[-_])(1|2|3|4|5|9|16|21)[x-](1|2|3|4|5|9|16)(?:$|[-_])/);
    if (ratioMatch) {
      const key = `${ratioMatch[1]}:${ratioMatch[2]}`;
      if (ALLOWED_RATIOS.has(key)) {
        result.detectedRatio = key as GenerationParams['aspectRatio'];
      }
    }
  }

  // 2. 分辨率：2k / 4k
  const sizeMatch = s.match(/(?:^|[-_])(2k|4k)(?:$|[-_])/);
  if (sizeMatch?.[1] === '2k') {
    result.detectedSize = '2K';
  } else if (sizeMatch?.[1] === '4k') {
    result.detectedSize = '4K';
  }

  return result;
}
