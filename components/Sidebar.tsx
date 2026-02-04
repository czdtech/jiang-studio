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
      <header className="aurora-header">
        <div className="aurora-header-inner">
          {/* Logo */}
          <div className="aurora-logo">
            <div className="aurora-logo-icon">
              <Sparkles className="text-obsidian w-4 h-4" />
            </div>
            <span className="aurora-logo-text">Nano Banana Studio</span>
          </div>

          {/* 导航项 */}
          <nav className="aurora-nav">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`aurora-nav-link ${isActive ? 'active' : ''}`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* 移动端底部导航 */}
      <nav className="aurora-mobile-nav">
        <div className="aurora-mobile-nav-inner">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`aurora-mobile-item ${isActive ? 'active' : ''}`}
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
