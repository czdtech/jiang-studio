import React from 'react';
import { pickRandomSamplePrompt, SAMPLE_PROMPTS } from './samplePrompts';

interface SamplePromptChipsProps {
  onPick: (prompt: string) => void;
  max?: number;
}

export const SamplePromptChips: React.FC<SamplePromptChipsProps> = ({ onPick, max = 4 }) => {
  const list = SAMPLE_PROMPTS.slice(0, Math.max(0, max));

  return (
    <div className="mt-2 rounded-lg border border-dark-border bg-dark-bg/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-500">示例提示词（点击填入）</span>
        <button
          type="button"
          onClick={() => onPick(pickRandomSamplePrompt().prompt)}
          className="text-xs text-gray-400 hover:text-white transition-colors"
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
            className="h-7 px-2.5 rounded-full border border-dark-border bg-dark-bg text-xs text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
};

