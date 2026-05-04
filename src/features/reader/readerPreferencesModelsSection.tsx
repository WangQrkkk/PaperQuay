import clsx from 'clsx';
import { Settings2 } from 'lucide-react';
import { useState } from 'react';

import type {
  ModelReasoningEffort,
  ModelRuntimeConfig,
  ModelRuntimeRole,
  OpenAICompatibleTestResult,
  QaModelPreset,
  ReaderSettings,
} from '../../types/reader';
import {
  getModelRuntimeConfig,
  MODEL_REASONING_OPTIONS,
  normalizeModelRuntimeConfig,
  normalizeModelTemperature,
  resolveModelPreset,
} from './readerShared';
import {
  SettingsField,
  SettingsInput,
  SettingsSelect,
} from './readerPreferencesPrimitives';
import type {
  ReaderPreferencesLocalizer,
  ReaderSettingsChangeHandler,
} from './readerPreferencesTypes';

type ModelPresetSettingKey =
  | 'translationModelPresetId'
  | 'selectionTranslationModelPresetId'
  | 'summaryModelPresetId'
  | 'agentModelPresetId'
  | 'qaActivePresetId';

interface ModelRoleBinding {
  key: string;
  runtimeRole: ModelRuntimeRole;
  settingKey: ModelPresetSettingKey;
  title: string;
  description: string;
}

interface ReaderPreferencesModelsSectionProps {
  active: boolean;
  l: ReaderPreferencesLocalizer;
  uiLanguage: ReaderSettings['uiLanguage'];
  settings: ReaderSettings;
  qaModelPresets: QaModelPreset[];
  onSettingChange: ReaderSettingsChangeHandler;
  onTestLlmConnection: (preset?: QaModelPreset) => Promise<OpenAICompatibleTestResult>;
  onQaModelPresetAdd: () => void;
  onQaModelPresetRemove: (presetId: string) => void;
  onQaModelPresetChange: (presetId: string, patch: Partial<QaModelPreset>) => void;
}

function buildModelRoleBindings(l: ReaderPreferencesLocalizer): ModelRoleBinding[] {
  return [
    {
      key: 'translation',
      runtimeRole: 'translation',
      settingKey: 'translationModelPresetId',
      title: l('文档翻译', 'Document Translation'),
      description: l(
        '全文翻译、批量翻译和 MinerU 块翻译。',
        'Full translation, batch translation, and MinerU block translation.',
      ),
    },
    {
      key: 'selection-translation',
      runtimeRole: 'selectionTranslation',
      settingKey: 'selectionTranslationModelPresetId',
      title: l('划词翻译', 'Selection Translation'),
      description: l(
        '阅读器中选中文本后的快速翻译。',
        'Quick translation for selected text in the reader.',
      ),
    },
    {
      key: 'summary',
      runtimeRole: 'summary',
      settingKey: 'summaryModelPresetId',
      title: l('论文概览', 'Paper Overview'),
      description: l(
        '论文概览、文库预览概览和批量概览生成。',
        'Paper overview, library preview overview, and batch overview generation.',
      ),
    },
    {
      key: 'agent',
      runtimeRole: 'agent',
      settingKey: 'agentModelPresetId',
      title: 'Agent 工具调用模型',
      description: l(
        '用于选择工具、生成参数、批量整理文献。',
        'Used for tool selection, parameter generation, and batch library operations.',
      ),
    },
    {
      key: 'qa',
      runtimeRole: 'qa',
      settingKey: 'qaActivePresetId',
      title: l('问答默认模型', 'Default QA Model'),
      description: l(
        '论文问答助手的默认模型。',
        'Default model for the paper QA assistant.',
      ),
    },
  ];
}

function formatRuntimeConfig(
  l: ReaderPreferencesLocalizer,
  runtimeConfig: ModelRuntimeConfig,
): string {
  const temperatureLabel =
    typeof runtimeConfig.temperature === 'number'
      ? `Temp ${runtimeConfig.temperature}`
      : l('Temp 默认', 'Temp default');
  const reasoningLabel =
    runtimeConfig.reasoningEffort && runtimeConfig.reasoningEffort !== 'auto'
      ? `${l('思考', 'Reasoning')} ${runtimeConfig.reasoningEffort}`
      : l('思考 自动', 'Reasoning auto');

  return `${temperatureLabel} · ${reasoningLabel}`;
}

export function ReaderPreferencesModelsSection({
  active,
  l,
  uiLanguage,
  settings,
  qaModelPresets,
  onSettingChange,
  onTestLlmConnection,
  onQaModelPresetAdd,
  onQaModelPresetRemove,
  onQaModelPresetChange,
}: ReaderPreferencesModelsSectionProps) {
  const [presetTestLoadingMap, setPresetTestLoadingMap] = useState<Record<string, boolean>>({});
  const [presetTestResultMap, setPresetTestResultMap] = useState<
    Record<string, OpenAICompatibleTestResult | null>
  >({});
  const [expandedModelConfigKey, setExpandedModelConfigKey] = useState<string | null>(null);
  const modelRoleBindings = buildModelRoleBindings(l);

  const handleTestModelPreset = async (preset: QaModelPreset) => {
    setPresetTestLoadingMap((current) => ({
      ...current,
      [preset.id]: true,
    }));
    setPresetTestResultMap((current) => ({
      ...current,
      [preset.id]: null,
    }));

    try {
      const result = await onTestLlmConnection(preset);
      setPresetTestResultMap((current) => ({
        ...current,
        [preset.id]: result,
      }));
    } catch (nextError) {
      setPresetTestResultMap((current) => ({
        ...current,
        [preset.id]: {
          ok: false,
          endpoint: preset.baseUrl.trim(),
          model: preset.model.trim(),
          latencyMs: 0,
          message: nextError instanceof Error ? nextError.message : l('模型测试失败', 'Model test failed'),
        },
      }));
    } finally {
      setPresetTestLoadingMap((current) => ({
        ...current,
        [preset.id]: false,
      }));
    }
  };

  const handleModelRuntimeConfigChange = (
    role: ModelRuntimeRole,
    patch: Partial<ModelRuntimeConfig>,
  ) => {
    const currentConfig = getModelRuntimeConfig(settings, role);

    onSettingChange('modelRuntimeConfigs', {
      ...settings.modelRuntimeConfigs,
      [role]: normalizeModelRuntimeConfig({
        ...currentConfig,
        ...patch,
      }),
    });
  };

  if (!active) {
    return null;
  }

  return (
    <>
      <SettingsField
        label={l('模型预设库', 'Model Presets')}
        description={l(
          '统一维护翻译、概览与问答共用的 OpenAI 兼容模型配置。',
          'Maintain shared OpenAI-compatible model configurations for translation, overview, and QA.',
        )}
      >
        <div className="space-y-3">
          {qaModelPresets.map((preset) => (
            <div
              key={preset.id}
              className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-medium text-slate-900">
                  {preset.label || preset.model || l('未命名模型', 'Unnamed Preset')}
                </div>
                <button
                  type="button"
                  onClick={() => void handleTestModelPreset(preset)}
                  disabled={
                    !preset.baseUrl.trim() ||
                    !preset.model.trim() ||
                    !preset.apiKey.trim() ||
                    Boolean(presetTestLoadingMap[preset.id])
                  }
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  {presetTestLoadingMap[preset.id]
                    ? l('测试中...', 'Testing...')
                    : l('测试', 'Test')}
                </button>
                <button
                  type="button"
                  onClick={() => onQaModelPresetRemove(preset.id)}
                  disabled={qaModelPresets.length <= 1}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  {l('删除', 'Delete')}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500">
                    {l('显示名称', 'Display Name')}
                  </div>
                  <SettingsInput
                    value={preset.label}
                    onChange={(event) =>
                      onQaModelPresetChange(preset.id, { label: event.target.value })
                    }
                    placeholder={l('例如：DeepSeek Chat', 'Example: DeepSeek Chat')}
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500">
                    {l('模型名称', 'Model Name')}
                  </div>
                  <SettingsInput
                    value={preset.model}
                    onChange={(event) =>
                      onQaModelPresetChange(preset.id, { model: event.target.value })
                    }
                    placeholder="gpt-4o-mini / deepseek-chat / qwen-plus"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="text-xs font-medium text-slate-500">
                    {l('地址', 'Endpoint')}
                  </div>
                  <SettingsInput
                    value={preset.baseUrl}
                    onChange={(event) =>
                      onQaModelPresetChange(preset.id, { baseUrl: event.target.value })
                    }
                    placeholder="https://api.openai.com"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="text-xs font-medium text-slate-500">API Key</div>
                  <SettingsInput
                    value={preset.apiKey}
                    onChange={(event) =>
                      onQaModelPresetChange(preset.id, { apiKey: event.target.value })
                    }
                    type="password"
                    placeholder={l(
                      '输入该模型预设的 API Key',
                      'Enter the API key for this preset',
                    )}
                  />
                </div>
              </div>

              {!preset.baseUrl.trim() || !preset.model.trim() || !preset.apiKey.trim() ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                  {l(
                    'Base URL、模型名称和 API Key 需要同时填写，才能用于测试与调用。',
                    'Fill in the Base URL, model name, and API key before testing or using this preset.',
                  )}
                </div>
              ) : null}

              {presetTestResultMap[preset.id] ? (
                <div
                  className={clsx(
                    'mt-3 rounded-xl border px-3 py-2 text-xs leading-5',
                    presetTestResultMap[preset.id]?.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-rose-200 bg-rose-50 text-rose-700',
                  )}
                >
                  <div className="font-medium">
                    {presetTestResultMap[preset.id]?.ok
                      ? l('连接成功', 'Connection Succeeded')
                      : l('连接失败', 'Connection Failed')}
                    {presetTestResultMap[preset.id]?.latencyMs
                      ? ` · ${presetTestResultMap[preset.id]!.latencyMs} ms`
                      : ''}
                  </div>
                  <div className="mt-1 break-all">
                    {l('地址', 'Endpoint')}:{' '}
                    {presetTestResultMap[preset.id]?.endpoint || l('未返回', 'Unavailable')}
                  </div>
                  <div className="mt-1 break-all">
                    {l('模型', 'Model')}:{' '}
                    {presetTestResultMap[preset.id]?.responseModel ||
                      presetTestResultMap[preset.id]?.model ||
                      l('未返回', 'Unavailable')}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">
                    {presetTestResultMap[preset.id]?.message}
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            onClick={onQaModelPresetAdd}
            className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            {l('新增模型预设', 'Add Model Preset')}
          </button>
        </div>
      </SettingsField>

      <SettingsField
        label={l('功能角色绑定', 'Feature Role Binding')}
        description={l(
          '为文档翻译、划词翻译、概览、问答与 Agent 工具调用分别选择默认模型。',
          'Choose default presets for document translation, selection translation, overview, QA, and Agent tool use.',
        )}
      >
        <div className="space-y-3">
          {modelRoleBindings.map((binding) => {
            const selectedPresetId = settings[binding.settingKey];
            const selectedPreset = resolveModelPreset(qaModelPresets, selectedPresetId);
            const runtimeConfig = getModelRuntimeConfig(settings, binding.runtimeRole);
            const expanded = expandedModelConfigKey === binding.key;

            return (
              <div
                key={binding.key}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-chrome-900/72"
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(150px,220px)_minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-chrome-100">
                      {binding.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-chrome-400">
                      {binding.description}
                    </div>
                  </div>
                  <SettingsSelect
                    value={selectedPresetId}
                    onChange={(event) => onSettingChange(binding.settingKey, event.target.value)}
                  >
                    {qaModelPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label || preset.model}
                      </option>
                    ))}
                  </SettingsSelect>
                  <button
                    type="button"
                    onClick={() => setExpandedModelConfigKey(expanded ? null : binding.key)}
                    disabled={!selectedPreset}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:bg-chrome-700"
                  >
                    <Settings2 className="h-4 w-4" strokeWidth={1.8} />
                    {l('配置', 'Configure')}
                  </button>
                </div>
                <div className="mt-2 text-[11px] leading-5 text-slate-400 dark:text-chrome-500">
                  {selectedPreset
                    ? `${selectedPreset.label || selectedPreset.model} · ${formatRuntimeConfig(l, runtimeConfig)}`
                    : l('未选择模型预设', 'No model preset selected')}
                </div>

                {expanded && selectedPreset ? (
                  <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-chrome-800/80 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-500 dark:text-chrome-400">
                        {l('温度', 'Temperature')}
                      </div>
                      <SettingsInput
                        type="number"
                        min={0}
                        max={2}
                        step={0.05}
                        value={runtimeConfig.temperature ?? ''}
                        onChange={(event) =>
                          handleModelRuntimeConfigChange(binding.runtimeRole, {
                            temperature: normalizeModelTemperature(event.target.value),
                          })
                        }
                        placeholder={l('默认', 'Default')}
                      />
                      <div className="text-[11px] leading-5 text-slate-400 dark:text-chrome-500">
                        {l(
                          '留空时使用各功能默认值；建议翻译/概览 0.1-0.3，创意生成可提高。',
                          'Leave blank to use each feature default; 0.1-0.3 is recommended for translation/overview.',
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-500 dark:text-chrome-400">
                        {l('思考程度', 'Reasoning Effort')}
                      </div>
                      <SettingsSelect
                        value={runtimeConfig.reasoningEffort ?? 'auto'}
                        onChange={(event) =>
                          handleModelRuntimeConfigChange(binding.runtimeRole, {
                            reasoningEffort: event.target.value as ModelReasoningEffort,
                          })
                        }
                      >
                        {MODEL_REASONING_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {l(option.labelZh, option.labelEn)}
                          </option>
                        ))}
                      </SettingsSelect>
                      <div className="text-[11px] leading-5 text-slate-400 dark:text-chrome-500">
                        {
                          MODEL_REASONING_OPTIONS.find(
                            (option) => option.value === (runtimeConfig.reasoningEffort ?? 'auto'),
                          )?.[uiLanguage === 'en-US' ? 'descriptionEn' : 'descriptionZh']
                        }
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </SettingsField>
    </>
  );
}
