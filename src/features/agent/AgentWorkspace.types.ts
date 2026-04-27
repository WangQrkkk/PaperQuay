import type { LucideIcon } from 'lucide-react';
import type { LibraryAgentPlan, LibraryAgentTool } from '../../services/libraryAgent';

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
  description: string;
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
  trace?: AgentTraceStep[];
  toolCall?: AgentToolCallView;
  plan?: LibraryAgentPlan;
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
  status: AgentStepStatus;
}
