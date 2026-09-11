const sections = [
    {
        name: "Fruits & légumes",
        items: [
            "Fruits de saison",
            "Champignons",
            "Patates"
        ]
    },

    {
        name: "Produits frais",
        items: [
            "Œufs — 5",
            "Yaourt nature",
            "Tofu",
            "Aiguillettes poulet/dinde",
            "Petit fromage (e.g. brie)",
            "Beurre doux — 220 g",
            "Crème liquide entière 30–35 % MG — 105 g"
        ]
    },

    {
        name: "Épicerie",
        items: [
            "Lentilles",
            "Céréales (quinoa/muesli)",
            "Amandes en poudre — 100 g",
            "Sucre glace — 100 g",
            "Sucre en poudre — 150 g",
            "Farine — 30 g",
            "Café soluble — 10 g",
            "Chocolat noir ≥70 % — 250 g",
            "Huile neutre (tournesol ou pépins de raisin) — 20 g"
        ]
    },

    {
        name: "Boissons",
        items: [
            "Jus"
        ]
    },

    {
        name: "Boulangerie",
        items: [
            "Papier cuisson de bonne qualité"
        ]
    }
];


const container = document.getElementById("store-sections");


// Cases cochées
let checkedItems = JSON.parse(
    localStorage.getItem("checkedItems") || "[]"
);


// État ouvert/fermé des sections
let sectionStates = JSON.parse(
    localStorage.getItem("sectionStates") || "null"
);


// Première visite : toutes les sections sont ouvertes
if (
    sectionStates === null ||
    !Array.isArray(sectionStates) ||
    sectionStates.length !== sections.length
) {
    sectionStates = sections.map(() => true);

    localStorage.setItem(
        "sectionStates",
        JSON.stringify(sectionStates)
    );
}


function updateLists() {

    container.innerHTML = "";

    sections.forEach((section, sectionIndex) => {

        const details = document.createElement("details");

        // Restaurer l'état de cette section
        details.open = sectionStates[sectionIndex];


        // Sauvegarder lorsque l'utilisateur ouvre ou ferme
        details.addEventListener("toggle", () => {

            sectionStates[sectionIndex] = details.open;

            localStorage.setItem(
                "sectionStates",
                JSON.stringify(sectionStates)
            );
        });


        const summary = document.createElement("summary");
        summary.textContent = section.name;


        const ul = document.createElement("ul");


        section.items.forEach((text, itemIndex) => {

            const id = `${sectionIndex}-${itemIndex}`;

            const isChecked = checkedItems.includes(id);


            const li = document.createElement("li");

            if (isChecked) {
                li.classList.add("checked");
            }


            const checkbox = document.createElement("input");

            checkbox.type = "checkbox";
            checkbox.checked = isChecked;


            const span = document.createElement("span");

            span.className = "item-text";
            span.textContent = text;


            checkbox.addEventListener("change", () => {

                if (checkbox.checked) {

                    if (!checkedItems.includes(id)) {
                        checkedItems.push(id);
                    }

                } else {

                    checkedItems = checkedItems.filter(
                        itemId => itemId !== id
                    );
                }


                // Sauvegarder les cases cochées
                localStorage.setItem(
                    "checkedItems",
                    JSON.stringify(checkedItems)
                );


                // Reconstruire la liste.
                // L'état ouvert/fermé est restauré
                // grâce à sectionStates.
                updateLists();
            });


            li.appendChild(checkbox);
            li.appendChild(span);

            ul.appendChild(li);
        });


        details.appendChild(summary);
        details.appendChild(ul);

        container.appendChild(details);
    });
}


// Affichage initial
updateLists();
