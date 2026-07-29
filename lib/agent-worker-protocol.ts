export type AgentWorkerInitRequest = {
  type: "init";
  requestId: string;
  sessionId: string;
  sessionFile: string;
  cwd: string;
  toolNames?: string[];
};

export type AgentWorkerCommandRequest = {
  type: "command";
  requestId: string;
  command: Record<string, unknown>;
};

export type AgentWorkerDestroyRequest = {
  type: "destroy";
  requestId: string;
};

export type AgentWorkerRequest =
  | AgentWorkerInitRequest
  | AgentWorkerCommandRequest
  | AgentWorkerDestroyRequest;

export type AgentWorkerReadyMessage = {
  type: "ready";
  requestId: string;
  realSessionId: string;
  sessionFile: string;
  cwd: string;
  running: boolean;
};

export type AgentWorkerResponseMessage = {
  type: "response";
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
};

export type AgentWorkerEventMessage = {
  type: "event";
  event: {
    type: string;
    [key: string]: unknown;
  };
};

export type AgentWorkerStatusMessage = {
  type: "status";
  running: boolean;
};

export type AgentWorkerDestroyedMessage = {
  type: "destroyed";
};

export type AgentWorkerFatalMessage = {
  type: "fatal";
  error: string;
};

export type AgentWorkerMessage =
  | AgentWorkerReadyMessage
  | AgentWorkerResponseMessage
  | AgentWorkerEventMessage
  | AgentWorkerStatusMessage
  | AgentWorkerDestroyedMessage
  | AgentWorkerFatalMessage;
