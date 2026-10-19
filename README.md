# Atlas

Atlas is a local-first image quiz app. Upload a diagram or photo, place landmarks on it, name each point to build an answer key, then test yourself by finding each named structure on the image.

## Run the desktop app

For a ready-to-use app, install the Windows installer or open the macOS `.dmg` produced by the build workflow. The desktop app does not require users to install Node.js or use a terminal.

To run from source for development:

1. Install [Node.js 22.12 or newer](https://nodejs.org/).
2. Open a terminal in this folder and run:

   ```sh
   npm install
   npm start
   ```

The app opens in its own window. It starts a private local server on a temporary port; it does not expose the server to the network.

## Build installers

Install dependencies once with `npm install`, then run the matching command:

```sh
npm run dist:win
npm run dist:mac
```

Windows builds create an NSIS installer in `dist\`. macOS builds create `.dmg` and `.zip` packages for both Apple Silicon (arm64) and Intel (x64) in `dist/`. macOS packages must be built on macOS; the included GitHub Actions workflow builds the Windows installer and macOS packages on their respective runners.

The macOS builds are unsigned. For distribution beyond testing, sign and notarize them with an Apple Developer ID so macOS users can open them without Gatekeeper warnings. This requires an Apple Developer account and signing credentials.

## Use it

1. Choose **Upload an image** and select a JPG, PNG, GIF, WebP, or SVG file up to 20 MB.
2. Click points on the image. Enter a name for each point in the answer key.
3. Choose **Find on image** to see one name at a time and click its numbered point, or **Free response** to see a highlighted numbered point and type the matching name from your answer key. Free-response answers are case-insensitive.
4. Each quiz runs through every named landmark once in random order. Finish the round to save your score, first-try accuracy, and elapsed time to the study set's scoreboard.
5. Rename, replace, and delete study sets from the app. Each change is saved automatically.

Quizzes, scores, and uploaded images are stored locally in the app's user-data folder, not in the installed application:

- Windows: `%APPDATA%\Atlas\data\`
- macOS: `~/Library/Application Support/Atlas/data/`

The app does not send images to an online service. Back up this `data` folder to keep a separate copy of your study sets. When running the desktop app from source for the first time, Atlas copies an existing project `data` folder into its user-data folder if one is present.

## Run the browser version

The standalone browser version is still available for development:

```sh
node server.js
```

Open `http://127.0.0.1:4173`. This mode stores its data in `data\` beside the source files.
