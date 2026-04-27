import { create } from 'zustand';

export type ReaderTabType = 'library' | 'reader';

export interface BaseAppTab {
  id: string;
  type: ReaderTabType;
  title: string;
}

export interface LibraryTab extends BaseAppTab {
  id: 'home';
  type: 'library';
}

export interface ReaderTab extends BaseAppTab {
  type: 'reader';
  documentId: string;
}

export type AppTab = LibraryTab | ReaderTab;

interface TabsState {
  tabs: AppTab[];
  activeTabId: string;
  openTab: (documentId: string, title: string) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setHomeTabTitle: (title: string) => void;
}

export const HOME_TAB_ID = 'home';

export function getHomeTabTitle(locale: 'zh-CN' | 'en-US') {
  return locale === 'en-US' ? 'My Library' : '我的文库';
}

function createHomeTab(title = getHomeTabTitle('zh-CN')): LibraryTab {
  return {
    id: HOME_TAB_ID,
    type: 'library',
    title,
  };
}

function createReaderTabId(documentId: string): string {
  return `reader:${documentId}`;
}

export const useTabsStore = create<TabsState>()((set, get) => ({
  tabs: [createHomeTab()],
  activeTabId: HOME_TAB_ID,
  openTab: (documentId, title) => {
    const nextTabId = createReaderTabId(documentId);
    const existingTab = get().tabs.find((tab) => tab.id === nextTabId);

    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return existingTab.id;
    }

    const nextTab: ReaderTab = {
      id: nextTabId,
      type: 'reader',
      title,
      documentId,
    };

    set((state) => ({
      tabs: [...state.tabs, nextTab],
      activeTabId: nextTab.id,
    }));

    return nextTab.id;
  },
  closeTab: (tabId) => {
    if (tabId === HOME_TAB_ID) {
      return;
    }

    const { tabs, activeTabId } = get();
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);

    if (closingIndex === -1) {
      return;
    }

    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    const fallbackTab = nextTabs[Math.max(closingIndex - 1, 0)] ?? createHomeTab();

    set({
      tabs: nextTabs.length > 0 ? nextTabs : [createHomeTab()],
      activeTabId: activeTabId === tabId ? fallbackTab.id : activeTabId,
    });
  },
  setActiveTab: (tabId) => {
    if (!get().tabs.some((tab) => tab.id === tabId)) {
      return;
    }

    set({ activeTabId: tabId });
  },
  setHomeTabTitle: (title) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === HOME_TAB_ID && tab.type === 'library' ? { ...tab, title } : tab,
      ),
    }));
  },
}));
