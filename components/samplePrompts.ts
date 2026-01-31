export type SamplePrompt = {
  label: string;
  prompt: string;
};

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    label: '赛博朋克柴犬',
    prompt: '一只戴着护目镜的柴犬宇航员，赛博朋克霓虹灯，雨夜反光，电影级光效，超清细节。',
  },
  {
    label: '极简产品海报',
    prompt: '极简产品海报：香蕉主题，黑金配色，干净留白，高级质感，强对比光影，商业摄影风。',
  },
  {
    label: '国风水墨山水',
    prompt: '中国水墨风山水画，云雾缭绕，留白，宣纸纹理，淡墨层次，意境悠远。',
  },
  {
    label: '像素风小猫',
    prompt: '可爱像素风小猫在键盘上打字，复古游戏 UI 风格，16-bit，暖色灯光。',
  },
  {
    label: '未来城市夜景',
    prompt: '未来主义城市夜景，广角，雨夜街道，霓虹招牌反射，超现实氛围，高清。',
  },
];

export const pickRandomSamplePrompt = (): SamplePrompt => {
  return SAMPLE_PROMPTS[Math.floor(Math.random() * SAMPLE_PROMPTS.length)]!;
};

