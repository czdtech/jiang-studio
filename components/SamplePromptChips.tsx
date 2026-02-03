import React from 'react';
import { pickRandomSamplePrompt, SAMPLE_PROMPTS } from './samplePrompts';

interface SamplePromptChipsProps {
  onPick: (prompt: string) => void;
  max?: number;
}

export const SamplePromptChips: React.FC<SamplePromptChipsProps> = ({ onPick, max = 4 }) => {
  const list = SAMPLE_PROMPTS.slice(0, Math.max(0, max));

  return (
    <div className="mt-3 rounded-xl border border-dark-border bg-dark-bg/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-500">示例提示词（点击填入）</span>
        <button
          type="button"
          onClick={() => onPick(pickRandomSamplePrompt().prompt)}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          随机一个
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {list.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onPick(item.prompt)}
            title={item.prompt}
            className="h-8 px-3 rounded-full border border-dark-border bg-dark-bg text-sm text-gray-300 hover:text-white hover:bg-white/5 hover:border-gray-500 transition-colors cursor-pointer"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
};
