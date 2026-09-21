import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  createHashHistory,
  createMemoryHistory,
  type AnyRouter
} from "@tanstack/react-router";
import type { VorkApi } from "../../preload/api.js";
import { AppShell } from "@/layouts/AppShell";
import { ConversationPage } from "@/routes/ConversationPage";
import { HomePage } from "@/routes/HomePage";
import { CredentialsPage, FilesPage, SettingsPage, SkillsPage, TasksPage } from "@/routes/ManagePages";
import { NewChatPage } from "@/routes/NewChatPage";

export type RouterContext = {
  api: VorkApi;
};

function buildRouteTree() {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: AppShell
  });

  return rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage }),
    createRoute({ getParentRoute: () => rootRoute, path: "/new", component: NewChatPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "/c/$conversationId", component: ConversationPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "/tasks", component: TasksPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "/skills", component: SkillsPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "/files", component: FilesPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "/credentials", component: CredentialsPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage })
  ]);
}

export function createAppRouter(options?: { api?: VorkApi; memory?: boolean; initialEntries?: string[] }): AnyRouter {
  const history = options?.memory
    ? createMemoryHistory({ initialEntries: options.initialEntries ?? ["/"] })
    : createHashHistory();

  return createRouter({
    routeTree: buildRouteTree(),
    history,
    context: {
      api: options?.api ?? (typeof window !== "undefined" ? window.vorkApi : (undefined as unknown as VorkApi))
    },
    defaultPreload: "intent"
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
