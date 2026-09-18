const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    loadData: () => ipcRenderer.invoke("data:load"),
    saveData: (sections) => ipcRenderer.invoke("data:save", sections),
    publish: (sections, message) => ipcRenderer.invoke("git:publish", { sections, message }),
    gitStatus: () => ipcRenderer.invoke("git:status"),
    currentRepoPath: () => ipcRenderer.invoke("repo:current"),
    chooseRepoFolder: () => ipcRenderer.invoke("repo:choose"),
    listSavedLists: () => ipcRenderer.invoke("lists:list"),
    loadSavedList: (name) => ipcRenderer.invoke("lists:load", name),
    saveSavedList: (name, sections) => ipcRenderer.invoke("lists:save", { name, sections }),
    renameSavedList: (oldName, newName) => ipcRenderer.invoke("lists:rename", { oldName, newName })
});
