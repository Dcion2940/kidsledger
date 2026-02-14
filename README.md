<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/169EmU0wIsNvelWvWcVyVvLPUKpjDxBCP

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Set `VITE_GOOGLE_CLIENT_ID` in `.env.local` (Google OAuth Web client ID)
4. Add OAuth authorized JavaScript origins in Google Cloud Console:
   - `http://localhost:3000`
   - `https://dcion2940.github.io`
5. Run the app:
   `npm run dev`

## Deploy to GitHub Pages

1. Optional: In GitHub repository **Settings > Secrets and variables > Actions**, add:
   - `VITE_GOOGLE_CLIENT_ID` (if you want a default client ID for all users)
   - `GEMINI_API_KEY` (optional, for AI advice feature)
2. If `VITE_GOOGLE_CLIENT_ID` is not set, users can enter their own Google Client ID on the login page (saved in localStorage per browser).
3. Push to `main`. GitHub Actions will build and deploy automatically.
4. In GitHub repo settings, open **Pages** and set **Build and deployment**:
   - Source: `GitHub Actions`

## Google Sheet Sync Notes

- The target spreadsheet must contain these sheet tabs: `Children`, `Transactions`, `Investments`.
- The signed-in Google account must have edit permission on that spreadsheet.
- To share one family ledger, share the same spreadsheet with both accounts as editors, then both devices use the same Sheet ID.
- In the app, click `匯出 Google Sheet 檔` to download 3 CSV files. Import each file into the matching tab (`Children`, `Transactions`, `Investments`) for quick first-time setup.
