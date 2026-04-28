export function updateAgentRunningSessions(
  current: ReadonlySet<string>,
  sessionId: string,
  running: boolean,
): Set<string> {
  const next = new Set(current);

  if (running) {
    next.add(sessionId);
  } else {
    next.delete(sessionId);
  }

  return next;
}

export function isAgentSessionRunning(
  current: ReadonlySet<string>,
  sessionId: string,
): boolean {
  return current.has(sessionId);
}
