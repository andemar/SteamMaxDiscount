# Steam Wishlist ITAD Discount Decorator

Chrome Extension (Manifest V3) that decorates each discounted game in your Steam wishlist with an emoji status based on IsThereAnyDeal historical pricing data.

It compares the current Steam discount with the historical low discount and shows:
- 🟢 current discount matches historical max (first-time/near-first-time)
- 🟡 current discount matches historical max (seen before)
- 🔴 current discount is below historical max
- 🟠 ITAD data unavailable or API error

## How It Works

1. The content script scans Steam wishlist rows (`https://store.steampowered.com/wishlist*`).
2. It extracts game title, Steam appid, and current discount from the DOM.
3. The background script resolves Steam appid to ITAD game ID (`/games/lookup/v1`).
4. It fetches pricing overview (`/games/overview/v2`) from IsThereAnyDeal.
5. The extension renders the emoji next to each game title and caches results in `chrome.storage.local`.

## Add Your ITAD API Key

Edit this file:
- `src/config.ts`

Set your key value:

```ts
export const ITAD_API_KEY: string = "YOUR_ITAD_API_KEY";
```

Notes:
- Do not commit a real API key to a public repository.
- The key is sent as `ITAD-API-Key` header for ITAD API calls.

## Build

From the project root:

```bash
npm install
npm run build
```

Optional checks:

```bash
npm test
npx tsc -p tsconfig.json --noEmit
```

Build output used by the extension:
- `background/background.js`
- `content/content.js`
- `manifest.json`

## Load in Chromium (Developer Mode)

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project folder:
   - `F:\AI\Repos\SteamMaxDiscount`
5. Open your Steam wishlist page:
   - `https://store.steampowered.com/wishlist`
6. Scroll the list to trigger lazy-loaded rows; emojis should appear next to discounted games.

If you update code:
1. Run `npm run build`
2. Click **Reload** on the extension card in `chrome://extensions`

## Cache and Refresh

- The extension caches game mapping and price metadata in `chrome.storage.local`.
- Use the in-page **Clear discount cache** button to clear cached entries and force fresh API fetches.

## Troubleshooting

- **Service worker registration failed**:
  - Rebuild and reload extension (`npm run build` + Reload in `chrome://extensions`).
- **Orange icons on all games**:
  - Verify API key in `src/config.ts`.
  - Check DevTools console for ITAD API errors.
- **No icons appear**:
  - Make sure games are currently discounted (no icon is expected for 0% discount).
  - Refresh wishlist page and scroll to load rows.
