const container = document.getElementById("store-sections");
const editBtn = document.getElementById("edit-btn");
const editBar = document.getElementById("edit-bar");
const editStatus = document.getElementById("edit-status");
const saveBtn = document.getElementById("save-btn");
const cancelBtn = document.getElementById("cancel-btn");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
const activeListName = document.getElementById("active-list-name");

// Rayons de la liste active, affichés hors mode édition.
let sections = [];

// Toutes les listes enregistrées : { active, lists: [{ name, template?, sections }] }.
// Null en mode statique (pas d'API) : seule data.json est disponible.
let store = null;

// Versions (sha GitHub) de data.json et lists.json, renvoyées à
// l'enregistrement pour détecter une modification faite ailleurs entre-temps.
let dataVersion = null;

// Mode édition : copie de travail de toutes les listes, et liste affichée.
let editMode = false;
let draftStore = null;
let currentList = 0;
let draft = []; // rayons de la liste affichée : draftStore.lists[currentList].sections
// Dans le brouillon, les articles sont des objets { text, image } : l'image
// suit ainsi l'article quand il est renommé ou déplacé d'un rayon à l'autre.
let dirty = false;
let saving = false;
let pendingFocus = null; // { sectionIndex, itemIndex | "name", atEnd }

// Annuler/rétablir (mode édition) : états successifs du brouillon, sérialisés.
const MAX_HISTORY = 200;
const TYPING_PAUSE = 500; // ms sans frappe avant de créer un point d'historique

let history = []; // [{ store, list }], list : liste affichée à ce moment-là
let historyIndex = 0;
let historyTimer = null;
let initialDraft = null; // état à l'ouverture, pour savoir s'il reste des changements

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


// Image associée à un article, ou null. section.images est optionnel.
function itemImage(section, text) {
    return Object.hasOwn(section.images ?? {}, text) ? section.images[text] : null;
}

function createThumbnail(url) {

    const image = document.createElement("img");
    image.className = "item-image";
    image.src = url;
    image.alt = "";
    image.loading = "lazy";
    // Certains sites refusent les images demandées depuis un autre site.
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove());

    return image;
}

function createItem(section, text) {

    const id = itemKey(section.name, text);
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
    const image = itemImage(section, text);
    if (image) li.appendChild(createThumbnail(image));
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
        ul.appendChild(createItem(section, text));
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
        undoBtn.disabled = false;
        clearTimeout(historyTimer);
        historyTimer = setTimeout(commitHistory, TYPING_PAUSE);
    });

    span.addEventListener("blur", commitHistory);

    // Ces touches modifient la structure : le texte saisi juste avant
    // doit rester un point d'historique à part.
    span.addEventListener("keydown", event => {
        if (
            event.key === "Enter" ||
            moveShortcutDirection(event) ||
            (event.key === "Backspace" && isEmptyText(span))
        ) {
            commitHistory();
        }
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
        draft[sectionIndex].items[itemIndex].text,
        "Nouvel article",
        value => { draft[sectionIndex].items[itemIndex].text = value; }
    );
    text.dataset.section = sectionIndex;
    text.dataset.item = itemIndex;

    text.addEventListener("keydown", event => {

        // Ctrl+Maj+↑/↓ : déplacer l'article, comme dans Notion.
        const direction = moveShortcutDirection(event);
        if (direction) {
            event.preventDefault();
            moveItemBy(sectionIndex, itemIndex, direction);
            return;
        }

        // Entrée : nouvel article juste en dessous.
        if (event.key === "Enter") {
            event.preventDefault();
            draft[sectionIndex].items.splice(itemIndex + 1, 0, { text: "", image: null });
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

    li.appendChild(createDragHandle("item", sectionIndex, itemIndex));
    li.appendChild(createImageButton(draft[sectionIndex].items[itemIndex]));
    li.appendChild(text);
    li.appendChild(remove);

    return li;
}

// Vignette de l'article, ou icône s'il n'a pas d'image : ouvre le choix d'image.
function createImageButton(item) {

    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn image-btn";
    button.title = item.image ? "Changer l'image" : "Ajouter une image";
    button.setAttribute("aria-label", button.title);
    button.textContent = "🖼";
    button.addEventListener("click", () => openImagePicker(item));

    if (item.image) {
        const image = createThumbnail(item.image);
        image.addEventListener("load", () => { button.textContent = ""; button.appendChild(image); });
        // Affichée seulement une fois chargée : sinon l'icône reste visible.
        image.loading = "eager";
    }

    return button;
}

function setItemImage(item, url) {
    item.image = url;
    setDirty(true);
    render();
}

async function searchImages(query) {

    const response = await fetch(`/api/images?q=${encodeURIComponent(query)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Erreur ${response.status}`);
    }
    return result.results;
}

function openImagePicker(item) {

    const dialog = document.createElement("dialog");
    dialog.className = "image-picker";

    const form = document.createElement("form");
    form.className = "image-search";

    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Rechercher une image";
    input.setAttribute("aria-label", "Rechercher une image");
    input.value = item.text.trim();

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Rechercher";

    form.appendChild(input);
    form.appendChild(submit);

    const status = document.createElement("p");
    status.className = "image-status";

    const results = document.createElement("div");
    results.className = "image-results";

    const urlForm = document.createElement("form");
    urlForm.className = "image-search";

    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.placeholder = "Ou coller l'adresse d'une image (https://…)";
    urlInput.setAttribute("aria-label", "Adresse d'une image");

    const urlSubmit = document.createElement("button");
    urlSubmit.type = "submit";
    urlSubmit.textContent = "Utiliser";

    urlForm.appendChild(urlInput);
    urlForm.appendChild(urlSubmit);

    const actions = document.createElement("div");
    actions.className = "image-actions";

    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Retirer l'image";
    clear.disabled = !item.image;

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Fermer";

    actions.appendChild(clear);
    actions.appendChild(close);

    function choose(url) {
        dialog.close();
        setItemImage(item, url);
    }

    let lastSearch = 0;

    async function runSearch() {

        const query = input.value.trim();
        if (!query) return;

        // Seule la dernière recherche lancée s'affiche.
        const search = ++lastSearch;
        status.textContent = "Recherche…";
        results.innerHTML = "";

        try {
            const found = await searchImages(query);
            if (search !== lastSearch) return;

            status.textContent = found.length ? "" : "Aucune image trouvée.";
            found.forEach(({ url, title }) => {
                const option = document.createElement("button");
                option.type = "button";
                option.title = title;
                option.setAttribute("aria-label", title);
                option.addEventListener("click", () => choose(url));

                const image = createThumbnail(url);
                image.addEventListener("error", () => option.remove());

                option.appendChild(image);
                results.appendChild(option);
            });
        } catch (err) {
            if (search === lastSearch) status.textContent = err.message;
        }
    }

    form.addEventListener("submit", event => {
        event.preventDefault();
        runSearch();
    });

    urlForm.addEventListener("submit", event => {
        event.preventDefault();
        const url = urlInput.value.trim();
        if (!url.startsWith("https://")) {
            status.textContent = "L'adresse doit commencer par https://";
            return;
        }
        choose(url);
    });

    clear.addEventListener("click", () => choose(null));
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());

    dialog.appendChild(form);
    dialog.appendChild(status);
    dialog.appendChild(results);
    dialog.appendChild(urlForm);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);

    dialog.showModal();
    runSearch();
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

        // Ctrl+Maj+↑/↓ : déplacer le rayon.
        const direction = moveShortcutDirection(event);
        if (direction) {
            event.preventDefault();
            moveSection(sectionIndex, direction < 0 ? sectionIndex - 1 : sectionIndex + 2);
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            if (draft[sectionIndex].items.length === 0) {
                draft[sectionIndex].items.push({ text: "", image: null });
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

    header.appendChild(createDragHandle("section", sectionIndex));
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
        draft[sectionIndex].items.push({ text: "", image: null });
        setDirty(true);
        pendingFocus = { sectionIndex, itemIndex: draft[sectionIndex].items.length - 1 };
        render();
    });

    wrapper.appendChild(header);
    wrapper.appendChild(ul);
    wrapper.appendChild(addItem);

    return wrapper;
}

// ---------- Déplacement des articles et des rayons (mode édition) ----------

// Les positions cibles sont des points d'insertion comptés avant de retirer
// l'élément déplacé : 0 = tout en haut, longueur = tout en bas.

function moveItem(fromSection, fromIndex, toSection, toIndex, focus = true) {

    if (toSection === fromSection && (toIndex === fromIndex || toIndex === fromIndex + 1)) {
        return;
    }

    const [text] = draft[fromSection].items.splice(fromIndex, 1);
    if (toSection === fromSection && toIndex > fromIndex) toIndex--;
    draft[toSection].items.splice(toIndex, 0, text);

    setDirty(true);
    if (focus) pendingFocus = { sectionIndex: toSection, itemIndex: toIndex, atEnd: true };
    render();
}

function moveSection(fromIndex, toIndex, focus = true) {

    if (toIndex < 0 || toIndex > draft.length || toIndex === fromIndex || toIndex === fromIndex + 1) {
        return;
    }

    const [section] = draft.splice(fromIndex, 1);
    if (toIndex > fromIndex) toIndex--;
    draft.splice(toIndex, 0, section);

    setDirty(true);
    if (focus) pendingFocus = { sectionIndex: toIndex, itemIndex: "name", atEnd: true };
    render();
}

// Un cran vers le haut ou le bas ; en bout de rayon, passe au rayon voisin.
function moveItemBy(sectionIndex, itemIndex, direction) {

    const items = draft[sectionIndex].items;

    if (direction < 0 && itemIndex > 0) {
        moveItem(sectionIndex, itemIndex, sectionIndex, itemIndex - 1);
    } else if (direction > 0 && itemIndex < items.length - 1) {
        moveItem(sectionIndex, itemIndex, sectionIndex, itemIndex + 2);
    } else if (direction < 0 && sectionIndex > 0) {
        moveItem(sectionIndex, itemIndex, sectionIndex - 1, draft[sectionIndex - 1].items.length);
    } else if (direction > 0 && sectionIndex < draft.length - 1) {
        moveItem(sectionIndex, itemIndex, sectionIndex + 1, 0);
    }
}

function moveShortcutDirection(event) {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return 0;
    if (event.key === "ArrowUp") return -1;
    if (event.key === "ArrowDown") return 1;
    return 0;
}


// Glisser-déposer à la Notion, par la poignée ⠿. Événements pointeur plutôt
// que le glisser-déposer HTML natif, qui ne marche pas au doigt sur mobile.

const DRAG_THRESHOLD = 4; // px avant que l'appui devienne un déplacement
const AUTO_SCROLL_EDGE = 60; // px du bord de l'écran où la page défile

let drag = null;

function createDragHandle(kind, sectionIndex, itemIndex) {

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Glisser pour déplacer (ou Ctrl+Maj+↑/↓)";
    handle.setAttribute("aria-hidden", "true");

    handle.addEventListener("pointerdown", event => {
        if (event.button !== 0 || saving) return;
        event.preventDefault();
        endDrag(false);
        drag = {
            kind,
            sectionIndex,
            itemIndex,
            pointerId: event.pointerId,
            source: handle.closest(kind === "item" ? "li" : ".section"),
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            started: false,
            target: null
        };
        // Suivi sur tout le document : le pointeur quitte vite la poignée.
        document.addEventListener("pointermove", onDragMove);
        document.addEventListener("pointerup", onDragUp);
        document.addEventListener("pointercancel", onDragCancel);
    });

    return handle;
}

function onDragMove(event) {

    if (event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;

    if (!drag.started) {
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < DRAG_THRESHOLD) return;
        startDrag();
    }

    positionGhost();
    updateDropTarget();
}

function onDragUp(event) {
    if (event.pointerId === drag.pointerId) endDrag(true);
}

function onDragCancel(event) {
    if (event.pointerId === drag.pointerId) endDrag(false);
}

function startDrag() {

    const rect = drag.source.getBoundingClientRect();
    drag.started = true;
    drag.offsetX = drag.startX - rect.left;
    drag.offsetY = drag.startY - rect.top;

    // Copie inerte de l'élément, qui suit le pointeur.
    const ghost = drag.source.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.querySelectorAll("[contenteditable]").forEach(el => {
        el.removeAttribute("contenteditable");
        delete el.dataset.section;
        delete el.dataset.item;
    });
    document.body.appendChild(ghost);
    drag.ghost = ghost;

    const indicator = document.createElement("div");
    indicator.className = "drop-indicator";
    indicator.hidden = true;
    document.body.appendChild(indicator);
    drag.indicator = indicator;

    drag.source.classList.add("drag-source");
    document.body.classList.add("dragging");
    document.activeElement?.blur();

    drag.frame = requestAnimationFrame(autoScroll);
}

function positionGhost() {
    drag.ghost.style.left = `${drag.x - drag.offsetX}px`;
    drag.ghost.style.top = `${drag.y - drag.offsetY}px`;
}

// Index du premier élément dont le milieu est sous le pointeur.
function insertionIndex(elements, y) {
    const index = elements.findIndex(el => {
        const rect = el.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
    });
    return index === -1 ? elements.length : index;
}

function updateDropTarget() {

    const wrappers = [...container.querySelectorAll(".section.editing")];
    let target = null;
    let line = null; // { top, left, width } de la ligne bleue

    if (drag.kind === "section") {

        const index = insertionIndex(wrappers, drag.y);
        target = { index };

        const anchor = wrappers[Math.min(index, wrappers.length - 1)].getBoundingClientRect();
        line = {
            top: index < wrappers.length ? anchor.top - 6 : anchor.bottom + 6,
            left: anchor.left,
            width: anchor.width
        };

        if (index === drag.sectionIndex || index === drag.sectionIndex + 1) target = null;

    } else {

        // Rayon survolé (ou le plus proche), puis position dans ce rayon.
        let sectionIndex = wrappers.findIndex(w => drag.y < w.getBoundingClientRect().bottom + 6);
        if (sectionIndex === -1) sectionIndex = wrappers.length - 1;

        const ul = wrappers[sectionIndex].querySelector("ul");
        const rows = [...ul.children];
        const index = insertionIndex(rows, drag.y);
        target = { sectionIndex, index };

        const ulRect = ul.getBoundingClientRect();
        line = { left: ulRect.left + 15, width: ulRect.width - 30 };
        if (rows.length === 0) {
            line.top = ulRect.top + 4;
        } else if (index < rows.length) {
            line.top = rows[index].getBoundingClientRect().top - 4;
        } else {
            line.top = rows[rows.length - 1].getBoundingClientRect().bottom + 3;
        }

        if (
            sectionIndex === drag.sectionIndex &&
            (index === drag.itemIndex || index === drag.itemIndex + 1)
        ) {
            target = null;
        }
    }

    drag.target = target;
    drag.indicator.hidden = !target;
    if (target) {
        drag.indicator.style.top = `${line.top - 1.5}px`;
        drag.indicator.style.left = `${line.left}px`;
        drag.indicator.style.width = `${line.width}px`;
    }
}

// Fait défiler la page quand le pointeur approche du haut ou du bas.
function autoScroll() {

    if (!drag?.started) return;

    const top = AUTO_SCROLL_EDGE;
    const bottom = editBar.getBoundingClientRect().top - AUTO_SCROLL_EDGE;
    let speed = 0;
    if (drag.y < top) speed = -(top - drag.y) / 3;
    if (drag.y > bottom) speed = (drag.y - bottom) / 3;

    if (speed !== 0) {
        window.scrollBy(0, speed);
        updateDropTarget();
    }

    drag.frame = requestAnimationFrame(autoScroll);
}

function endDrag(drop) {

    if (!drag) return;

    const { started, target, kind, sectionIndex, itemIndex } = drag;

    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", onDragUp);
    document.removeEventListener("pointercancel", onDragCancel);

    if (started) {
        cancelAnimationFrame(drag.frame);
        drag.ghost.remove();
        drag.indicator.remove();
        drag.source.classList.remove("drag-source");
        document.body.classList.remove("dragging");
    }
    drag = null;

    if (!started || !drop || !target) return;

    if (kind === "section") {
        moveSection(sectionIndex, target.index, false);
    } else {
        moveItem(sectionIndex, itemIndex, target.sectionIndex, target.index, false);
    }
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && drag) endDrag(false);
});


// ---------- Annuler / rétablir (mode édition) ----------

function resetHistory() {
    clearTimeout(historyTimer);
    initialDraft = JSON.stringify(draftStore);
    history = [{ store: initialDraft, list: currentList }];
    historyIndex = 0;
    updateHistoryButtons();
}

function updateHistoryButtons() {
    undoBtn.disabled = historyIndex === 0;
    redoBtn.disabled = historyIndex === history.length - 1;
}

// Ajoute un point d'historique si le brouillon a changé depuis le dernier.
function commitHistory() {

    clearTimeout(historyTimer);
    if (!editMode) return;

    const current = JSON.stringify(draftStore);
    if (current === history[historyIndex].store) return;

    history = history.slice(0, historyIndex + 1);
    history.push({ store: current, list: currentList });
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;

    updateHistoryButtons();
}

function goToHistory(index) {

    const from = history[historyIndex];
    const to = history[index];

    // Rester sur la liste concernée par le changement annulé, sauf si le
    // changement ajoutait ou supprimait une liste.
    const before = JSON.parse(from.store).lists.length;
    draftStore = JSON.parse(to.store);
    showList(draftStore.lists.length === before ? from.list : to.list);

    historyIndex = index;
    setDirty(to.store !== initialDraft);
    updateHistoryButtons();

    const focused = document.activeElement?.dataset;
    if (focused?.section !== undefined) {
        pendingFocus = { sectionIndex: focused.section, itemIndex: focused.item, atEnd: true };
    }
    render();
}

function undo() {
    if (saving || drag) return;
    commitHistory();
    if (historyIndex > 0) goToHistory(historyIndex - 1);
}

function redo() {
    if (saving || drag) return;
    commitHistory();
    if (historyIndex < history.length - 1) goToHistory(historyIndex + 1);
}

document.addEventListener("keydown", event => {

    if (!editMode || !(event.ctrlKey || event.metaKey)) return;

    // Le choix d'image a ses propres champs : leur Ctrl+Z reste celui du navigateur.
    if (event.target.closest?.("dialog")) return;

    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
    }
});


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
    draftStore = {
        active: store.active,
        lists: store.lists.map(list => ({ ...list, sections: toDraftSections(list.sections) }))
    };
    showList(draftStore.lists.findIndex(list => list.name === draftStore.active));
    editMode = true;
    setDirty(false);
    resetHistory();
    render();
}

function exitEditMode() {
    clearTimeout(historyTimer);
    editMode = false;
    draftStore = null;
    draft = [];
    setDirty(false);
    render();
}

function toDraftSections(sectionList) {
    return sectionList.map(section => ({
        name: section.name,
        items: section.items.map(text => ({ text, image: itemImage(section, text) }))
    }));
}

function copyDraftSections(sectionList) {
    return JSON.parse(JSON.stringify(sectionList));
}

function cleanSections(sectionList) {
    return sectionList.map(section => {

        const items = section.items
            .map(item => ({ ...item, text: item.text.trim() }))
            .filter(item => item.text !== "");
        const withImage = items.filter(item => item.image);

        return {
            name: section.name.trim(),
            items: items.map(item => item.text),
            ...(withImage.length > 0
                ? { images: Object.fromEntries(withImage.map(item => [item.text, item.image])) }
                : {})
        };
    });
}

function cleanDraftStore() {
    return {
        active: draftStore.active,
        lists: draftStore.lists.map(list => ({ ...list, sections: cleanSections(list.sections) }))
    };
}


// ---------- Listes enregistrées (mode édition) ----------

function showList(index) {
    currentList = index;
    draft = draftStore.lists[index].sections;
}

function askListName(message, initial, renaming) {

    const name = prompt(message, initial)?.trim();
    if (!name) return null;

    const taken = draftStore.lists.some(
        (list, index) => list.name === name && !(renaming && index === currentList)
    );
    if (taken) {
        alert(`Une liste nommée « ${name} » existe déjà.`);
        return null;
    }
    return name;
}

function addList(name, sectionList) {
    draftStore.lists.push({ name, sections: sectionList });
    showList(draftStore.lists.length - 1);
    setDirty(true);
    render();
}

function createListBar() {

    const list = draftStore.lists[currentList];
    const isActive = list.name === draftStore.active;

    const bar = document.createElement("div");
    bar.className = "list-bar";

    const select = document.createElement("select");
    select.className = "list-select";
    select.setAttribute("aria-label", "Liste affichée");
    draftStore.lists.forEach((item, index) => {
        const option = document.createElement("option");
        option.value = index;
        option.textContent = item.name
            + (item.name === draftStore.active ? " ★" : "")
            + (item.template ? " (modèle)" : "");
        option.selected = index === currentList;
        select.appendChild(option);
    });
    select.addEventListener("change", () => {
        showList(Number(select.value));
        render();
    });

    const status = document.createElement("span");
    status.className = "list-status";
    if (isActive) {
        status.textContent = "★ Active";
        status.classList.add("active");
    } else if (list.template) {
        status.textContent = "Modèle";
    }

    const top = document.createElement("div");
    top.className = "list-bar-top";
    top.appendChild(select);
    top.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "list-actions";

    function addAction(label, onClick, options = {}) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = Boolean(options.disabled);
        if (options.title) button.title = options.title;
        if (options.primary) button.classList.add("primary");
        button.addEventListener("click", onClick);
        actions.appendChild(button);
    }

    // Un modèle ne s'active pas : on en crée une copie.
    if (list.template) {
        addAction("Utiliser ce modèle", () => {
            const name = askListName("Nom de la nouvelle liste :", "");
            if (name) addList(name, copyDraftSections(list.sections));
        }, { primary: true });
    } else if (!isActive) {
        addAction("Rendre active", () => {
            draftStore.active = list.name;
            setDirty(true);
            render();
        }, { primary: true });
    }

    addAction("Nouvelle", () => {
        const name = askListName("Nom de la nouvelle liste :", "");
        if (name) addList(name, []);
    });

    addAction("Dupliquer", () => {
        const name = askListName("Nom de la copie :", `${list.name} (copie)`);
        if (name) addList(name, copyDraftSections(list.sections));
    });

    addAction("Renommer", () => {
        const name = askListName("Nouveau nom :", list.name, true);
        if (!name || name === list.name) return;
        if (isActive) draftStore.active = name;
        list.name = name;
        setDirty(true);
        render();
    });

    addAction("Supprimer", () => {
        if (!confirm(`Supprimer la liste « ${list.name} » ?`)) return;
        draftStore.lists.splice(currentList, 1);
        showList(draftStore.lists.findIndex(item => item.name === draftStore.active));
        setDirty(true);
        render();
    }, {
        disabled: isActive,
        title: isActive ? "Rendez d'abord une autre liste active." : ""
    });

    bar.appendChild(top);
    bar.appendChild(actions);

    return bar;
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

    const cleaned = cleanDraftStore();

    const unnamed = cleaned.lists.find(list => list.sections.some(section => section.name === ""));
    if (unnamed) {
        setEditStatus(`Chaque rayon doit avoir un nom (liste « ${unnamed.name} »).`, "error");
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
                body: JSON.stringify({ store: cleaned, version: dataVersion })
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

            setStore(result.store);
            dataVersion = result.version;
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

    activeListName.textContent = store && !editMode ? store.active : "";

    if (!editMode) {
        sections.forEach((section, sectionIndex) => {
            container.appendChild(createSection(section, sectionIndex));
        });
        return;
    }

    // Toute modification de structure passe par render().
    commitHistory();

    container.appendChild(createListBar());

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
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

window.addEventListener("beforeunload", event => {
    if (editMode && dirty) {
        event.preventDefault();
    }
});


function setStore(value) {
    store = value;
    sections = store.lists.find(list => list.name === store.active).sections;
}

async function loadSections() {

    // Sur Vercel : lecture à jour depuis GitHub, édition possible.
    try {
        const response = await fetch("/api/data", { cache: "no-store" });
        if (response.ok) {
            const result = await response.json();
            setStore(result.store);
            dataVersion = result.version;
            editBtn.hidden = false;
            return;
        }
    } catch {
        // Pas d'API (serveur statique local) : lecture seule.
    }

    const response = await fetch("data.json");
    sections = await response.json();
}

async function init() {

    await loadSections();

    migrateCheckedItems();
    ensureSectionStates();
    render();
}

init();
