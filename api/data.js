// Fonction serverless Vercel : lit et écrit les listes directement dans le
// dépôt GitHub, pour que chaque modification faite depuis le site devienne
// un commit (et déclenche un nouveau déploiement).
//
// Fichiers concernés :
//   lists.json  toutes les listes enregistrées + le nom de la liste active
//   data.json   copie de la liste active (format historique, lu par l'app
//               éditeur et par le site en mode statique)
//
// Variables d'environnement (à définir dans Vercel) :
//   GITHUB_TOKEN   jeton GitHub avec le droit "Contents: read & write" sur le dépôt
//   EDIT_PASSWORD  mot de passe demandé pour passer en mode édition
//   GITHUB_REPO    (optionnel) "propriétaire/dépôt", par défaut ci-dessous
//   GITHUB_BRANCH  (optionnel) branche cible, par défaut "main"

const crypto = require("node:crypto");

const REPO = process.env.GITHUB_REPO || "cactusDevelop/liste-de-courses";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const DATA_PATH = "data.json";
const LISTS_PATH = "lists.json";
const API_URL = `https://api.github.com/repos/${REPO}`;

const DEFAULT_LIST_NAME = "Ma liste";

function githubHeaders() {
    const headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "liste-de-courses"
    };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    return headers;
}

async function github(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: { ...githubHeaders(), ...(options.body ? { "Content-Type": "application/json" } : {}) }
    });
    return response;
}

function validateSections(sections) {

    if (!Array.isArray(sections)) {
        throw new Error("Format invalide : la liste des rayons doit être un tableau.");
    }

    for (const section of sections) {

        if (typeof section?.name !== "string" || !section.name.trim() || !Array.isArray(section.items)) {
            throw new Error("Format invalide : chaque rayon doit avoir un nom et une liste d'articles.");
        }

        for (const item of section.items) {
            if (typeof item !== "string") {
                throw new Error("Format invalide : chaque article doit être du texte.");
            }
        }
    }
}

function validateStore(store) {

    if (!store || typeof store !== "object" || !Array.isArray(store.lists)) {
        throw new Error("Format invalide : les listes doivent être un tableau.");
    }

    const names = new Set();

    for (const list of store.lists) {

        if (typeof list?.name !== "string" || !list.name.trim()) {
            throw new Error("Chaque liste doit avoir un nom.");
        }
        if (names.has(list.name)) {
            throw new Error(`Deux listes portent le nom « ${list.name} ».`);
        }
        names.add(list.name);

        if (list.template !== undefined && typeof list.template !== "boolean") {
            throw new Error("Format invalide : « template » doit être vrai ou faux.");
        }
        validateSections(list.sections);
    }

    const active = store.lists.find(list => list.name === store.active);
    if (!active) {
        throw new Error("La liste active n'existe pas.");
    }
    if (active.template) {
        throw new Error("Un modèle ne peut pas être la liste active.");
    }
}

// Comparaison à temps constant, pour ne pas révéler le mot de passe
// caractère par caractère via le temps de réponse.
function passwordMatches(given) {
    const expected = process.env.EDIT_PASSWORD;
    if (!expected || typeof given !== "string") {
        return false;
    }
    const a = crypto.createHash("sha256").update(given).digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

// Lit un fichier JSON du dépôt ; renvoie null s'il n'existe pas.
async function readJsonFile(path, ref) {
    const response = await github(`/contents/${path}?ref=${encodeURIComponent(ref)}`);
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`GitHub a répondu ${response.status} en lisant ${path}.`);
    }
    const file = await response.json();
    const text = Buffer.from(file.content, "base64").toString("utf8");
    return { value: JSON.parse(text), sha: file.sha };
}

async function readFromGitHub(ref = BRANCH) {

    const [data, lists] = await Promise.all([readJsonFile(DATA_PATH, ref), readJsonFile(LISTS_PATH, ref)]);

    if (!data) {
        throw new Error(`${DATA_PATH} est introuvable dans le dépôt.`);
    }

    let store = lists?.value;
    if (!store || !Array.isArray(store.lists) || !store.lists.some(list => list.name === store.active)) {
        store = { active: DEFAULT_LIST_NAME, lists: [{ name: DEFAULT_LIST_NAME, sections: data.value }] };
    }

    // data.json fait foi pour la liste active : il a pu être modifié
    // directement (app éditeur, commit manuel) sans passer par lists.json.
    store.lists.find(list => list.name === store.active).sections = data.value;

    return {
        store,
        version: { data: data.sha, lists: lists ? lists.sha : null }
    };
}

function toFileText(value) {
    return JSON.stringify(value, null, 2) + "\n";
}

// Écrit data.json et lists.json en un seul commit, via l'API Git bas niveau.
async function writeToGitHub(store, version) {

    const refResponse = await github(`/git/ref/heads/${encodeURIComponent(BRANCH)}`);
    if (!refResponse.ok) {
        throw new Error(`GitHub a répondu ${refResponse.status} en lisant la branche ${BRANCH}.`);
    }
    const headSha = (await refResponse.json()).object.sha;

    // Les fichiers ont-ils changé depuis le chargement de la page ?
    const current = await readFromGitHub(headSha);
    if (current.version.data !== version?.data || current.version.lists !== version?.lists) {
        return { conflict: true };
    }

    const commitResponse = await github(`/git/commits/${headSha}`);
    if (!commitResponse.ok) {
        throw new Error(`GitHub a répondu ${commitResponse.status} en lisant le dernier commit.`);
    }
    const baseTree = (await commitResponse.json()).tree.sha;

    const activeSections = store.lists.find(list => list.name === store.active).sections;

    const treeResponse = await github("/git/trees", {
        method: "POST",
        body: JSON.stringify({
            base_tree: baseTree,
            tree: [
                { path: DATA_PATH, mode: "100644", type: "blob", content: toFileText(activeSections) },
                { path: LISTS_PATH, mode: "100644", type: "blob", content: toFileText(store) }
            ]
        })
    });
    if (!treeResponse.ok) {
        throw new Error(`GitHub a refusé l'enregistrement (${treeResponse.status}) : ${await treeResponse.text()}`);
    }
    const tree = await treeResponse.json();

    const newCommitResponse = await github("/git/commits", {
        method: "POST",
        body: JSON.stringify({
            message: "Mise à jour de la liste de courses (web)",
            tree: tree.sha,
            parents: [headSha]
        })
    });
    if (!newCommitResponse.ok) {
        throw new Error(`GitHub a refusé l'enregistrement (${newCommitResponse.status}) : ${await newCommitResponse.text()}`);
    }
    const newCommit = await newCommitResponse.json();

    // force: false → échoue si la branche a avancé entre-temps.
    const updateResponse = await github(`/git/refs/heads/${encodeURIComponent(BRANCH)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: newCommit.sha, force: false })
    });
    if (updateResponse.status === 422 || updateResponse.status === 409) {
        return { conflict: true };
    }
    if (!updateResponse.ok) {
        throw new Error(`GitHub a refusé l'enregistrement (${updateResponse.status}) : ${await updateResponse.text()}`);
    }

    const shaOf = path => tree.tree.find(entry => entry.path === path)?.sha ?? null;
    return { version: { data: shaOf(DATA_PATH), lists: shaOf(LISTS_PATH) } };
}

async function handleGet(res) {
    const { store, version } = await readFromGitHub();
    res.status(200).json({ store, version });
}

async function handlePut(req, res) {

    if (!passwordMatches(req.headers["x-edit-password"])) {
        res.status(401).json({ error: "Mot de passe incorrect." });
        return;
    }

    if (!process.env.GITHUB_TOKEN) {
        res.status(500).json({ error: "GITHUB_TOKEN n'est pas configuré sur Vercel." });
        return;
    }

    const { store, version } = req.body || {};

    try {
        validateStore(store);
    } catch (err) {
        res.status(400).json({ error: err.message });
        return;
    }

    if (!version || typeof version.data !== "string") {
        res.status(400).json({ error: "Version de la liste manquante, rechargez la page." });
        return;
    }

    const clean = {
        active: store.active,
        lists: store.lists.map(list => ({
            name: list.name,
            ...(list.template ? { template: true } : {}),
            sections: list.sections
        }))
    };

    const result = await writeToGitHub(clean, version);

    // Les fichiers ont changé entre-temps (autre appareil, app éditeur...).
    if (result.conflict) {
        res.status(409).json({
            error: "La liste a été modifiée ailleurs entre-temps. Rechargez la page puis refaites vos changements."
        });
        return;
    }

    res.status(200).json({ store: clean, version: result.version });
}

module.exports = async (req, res) => {

    res.setHeader("Cache-Control", "no-store");

    try {
        if (req.method === "GET") {
            await handleGet(res);
        } else if (req.method === "PUT") {
            await handlePut(req, res);
        } else {
            res.setHeader("Allow", "GET, PUT");
            res.status(405).json({ error: "Méthode non autorisée." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
