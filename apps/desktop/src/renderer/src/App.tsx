import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { VorkApi } from "../../preload/api.js";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VorkApiProvider } from "@/features/chat/useConversation";
import { createQueryClient } from "@/lib/query-client";
import { createAppRouter } from "@/router";

export default function App({ api = window.vorkApi, memory = false }: { api?: VorkApi; memory?: boolean }) {
  const [queryClient] = useState(() => createQueryClient());
  const router = useMemo(() => createAppRouter({ api, memory }), [api, memory]);

  return (
    <VorkApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </VorkApiProvider>
  );
}
