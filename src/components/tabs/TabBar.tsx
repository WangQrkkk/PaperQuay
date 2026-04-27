import type { AppTab } from '../../stores/useTabsStore';
import TabItem from './TabItem';

interface TabBarProps {
  tabs: AppTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

function TabBar({ tabs, activeTabId, onSelect, onClose }: TabBarProps) {
  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-slate-200/90 bg-slate-100/95 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-900">
      <div className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
      </div>
    </div>
  );
}

export default TabBar;
