import { contextBridge, ipcRenderer } from "electron";
import type { SectionName, SkillMode, StorageKind, WorkbenchAPI, WorkbenchSettings, WorkbenchSnapshot, WorkbenchUpdateState } from "../shared/types";

const api: WorkbenchAPI = {
  bootstrap: () => ipcRenderer.invoke("workbench:bootstrap"),
  refresh: (section?: SectionName, forceReload?: boolean) => ipcRenderer.invoke("workbench:refresh", section, forceReload),
  chooseWorkspace: () => ipcRenderer.invoke("workbench:chooseWorkspace"),
  chooseCodexExecutable: () => ipcRenderer.invoke("workbench:chooseCodex"),
  setSkillMode: (skillId: string, mode: SkillMode) => ipcRenderer.invoke("workbench:setSkillMode", skillId, mode),
  setHookEnabled: (hookId: string, enabled: boolean) => ipcRenderer.invoke("workbench:setHookEnabled", hookId, enabled),
  setMCPEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke("workbench:setMCPEnabled", name, enabled),
  reloadMCP: () => ipcRenderer.invoke("workbench:reloadMCP"),
  cleanupStorage: (kind: StorageKind, fingerprint: string) => ipcRenderer.invoke("workbench:cleanupStorage", kind, fingerprint),
  saveSettings: (patch: Partial<WorkbenchSettings>) => ipcRenderer.invoke("workbench:saveSettings", patch),
  openPath: (target: string) => ipcRenderer.invoke("workbench:openPath", target),
  openExternal: (url: string) => ipcRenderer.invoke("workbench:openExternal", url),
  copyText: (text: string) => ipcRenderer.invoke("workbench:copyText", text),
  previewBackup: (repository: string) => ipcRenderer.invoke("workbench:previewBackup", repository),
  runBackup: (repository: string) => ipcRenderer.invoke("workbench:runBackup", repository),
  getUpdateState: () => ipcRenderer.invoke("workbench:getUpdateState"),
  checkForUpdates: () => ipcRenderer.invoke("workbench:checkForUpdates"),
  onSnapshot: (listener: (snapshot: WorkbenchSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: WorkbenchSnapshot) => listener(snapshot);
    ipcRenderer.on("workbench:snapshot", handler);
    return () => ipcRenderer.removeListener("workbench:snapshot", handler);
  },
  onUpdateState: (listener: (state: WorkbenchUpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: WorkbenchUpdateState) => listener(state);
    ipcRenderer.on("workbench:updateState", handler);
    return () => ipcRenderer.removeListener("workbench:updateState", handler);
  },
};

contextBridge.exposeInMainWorld("workbench", api);
