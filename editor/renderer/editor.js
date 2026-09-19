const container = document.getElementById("store-sections");
const statusText = document.getElementById("status-text");
const saveBtn = document.getElementById("save-btn");
const publishBtn = document.getElementById("publish-btn");
const addSectionBtn = document.getElementById("add-section-btn");
const commitMessageInput = document.getElementById("commit-message");
const logPanel = document.getElementById("log-panel");
const logOutput = document.getElementById("log-output");
const repoPathText = document.getElementById("repo-path-text");
const changeRepoBtn = document.getElementById("change-repo-btn");
const savedListsUl = document.getElementById("saved-lists-ul");
const saveAsListBtn = document.getElementById("save-as-list-btn");
const newListBtn = document.getElementById("new-list-btn");
const listContextMenu = document.getElementById("list-context-menu");
const contextRenameBtn = document.getElementById("context-rename-btn");

let sections = [];
let dirty = false;
let pendingFocus = null; // { sectionIndex, itemIndex | "name" }
let activeListName = null; // nom de la liste enregistrée actuellement chargée, si applicable
let contextMenuTarget = null; // nom de la liste ciblée par le menu contextuel

// Historique annuler/rétablir (Ctrl+Z / Ctrl+Y)
let history = [];
let historyIndex = -1;
let restoringHistory = false;

function cloneSections(value) {
    return JSON.parse(JSON.stringify(value));
}

function resetHistory() {
    history = [cloneSections(sections)];
    historyIndex = 0;
}

function pushHistory() {
    if (restoringHistory) return;
    history = history.slice(0, historyIndex + 1);
    history.push(cloneSections(sections));
    historyIndex = history.length - 1;

    const MAX_HISTORY = 200;
    if (history.length > MAX_HISTORY) {
        history.shift();
        historyIndex--;
    }
}

function applyHistory() {
    restoringHistory = true;
    sections = cloneSections(history[historyIndex]);
    setDirty(true);
    render();
    restoringHistory = false;
}

function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    applyHistory();
}

function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    applyHistory();
}


function setStatus(text, kind) {
    statusText.textContent = text;
    statusText.classList.toggle("dirty", kind === "dirty");
    statusText.classList.toggle("error", kind === "error");
}

function setDirty(value) {
    dirty = value;
    setStatus(dirty ? "Modifications non enregistrées" : "Tout est enregistré", dirty ? "dirty" : null);
}

function markChanged() {
    setDirty(true);
    render();
    pushHistory();
}

function showLog(lines, isError) {
    logOutput.textContent = lines.join("\n");
    logPanel.hidden = false;
    logPanel.classList.toggle("error", !!isError);
}


function moveInArray(array, fromIndex, toIndex) {
    const [moved] = array.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    array.splice(insertAt, 0, moved);
}


function createItemRow(section, sectionIndex, itemIndex) {

    const li = document.createElement("li");
    li.className = "editor-item";
    li.dataset.sectionIndex = String(sectionIndex);
    li.dataset.itemIndex = String(itemIndex);

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.draggable = true;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "item-text-input";
    input.value = section.items[itemIndex];
    input.addEventListener("input", () => {
        section.items[itemIndex] = input.value;
        setDirty(true);
    });
    // Un seul point d'historique par saisie (au blur), pas à chaque frappe.
    input.addEventListener("change", () => pushHistory());

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Supprimer l'article";
    deleteBtn.addEventListener("click", () => {
        section.items.splice(itemIndex, 1);
        markChanged();
    });

    handle.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(
            "application/x-item",
            JSON.stringify({ sectionIndex, itemIndex })
        );
    });

    li.addEventListener("dragover", (e) => {
        if (!e.dataTransfer.types.includes("application/x-item")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        li.classList.add("drag-over");
    });
    li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
    li.addEventListener("drop", (e) => {
        if (!e.dataTransfer.types.includes("application/x-item")) return;
        e.preventDefault();
        e.stopPropagation();
        li.classList.remove("drag-over");

        const data = JSON.parse(e.dataTransfer.getData("application/x-item") || "{}");
        if (data.sectionIndex !== sectionIndex) return; // reorder within the same section only
        if (data.itemIndex === itemIndex) return;

        moveInArray(section.items, data.itemIndex, itemIndex);
        markChanged();
    });

    li.appendChild(handle);
    li.appendChild(input);
    li.appendChild(deleteBtn);

    if (
        pendingFocus &&
        pendingFocus.sectionIndex === sectionIndex &&
        pendingFocus.itemIndex === itemIndex
    ) {
        pendingFocus = null;
        requestAnimationFrame(() => input.focus());
    }

    return li;
}


function createAddItemRow(section, sectionIndex) {

    const li = document.createElement("li");
    li.className = "add-item-row";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add-item-btn";
    btn.textContent = "+ Ajouter un article";
    btn.addEventListener("click", () => {
        section.items.push("");
        pendingFocus = { sectionIndex, itemIndex: section.items.length - 1 };
        markChanged();
    });

    li.appendChild(btn);
    return li;
}


function createSectionBlock(section, sectionIndex) {

    const details = document.createElement("div");
    details.className = "editor-section";
    details.dataset.sectionIndex = String(sectionIndex);

    const header = document.createElement("div");
    header.className = "section-header";

    const handle = document.createElement("span");
    handle.className = "section-drag-handle";
    handle.textContent = "⠿";
    handle.draggable = true;

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "section-name-input";
    nameInput.value = section.name;
    nameInput.addEventListener("input", () => {
        section.name = nameInput.value;
        setDirty(true);
    });
    nameInput.addEventListener("change", () => pushHistory());

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn delete-section-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Supprimer ce rayon";
    deleteBtn.addEventListener("click", () => {
        const hasItems = section.items.length > 0;
        if (hasItems && !window.confirm(`Supprimer le rayon « ${section.name} » et ses ${section.items.length} article(s) ?`)) {
            return;
        }
        sections.splice(sectionIndex, 1);
        markChanged();
    });

    handle.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-section", String(sectionIndex));
    });

    details.addEventListener("dragover", (e) => {
        if (!e.dataTransfer.types.includes("application/x-section")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        details.classList.add("drag-over");
    });
    details.addEventListener("dragleave", () => details.classList.remove("drag-over"));
    details.addEventListener("drop", (e) => {
        if (!e.dataTransfer.types.includes("application/x-section")) return;
        e.preventDefault();
        e.stopPropagation();
        details.classList.remove("drag-over");

        const fromIndex = Number(e.dataTransfer.getData("application/x-section"));
        if (Number.isNaN(fromIndex) || fromIndex === sectionIndex) return;

        moveInArray(sections, fromIndex, sectionIndex);
        markChanged();
    });

    header.appendChild(handle);
    header.appendChild(nameInput);
    header.appendChild(deleteBtn);

    const ul = document.createElement("ul");
    section.items.forEach((_text, itemIndex) => {
        ul.appendChild(createItemRow(section, sectionIndex, itemIndex));
    });
    ul.appendChild(createAddItemRow(section, sectionIndex));

    details.appendChild(header);
    details.appendChild(ul);

    if (pendingFocus && pendingFocus.sectionIndex === sectionIndex && pendingFocus.itemIndex === "name") {
        pendingFocus = null;
        requestAnimationFrame(() => nameInput.focus());
    }

    return details;
}


function render() {
    container.innerHTML = "";
    sections.forEach((section, sectionIndex) => {
        container.appendChild(createSectionBlock(section, sectionIndex));
    });
}


addSectionBtn.addEventListener("click", () => {
    sections.push({ name: "Nouveau rayon", items: [] });
    pendingFocus = { sectionIndex: sections.length - 1, itemIndex: "name" };
    markChanged();
});


saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
        const result = await window.api.saveData(sections);
        if (!result?.ok) {
            throw new Error(result?.error || "Échec de l'enregistrement.");
        }

        const logLines = ["Enregistré dans data.json (en local)."];

        // Garde la liste enregistrée (si une est active) synchronisée avec
        // data.json, pour que "Enregistrer" fasse aussi apparaître/mettre à
        // jour la liste dans "Mes listes enregistrées".
        if (activeListName) {
            await window.api.saveSavedList(activeListName, sections);
            logLines.push(`Liste « ${activeListName} » mise à jour.`);
            await refreshSavedLists();
        } else {
            const name = window.prompt("Nom de la liste à enregistrer :", "");
            const trimmed = name && name.trim();
            if (trimmed) {
                await window.api.saveSavedList(trimmed, sections);
                activeListName = trimmed;
                logLines.push(`Liste enregistrée sous « ${trimmed} ».`);
                await refreshSavedLists();
            }
        }

        setDirty(false);
        showLog(logLines, false);
    } catch (err) {
        setStatus("Erreur lors de l'enregistrement", "error");
        showLog([String(err.message || err)], true);
    } finally {
        saveBtn.disabled = false;
    }
});


publishBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    publishBtn.disabled = true;
    setStatus("Publication en cours…", "dirty");
    try {
        const result = await window.api.publish(sections, commitMessageInput.value);
        showLog(result.log || [], !result.ok);
        if (result.ok) {
            setDirty(false);
            commitMessageInput.value = "";
        } else {
            setStatus("Échec de la publication", "error");
        }
    } catch (err) {
        setStatus("Échec de la publication", "error");
        showLog([String(err.message || err)], true);
    } finally {
        saveBtn.disabled = false;
        publishBtn.disabled = false;
    }
});


document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;

    // Laisse le champ de message de commit et le renommage inline gérer
    // leur propre annuler/rétablir natif du texte.
    if (e.target === commitMessageInput || e.target.classList?.contains("rename-input")) {
        return;
    }

    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
    } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
    }
});


window.addEventListener("beforeunload", (e) => {
    if (dirty) {
        e.preventDefault();
        e.returnValue = "";
    }
});


async function refreshRepoPathDisplay() {
    const repoPath = await window.api.currentRepoPath();
    repoPathText.textContent = repoPath ? `Dossier : ${repoPath}` : "Aucun dossier sélectionné";
    repoPathText.title = repoPath || "";
}

changeRepoBtn.addEventListener("click", async () => {
    changeRepoBtn.disabled = true;
    try {
        const result = await window.api.chooseRepoFolder();
        if (result?.ok) {
            await refreshRepoPathDisplay();
            await init();
        }
    } finally {
        changeRepoBtn.disabled = false;
    }
});


async function refreshSavedLists() {
    let names = [];
    try {
        names = await window.api.listSavedLists();
    } catch (err) {
        showLog([String(err.message || err)], true);
        return;
    }

    savedListsUl.innerHTML = "";

    if (names.length === 0) {
        const empty = document.createElement("li");
        empty.id = "saved-lists-empty";
        empty.textContent = "Aucune liste enregistrée pour l'instant.";
        savedListsUl.appendChild(empty);
        return;
    }

    names.forEach((name) => {
        const li = document.createElement("li");
        li.textContent = name;
        li.dataset.name = name;
        li.classList.toggle("active", name === activeListName);

        li.addEventListener("click", () => loadSavedList(name));
        li.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            openListContextMenu(name, e.clientX, e.clientY);
        });

        savedListsUl.appendChild(li);
    });
}

async function loadSavedList(name) {
    if (dirty && !window.confirm("Des modifications non enregistrées seront perdues. Charger cette liste quand même ?")) {
        return;
    }
    try {
        sections = await window.api.loadSavedList(name);
        activeListName = name;
        setDirty(false);
        render();
        resetHistory();
        await refreshSavedLists();
        showLog([`Liste « ${name} » chargée.`], false);
    } catch (err) {
        setStatus("Impossible de charger cette liste", "error");
        showLog([String(err.message || err)], true);
    }
}

saveAsListBtn.addEventListener("click", async () => {
    const name = window.prompt("Nom de la liste à enregistrer :", activeListName || "");
    if (!name || !name.trim()) return;

    try {
        const trimmed = name.trim();
        await window.api.saveSavedList(trimmed, sections);
        activeListName = trimmed;
        await refreshSavedLists();
        showLog([`Liste enregistrée sous « ${trimmed} ».`], false);
    } catch (err) {
        showLog([String(err.message || err)], true);
    }
});

newListBtn.addEventListener("click", () => {
    if (dirty && !window.confirm("Des modifications non enregistrées seront perdues. Créer une nouvelle liste vide ?")) {
        return;
    }
    sections = [];
    activeListName = null;
    setDirty(true);
    render();
    resetHistory();
    refreshSavedLists();
});

function openListContextMenu(name, x, y) {
    contextMenuTarget = name;
    listContextMenu.style.left = `${x}px`;
    listContextMenu.style.top = `${y}px`;
    listContextMenu.hidden = false;
}

function closeListContextMenu() {
    listContextMenu.hidden = true;
    contextMenuTarget = null;
}

document.addEventListener("click", (e) => {
    if (!listContextMenu.hidden && !listContextMenu.contains(e.target)) {
        closeListContextMenu();
    }
});

contextRenameBtn.addEventListener("click", () => {
    const name = contextMenuTarget;
    closeListContextMenu();
    if (!name) return;
    startInlineRename(name);
});

function startInlineRename(name) {
    const li = Array.from(savedListsUl.querySelectorAll("li")).find((el) => el.dataset.name === name);
    if (!li) return;

    li.textContent = "";
    li.classList.add("rename-mode");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "rename-input";
    input.value = name;
    li.appendChild(input);
    input.focus();
    input.select();

    let settled = false;

    const commit = async () => {
        if (settled) return;
        settled = true;

        const newName = input.value.trim();
        if (!newName || newName === name) {
            await refreshSavedLists();
            return;
        }

        try {
            await window.api.renameSavedList(name, newName);
            if (activeListName === name) activeListName = newName;
        } catch (err) {
            showLog([String(err.message || err)], true);
        }
        await refreshSavedLists();
    };

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            input.blur();
        } else if (e.key === "Escape") {
            settled = true; // annule sans renommer
            refreshSavedLists();
        }
    });

    input.addEventListener("blur", commit);
}


async function init() {
    await refreshRepoPathDisplay();
    await refreshSavedLists();
    try {
        sections = await window.api.loadData();
        setDirty(false);
        render();
        resetHistory();
    } catch (err) {
        setStatus("Impossible de charger data.json", "error");
        showLog([String(err.message || err)], true);
    }
}

init();
