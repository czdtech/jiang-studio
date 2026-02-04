import React from 'react';
import { Sparkles } from 'lucide-react';

type PageTab = 'gemini' | 'openai_proxy' | 'antigravity_tools' | 'kie' | 'portfolio';

interface SidebarProps {
  activeTab: PageTab;
  onTabChange: (tab: PageTab) => void;
}

interface NavItem {
  id: PageTab;
  label: string;
  shortLabel: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'gemini', label: 'Gemini 官方', shortLabel: 'Gemini' },
  { id: 'openai_proxy', label: '第三方中转', shortLabel: '中转' },
  { id: 'antigravity_tools', label: 'Antigravity', shortLabel: 'AG' },
  { id: 'kie', label: 'Kie AI', shortLabel: 'Kie' },
  { id: 'portfolio', label: '作品集', shortLabel: '作品' },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  return (
    <>
      {/* 桌面端顶部导航 */}
      <header className="hidden md:flex fixed top-0 left-0 right-0 h-12 bg-dark-surface border-b border-dark-border z-50 items-center justify-center">
        <div className="w-full max-w-7xl mx-auto px-4 flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-banana-500 to-banana-600 rounded-[10px] flex items-center justify-center shadow-[var(--shadow-glow)]">
              <Sparkles className="text-obsidian w-4 h-4" />
            </div>
            <span className="text-text-primary font-bold text-sm">Nano Banana</span>
          </div>

          {/* 导航项 */}
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`h-8 px-3 rounded-lg text-sm transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-banana-500/15 text-banana-400'
                      : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* 移动端底部导航 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-dark-surface border-t border-dark-border z-50">
        <div className="flex items-center justify-around h-full px-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex-1 h-full flex items-center justify-center text-xs transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'text-banana-400 bg-banana-500/10'
                    : 'text-gray-500 active:bg-white/5'
                }`}
              >
                {item.shortLabel}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
