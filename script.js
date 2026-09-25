const container = document.getElementById("store-sections");
const editBtn = document.getElementById("edit-btn");
const editBar = document.getElementById("edit-bar");
const editStatus = document.getElementById("edit-status");
const saveBtn = document.getElementById("save-btn");
const cancelBtn = document.getElementById("cancel-btn");

let sections = [];

// Version (sha GitHub) de data.json, renvoyée à l'enregistrement pour
// détecter une modification faite ailleurs entre-temps.
let dataSha = null;

// Mode édition
let editMode = false;
let draft = [];
let dirty = false;
let saving = false;
let pendingFocus = null; // { sectionIndex, itemIndex | "name", atEnd }

// Cases cochées, identifiées par "rayon\narticle" pour résister aux
// ajouts, suppressions et déplacements d'articles.
let checkedItems = JSON.parse(
    localStorage.getItem("checkedItems") || "[]"
);

// État ouvert/fermé des sections
let sectionStates = JSON.parse(
    localStorage.getItem("sectionStates") || "null"
);


function itemKey(sectionName, text) {
    return `${sectionName}\n${text}`;
}

function migrateCheckedItems() {

    // Anciennes versions : identifiants "indexRayon-indexArticle".
    checkedItems = checkedItems
        .map(id => {
            const match = /^(\d+)-(\d+)$/.exec(id);
            if (!match) return id;
            const section = sections[Number(match[1])];
            const text = section?.items[Number(match[2])];
            return text === undefined ? null : itemKey(section.name, text);
        })
        .filter(id => id !== null);

    // Oublier les articles qui n'existent plus.
    const existing = new Set(
        sections.flatMap(section => section.items.map(text => itemKey(section.name, text)))
    );
    checkedItems = checkedItems.filter(id => existing.has(id));

    saveCheckedItems();
}

function ensureSectionStates() {

    // Première visite, ou la liste a changé de taille :
    // toutes les sections sont ouvertes par défaut.
    if (
        !Array.isArray(sectionStates) ||
        sectionStates.length !== sections.length
    ) {
        sectionStates = sections.map(() => true);
        saveSectionStates();
    }
}

function saveCheckedItems() {
    localStorage.setItem("checkedItems", JSON.stringify(checkedItems));
}

function saveSectionStates() {
    localStorage.setItem("sectionStates", JSON.stringify(sectionStates));
}


function toggleItem(id) {

    if (checkedItems.includes(id)) {
        checkedItems = checkedItems.filter(itemId => itemId !== id);
    } else {
        checkedItems.push(id);
    }

    saveCheckedItems();
    render();
}


function createItem(sectionName, text) {

    const id = itemKey(sectionName, text);
    const isChecked = checkedItems.includes(id);

    const li = document.createElement("li");
    if (isChecked) {
        li.classList.add("checked");
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isChecked;
    checkbox.addEventListener("change", () => toggleItem(id));

    const span = document.createElement("span");
    span.className = "item-text";
    span.textContent = text;

    li.appendChild(checkbox);
    li.appendChild(span);

    return li;
}


function createSection(section, sectionIndex) {

    const details = document.createElement("details");
    details.open = sectionStates[sectionIndex];

    // Sauvegarder lorsque l'utilisateur ouvre ou ferme
    details.addEventListener("toggle", () => {
        sectionStates[sectionIndex] = details.open;
        saveSectionStates();
    });

    const summary = document.createElement("summary");
    summary.textContent = section.name;

    const ul = document.createElement("ul");
    section.items.forEach(text => {
        ul.appendChild(createItem(section.name, text));
    });

    details.appendChild(summary);
    details.appendChild(ul);

    return details;
}


// ---------- Mode édition ----------

function setDirty(value) {
    dirty = value;
    setEditStatus(dirty ? "Modifications non enregistrées" : "");
}

function setEditStatus(text, kind) {
    editStatus.textContent = text;
    editStatus.classList.toggle("error", kind === "error");
}

// Champ de texte éditable sur place, en texte brut uniquement.
function createEditable(className, text, placeholder, onChange) {

    const span = document.createElement("span");
    span.className = className;
    span.contentEditable = "true";
    span.spellcheck = true;
    span.textContent = text;
    span.dataset.placeholder = placeholder;

    span.addEventListener("input", () => {
        onChange(span.textContent);
        setDirty(true);
    });

    // Coller sans mise en forme, et sur une seule ligne.
    span.addEventListener("paste", event => {
        event.preventDefault();
        const pasted = event.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ");
        document.execCommand("insertText", false, pasted);
    });

    return span;
}

function isEmptyText(element) {
    return element.textContent.trim() === "";
}

function createEditItem(sectionIndex, itemIndex) {

    const li = document.createElement("li");
    li.className = "editing";

    const text = createEditable(
        "item-text",
        draft[sectionIndex].items[itemIndex],
        "Nouvel article",
        value => { draft[sectionIndex].items[itemIndex] = value; }
    );
    text.dataset.section = sectionIndex;
    text.dataset.item = itemIndex;

    text.addEventListener("keydown", event => {

        // Entrée : nouvel article juste en dessous.
        if (event.key === "Enter") {
            event.preventDefault();
            draft[sectionIndex].items.splice(itemIndex + 1, 0, "");
            setDirty(true);
            pendingFocus = { sectionIndex, itemIndex: itemIndex + 1 };
            render();
        }

        // Retour arrière sur un article vide : le supprimer.
        if (event.key === "Backspace" && isEmptyText(text)) {
            event.preventDefault();
            removeItem(sectionIndex, itemIndex);
        }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn delete-btn";
    remove.title = "Supprimer l'article";
    remove.setAttribute("aria-label", "Supprimer l'article");
    remove.textContent = "×";
    remove.addEventListener("click", () => removeItem(sectionIndex, itemIndex));

    li.appendChild(text);
    li.appendChild(remove);

    return li;
}

function removeItem(sectionIndex, itemIndex) {

    draft[sectionIndex].items.splice(itemIndex, 1);
    setDirty(true);

    pendingFocus = itemIndex > 0
        ? { sectionIndex, itemIndex: itemIndex - 1, atEnd: true }
        : { sectionIndex, itemIndex: "name", atEnd: true };
    render();
}

function createEditSection(section, sectionIndex) {

    const wrapper = document.createElement("div");
    wrapper.className = "section editing";

    const header = document.createElement("div");
    header.className = "section-header";

    const name = createEditable(
        "section-name",
        section.name,
        "Nom du rayon",
        value => { draft[sectionIndex].name = value; }
    );
    name.dataset.section = sectionIndex;
    name.dataset.item = "name";

    name.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (draft[sectionIndex].items.length === 0) {
                draft[sectionIndex].items.push("");
                setDirty(true);
            }
            pendingFocus = { sectionIndex, itemIndex: 0 };
            render();
        }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn delete-btn";
    remove.title = "Supprimer le rayon";
    remove.setAttribute("aria-label", "Supprimer le rayon");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
        const label = section.name.trim() || "ce rayon";
        if (section.items.length > 0 && !confirm(`Supprimer « ${label} » et ses ${section.items.length} article(s) ?`)) {
            return;
        }
        draft.splice(sectionIndex, 1);
        setDirty(true);
        render();
    });

    header.appendChild(name);
    header.appendChild(remove);

    const ul = document.createElement("ul");
    section.items.forEach((_, itemIndex) => {
        ul.appendChild(createEditItem(sectionIndex, itemIndex));
    });

    const addItem = document.createElement("button");
    addItem.type = "button";
    addItem.className = "add-btn";
    addItem.textContent = "+ Ajouter un article";
    addItem.addEventListener("click", () => {
        draft[sectionIndex].items.push("");
        setDirty(true);
        pendingFocus = { sectionIndex, itemIndex: draft[sectionIndex].items.length - 1 };
        render();
    });

    wrapper.appendChild(header);
    wrapper.appendChild(ul);
    wrapper.appendChild(addItem);

    return wrapper;
}

function applyPendingFocus() {

    if (!pendingFocus) return;

    const { sectionIndex, itemIndex, atEnd } = pendingFocus;
    pendingFocus = null;

    const target = container.querySelector(
        `[data-section="${sectionIndex}"][data-item="${itemIndex}"]`
    );
    if (!target) return;

    target.focus();
    if (atEnd) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function enterEditMode() {
    draft = JSON.parse(JSON.stringify(sections));
    editMode = true;
    setDirty(false);
    render();
}

function exitEditMode() {
    editMode = false;
    draft = [];
    setDirty(false);
    render();
}

function cleanDraft() {
    return draft.map(section => ({
        name: section.name.trim(),
        items: section.items.map(item => item.trim()).filter(item => item !== "")
    }));
}

function getPassword(forceAsk) {

    let password = forceAsk ? null : localStorage.getItem("editPassword");
    if (!password) {
        password = prompt("Mot de passe d'édition :");
        if (password) {
            localStorage.setItem("editPassword", password);
        }
    }
    return password;
}

async function save() {

    if (saving) return;

    const cleaned = cleanDraft();

    if (cleaned.some(section => section.name === "")) {
        setEditStatus("Chaque rayon doit avoir un nom.", "error");
        return;
    }

    let password = getPassword(false);
    if (!password) return;

    saving = true;
    saveBtn.disabled = true;
    setEditStatus("Enregistrement…");

    try {
        while (true) {

            const response = await fetch("/api/data", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "X-Edit-Password": password
                },
                body: JSON.stringify({ sections: cleaned, sha: dataSha })
            });

            const result = await response.json().catch(() => ({}));

            if (response.status === 401) {
                localStorage.removeItem("editPassword");
                password = getPassword(true);
                if (!password) {
                    setEditStatus("Mot de passe incorrect.", "error");
                    return;
                }
                continue;
            }

            if (!response.ok) {
                setEditStatus(result.error || `Erreur ${response.status}`, "error");
                return;
            }

            sections = result.sections;
            dataSha = result.sha;
            migrateCheckedItems();
            ensureSectionStates();
            exitEditMode();
            return;
        }
    } catch (err) {
        setEditStatus(`Impossible d'enregistrer : ${err.message}`, "error");
    } finally {
        saving = false;
        saveBtn.disabled = false;
    }
}


function render() {

    container.innerHTML = "";
    document.body.classList.toggle("edit-mode", editMode);
    editBar.hidden = !editMode;
    editBtn.classList.toggle("active", editMode);

    if (!editMode) {
        sections.forEach((section, sectionIndex) => {
            container.appendChild(createSection(section, sectionIndex));
        });
        return;
    }

    draft.forEach((section, sectionIndex) => {
        container.appendChild(createEditSection(section, sectionIndex));
    });

    const addSection = document.createElement("button");
    addSection.type = "button";
    addSection.className = "add-btn add-section-btn";
    addSection.textContent = "+ Ajouter un rayon";
    addSection.addEventListener("click", () => {
        draft.push({ name: "", items: [] });
        setDirty(true);
        pendingFocus = { sectionIndex: draft.length - 1, itemIndex: "name" };
        render();
    });
    container.appendChild(addSection);

    applyPendingFocus();
}


editBtn.addEventListener("click", () => {
    if (!editMode) {
        enterEditMode();
    } else if (!dirty || confirm("Abandonner les modifications ?")) {
        exitEditMode();
    }
});

cancelBtn.addEventListener("click", () => {
    if (!dirty || confirm("Abandonner les modifications ?")) {
        exitEditMode();
    }
});

saveBtn.addEventListener("click", save);

window.addEventListener("beforeunload", event => {
    if (editMode && dirty) {
        event.preventDefault();
    }
});


async function loadSections() {

    // Sur Vercel : lecture à jour depuis GitHub, édition possible.
    try {
        const response = await fetch("/api/data", { cache: "no-store" });
        if (response.ok) {
            const result = await response.json();
            dataSha = result.sha;
            editBtn.hidden = false;
            return result.sections;
        }
    } catch {
        // Pas d'API (serveur statique local) : lecture seule.
    }

    const response = await fetch("data.json");
    return response.json();
}

async function init() {

    sections = await loadSections();

    migrateCheckedItems();
    ensureSectionStates();
    render();
}

init();
