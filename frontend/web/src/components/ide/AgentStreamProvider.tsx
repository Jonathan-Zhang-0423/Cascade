import { createContext, useContext } from "react";
import { useManagerStream } from "./chat/hooks/useManagerStream";
import { useBuildStream } from "./chat/hooks/useBuildStream";

interface AgentStreamContextValue {
  manager: ReturnType<typeof useManagerStream>;
  build: ReturnType<typeof useBuildStream>;
}

const AgentStreamContext = createContext<AgentStreamContextValue | null>(null);

export function AgentStreamProvider({ children }: { children: React.ReactNode }) {
  const manager = useManagerStream();
  const build = useBuildStream();
  return (
    <AgentStreamContext.Provider value={{ manager, build }}>
      {children}
    </AgentStreamContext.Provider>
  );
}

export function useAgentStream() {
  const ctx = useContext(AgentStreamContext);
  if (!ctx) throw new Error("useAgentStream must be used within AgentStreamProvider");
  return ctx;
}
