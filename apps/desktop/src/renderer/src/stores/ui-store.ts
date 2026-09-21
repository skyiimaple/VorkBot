import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const memoryStorage = new Map<string, string>();

function safeStorage() {
  try {
    const probe = `__vork_${Date.now()}`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return {
      getItem: (name: string) => memoryStorage.get(name) ?? null,
      setItem: (name: string, value: string) => {
        memoryStorage.set(name, value);
      },
      removeItem: (name: string) => {
        memoryStorage.delete(name);
      }
    };
  }
}

export type SidebarSection = {
  id: string;
  name: string;
  collapsed: boolean;
  botIds: string[];
};

/** Grok sand sidebar: default 280, clamp 240–400 */
export const SIDEBAR_WIDTH_DEFAULT = 280;
export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_MAX = 400;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

type UiState = {
  sidebarQuery: string;
  sidebarWidth: number;
  computerOpenByConversation: Record<string, boolean>;
  settingsOpen: boolean;
  hiddenBotIds: string[];
  showHiddenBots: boolean;
  pinnedBotIds: string[];
  mutedBotIds: string[];
  unreadConversationIds: string[];
  botNameOverrides: Record<string, string>;
  sections: SidebarSection[];
  ungroupedCollapsed: boolean;
  lastSeenByConversation: Record<string, string>;
  setSidebarQuery: (query: string) => void;
  setSidebarWidth: (width: number) => void;
  setComputerOpen: (conversationId: string, open: boolean) => void;
  toggleComputerOpen: (conversationId: string) => void;
  setSettingsOpen: (open: boolean) => void;
  hideBot: (botId: string) => void;
  unhideBot: (botId: string) => void;
  setShowHiddenBots: (show: boolean) => void;
  pinBot: (botId: string) => void;
  unpinBot: (botId: string) => void;
  muteBot: (botId: string) => void;
  unmuteBot: (botId: string) => void;
  markConversationUnread: (conversationId: string) => void;
  markConversationRead: (conversationId: string) => void;
  markConversationSeen: (conversationId: string, seenAt?: string) => void;
  renameBot: (botId: string, name: string) => void;
  createSection: (name: string, botId?: string) => string;
  renameSection: (sectionId: string, name: string) => void;
  deleteSection: (sectionId: string) => void;
  toggleSectionCollapsed: (sectionId: string) => void;
  toggleUngroupedCollapsed: () => void;
  moveBotToSection: (botId: string, sectionId: string | null) => void;
  moveSection: (sectionId: string, direction: "up" | "down") => void;
};

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function withoutId(ids: string[], id: string): string[] {
  return ids.filter((item) => item !== id);
}

function withId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

function stripBotFromSections(sections: SidebarSection[], botId: string): SidebarSection[] {
  return sections.map((section) => ({
    ...section,
    botIds: withoutId(section.botIds, botId)
  }));
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarQuery: "",
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      computerOpenByConversation: {},
      settingsOpen: false,
      hiddenBotIds: [],
      showHiddenBots: false,
      pinnedBotIds: [],
      mutedBotIds: [],
      unreadConversationIds: [],
      botNameOverrides: {},
      sections: [],
      ungroupedCollapsed: false,
      lastSeenByConversation: {},
      setSidebarQuery: (sidebarQuery) => set({ sidebarQuery }),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setComputerOpen: (conversationId, open) =>
        set((state) => ({
          computerOpenByConversation: { ...state.computerOpenByConversation, [conversationId]: open }
        })),
      toggleComputerOpen: (conversationId) =>
        set((state) => ({
          computerOpenByConversation: {
            ...state.computerOpenByConversation,
            [conversationId]: !state.computerOpenByConversation[conversationId]
          }
        })),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      hideBot: (botId) =>
        set((state) => ({
          hiddenBotIds: withId(state.hiddenBotIds, botId),
          pinnedBotIds: withoutId(state.pinnedBotIds, botId),
          sections: stripBotFromSections(state.sections, botId)
        })),
      unhideBot: (botId) =>
        set((state) => ({
          hiddenBotIds: withoutId(state.hiddenBotIds, botId)
        })),
      setShowHiddenBots: (showHiddenBots) => set({ showHiddenBots }),
      pinBot: (botId) =>
        set((state) => ({
          pinnedBotIds: [botId, ...withoutId(state.pinnedBotIds, botId)],
          hiddenBotIds: withoutId(state.hiddenBotIds, botId),
          sections: stripBotFromSections(state.sections, botId)
        })),
      unpinBot: (botId) =>
        set((state) => ({
          pinnedBotIds: withoutId(state.pinnedBotIds, botId)
        })),
      muteBot: (botId) =>
        set((state) => ({
          mutedBotIds: withId(state.mutedBotIds, botId)
        })),
      unmuteBot: (botId) =>
        set((state) => ({
          mutedBotIds: withoutId(state.mutedBotIds, botId)
        })),
      markConversationUnread: (conversationId) =>
        set((state) => ({
          unreadConversationIds: withId(state.unreadConversationIds, conversationId)
        })),
      markConversationRead: (conversationId) =>
        set((state) => ({
          unreadConversationIds: withoutId(state.unreadConversationIds, conversationId),
          lastSeenByConversation: {
            ...state.lastSeenByConversation,
            [conversationId]: new Date().toISOString()
          }
        })),
      markConversationSeen: (conversationId, seenAt = new Date().toISOString()) =>
        set((state) => ({
          lastSeenByConversation: { ...state.lastSeenByConversation, [conversationId]: seenAt },
          unreadConversationIds: withoutId(state.unreadConversationIds, conversationId)
        })),
      renameBot: (botId, name) =>
        set((state) => ({
          botNameOverrides: { ...state.botNameOverrides, [botId]: name.trim() || state.botNameOverrides[botId] }
        })),
      createSection: (name, botId) => {
        const id = newId("sec");
        set((state) => {
          const trimmed = name.trim() || "新分组";
          let sections = stripBotFromSections(state.sections, botId ?? "");
          sections = [
            ...sections,
            { id, name: trimmed, collapsed: false, botIds: botId ? [botId] : [] }
          ];
          return {
            sections,
            pinnedBotIds: botId ? withoutId(state.pinnedBotIds, botId) : state.pinnedBotIds,
            hiddenBotIds: botId ? withoutId(state.hiddenBotIds, botId) : state.hiddenBotIds
          };
        });
        return id;
      },
      renameSection: (sectionId, name) =>
        set((state) => ({
          sections: state.sections.map((section) =>
            section.id === sectionId ? { ...section, name: name.trim() || section.name } : section
          )
        })),
      deleteSection: (sectionId) =>
        set((state) => ({
          sections: state.sections.filter((section) => section.id !== sectionId)
        })),
      toggleSectionCollapsed: (sectionId) =>
        set((state) => ({
          sections: state.sections.map((section) =>
            section.id === sectionId ? { ...section, collapsed: !section.collapsed } : section
          )
        })),
      toggleUngroupedCollapsed: () =>
        set((state) => ({
          ungroupedCollapsed: !state.ungroupedCollapsed
        })),
      moveBotToSection: (botId, sectionId) =>
        set((state) => {
          let sections = stripBotFromSections(state.sections, botId);
          if (sectionId) {
            sections = sections.map((section) =>
              section.id === sectionId ? { ...section, botIds: withId(section.botIds, botId) } : section
            );
          }
          return {
            sections,
            pinnedBotIds: withoutId(state.pinnedBotIds, botId),
            hiddenBotIds: withoutId(state.hiddenBotIds, botId)
          };
        }),
      moveSection: (sectionId, direction) =>
        set((state) => {
          const index = state.sections.findIndex((section) => section.id === sectionId);
          if (index < 0) return state;
          const target = direction === "up" ? index - 1 : index + 1;
          if (target < 0 || target >= state.sections.length) return state;
          const sections = [...state.sections];
          const [item] = sections.splice(index, 1);
          sections.splice(target, 0, item);
          return { sections };
        })
    }),
    {
      // v2: drop stale sidebar state after wiping test bots
      name: "vork-ui-store-v2",
      storage: createJSONStorage(safeStorage),
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        hiddenBotIds: state.hiddenBotIds,
        showHiddenBots: state.showHiddenBots,
        pinnedBotIds: state.pinnedBotIds,
        mutedBotIds: state.mutedBotIds,
        unreadConversationIds: state.unreadConversationIds,
        botNameOverrides: state.botNameOverrides,
        sections: state.sections,
        ungroupedCollapsed: state.ungroupedCollapsed,
        lastSeenByConversation: state.lastSeenByConversation,
        computerOpenByConversation: state.computerOpenByConversation
      })
    }
  )
);
