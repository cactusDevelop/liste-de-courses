const sections = [
    {
        name: "Fruits et légumes",
        items: [
            "Pommes",
            "Bananes",
            "Carottes",
            "Tomates"
        ]
    },

    {
        name: "Produits frais",
        items: [
            "Lait",
            "Œufs",
            "Beurre",
            "Yaourts"
        ]
    },

    {
        name: "Épicerie",
        items: [
            "Farine",
            "Sucre",
            "Pâtes",
            "Riz"
        ]
    },

    {
        name: "Boulangerie",
        items: [
            "Pain",
            "Croissants"
        ]
    }
];


const container = document.getElementById("store-sections");


// Charger les cases cochées
let checkedItems = JSON.parse(
    localStorage.getItem("checkedItems") || "[]"
);


// Créer les sections
function updateLists() {

    container.innerHTML = "";

    sections.forEach((section, sectionIndex) => {

        const details = document.createElement("details");

        // Le premier magasin est ouvert au départ
        if (sectionIndex === 0) {
            details.open = true;
        }

        const summary = document.createElement("summary");
        summary.textContent = section.name;

        details.appendChild(summary);


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


                localStorage.setItem(
                    "checkedItems",
                    JSON.stringify(checkedItems)
                );


                updateLists();
            });


            li.appendChild(checkbox);
            li.appendChild(span);

            ul.appendChild(li);
        });


        details.appendChild(ul);
        container.appendChild(details);
    });
}


updateLists();
