// The only module that talks to chrome.tabs / chrome.tabGroups / chrome.windows.
// Chrome rejects tab edits while the user drags a tab; those calls are retried.

const isBusyError = (err: unknown) => /dragging|cannot be edited right now/i.test(String((err as Error)?.message ?? err));

async function retry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isBusyError(err)) throw err;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw last;
}

export type ChromeTab = chrome.tabs.Tab;

export const ChromeTabsAdapter = {
  async normalTabs(): Promise<ChromeTab[]> {
    return chrome.tabs.query({ windowType: 'normal' });
  },

  async get(tabId: number): Promise<ChromeTab | undefined> {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return undefined;
    }
  },

  async isNormalWindow(windowId: number): Promise<boolean> {
    try {
      return (await chrome.windows.get(windowId)).type === 'normal';
    } catch {
      return false;
    }
  },

  async focusedNormalWindowId(): Promise<number> {
    try {
      const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (w.id !== undefined && w.type === 'normal') return w.id;
    } catch {
      /* none focused */
    }
    const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (all[0]?.id !== undefined) return all[0].id;
    const created = await chrome.windows.create({ focused: true });
    return created!.id!;
  },

  async create(props: chrome.tabs.CreateProperties): Promise<ChromeTab> {
    return retry(() => chrome.tabs.create(props));
  },

  async activate(tabId: number, windowId?: number): Promise<void> {
    await retry(() => chrome.tabs.update(tabId, { active: true }));
    if (windowId !== undefined) await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
  },

  async remove(tabIds: number[]): Promise<void> {
    if (tabIds.length === 0) return;
    await retry(() => chrome.tabs.remove(tabIds)).catch(() => undefined);
  },

  async group(tabIds: number[], groupId?: number, windowId?: number): Promise<number> {
    const ids = tabIds as [number, ...number[]];
    return retry(() =>
      groupId !== undefined
        ? chrome.tabs.group({ tabIds: ids, groupId })
        : chrome.tabs.group({ tabIds: ids, createProperties: { windowId } }),
    );
  },

  async groups(): Promise<chrome.tabGroups.TabGroup[]> {
    return chrome.tabGroups.query({});
  },

  async updateGroup(groupId: number, props: chrome.tabGroups.UpdateProperties): Promise<void> {
    await retry(() => chrome.tabGroups.update(groupId, props)).catch(() => undefined);
  },

  async tabsInGroup(groupId: number): Promise<ChromeTab[]> {
    return chrome.tabs.query({ groupId });
  },
};
