const container = document.getElementById("store-sections");

let sections = [];

// Cases cochées
let checkedItems = JSON.parse(
    localStorage.getItem("checkedItems") || "[]"
);

// État ouvert/fermé des sections
let sectionStates = JSON.parse(
    localStorage.getItem("sectionStates") || "null"
);


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


function createItem(sectionIndex, itemIndex, text) {

    const id = `${sectionIndex}-${itemIndex}`;
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
    section.items.forEach((text, itemIndex) => {
        ul.appendChild(createItem(sectionIndex, itemIndex, text));
    });

    details.appendChild(summary);
    details.appendChild(ul);

    return details;
}


function render() {

    container.innerHTML = "";

    sections.forEach((section, sectionIndex) => {
        container.appendChild(createSection(section, sectionIndex));
    });
}


async function init() {

    const response = await fetch("data.json");
    sections = await response.json();

    ensureSectionStates();
    render();
}

init();
