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

let sections = [];
let dirty = false;
let pendingFocus = null; // { sectionIndex, itemIndex | "name" }


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
        if (result?.ok) {
            setDirty(false);
            showLog(["Enregistré dans data.json (en local)."], false);
        } else {
            throw new Error(result?.error || "Échec de l'enregistrement.");
        }
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


async function init() {
    await refreshRepoPathDisplay();
    try {
        sections = await window.api.loadData();
        setDirty(false);
        render();
    } catch (err) {
        setStatus("Impossible de charger data.json", "error");
        showLog([String(err.message || err)], true);
    }
}

init();
