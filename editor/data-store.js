const fs = require("node:fs/promises");

function validateSections(sections) {

    if (!Array.isArray(sections)) {
        throw new Error("Format invalide : la liste des rayons doit être un tableau.");
    }

    for (const section of sections) {

        if (typeof section?.name !== "string" || !Array.isArray(section.items)) {
            throw new Error("Format invalide : chaque rayon doit avoir un nom et une liste d'articles.");
        }

        for (const item of section.items) {
            if (typeof item !== "string") {
                throw new Error("Format invalide : chaque article doit être du texte.");
            }
        }
    }
}

async function readSections(dataPath) {
    const text = await fs.readFile(dataPath, "utf8");
    return JSON.parse(text);
}

async function writeSections(dataPath, sections) {
    validateSections(sections);
    const text = JSON.stringify(sections, null, 2) + "\n";
    await fs.writeFile(dataPath, text, "utf8");
}

module.exports = { validateSections, readSections, writeSections };
