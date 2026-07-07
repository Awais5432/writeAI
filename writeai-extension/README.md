# WriteAI Chrome Extension

MV3 extension — highlight text on any page and run AI writing actions.

## Load unpacked (dev)

1. Start the backend: `cd ../writeai-backend && npm run dev`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select this `writeai-extension` folder
5. Copy your extension ID and set `EXTENSION_ORIGIN=chrome-extension://YOUR_ID` in backend `.env`

Update `API_BASE` in `background/service-worker.js` for production (`https://api.writeai.com`).

## Features

- Text selection toolbar with 5 actions: Fix, Rephrase, Translate, Summarize, Explain
- Google sign-in via popup
- Usage meter and Stripe upgrade flow

## Icons

Replace placeholder icons in `icons/` before Chrome Web Store submission.
