// Fonction serverless Vercel : recherche d'images pour les articles, sans clé
// d'API. Passe par le serveur car Open Food Facts n'autorise pas les appels
// directs depuis le navigateur.
//
// Sources, par ordre d'affichage :
//   Open Food Facts   photos de produits emballés
//   Wikimedia Commons le reste (fruits, légumes, objets...)

const MAX_QUERY_LENGTH = 100;
const RESULTS_PER_SOURCE = 12;
const TIMEOUT_MS = 6000;
const USER_AGENT = "liste-de-courses (https://liste-de-courses-teal.vercel.app)";

async function fetchJson(url) {
    const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`${url.hostname} a répondu ${response.status}.`);
    }
    return response.json();
}

async function searchOpenFoodFacts(query) {

    const url = new URL("https://search.openfoodfacts.org/search");
    url.search = new URLSearchParams({
        q: query,
        langs: "fr",
        page_size: RESULTS_PER_SOURCE,
        fields: "product_name,image_front_small_url"
    });

    const { hits = [] } = await fetchJson(url);
    return hits
        .filter(hit => hit.image_front_small_url)
        .map(hit => ({ url: hit.image_front_small_url, title: hit.product_name || query }));
}

async function searchCommons(query) {

    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
        action: "query",
        format: "json",
        generator: "search",
        gsrnamespace: 6,
        gsrlimit: RESULTS_PER_SOURCE,
        gsrsearch: `${query} filetype:bitmap`,
        prop: "imageinfo",
        iiprop: "url",
        iiurlwidth: 250
    });

    const result = await fetchJson(url);
    return Object.values(result.query?.pages ?? {})
        .sort((a, b) => a.index - b.index)
        .filter(page => page.imageinfo?.[0]?.thumburl)
        .map(page => ({
            url: page.imageinfo[0].thumburl,
            title: page.title.replace(/^File:/, "").replace(/\.\w+$/, "")
        }));
}

module.exports = async (req, res) => {

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        res.status(405).json({ error: "Méthode non autorisée." });
        return;
    }

    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!query || query.length > MAX_QUERY_LENGTH) {
        res.status(400).json({ error: "Recherche vide ou trop longue." });
        return;
    }

    // Une source en panne ne doit pas priver des résultats de l'autre.
    const searches = await Promise.allSettled([searchOpenFoodFacts(query), searchCommons(query)]);
    const found = searches.filter(search => search.status === "fulfilled");

    if (found.length === 0) {
        res.setHeader("Cache-Control", "no-store");
        res.status(502).json({ error: "La recherche d'images est indisponible pour le moment." });
        return;
    }

    const results = found.flatMap(search => search.value);
    const unique = [...new Map(results.map(result => [result.url, result])).values()];

    res.setHeader("Cache-Control", "public, s-maxage=86400");
    res.status(200).json({ results: unique });
};
