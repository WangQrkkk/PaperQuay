import type { LucideIcon } from 'lucide-react';
import type { LibraryAgentPlan, LibraryAgentTool, LibraryAgentUserChoice } from '../../services/libraryAgent';
import type { DocumentChatAttachment } from '../../types/reader';

export type AgentStepStatus = 'waiting' | 'running' | 'success' | 'error';

export type AgentStepType =
  | 'intent'
  | 'thought-summary'
  | 'plan'
  | 'tool-call'
  | 'tool-result'
  | 'final';

export interface AgentCapability {
  key: LibraryAgentTool;
  functionName: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  icon: LucideIcon;
}

export interface AgentTraceStep {
  id: string;
  type: AgentStepType;
  title: string;
  summary: string;
  status: AgentStepStatus;
  durationMs?: number;
  detail?: string;
}

export interface AgentToolCallView {
  id: string;
  tool: LibraryAgentTool;
  functionName: string;
  status: AgentStepStatus;
  durationMs?: number;
  parameterSummary: string;
  resultSummary: string;
  rawParameters: Record<string, unknown>;
}

export interface AgentChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  meta?: string;
  createdAt: number;
  attachments?: DocumentChatAttachment[];
  trace?: AgentTraceStep[];
  toolCall?: AgentToolCallView;
  plan?: LibraryAgentPlan;
  choices?: LibraryAgentUserChoice[];
  error?: string;
}

export interface AgentHistorySession {
  id: string;
  title: string;
  summary: string;
  updatedAt: number;
  messages: AgentChatMessage[];
  selectedPaperIds: string[];
  lastInstruction: string;
  ragEnabled?: boolean;
  selectedModelPresetId?: string;
  attachments?: DocumentChatAttachment[];
  status: AgentStepStatus;
}
