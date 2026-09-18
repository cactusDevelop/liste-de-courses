const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fsSync = require("node:fs");
const { execFile } = require("node:child_process");
const util = require("node:util");
const {
    readSections,
    writeSections,
    listSavedLists,
    readSavedList,
    writeSavedList,
    renameSavedList
} = require("./data-store");

const execFileAsync = util.promisify(execFile);

const configPath = path.join(app.getPath("userData"), "config.json");

// Le chemin du dépôt liste-de-courses sur le disque de l'utilisateur.
// Résolu au démarrage (voir resolveRepoRoot) car un .exe empaqueté ne
// s'exécute pas depuis le dépôt : __dirname pointe alors vers un dossier
// temporaire créé par l'exécutable portable.
let repoRoot = null;


function loadConfig() {
    try {
        return JSON.parse(fsSync.readFileSync(configPath, "utf8"));
    } catch {
        return {};
    }
}

function saveConfig(partial) {
    const config = { ...loadConfig(), ...partial };
    fsSync.mkdirSync(path.dirname(configPath), { recursive: true });
    fsSync.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function isValidRepoRoot(candidate) {
    return !!candidate && fsSync.existsSync(path.join(candidate, "data.json"));
}

async function pickRepoRoot(parentWindow) {

    const result = await dialog.showOpenDialog(parentWindow, {
        title: "Sélectionne le dossier du dépôt « liste-de-courses » (celui qui contient data.json)",
        properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    const chosen = result.filePaths[0];
    if (!isValidRepoRoot(chosen)) {
        dialog.showErrorBox(
            "Dossier invalide",
            `Le dossier choisi ne contient pas de fichier data.json :\n${chosen}`
        );
        return null;
    }

    return chosen;
}

async function resolveRepoRoot() {

    // 1) déjà configuré lors d'un lancement précédent, et toujours valide
    const config = loadConfig();
    if (isValidRepoRoot(config.repoPath)) {
        return config.repoPath;
    }

    // 2) lancé depuis l'intérieur du dépôt (ex. `npm start` en développement)
    const devCandidate = path.join(__dirname, "..");
    if (isValidRepoRoot(devCandidate)) {
        saveConfig({ repoPath: devCandidate });
        return devCandidate;
    }

    // 3) premier lancement du .exe empaqueté : demander une fois
    const chosen = await pickRepoRoot(null);
    if (!chosen) {
        return null;
    }

    saveConfig({ repoPath: chosen });
    return chosen;
}


function createWindow() {
    const win = new BrowserWindow({
        width: 760,
        height: 920,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.loadFile(path.join(__dirname, "renderer", "editor.html"));
    return win;
}

app.whenReady().then(async () => {
    repoRoot = await resolveRepoRoot();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});


function describeError(err) {
    return (err?.stderr && err.stderr.toString().trim()) || err?.message || String(err);
}

function requireRepoRoot() {
    if (!repoRoot) {
        throw new Error("Aucun dossier de dépôt sélectionné.");
    }
    return repoRoot;
}


ipcMain.handle("data:load", () => readSections(path.join(requireRepoRoot(), "data.json")));

ipcMain.handle("data:save", async (_event, sections) => {
    await writeSections(path.join(requireRepoRoot(), "data.json"), sections);
    return { ok: true };
});

ipcMain.handle("git:publish", async (_event, { sections, message }) => {

    const log = [];

    try {
        const root = requireRepoRoot();
        await writeSections(path.join(root, "data.json"), sections);
        log.push("data.json enregistré.");

        // -A : on publie tout le dépôt (pas seulement data.json), pour que
        // "Publier" suffise même quand d'autres fichiers du site ont changé
        // (ex. index.html/script.js/style.css) sans passer par cette app.
        await execFileAsync("git", ["add", "-A"], { cwd: root });

        const status = await execFileAsync(
            "git", ["status", "--porcelain"], { cwd: root }
        );

        if (!status.stdout.trim()) {
            log.push("Aucun changement à publier (le dépôt est déjà à jour sur Git).");
            return { ok: true, log, pushed: false };
        }

        const commitMessage = (message && message.trim()) || "Mise à jour de la liste de courses";

        const commit = await execFileAsync(
            "git", ["commit", "-m", commitMessage], { cwd: root }
        );
        log.push(commit.stdout.trim() || "Commit effectué.");

        const push = await execFileAsync("git", ["push"], { cwd: root });
        log.push(push.stdout.trim() || push.stderr.trim() || "Publié sur GitHub.");

        return { ok: true, log, pushed: true };

    } catch (err) {
        log.push(describeError(err));
        return { ok: false, log, error: describeError(err) };
    }
});

ipcMain.handle("git:status", async () => {
    try {
        const root = requireRepoRoot();
        const { stdout } = await execFileAsync(
            "git", ["status", "--porcelain"], { cwd: root }
        );
        return { ok: true, dirty: stdout.trim().length > 0 };
    } catch (err) {
        return { ok: false, error: describeError(err) };
    }
});

ipcMain.handle("lists:list", () => listSavedLists(requireRepoRoot()));

ipcMain.handle("lists:load", (_event, name) => readSavedList(requireRepoRoot(), name));

ipcMain.handle("lists:save", async (_event, { name, sections }) => {
    await writeSavedList(requireRepoRoot(), name, sections);
    return { ok: true };
});

ipcMain.handle("lists:rename", async (_event, { oldName, newName }) => {
    await renameSavedList(requireRepoRoot(), oldName, newName);
    return { ok: true };
});

ipcMain.handle("repo:current", () => repoRoot);

ipcMain.handle("repo:choose", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const chosen = await pickRepoRoot(win);
    if (!chosen) {
        return { ok: false };
    }
    repoRoot = chosen;
    saveConfig({ repoPath: chosen });
    return { ok: true, repoRoot };
});
