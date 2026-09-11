const items = [
    "Acheter du lait",
    "Acheter des œufs",
    "Acheter du beurre",
    "Acheter de la farine",
    "Acheter du chocolat"
];

const todoList = document.getElementById("todo-list");
const checkedList = document.getElementById("checked-list");


// Charger les cases cochées sauvegardées
let checkedItems = JSON.parse(
    localStorage.getItem("checkedItems") || "[]"
);


// Afficher la liste
function updateLists() {

    todoList.innerHTML = "";
    checkedList.innerHTML = "";

    items.forEach((text, index) => {

        const isChecked = checkedItems.includes(index);

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

                if (!checkedItems.includes(index)) {
                    checkedItems.push(index);
                }

            } else {

                checkedItems = checkedItems.filter(
                    itemIndex => itemIndex !== index
                );

            }

            // Sauvegarder dans le navigateur
            localStorage.setItem(
                "checkedItems",
                JSON.stringify(checkedItems)
            );

            updateLists();
        });

        li.appendChild(checkbox);
        li.appendChild(span);


        if (isChecked) {
            checkedList.appendChild(li);
        } else {
            todoList.appendChild(li);
        }
    });


    // Message lorsqu'il n'y a encore rien d'acheté
    if (checkedList.children.length === 0) {

        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "Rien d'acheté pour l'instant.";

        checkedList.appendChild(empty);
    }
}


// Affichage initial
updateLists();
