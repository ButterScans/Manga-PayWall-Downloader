const GITHUB_RELEASES_API = 'https://api.github.com/repos/ButterScans/Manga-PayWall-Downloader/releases/latest';
const GITHUB_RELEASE_PAGE = 'https://github.com/ButterScans/Manga-PayWall-Downloader/releases/latest';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;

    if (msg.action === 'check_update') {
        fetch(GITHUB_RELEASES_API, { cache: "no-store" })
            .then(async (res) => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                const latestTag = data.tag_name;
                const htmlUrl = data.html_url || GITHUB_RELEASE_PAGE;
                sendResponse({ success: true, latestTag, htmlUrl });
            })
            .catch(err => {
                console.warn('check_update failed', err);
                sendResponse({ success: false, error: String(err) });
            });

        return true;
    }
});