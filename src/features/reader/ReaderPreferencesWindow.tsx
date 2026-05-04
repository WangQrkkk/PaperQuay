import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useWheelScrollDelegate } from '../../hooks/useWheelScrollDelegate';
import { pickLocaleText, type PreferencesSectionKey } from './readerShared';
import {
  buildReaderPreferencesSections,
  ReaderPreferencesContent,
} from './readerPreferencesContent';
import type { ReaderPreferencesWindowProps } from './readerPreferencesTypes';

export type { ReaderPreferencesWindowProps } from './readerPreferencesTypes';

export default function ReaderPreferencesWindow({
  open,
  onClose,
  preferredSection,
  settings,
  translatedCount = 0,
  ...contentProps
}: ReaderPreferencesWindowProps) {
  const l = <T,>(zh: T, en: T) => pickLocaleText(settings.uiLanguage, zh, en);
  const sections = buildReaderPreferencesSections(l);
  const [activeSection, setActiveSection] = useState<PreferencesSectionKey>('general');
  const sidebarRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const handleSidebarWheelCapture = useWheelScrollDelegate({ rootRef: sidebarRef });
  const handleContentWheelCapture = useWheelScrollDelegate({ rootRef: contentRef });

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (preferredSection) {
      setActiveSection(preferredSection);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, preferredSection]);

  if (!open) {
    return null;
  }

  const activeSectionMeta = sections.find((section) => section.key === activeSection);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/62 backdrop-blur-sm">
      <button
        type="button"
        aria-label={l('关闭设置窗口', 'Close settings window')}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="paperquay-settings relative flex h-[min(760px,calc(100vh-32px))] w-[min(1080px,calc(100vw-32px))] overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fafc,#f1f5f9)] shadow-[0_36px_120px_rgba(15,23,42,0.20)] dark:border-white/10 dark:bg-chrome-950 dark:shadow-[0_36px_120px_rgba(0,0,0,0.48)]">
        <aside
          ref={sidebarRef}
          onWheelCapture={handleSidebarWheelCapture}
          className="flex min-h-0 w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white/76 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-900"
        >
          <div className="shrink-0 px-3 pb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-chrome-400">
              {l('设置', 'Settings')}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-chrome-100">
              {l('设置', 'Settings')}
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-500 dark:text-chrome-300">
              {l(
                '像桌面应用一样管理文库、阅读、解析与模型能力。',
                'Manage library, reading, parsing, and model capabilities in a desktop-first workflow.',
              )}
            </div>
          </div>

          <div
            data-wheel-scroll-target
            className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-y-contain pr-1"
          >
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200',
                  activeSection === section.key
                    ? 'bg-accent-teal/18 text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.18)] dark:bg-accent-teal/18 dark:text-chrome-100 dark:shadow-none'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-chrome-300 dark:hover:bg-chrome-700 dark:hover:text-chrome-100',
                )}
              >
                <span
                  className={clsx(
                    'mt-0.5',
                    activeSection === section.key
                      ? 'text-accent-teal dark:text-accent-teal'
                      : 'text-slate-400 dark:text-chrome-400',
                  )}
                >
                  {section.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{section.title}</span>
                  <span
                    className={clsx(
                      'mt-1 block text-xs leading-5',
                      activeSection === section.key
                        ? 'text-slate-600 dark:text-chrome-300'
                        : 'text-slate-400 dark:text-chrome-400',
                    )}
                  >
                    {section.description}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 shrink-0 rounded-2xl border border-slate-200 bg-white/80 p-3 text-xs leading-5 text-slate-500 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300">
            {l(
              `当前翻译缓存：${translatedCount} 个结构块`,
              `Translation cache: ${translatedCount} blocks`,
            )}
          </div>
        </aside>

        <section
          ref={contentRef}
          onWheelCapture={handleContentWheelCapture}
          className="flex min-w-0 flex-1 flex-col"
        >
          <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/70 px-6 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-chrome-400">
                {activeSectionMeta?.title}
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-chrome-100">
                {activeSectionMeta?.description}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:bg-chrome-700"
            >
              <X className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('关闭', 'Close')}
            </button>
          </header>

          <div
            data-wheel-scroll-target
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-6 py-6 pb-10"
          >
            <ReaderPreferencesContent
              activeSection={activeSection}
              l={l}
              settings={settings}
              {...contentProps}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
