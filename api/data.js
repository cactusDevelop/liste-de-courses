// Fonction serverless Vercel : lit et écrit data.json directement dans le
// dépôt GitHub, pour que chaque modification faite depuis le site devienne
// un commit (et déclenche un nouveau déploiement).
//
// Variables d'environnement (à définir dans Vercel) :
//   GITHUB_TOKEN   jeton GitHub avec le droit "Contents: read & write" sur le dépôt
//   EDIT_PASSWORD  mot de passe demandé pour passer en mode édition
//   GITHUB_REPO    (optionnel) "propriétaire/dépôt", par défaut ci-dessous
//   GITHUB_BRANCH  (optionnel) branche cible, par défaut "main"

const crypto = require("node:crypto");

const REPO = process.env.GITHUB_REPO || "cactusDevelop/liste-de-courses";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const FILE_PATH = "data.json";
const CONTENTS_URL = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

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

async function readFromGitHub() {
    const response = await fetch(`${CONTENTS_URL}?ref=${encodeURIComponent(BRANCH)}`, {
        headers: githubHeaders()
    });
    if (!response.ok) {
        throw new Error(`GitHub a répondu ${response.status} en lisant ${FILE_PATH}.`);
    }
    const file = await response.json();
    const text = Buffer.from(file.content, "base64").toString("utf8");
    return { sections: JSON.parse(text), sha: file.sha };
}

async function handleGet(res) {
    const { sections, sha } = await readFromGitHub();
    res.status(200).json({ sections, sha });
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

    const { sections, sha } = req.body || {};

    try {
        validateSections(sections);
    } catch (err) {
        res.status(400).json({ error: err.message });
        return;
    }

    if (typeof sha !== "string" || !sha) {
        res.status(400).json({ error: "Version de la liste manquante, rechargez la page." });
        return;
    }

    const text = JSON.stringify(sections, null, 2) + "\n";

    const response = await fetch(CONTENTS_URL, {
        method: "PUT",
        headers: { ...githubHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
            message: "Mise à jour de la liste de courses (web)",
            content: Buffer.from(text, "utf8").toString("base64"),
            sha,
            branch: BRANCH
        })
    });

    // 409 : le fichier a changé entre-temps (autre appareil, app éditeur...).
    if (response.status === 409) {
        res.status(409).json({
            error: "La liste a été modifiée ailleurs entre-temps. Rechargez la page puis refaites vos changements."
        });
        return;
    }

    if (!response.ok) {
        const detail = await response.text();
        res.status(502).json({ error: `GitHub a refusé l'enregistrement (${response.status}) : ${detail}` });
        return;
    }

    const result = await response.json();
    res.status(200).json({ sections, sha: result.content.sha });
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
