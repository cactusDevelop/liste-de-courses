const fs = require("node:fs/promises");
const path = require("node:path");

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

// Noms interdits : séparateurs de chemin ("../"), caractères invalides
// sous Windows. Défense en profondeur en plus du path.join ci-dessous.
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

function sanitizeListName(name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) {
        throw new Error("Le nom de la liste ne peut pas être vide.");
    }
    if (trimmed === "." || trimmed === "..") {
        throw new Error("Nom de liste invalide.");
    }
    if (INVALID_NAME_CHARS.test(trimmed)) {
        throw new Error('Le nom de la liste ne peut pas contenir : \\ / : * ? " < > |');
    }
    return trimmed;
}

function listsDir(repoRoot) {
    return path.join(repoRoot, "saved-lists");
}

async function listSavedLists(repoRoot) {
    const dir = listsDir(repoRoot);
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir);
    return entries
        .filter((entry) => entry.toLowerCase().endsWith(".json"))
        .map((entry) => entry.slice(0, -".json".length))
        .sort((a, b) => a.localeCompare(b, "fr"));
}

async function readSavedList(repoRoot, name) {
    const safeName = sanitizeListName(name);
    const filePath = path.join(listsDir(repoRoot), `${safeName}.json`);
    return readSections(filePath);
}

async function writeSavedList(repoRoot, name, sections) {
    const safeName = sanitizeListName(name);
    const dir = listsDir(repoRoot);
    await fs.mkdir(dir, { recursive: true });
    await writeSections(path.join(dir, `${safeName}.json`), sections);
}

async function renameSavedList(repoRoot, oldName, newName) {
    const safeOld = sanitizeListName(oldName);
    const safeNew = sanitizeListName(newName);
    if (safeOld === safeNew) {
        return;
    }

    const dir = listsDir(repoRoot);
    const oldPath = path.join(dir, `${safeOld}.json`);
    const newPath = path.join(dir, `${safeNew}.json`);

    let newExists = true;
    try {
        await fs.access(newPath);
    } catch {
        newExists = false;
    }
    if (newExists) {
        throw new Error(`Une liste nommée « ${safeNew} » existe déjà.`);
    }

    await fs.rename(oldPath, newPath);
}

module.exports = {
    validateSections,
    readSections,
    writeSections,
    listSavedLists,
    readSavedList,
    writeSavedList,
    renameSavedList
};
